/**
 * Query Engine — Answer Grounding Helpers
 *
 * Pure functions that turn semantic-search hits plus the selected version's
 * {@link ApiMetadata} into the grounding context supplied to the
 * {@link LlmProvider}. Keeping this logic pure and separate keeps it
 * unit-testable and lets {@link QueryEngine.ask} focus on orchestration.
 *
 * The two augmentation rules encode the answer-content requirements:
 * - Endpoint hits are rendered from the metadata so the answer always contains
 *   the endpoint's path, HTTP method, and the complete required-parameter list
 *   (Req 4.2).
 * - Authentication questions enumerate every authentication scheme defined in
 *   the metadata, not just those returned by retrieval (Req 4.3).
 *
 * Validates: Requirements 4.2, 4.3
 */

import type { ApiMetadata, EndpointMeta, RetrievedChunk } from '../api-copilot-shared';
import { renderAuthSchemeText, renderEndpointText } from './query-engine.chunker';
import type { SearchHit } from './query-engine.types';

/**
 * Keywords that mark a question as being about authentication (Req 4.3). The
 * substring `auth` intentionally matches `authenticate`, `authentication`,
 * `authorize`, and `oauth`.
 */
const AUTH_QUESTION_KEYWORDS = [
  'auth',
  'token',
  'credential',
  'login',
  'log in',
  'sign in',
  'jwt',
  'bearer',
  'api key',
  'apikey',
  'pkce',
];

/**
 * Determine whether a question is about how to authenticate with the selected
 * API. Case-insensitive substring match against {@link AUTH_QUESTION_KEYWORDS}.
 */
export function isAuthenticationQuestion(question: string): boolean {
  const normalized = question.toLowerCase();
  return AUTH_QUESTION_KEYWORDS.some((keyword) => normalized.includes(keyword));
}

/**
 * Build the ordered, de-duplicated grounding context for an answer.
 *
 * @param hits - retrieved search hits (already scoped, thresholded, and ranked).
 * @param metadata - the selected version's metadata, or `null` when unavailable.
 * @param authQuestion - whether the question is about authentication (Req 4.3).
 */
export function buildGroundingContext(
  hits: SearchHit[],
  metadata: ApiMetadata | null,
  authQuestion: boolean
): RetrievedChunk[] {
  const context: RetrievedChunk[] = [];
  const seen = new Set<string>();

  const endpointById = new Map<string, EndpointMeta>();
  if (metadata) {
    for (const endpoint of metadata.endpoints) {
      endpointById.set(endpoint.endpointId, endpoint);
    }
  }

  // Every retrieved hit becomes a context chunk. When a hit references a known
  // endpoint, render its text from the metadata so the answer carries the
  // endpoint's path, method, and complete required-parameter list (Req 4.2).
  for (const hit of hits) {
    if (seen.has(hit.sourceRef)) {
      continue;
    }
    const endpoint = endpointById.get(hit.sourceRef);
    context.push({
      sourceRef: hit.sourceRef,
      text: endpoint ? renderEndpointText(endpoint) : hit.text,
    });
    seen.add(hit.sourceRef);
  }

  // Authentication questions enumerate EVERY scheme defined in the metadata,
  // adding any not already present in the retrieved context (Req 4.3).
  if (authQuestion && metadata) {
    for (const scheme of metadata.authSchemes) {
      const sourceRef = `auth:${scheme.id}`;
      if (seen.has(sourceRef)) {
        continue;
      }
      context.push({ sourceRef, text: renderAuthSchemeText(scheme) });
      seen.add(sourceRef);
    }
  }

  return context;
}
