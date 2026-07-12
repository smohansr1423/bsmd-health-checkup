/**
 * Knowledge Engine — SpecParser
 *
 * Parses an uploaded OpenAPI 3.x or Swagger 2.0 specification into the
 * normalized {@link ApiMetadata} model (Req 1). The parser:
 *   1. Enforces the 25 MB size and YAML/JSON format gate BEFORE parsing (Req 1.5).
 *   2. Parses YAML or JSON, surfacing the first invalid element on failure (Req 1.4).
 *   3. Detects the specification format (OpenAPI 3.x / Swagger 2.0).
 *   4. Dereferences local `$ref`s.
 *   5. Normalizes both formats into a single {@link ApiMetadata} model, capturing
 *      every endpoint, method, parameter, request/response schema, auth scheme,
 *      response example, error code, and rate-limit entry (Req 1.1, 1.2, 1.3).
 *   6. Rejects a valid-but-empty spec with {@link NoMetadataFoundError} (Req 1.6).
 *
 * On any parse failure the parser produces NO partial metadata: everything is
 * assembled in local state and only returned on complete success (Req 1.4).
 *
 * Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 1.6
 */

import { load as loadYaml, YAMLException } from 'js-yaml';

import type {
  ApiMetadata,
  AuthScheme,
  AuthSchemeMeta,
  DateProvider,
  EndpointMeta,
  HttpMethod,
  IdGenerator,
  JsonSchema,
  ParameterMeta,
  RateLimitMeta,
  SpecFormat,
} from '../api-copilot-shared';
import { defaultDateProvider, defaultIdGenerator } from '../api-copilot-shared';

import {
  NoMetadataFoundError,
  SpecParseError,
} from './knowledge-engine.errors';
import type { SpecParser, SpecParserDependencies } from './knowledge-engine.types';
import { isRecord, validateUploadGate } from './knowledge-engine.validators';

/** HTTP method keys recognized on a path item, in canonical order. */
const HTTP_METHODS: readonly string[] = [
  'get',
  'post',
  'put',
  'patch',
  'delete',
  'head',
  'options',
];

const PARAM_LOCATIONS: readonly string[] = ['path', 'query', 'header', 'cookie', 'body'];

/** Matches rate-limit-style header names (e.g. `X-RateLimit-Limit`, `RateLimit-Reset`). */
const RATE_LIMIT_NAME = /rate.?limit/i;

// ---------------------------------------------------------------------------
// JSON Pointer / $ref helpers
// ---------------------------------------------------------------------------

function decodePointerToken(token: string): string {
  return token.replace(/~1/g, '/').replace(/~0/g, '~');
}

/** Convert a local JSON reference (`#/a/b/c`) to a list of path segments. */
function pointerToSegments(ref: string): string[] {
  const hashIndex = ref.indexOf('#');
  const fragment = hashIndex >= 0 ? ref.slice(hashIndex + 1) : ref;
  return fragment
    .split('/')
    .filter((segment) => segment.length > 0)
    .map(decodePointerToken);
}

function resolveRef(root: Record<string, unknown>, ref: string): unknown {
  let current: unknown = root;
  for (const segment of pointerToSegments(ref)) {
    if (!isRecord(current) || !(segment in current)) {
      throw new SpecParseError(ref, 'unresolved $ref: reference target not found');
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/**
 * Recursively replace local `$ref`s with their resolved targets. External
 * references are rejected (Req 1.4). Circular references are broken by
 * substituting an empty object so normalization terminates.
 */
function dereference(
  node: unknown,
  root: Record<string, unknown>,
  stack: Set<string>
): unknown {
  if (Array.isArray(node)) {
    return node.map((item) => dereference(item, root, stack));
  }
  if (!isRecord(node)) {
    return node;
  }

  if (typeof node.$ref === 'string') {
    const ref = node.$ref;
    if (!ref.startsWith('#')) {
      throw new SpecParseError(
        ref,
        'external or unsupported $ref; only local "#/" references are supported'
      );
    }
    if (stack.has(ref)) {
      // Circular reference — break the cycle without recursing further.
      return {};
    }
    const target = resolveRef(root, ref);
    const nextStack = new Set(stack);
    nextStack.add(ref);
    return dereference(target, root, nextStack);
  }

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    out[key] = dereference(value, root, stack);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Small normalization helpers
// ---------------------------------------------------------------------------

function asString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function asSchema(value: unknown): JsonSchema {
  return isRecord(value) ? (value as JsonSchema) : {};
}

/** Pick the first media-type schema from an OpenAPI 3 `content` map. */
function firstContentSchema(content: unknown): JsonSchema | undefined {
  if (!isRecord(content)) {
    return undefined;
  }
  for (const media of Object.values(content)) {
    if (isRecord(media) && isRecord(media.schema)) {
      return media.schema as JsonSchema;
    }
  }
  return undefined;
}

/** Pick the first available example from an OpenAPI 3 `content` map. */
function firstContentExample(content: unknown): unknown {
  if (!isRecord(content)) {
    return undefined;
  }
  for (const media of Object.values(content)) {
    if (!isRecord(media)) {
      continue;
    }
    if ('example' in media) {
      return media.example;
    }
    if (isRecord(media.examples)) {
      const examples = Object.values(media.examples);
      if (examples.length > 0) {
        const first = examples[0];
        // OpenAPI wraps examples as `{ value: ... }`.
        return isRecord(first) && 'value' in first ? first.value : first;
      }
    }
  }
  return undefined;
}

function isErrorStatus(statusCode: string): boolean {
  const numeric = Number.parseInt(statusCode, 10);
  return Number.isFinite(numeric) && numeric >= 400;
}

function toRateLimitMeta(id: string, source: Record<string, unknown>): RateLimitMeta {
  const meta: RateLimitMeta = { id, details: source };
  if (typeof source.limit === 'number') {
    meta.limit = source.limit;
  }
  if (typeof source.windowSeconds === 'number') {
    meta.windowSeconds = source.windowSeconds;
  } else if (typeof source.window === 'number') {
    meta.windowSeconds = source.window;
  }
  return meta;
}

// ---------------------------------------------------------------------------
// Rate-limit extraction (format-agnostic)
// ---------------------------------------------------------------------------

/**
 * Collect rate-limit entries declared in the specification: vendor extensions
 * (`x-rate-limit` / `x-ratelimit`) at the root, and any response header whose
 * name identifies a rate-limit policy.
 */
function extractRateLimits(root: Record<string, unknown>): RateLimitMeta[] {
  const results: RateLimitMeta[] = [];
  const seen = new Set<string>();

  const push = (id: string, source: Record<string, unknown>): void => {
    if (seen.has(id)) {
      return;
    }
    seen.add(id);
    results.push(toRateLimitMeta(id, source));
  };

  // Root-level vendor extensions.
  for (const key of ['x-rate-limit', 'x-ratelimit', 'x-rateLimit']) {
    const value = root[key];
    if (Array.isArray(value)) {
      value.forEach((entry, index) => {
        if (isRecord(entry)) {
          push(asString(entry.id, `${key}[${index}]`), entry);
        }
      });
    } else if (isRecord(value)) {
      push(asString(value.id, key), value);
    }
  }

  // Response headers named like a rate-limit policy.
  const paths = isRecord(root.paths) ? root.paths : {};
  for (const pathItem of Object.values(paths)) {
    if (!isRecord(pathItem)) {
      continue;
    }
    for (const method of HTTP_METHODS) {
      const operation = pathItem[method];
      if (!isRecord(operation) || !isRecord(operation.responses)) {
        continue;
      }
      for (const response of Object.values(operation.responses)) {
        if (!isRecord(response) || !isRecord(response.headers)) {
          continue;
        }
        for (const [headerName, headerDef] of Object.entries(response.headers)) {
          if (RATE_LIMIT_NAME.test(headerName)) {
            push(headerName, isRecord(headerDef) ? headerDef : {});
          }
        }
      }
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// OpenAPI 3.x normalization
// ---------------------------------------------------------------------------

function normalizeParameterLocation(location: unknown): ParameterMeta['location'] {
  const value = typeof location === 'string' ? location.toLowerCase() : '';
  return (PARAM_LOCATIONS.includes(value) ? value : 'query') as ParameterMeta['location'];
}

function normalizeOas3Parameter(param: Record<string, unknown>): ParameterMeta {
  const location = normalizeParameterLocation(param.in);
  const meta: ParameterMeta = {
    name: asString(param.name, ''),
    location,
    // Path parameters are always required per the OpenAPI spec.
    required: location === 'path' ? true : param.required === true,
    schema: asSchema(param.schema),
  };
  if ('example' in param) {
    meta.example = param.example;
  }
  return meta;
}

function mergeParameters(
  pathLevel: unknown,
  operationLevel: unknown
): Record<string, unknown>[] {
  const merged = new Map<string, Record<string, unknown>>();
  const add = (list: unknown): void => {
    if (!Array.isArray(list)) {
      return;
    }
    for (const entry of list) {
      if (isRecord(entry)) {
        merged.set(`${asString(entry.in, '')}:${asString(entry.name, '')}`, entry);
      }
    }
  };
  add(pathLevel);
  // Operation-level parameters override path-level ones with the same name+location.
  add(operationLevel);
  return [...merged.values()];
}

function mapOas3AuthType(scheme: Record<string, unknown>): AuthScheme {
  const type = asString(scheme.type, '').toLowerCase();
  if (type === 'apikey') {
    return 'apiKey';
  }
  if (type === 'http') {
    const httpScheme = asString(scheme.scheme, '').toLowerCase();
    if (httpScheme === 'basic') {
      return 'basic';
    }
    if (httpScheme === 'bearer') {
      return asString(scheme.bearerFormat, '').toLowerCase() === 'jwt' ? 'jwt' : 'bearer';
    }
    return 'bearer';
  }
  if (type === 'oauth2') {
    return isRecord(scheme.flows) && 'clientCredentials' in scheme.flows
      ? 'clientCredentials'
      : 'oauth2';
  }
  if (type === 'openidconnect') {
    return 'oauth2';
  }
  // Unknown type — default to apiKey; the original type is preserved in details.
  return 'apiKey';
}

function extractOas3AuthSchemes(root: Record<string, unknown>): AuthSchemeMeta[] {
  const components = isRecord(root.components) ? root.components : {};
  const securitySchemes = isRecord(components.securitySchemes)
    ? components.securitySchemes
    : {};
  const schemes: AuthSchemeMeta[] = [];
  for (const [id, def] of Object.entries(securitySchemes)) {
    if (!isRecord(def)) {
      continue;
    }
    schemes.push({ id, type: mapOas3AuthType(def), details: def });
  }
  return schemes;
}

function extractSecurityRefs(security: unknown): string[] {
  if (!Array.isArray(security)) {
    return [];
  }
  const refs = new Set<string>();
  for (const requirement of security) {
    if (isRecord(requirement)) {
      for (const name of Object.keys(requirement)) {
        refs.add(name);
      }
    }
  }
  return [...refs];
}

function extractOas3Responses(responses: unknown): {
  responseSchemas: Record<string, JsonSchema>;
  responseExamples: Record<string, unknown>;
  errorCodes: string[];
} {
  const responseSchemas: Record<string, JsonSchema> = {};
  const responseExamples: Record<string, unknown> = {};
  const errorCodes: string[] = [];

  if (isRecord(responses)) {
    for (const [statusCode, response] of Object.entries(responses)) {
      if (!isRecord(response)) {
        continue;
      }
      const schema = firstContentSchema(response.content);
      if (schema !== undefined) {
        responseSchemas[statusCode] = schema;
      }
      const example = firstContentExample(response.content);
      if (example !== undefined) {
        responseExamples[statusCode] = example;
      }
      if (isErrorStatus(statusCode)) {
        errorCodes.push(statusCode);
      }
    }
  }

  return { responseSchemas, responseExamples, errorCodes };
}

function normalizeOpenApi3(root: Record<string, unknown>, apiId: string): ApiMetadata {
  const info = isRecord(root.info) ? root.info : {};
  const title = asString(info.title, 'Untitled API');
  const paths = isRecord(root.paths) ? root.paths : {};
  const rootSecurity = root.security;

  const endpoints: EndpointMeta[] = [];
  for (const [path, pathItem] of Object.entries(paths)) {
    if (!isRecord(pathItem)) {
      continue;
    }
    for (const method of HTTP_METHODS) {
      const operation = pathItem[method];
      if (!isRecord(operation)) {
        continue;
      }

      const parameters = mergeParameters(pathItem.parameters, operation.parameters).map(
        normalizeOas3Parameter
      );

      let requestSchema: JsonSchema | undefined;
      if (isRecord(operation.requestBody)) {
        requestSchema = firstContentSchema(operation.requestBody.content);
      }

      const { responseSchemas, responseExamples, errorCodes } = extractOas3Responses(
        operation.responses
      );

      const endpoint: EndpointMeta = {
        endpointId: `${method.toUpperCase()} ${path}`,
        path,
        method: method.toUpperCase() as HttpMethod,
        parameters,
        responseSchemas,
        responseExamples,
        errorCodes,
        authSchemeRefs: extractSecurityRefs(operation.security ?? rootSecurity),
      };
      if (requestSchema !== undefined) {
        endpoint.requestSchema = requestSchema;
      }
      endpoints.push(endpoint);
    }
  }

  return {
    apiId,
    title,
    sourceFormat: 'openapi-3',
    endpoints,
    authSchemes: extractOas3AuthSchemes(root),
    rateLimits: extractRateLimits(root),
  };
}

// ---------------------------------------------------------------------------
// Swagger 2.0 normalization
// ---------------------------------------------------------------------------

function normalizeSwagger2Parameter(param: Record<string, unknown>): ParameterMeta {
  const location = normalizeParameterLocation(param.in);
  const meta: ParameterMeta = {
    name: asString(param.name, ''),
    location,
    required: location === 'path' ? true : param.required === true,
    // Swagger 2 non-body params declare the schema inline (type/format/etc.).
    schema: isRecord(param.schema) ? (param.schema as JsonSchema) : (param as JsonSchema),
  };
  if ('x-example' in param) {
    meta.example = param['x-example'];
  }
  return meta;
}

function extractSwagger2Responses(responses: unknown): {
  responseSchemas: Record<string, JsonSchema>;
  responseExamples: Record<string, unknown>;
  errorCodes: string[];
} {
  const responseSchemas: Record<string, JsonSchema> = {};
  const responseExamples: Record<string, unknown> = {};
  const errorCodes: string[] = [];

  if (isRecord(responses)) {
    for (const [statusCode, response] of Object.entries(responses)) {
      if (!isRecord(response)) {
        continue;
      }
      if (isRecord(response.schema)) {
        responseSchemas[statusCode] = response.schema as JsonSchema;
      }
      if (isRecord(response.examples)) {
        const examples = Object.values(response.examples);
        if (examples.length > 0) {
          responseExamples[statusCode] = examples[0];
        }
      } else if ('example' in response) {
        responseExamples[statusCode] = response.example;
      }
      if (isErrorStatus(statusCode)) {
        errorCodes.push(statusCode);
      }
    }
  }

  return { responseSchemas, responseExamples, errorCodes };
}

function mapSwagger2AuthType(def: Record<string, unknown>): AuthScheme {
  const type = asString(def.type, '').toLowerCase();
  if (type === 'basic') {
    return 'basic';
  }
  if (type === 'apikey') {
    return 'apiKey';
  }
  if (type === 'oauth2') {
    // Swagger 2 `application` flow corresponds to the client-credentials grant.
    return asString(def.flow, '').toLowerCase() === 'application'
      ? 'clientCredentials'
      : 'oauth2';
  }
  return 'apiKey';
}

function extractSwagger2AuthSchemes(root: Record<string, unknown>): AuthSchemeMeta[] {
  const definitions = isRecord(root.securityDefinitions) ? root.securityDefinitions : {};
  const schemes: AuthSchemeMeta[] = [];
  for (const [id, def] of Object.entries(definitions)) {
    if (!isRecord(def)) {
      continue;
    }
    schemes.push({ id, type: mapSwagger2AuthType(def), details: def });
  }
  return schemes;
}

function normalizeSwagger2(root: Record<string, unknown>, apiId: string): ApiMetadata {
  const info = isRecord(root.info) ? root.info : {};
  const title = asString(info.title, 'Untitled API');
  const paths = isRecord(root.paths) ? root.paths : {};
  const rootSecurity = root.security;

  const endpoints: EndpointMeta[] = [];
  for (const [path, pathItem] of Object.entries(paths)) {
    if (!isRecord(pathItem)) {
      continue;
    }
    for (const method of HTTP_METHODS) {
      const operation = pathItem[method];
      if (!isRecord(operation)) {
        continue;
      }

      const allParams = mergeParameters(pathItem.parameters, operation.parameters);
      const parameters: ParameterMeta[] = [];
      let requestSchema: JsonSchema | undefined;
      for (const param of allParams) {
        if (asString(param.in, '').toLowerCase() === 'body') {
          // A Swagger 2 body parameter carries the request schema.
          if (isRecord(param.schema)) {
            requestSchema = param.schema as JsonSchema;
          }
          continue;
        }
        parameters.push(normalizeSwagger2Parameter(param));
      }

      const { responseSchemas, responseExamples, errorCodes } = extractSwagger2Responses(
        operation.responses
      );

      const endpoint: EndpointMeta = {
        endpointId: `${method.toUpperCase()} ${path}`,
        path,
        method: method.toUpperCase() as HttpMethod,
        parameters,
        responseSchemas,
        responseExamples,
        errorCodes,
        authSchemeRefs: extractSecurityRefs(operation.security ?? rootSecurity),
      };
      if (requestSchema !== undefined) {
        endpoint.requestSchema = requestSchema;
      }
      endpoints.push(endpoint);
    }
  }

  return {
    apiId,
    title,
    sourceFormat: 'swagger-2',
    endpoints,
    authSchemes: extractSwagger2AuthSchemes(root),
    rateLimits: extractRateLimits(root),
  };
}

// ---------------------------------------------------------------------------
// Parser implementation
// ---------------------------------------------------------------------------

/**
 * Default {@link SpecParser} implementation. Stateless aside from injected
 * `idGenerator`/`dateProvider`; safe to share across requests.
 */
export class SpecParserService implements SpecParser {
  private readonly idGenerator: IdGenerator;
  private readonly dateProvider: DateProvider;

  constructor(deps: Partial<SpecParserDependencies> = {}) {
    this.idGenerator = deps.idGenerator ?? defaultIdGenerator;
    this.dateProvider = deps.dateProvider ?? defaultDateProvider;
  }

  async parse(raw: Buffer, contentType: string): Promise<ApiMetadata> {
    // 1. Size + format gate BEFORE parsing (Req 1.5).
    const format = validateUploadGate(raw, contentType);

    // 2. Parse the raw content, surfacing the first invalid element (Req 1.4).
    const document = this.parseRaw(raw, format);

    // 3. Detect specification format.
    const specFormat = detectSpecFormat(document);
    const root = document as Record<string, unknown>;

    // 4. Dereference local $refs (Req 1.4 for unresolved/external refs).
    const dereferenced = dereference(root, root, new Set<string>());
    if (!isRecord(dereferenced)) {
      throw new SpecParseError('root', 'the specification root must be a mapping/object');
    }

    // 5. Normalize into ApiMetadata (Req 1.1, 1.2, 1.3). apiId is assigned via
    //    the injected id generator; dateProvider is reserved for downstream use.
    void this.dateProvider;
    const apiId = this.idGenerator();
    const metadata: ApiMetadata =
      specFormat === 'openapi-3'
        ? normalizeOpenApi3(dereferenced, apiId)
        : normalizeSwagger2(dereferenced, apiId);

    // 6. Reject a valid-but-empty specification (Req 1.6).
    if (metadata.endpoints.length === 0) {
      throw new NoMetadataFoundError();
    }

    return metadata;
  }

  /** Parse YAML or JSON, converting syntax errors into {@link SpecParseError}. */
  private parseRaw(raw: Buffer, format: 'yaml' | 'json'): unknown {
    const text = raw.toString('utf8');
    if (text.trim().length === 0) {
      throw new SpecParseError('root', 'the uploaded file is empty');
    }

    if (format === 'json') {
      try {
        return JSON.parse(text);
      } catch (error) {
        throw new SpecParseError(locateJsonError(text, error), describeError(error));
      }
    }

    // YAML (a superset of JSON, so JSON content parses here too).
    try {
      return loadYaml(text);
    } catch (error) {
      if (error instanceof YAMLException && error.mark) {
        throw new SpecParseError(
          `line ${error.mark.line + 1}, column ${error.mark.column + 1}`,
          error.reason || describeError(error)
        );
      }
      throw new SpecParseError('root', describeError(error));
    }
  }
}

// ---------------------------------------------------------------------------
// Standalone helpers used by the service
// ---------------------------------------------------------------------------

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Best-effort line/column for a JSON syntax error message. */
function locateJsonError(text: string, error: unknown): string {
  const message = describeError(error);
  const match = /position (\d+)/.exec(message);
  if (match) {
    const position = Number.parseInt(match[1], 10);
    const upto = text.slice(0, position);
    const line = upto.split('\n').length;
    const column = position - upto.lastIndexOf('\n');
    return `line ${line}, column ${column}`;
  }
  return 'root';
}

function detectSpecFormat(document: unknown): SpecFormat {
  if (!isRecord(document)) {
    throw new SpecParseError('root', 'the specification must be a mapping/object at its root');
  }
  if (typeof document.openapi === 'string') {
    if (/^3\./.test(document.openapi)) {
      return 'openapi-3';
    }
    throw new SpecParseError(
      '$.openapi',
      `unsupported OpenAPI version "${document.openapi}"; only 3.x is supported`
    );
  }
  if (typeof document.swagger === 'string') {
    if (document.swagger === '2.0') {
      return 'swagger-2';
    }
    throw new SpecParseError(
      '$.swagger',
      `unsupported Swagger version "${document.swagger}"; only 2.0 is supported`
    );
  }
  throw new SpecParseError(
    'root',
    'missing "openapi" (3.x) or "swagger" (2.0) version field; not a recognized specification'
  );
}
