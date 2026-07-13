/**
 * Auth-view error resolution (Task 13.2 — Req 2.4, 2.5, 3.4, 3.5).
 *
 * A **pure**, presentation-only helper shared by {@link SignInView} and
 * {@link SignUpView}. It turns the {@link UiOutcome} produced by the app-client
 * response mapper (fed to the views as a prop by the wiring layer, Task 16.2)
 * into a single, secret-free, user-facing message string.
 *
 * The backend surfaces the three auth-specific failures the requirements name
 * as ordinary `backend_error` outcomes, distinguished by their `code` (the
 * SCREAMING_SNAKE_CASE of the backend error class name — see the gateway's
 * `api-copilot-support` error table):
 *
 *   - `EMAIL_ALREADY_REGISTERED_ERROR` — sign-up 409 (Req 2.4)
 *   - `INVALID_CREDENTIALS_ERROR`      — sign-in 401, a *non*-session code so it
 *     maps to `backend_error`, not `session_expired` (Req 3.4)
 *   - `ACCOUNT_LOCKED_ERROR`           — sign-in 423 (Req 3.5)
 *
 * Any other error outcome (a different `backend_error`, a transport failure, or
 * a rate limit) yields a generic, describe-the-failure message so the view can
 * still tell the User what happened while retaining their input (Req 2.5).
 */

import type { UiOutcome } from '../app-client/types';

/**
 * Backend error `code` values that identify the auth-specific failures. These
 * are the SCREAMING_SNAKE_CASE forms of the account-auth error class names the
 * gateway emits in the `{ error: { code } }` envelope.
 */
export const AUTH_ERROR_CODES = {
  /** Sign-up: the email is already associated with an Account (Req 2.4). */
  emailAlreadyRegistered: 'EMAIL_ALREADY_REGISTERED_ERROR',
  /** Sign-in: the credentials do not match an existing Account (Req 3.4). */
  invalidCredentials: 'INVALID_CREDENTIALS_ERROR',
  /** Sign-in: the Account is temporarily locked (Req 3.5). */
  accountLocked: 'ACCOUNT_LOCKED_ERROR',
} as const;

/** Secret-free, user-facing messages for the auth outcomes the views render. */
export const AUTH_ERROR_MESSAGES = {
  /** Req 2.4 — the email is already registered. */
  emailAlreadyRegistered:
    'That email is already registered. Try signing in instead.',
  /** Req 3.4 — the credentials do not match an existing account. */
  invalidCredentials:
    'The email or password you entered is incorrect. Please try again.',
  /** Req 3.5 — the account is temporarily locked. */
  accountLocked:
    'This account is temporarily locked after repeated failed sign-in attempts. Please try again later.',
  /** Req 17.1 — the Backend_Gateway could not be reached. */
  unreachable:
    'The backend could not be reached. Check your connection and try again.',
  /** Req 4.6 — a secure HTTPS connection could not be established. */
  tlsError: 'A secure connection to the backend could not be established.',
  /** Req 16.4 — too many attempts; the request was rate limited. */
  rateLimited: 'Too many attempts. Please wait a moment and try again.',
  /** Generic fallback describing the failure (Req 2.5). */
  generic: 'The request could not be completed. Please try again.',
} as const;

/**
 * Resolve the message for an auth error outcome, given the map of known
 * `backend_error` codes to messages for the specific view.
 *
 * Returns `null` for a `success` or client-side `validation_error` outcome
 * (those are handled inline by the view), and a describe-the-failure string for
 * every error outcome so the User is always told what happened.
 */
function resolveAuthError(
  outcome: UiOutcome<unknown> | undefined,
  knownCodeMessages: Readonly<Record<string, string>>,
): string | null {
  if (outcome === undefined) {
    return null;
  }
  switch (outcome.kind) {
    case 'success':
    case 'validation_error':
      // Success routes away; validation errors are shown inline by the view.
      return null;
    case 'backend_error':
      return knownCodeMessages[outcome.code] ?? AUTH_ERROR_MESSAGES.generic;
    case 'rate_limited':
      return AUTH_ERROR_MESSAGES.rateLimited;
    case 'unreachable':
      return AUTH_ERROR_MESSAGES.unreachable;
    case 'tls_error':
      return AUTH_ERROR_MESSAGES.tlsError;
    case 'session_expired':
    default:
      return AUTH_ERROR_MESSAGES.generic;
  }
}

/**
 * Resolve the sign-up error message for an outcome (Req 2.4, 2.5), mapping the
 * email-already-registered code to its specific message and every other error
 * to a generic describe-the-failure message.
 */
export function resolveSignUpError(
  outcome: UiOutcome<unknown> | undefined,
): string | null {
  return resolveAuthError(outcome, {
    [AUTH_ERROR_CODES.emailAlreadyRegistered]:
      AUTH_ERROR_MESSAGES.emailAlreadyRegistered,
  });
}

/**
 * Resolve the sign-in error message for an outcome (Req 3.4, 3.5), mapping the
 * credential-mismatch and account-locked codes to their specific messages and
 * every other error to a generic describe-the-failure message.
 */
export function resolveSignInError(
  outcome: UiOutcome<unknown> | undefined,
): string | null {
  return resolveAuthError(outcome, {
    [AUTH_ERROR_CODES.invalidCredentials]: AUTH_ERROR_MESSAGES.invalidCredentials,
    [AUTH_ERROR_CODES.accountLocked]: AUTH_ERROR_MESSAGES.accountLocked,
  });
}
