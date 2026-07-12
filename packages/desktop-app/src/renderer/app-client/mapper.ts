/**
 * Response-to-outcome mapper (Task 4.3).
 *
 * `mapResponse` is a **pure** function — no I/O, no React, no Electron — that
 * turns the sanitized, token-less {@link SanitizedResponse} returned by the
 * main-process request broker into the renderer-facing {@link UiOutcome} that
 * views and reducers consume. It is the single, deterministic mapping point
 * shared by every domain client method (see the design's "status → UiOutcome
 * mapping" rules).
 *
 * Mapping rules (Req 2.5, 8.6, 15.5, 16.3, 16.4, 4.4, 4.6, 17.1):
 *  - Transport failure takes precedence over any HTTP status (on a transport
 *    failure the broker reports `status: 0`):
 *      - `unreachable` → `{ kind: 'unreachable' }`               (Req 17.1)
 *      - `tls_failed`  → `{ kind: 'tls_error' }`                 (Req 4.6)
 *      - `timeout`     → `{ kind: 'backend_error', code: 'TIMEOUT' }` — there is
 *        no dedicated timeout outcome; the design maps a deadline breach to a
 *        backend_error the view renders while retaining input (Req 8.7, 15.5).
 *  - `2xx`                        → `{ kind: 'success', value: data }`
 *  - `401` with a Session_Token expiry/invalid code (the gateway auth
 *    middleware's `SESSION_EXPIRED` / `INVALID_TOKEN` / `AUTHENTICATION_REQUIRED`
 *    / `INVALID_AUTH_FORMAT`) → `{ kind: 'session_expired' }`    (Req 4.4)
 *  - `429`                        → `{ kind: 'rate_limited', retryAfterMs }` (Req 16.4)
 *  - any other `4xx`/`5xx` (including a 401 whose code is *not* a token-expiry
 *    code, e.g. invalid sign-in credentials or a target-API auth error) →
 *    `{ kind: 'backend_error', code, message, details }`         (Req 16.3, 2.5, 8.6, 15.5)
 *
 * Secret-safety (Req 4.1, 16.5): the mapper only ever copies fields that already
 * come from the broker-sanitized response (`data`, and the backend error's
 * `code` / `message` / `details`). It never has access to, and never emits, a
 * Session_Token or credential value.
 */

import type { SanitizedResponse, UiOutcome } from './types';

/**
 * HTTP 401 error codes emitted by the gateway auth middleware that specifically
 * indicate the Session_Token is missing, invalid, or expired — i.e. the client
 * must re-authenticate (Req 4.4). These are distinct from other 401s such as
 * invalid sign-in credentials (`INVALID_CREDENTIALS_ERROR`), a target-API auth
 * failure (`AUTH_ERROR`), or a replay's saved-auth failure
 * (`SAVED_AUTH_INVALID_ERROR`), which are ordinary `backend_error`s the user
 * acts on without being signed out.
 *
 * Source: `packages/api-gateway/src/middleware/auth.middleware.ts`.
 */
const SESSION_EXPIRY_CODES: ReadonlySet<string> = new Set([
  'SESSION_EXPIRED',
  'INVALID_TOKEN',
  'AUTHENTICATION_REQUIRED',
  'INVALID_AUTH_FORMAT',
]);

/** True iff the error code denotes an expired/invalid Session_Token (Req 4.4). */
function isSessionExpiryCode(code: string | undefined): boolean {
  return code !== undefined && SESSION_EXPIRY_CODES.has(code);
}

/**
 * Map a sanitized broker response to the single renderer-facing outcome.
 * Total and deterministic: every possible `SanitizedResponse` yields exactly
 * one {@link UiOutcome} (Design Property 14).
 *
 * @typeParam T - the expected success payload type for the calling endpoint.
 */
export function mapResponse<T>(res: SanitizedResponse): UiOutcome<T> {
  // 1. Transport-level failures win over any HTTP status. On these the broker
  //    reports status 0 and transmits nothing further to interpret.
  switch (res.transport) {
    case 'unreachable':
      return { kind: 'unreachable' };
    case 'tls_failed':
      return { kind: 'tls_error' };
    case 'timeout':
      // No dedicated timeout outcome exists; surface it as a backend_error the
      // Q&A/dashboard views render while retaining the user's input for retry.
      return {
        kind: 'backend_error',
        code: 'TIMEOUT',
        message: 'The request timed out before a response was received.',
      };
    case 'ok':
    default:
      break; // fall through to HTTP-status mapping
  }

  // 2. Success: any 2xx carries the parsed `{ data }` payload.
  if (res.status >= 200 && res.status < 300) {
    return { kind: 'success', value: res.data as T };
  }

  // 3. Session_Token expired/invalid (only for token-expiry 401 codes).
  if (res.status === 401 && isSessionExpiryCode(res.error?.code)) {
    return { kind: 'session_expired' };
  }

  // 4. Rate limited: carry the parsed Retry-After when present.
  if (res.status === 429) {
    return { kind: 'rate_limited', retryAfterMs: res.retryAfterMs };
  }

  // 5. Every other client/server error carries the backend code + message
  //    (and any details) verbatim — never a token/credential value.
  return {
    kind: 'backend_error',
    code: res.error?.code ?? String(res.status),
    message: res.error?.message ?? 'The request could not be completed.',
    details: res.error?.details,
  };
}
