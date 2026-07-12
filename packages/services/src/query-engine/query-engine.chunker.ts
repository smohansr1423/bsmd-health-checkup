/**
 * Query Engine — Metadata Chunker
 *
 * Pure functions that turn normalized {@link ApiMetadata} into discrete
 * {@link ContentChunk}s for embedding and indexing (Req 3.1). Keeping the
 * chunking logic pure and separate keeps it unit-testable and lets the
 * {@link IndexingService} focus on embedding + storage orchestration.
 *
 * Each endpoint, each authentication scheme, and each rate-limit entry becomes
 * its own chunk with a citation-friendly `sourceRef`, plus one overview chunk
 * for the API itself. Every semantically meaningful piece of the metadata is
 * therefore retrievable by a scoped semantic query (Property 9).
 *
 * Validates: Requirements 3.1
 */

import type {
  ApiMetadata,
  AuthSchemeMeta,
  EndpointMeta,
  ParameterMeta,
  RateLimitMeta,
} from '../api-copilot-shared';
import type { ContentChunk } from './query-engine.types';

/** Render a single parameter into a compact, human-readable line. */
function renderParameter(param: ParameterMeta): string {
  const requirement = param.required ? 'required' : 'optional';
  return `${param.name} (${param.location}, ${requirement})`;
}

/** Build the searchable text for a single endpoint. */
export function renderEndpointText(endpoint: EndpointMeta): string {
  const lines: string[] = [
    `${endpoint.method} ${endpoint.path}`,
    `Endpoint: ${endpoint.endpointId}`,
  ];

  if (endpoint.parameters.length > 0) {
    lines.push(
      `Parameters: ${endpoint.parameters.map(renderParameter).join(', ')}`
    );
  }

  const requiredParams = endpoint.parameters
    .filter((p) => p.required)
    .map((p) => p.name);
  if (requiredParams.length > 0) {
    lines.push(`Required parameters: ${requiredParams.join(', ')}`);
  }

  if (endpoint.requestSchema !== undefined) {
    lines.push('Has request body schema.');
  }

  const responseStatuses = Object.keys(endpoint.responseSchemas);
  if (responseStatuses.length > 0) {
    lines.push(`Response statuses: ${responseStatuses.join(', ')}`);
  }

  if (endpoint.errorCodes.length > 0) {
    lines.push(`Error codes: ${endpoint.errorCodes.join(', ')}`);
  }

  if (endpoint.authSchemeRefs.length > 0) {
    lines.push(`Authentication: ${endpoint.authSchemeRefs.join(', ')}`);
  }

  return lines.join('\n');
}

/** Build the searchable text for a single authentication scheme. */
export function renderAuthSchemeText(scheme: AuthSchemeMeta): string {
  return `Authentication scheme "${scheme.id}" of type ${scheme.type}.`;
}

/** Build the searchable text for a single rate-limit entry. */
export function renderRateLimitText(rateLimit: RateLimitMeta): string {
  const parts: string[] = [`Rate limit "${rateLimit.id}"`];
  if (rateLimit.limit !== undefined) {
    parts.push(`limit ${rateLimit.limit}`);
  }
  if (rateLimit.windowSeconds !== undefined) {
    parts.push(`per ${rateLimit.windowSeconds}s`);
  }
  return `${parts.join(', ')}.`;
}

/**
 * Turn normalized {@link ApiMetadata} into the ordered set of
 * {@link ContentChunk}s to embed and index.
 *
 * Source references are stable and citation-friendly:
 * - `api:${apiId}` — one API overview chunk
 * - endpoint `endpointId` — one chunk per endpoint
 * - `auth:${schemeId}` — one chunk per authentication scheme
 * - `rateLimit:${id}` — one chunk per rate-limit entry
 */
export function chunkApiMetadata(metadata: ApiMetadata): ContentChunk[] {
  const chunks: ContentChunk[] = [];

  // API overview chunk.
  chunks.push({
    sourceRef: `api:${metadata.apiId}`,
    text: `API: ${metadata.title} (format ${metadata.sourceFormat}). ${metadata.endpoints.length} endpoint(s).`,
  });

  // One chunk per endpoint.
  for (const endpoint of metadata.endpoints) {
    chunks.push({
      sourceRef: endpoint.endpointId,
      text: renderEndpointText(endpoint),
    });
  }

  // One chunk per authentication scheme.
  for (const scheme of metadata.authSchemes) {
    chunks.push({
      sourceRef: `auth:${scheme.id}`,
      text: renderAuthSchemeText(scheme),
    });
  }

  // One chunk per rate-limit entry.
  for (const rateLimit of metadata.rateLimits) {
    chunks.push({
      sourceRef: `rateLimit:${rateLimit.id}`,
      text: renderRateLimitText(rateLimit),
    });
  }

  return chunks;
}
