/**
 * Interactive API Testing Console — Validators & pure helpers
 *
 * Pure functions that build a request snapshot for history, construct the
 * classified failure result saved on a transient failure, and classify a
 * saved-authentication problem at replay time. Keeping these pure makes the
 * bounded-history (Property 31) and replay (Property 32, 33) behaviors directly
 * testable.
 *
 * The saved-auth classification inspects the error structurally (by `name` and
 * optional `reason`) rather than importing the Auth Assistant module, so the
 * console stays decoupled from that domain while still surfacing an accurate
 * authentication problem for Req 8.5.
 *
 * Validates: Requirements 8.2, 8.3, 8.5
 */

import type {
  ExecutionResult,
  OutboundRequest,
  OutboundRequestSnapshot,
} from '../api-copilot-shared';
import type { ConsoleFailure } from './testing-console.types';
import type { SavedAuthProblem } from './testing-console.errors';

/**
 * Build an immutable snapshot of a sent request for the history record. Headers
 * are copied so later mutation of the outbound request cannot alter history.
 */
export function toSnapshot(request: OutboundRequest): OutboundRequestSnapshot {
  return {
    method: request.method,
    url: request.url,
    headers: { ...request.headers },
    body: request.body,
  };
}

/**
 * Construct the {@link ExecutionResult} saved to history when a run fails with a
 * transient (timeout or network) condition (Req 8.2, 8.3). No response was
 * received, so status is 0 with empty headers; the classified `outcome` and a
 * human-readable body describe the failure type.
 */
export function buildFailureResult(
  failure: ConsoleFailure,
  elapsedMs: number
): ExecutionResult {
  return {
    statusCode: 0,
    headers: {},
    body: failure.message,
    elapsedMs,
    outcome: failure.kind === 'timeout' ? 'timeout' : 'network_error',
  };
}

/** A classified saved-authentication problem plus a redacted reason phrase. */
export interface SavedAuthClassification {
  problem: SavedAuthProblem;
  reasonPhrase: string;
}

/**
 * Classify an error thrown while resolving authentication for a replayed
 * request into a saved-authentication problem (Req 8.5). The classification is
 * derived only from the error's `name`/`reason` — never from any credential
 * value — so no secret can leak into the surfaced error.
 */
export function classifySavedAuthProblem(
  error: unknown
): SavedAuthClassification {
  const name = errorName(error);
  const reason = errorReason(error);

  if (name === 'CredentialNotFoundError') {
    return {
      problem: 'missing',
      reasonPhrase: 'no credential is configured for the saved target API',
    };
  }

  switch (reason) {
    case 'no_refresh_mechanism':
      return {
        problem: 'expired',
        reasonPhrase:
          'the saved access token has expired and no refresh mechanism is configured',
      };
    case 'refresh_failed':
      return {
        problem: 'expired',
        reasonPhrase:
          'the saved access token has expired and the refresh attempt failed',
      };
    case 'timeout':
      return {
        problem: 'invalid',
        reasonPhrase: 'authentication did not complete within the allowed time',
      };
    case 'invalid_credentials':
      return {
        problem: 'invalid',
        reasonPhrase:
          'the saved credentials were invalid or rejected by the target API',
      };
    case 'unsupported_scheme':
      return {
        problem: 'invalid',
        reasonPhrase: 'the saved authentication scheme is not supported',
      };
    default:
      return {
        problem: 'invalid',
        reasonPhrase: 'the saved authentication could not be resolved',
      };
  }
}

function errorName(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'name' in error) {
    const value = (error as { name: unknown }).name;
    return typeof value === 'string' ? value : undefined;
  }
  return undefined;
}

function errorReason(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'reason' in error) {
    const value = (error as { reason: unknown }).reason;
    return typeof value === 'string' ? value : undefined;
  }
  return undefined;
}
