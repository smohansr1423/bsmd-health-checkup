/**
 * Code Generator — Validators & pure helpers
 *
 * Pure functions that normalize an endpoint's metadata into a language-agnostic
 * render model: the resolved URL (with path parameters substituted), the
 * required and optional query/header parameters, the resolved authentication
 * material for the endpoint's auth schemes, and the request-body fields. Keeping
 * these pure makes the "required parameters + auth are always present" contract
 * (Property 27) and the "optional parameters are inert placeholders" contract
 * (Property 28) directly testable.
 *
 * Validates: Requirements 7.3, 7.4, 7.5
 */

import type {
  ApiMetadata,
  AuthSchemeMeta,
  EndpointMeta,
  JsonSchema,
  ParameterMeta,
} from '../api-copilot-shared';

/** A single rendered parameter (query/header) with its placeholder value. */
export interface RenderParam {
  name: string;
  /** Scalar placeholder value (example when present, else `<name>`). */
  value: string;
  required: boolean;
}

/** A single rendered request-body field. */
export interface RenderBodyField {
  name: string;
  /** Scalar placeholder value (example when present, else `<name>`). */
  value: string;
  required: boolean;
}

/** Language-agnostic model used by every language generator. */
export interface EndpointRenderModel {
  method: EndpointMeta['method'];
  /** Full URL: base URL + endpoint path with path params substituted. */
  url: string;
  /** Endpoint path with path params substituted (for reference/comments). */
  path: string;
  /** Query parameters (required first, then optional). */
  query: RenderParam[];
  /** Header parameters declared by the endpoint (excludes auth headers). */
  headers: RenderParam[];
  /** Authentication headers derived from the endpoint's auth schemes. */
  authHeaders: RenderParam[];
  /** Authentication query parameters (e.g., API key in query). */
  authQuery: RenderParam[];
  /** Request-body fields (required first, then optional). */
  bodyFields: RenderBodyField[];
  /** Whether the endpoint carries a request body. */
  hasBody: boolean;
  /** Human-readable notes describing the resolved authentication mechanism(s). */
  authNotes: string[];
}

/** Type guard for a plain JSON object. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Resolve an endpoint by its stable id within the metadata. */
export function findEndpoint(
  metadata: ApiMetadata,
  endpointId: string
): EndpointMeta | undefined {
  return metadata.endpoints.find((e) => e.endpointId === endpointId);
}

/** Resolve the endpoint's referenced auth schemes to their definitions. */
export function resolveAuthSchemes(
  metadata: ApiMetadata,
  endpoint: EndpointMeta
): AuthSchemeMeta[] {
  const byId = new Map(metadata.authSchemes.map((s) => [s.id, s]));
  const resolved: AuthSchemeMeta[] = [];
  for (const ref of endpoint.authSchemeRefs) {
    const scheme = byId.get(ref);
    if (scheme !== undefined) {
      resolved.push(scheme);
    }
  }
  return resolved;
}

/** A scalar placeholder for a parameter: its example when scalar, else `<name>`. */
export function placeholderFor(param: ParameterMeta): string {
  const ex = param.example;
  if (typeof ex === 'string' || typeof ex === 'number' || typeof ex === 'boolean') {
    return String(ex);
  }
  return `<${param.name}>`;
}

/** Substitute `{name}` path templates using each path parameter's placeholder. */
export function substitutePath(
  path: string,
  pathParams: ParameterMeta[]
): string {
  let resolved = path;
  for (const p of pathParams) {
    resolved = resolved.replace(
      new RegExp(`\\{${escapeRegExp(p.name)}\\}`, 'g'),
      placeholderFor(p)
    );
  }
  return resolved;
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Join a base URL and a path, normalizing slashes. */
export function joinUrl(baseUrl: string, path: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${base}${suffix}`;
}

/**
 * Extract request-body fields from the endpoint's request schema and any body
 * parameters. Fields listed in the schema's `required` array (or body params
 * marked required) are required; the rest are optional.
 */
export function bodyFieldsOf(endpoint: EndpointMeta): RenderBodyField[] {
  const fields = new Map<string, RenderBodyField>();

  const schema = endpoint.requestSchema;
  if (schema !== undefined) {
    const required = new Set(requiredNames(schema));
    const properties = (schema as Record<string, unknown>).properties;
    if (isRecord(properties)) {
      for (const [name, propSchema] of Object.entries(properties)) {
        fields.set(name, {
          name,
          value: exampleFromSchema(propSchema, name),
          required: required.has(name),
        });
      }
    }
    // A schema may declare required names without listing every property.
    for (const name of required) {
      if (!fields.has(name)) {
        fields.set(name, { name, value: `<${name}>`, required: true });
      }
    }
  }

  for (const param of endpoint.parameters) {
    if (param.location === 'body') {
      fields.set(param.name, {
        name: param.name,
        value: placeholderFor(param),
        required: param.required,
      });
    }
  }

  return sortRequiredFirst([...fields.values()]);
}

function requiredNames(schema: JsonSchema): string[] {
  const required = (schema as Record<string, unknown>).required;
  if (!Array.isArray(required)) {
    return [];
  }
  return required.filter((n): n is string => typeof n === 'string');
}

function exampleFromSchema(propSchema: unknown, name: string): string {
  if (isRecord(propSchema)) {
    const ex = propSchema.example;
    if (typeof ex === 'string' || typeof ex === 'number' || typeof ex === 'boolean') {
      return String(ex);
    }
  }
  return `<${name}>`;
}

function sortRequiredFirst<T extends { required: boolean }>(items: T[]): T[] {
  return [...items].sort((a, b) => Number(b.required) - Number(a.required));
}

/**
 * Build the language-agnostic render model for an endpoint: substitutes path
 * params into the URL, partitions query/header params, resolves authentication
 * material, and collects body fields.
 */
export function buildRenderModel(
  metadata: ApiMetadata,
  endpoint: EndpointMeta,
  baseUrl: string
): EndpointRenderModel {
  const pathParams = endpoint.parameters.filter((p) => p.location === 'path');
  const path = substitutePath(endpoint.path, pathParams);
  const url = joinUrl(baseUrl, path);

  const query = sortRequiredFirst(
    endpoint.parameters
      .filter((p) => p.location === 'query')
      .map((p) => toRenderParam(p))
  );
  const headers = sortRequiredFirst(
    endpoint.parameters
      .filter((p) => p.location === 'header')
      .map((p) => toRenderParam(p))
  );

  const auth = renderAuth(resolveAuthSchemes(metadata, endpoint));
  const bodyFields = bodyFieldsOf(endpoint);
  const methodHasBody = endpoint.method !== 'GET' && endpoint.method !== 'HEAD';
  const hasBody = bodyFields.length > 0 && methodHasBody;

  return {
    method: endpoint.method,
    url,
    path,
    query,
    headers,
    authHeaders: auth.headers,
    authQuery: auth.query,
    bodyFields,
    hasBody,
    authNotes: auth.notes,
  };
}

function toRenderParam(p: ParameterMeta): RenderParam {
  return { name: p.name, value: placeholderFor(p), required: p.required };
}

/**
 * Resolve authentication schemes into concrete header/query material the
 * generated snippet applies (Req 7.3). Duplicate header names are de-duplicated
 * (keeping the first), with alternatives recorded in the notes.
 */
export function renderAuth(schemes: AuthSchemeMeta[]): {
  headers: RenderParam[];
  query: RenderParam[];
  notes: string[];
} {
  const headers: RenderParam[] = [];
  const query: RenderParam[] = [];
  const notes: string[] = [];
  const seenHeaders = new Set<string>();

  for (const scheme of schemes) {
    switch (scheme.type) {
      case 'oauth2':
      case 'jwt':
      case 'bearer':
      case 'clientCredentials':
      case 'pkce': {
        addHeader(headers, seenHeaders, notes, 'Authorization', 'Bearer YOUR_ACCESS_TOKEN', scheme);
        break;
      }
      case 'basic': {
        addHeader(
          headers,
          seenHeaders,
          notes,
          'Authorization',
          'Basic YOUR_BASE64_CREDENTIALS',
          scheme
        );
        break;
      }
      case 'apiKey': {
        const location = stringDetail(scheme.details, 'in') ?? 'header';
        const name = stringDetail(scheme.details, 'name') ?? 'X-API-Key';
        if (location === 'query') {
          query.push({ name, value: 'YOUR_API_KEY', required: true });
          notes.push(`API key (${scheme.id}) sent as query parameter "${name}".`);
        } else if (location === 'cookie') {
          addHeader(headers, seenHeaders, notes, 'Cookie', `${name}=YOUR_API_KEY`, scheme);
        } else {
          addHeader(headers, seenHeaders, notes, name, 'YOUR_API_KEY', scheme);
        }
        break;
      }
      default: {
        notes.push(`Authentication scheme "${scheme.type}" (${scheme.id}) must be configured manually.`);
      }
    }
  }

  return { headers, query, notes };
}

function addHeader(
  headers: RenderParam[],
  seen: Set<string>,
  notes: string[],
  name: string,
  value: string,
  scheme: AuthSchemeMeta
): void {
  if (seen.has(name)) {
    notes.push(
      `Alternative auth scheme "${scheme.type}" (${scheme.id}) also uses the "${name}" header.`
    );
    return;
  }
  seen.add(name);
  headers.push({ name, value, required: true });
  notes.push(`Authentication: ${scheme.type} (${scheme.id}) via "${name}" header.`);
}

function stringDetail(
  details: Record<string, unknown>,
  key: string
): string | undefined {
  const value = details[key];
  return typeof value === 'string' ? value : undefined;
}
