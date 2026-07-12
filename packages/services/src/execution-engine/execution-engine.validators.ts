/**
 * Execution Engine — Validators & pure helpers
 *
 * Pure functions that derive the required-value set from endpoint metadata,
 * detect which required values are missing from the caller's input, build the
 * outbound request, and pretty-print a response body while preserving its
 * structure. Keeping these pure makes the required-value contract (Property 19)
 * and body formatting (Property 22) directly testable.
 *
 * Validates: Requirements 5.1, 5.2, 5.4
 */

import type { EndpointMeta, JsonSchema } from '../api-copilot-shared';
import type {
  ParamValues,
  RequiredValueRef,
} from './execution-engine.types';

/** Type guard for a plain JSON object. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Extract the names of required body fields declared by a request schema. A
 * JSON Schema declares required object properties via its `required: string[]`
 * array. Absent or malformed arrays yield no required body fields.
 */
export function requiredBodyFields(schema: JsonSchema | undefined): string[] {
  if (schema === undefined) {
    return [];
  }
  const required = (schema as Record<string, unknown>).required;
  if (!Array.isArray(required)) {
    return [];
  }
  return required.filter((name): name is string => typeof name === 'string');
}

/**
 * Compute the complete set of values an endpoint requires before it can be
 * executed: every required parameter (path/query/header/cookie), every required
 * request-body field, and — when the endpoint declares any authentication
 * scheme — a single `authentication` requirement (Req 5.1, Property 19).
 */
export function computeRequiredValues(endpoint: EndpointMeta): RequiredValueRef[] {
  const required: RequiredValueRef[] = [];

  for (const param of endpoint.parameters) {
    if (!param.required) {
      continue;
    }
    if (param.location === 'body') {
      required.push({ location: 'body', name: param.name });
    } else {
      required.push({ location: param.location, name: param.name });
    }
  }

  for (const field of requiredBodyFields(endpoint.requestSchema)) {
    // Avoid duplicating a body field already captured as a body parameter.
    if (!required.some((r) => r.location === 'body' && r.name === field)) {
      required.push({ location: 'body', name: field });
    }
  }

  if (endpoint.authSchemeRefs.length > 0) {
    required.push({ location: 'authentication', name: 'authentication' });
  }

  return required;
}

/**
 * Return every required value that is absent from the caller's provided input.
 * A value is present when its corresponding entry is supplied and non-empty;
 * the `authentication` requirement is satisfied by `provided.authConfigured`.
 */
export function findMissingValues(
  required: RequiredValueRef[],
  provided: ParamValues
): RequiredValueRef[] {
  return required.filter((ref) => !isProvided(ref, provided));
}

function isProvided(ref: RequiredValueRef, provided: ParamValues): boolean {
  switch (ref.location) {
    case 'authentication':
      return provided.authConfigured === true;
    case 'body':
      return hasBodyField(provided.body, ref.name);
    case 'path':
      return hasScalar(provided.path, ref.name);
    case 'query':
      return hasScalar(provided.query, ref.name);
    case 'header':
      return hasScalar(provided.header, ref.name);
    case 'cookie':
      return hasScalar(provided.cookie, ref.name);
    default:
      return false;
  }
}

function hasScalar(
  bag: Record<string, string | number | boolean> | undefined,
  name: string
): boolean {
  if (bag === undefined) {
    return false;
  }
  const value = bag[name];
  if (value === undefined || value === null) {
    return false;
  }
  return !(typeof value === 'string' && value.length === 0);
}

function hasBodyField(
  body: Record<string, unknown> | undefined,
  name: string
): boolean {
  if (body === undefined) {
    return false;
  }
  const value = body[name];
  return value !== undefined && value !== null;
}

/**
 * Build the target URL from a base URL, the endpoint path (with `{name}` path
 * parameters substituted), and the supplied query parameters.
 */
export function buildUrl(
  baseUrl: string,
  path: string,
  pathValues: Record<string, string | number | boolean> | undefined,
  queryValues: Record<string, string | number | boolean> | undefined
): string {
  let resolvedPath = path;
  if (pathValues !== undefined) {
    for (const [name, value] of Object.entries(pathValues)) {
      resolvedPath = resolvedPath.replace(
        new RegExp(`\\{${escapeRegExp(name)}\\}`, 'g'),
        encodeURIComponent(String(value))
      );
    }
  }

  const base = baseUrl.replace(/\/+$/, '');
  const suffix = resolvedPath.startsWith('/') ? resolvedPath : `/${resolvedPath}`;
  let url = `${base}${suffix}`;

  if (queryValues !== undefined) {
    const params = new URLSearchParams();
    for (const [name, value] of Object.entries(queryValues)) {
      params.append(name, String(value));
    }
    const qs = params.toString();
    if (qs.length > 0) {
      url += `?${qs}`;
    }
  }

  return url;
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Build the outbound header map from supplied header scalars. */
export function buildHeaders(
  headerValues: Record<string, string | number | boolean> | undefined,
  hasBody: boolean
): Record<string, string> {
  const headers: Record<string, string> = {};
  if (headerValues !== undefined) {
    for (const [name, value] of Object.entries(headerValues)) {
      headers[name] = String(value);
    }
  }
  if (hasBody && headers['Content-Type'] === undefined) {
    headers['Content-Type'] = 'application/json';
  }
  return headers;
}

/**
 * Pretty-print a response body with indentation and line breaks that preserve
 * its original structure (Req 5.4). A JSON body is re-serialized with 2-space
 * indentation such that re-parsing the result yields a structurally equal value
 * (Property 22); a non-JSON body is returned unchanged.
 */
export function prettyPrintBody(body: string): string {
  if (body.length === 0) {
    return body;
  }
  try {
    const parsed: unknown = JSON.parse(body);
    return JSON.stringify(parsed, null, 2);
  } catch {
    // Not JSON — return the body unmodified.
    return body;
  }
}
