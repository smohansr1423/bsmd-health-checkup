/**
 * Pure startup router.
 *
 * On launch the Desktop_App must decide which view to present first. That
 * decision is a *total function* of two pieces of persisted state:
 *
 *   1. Whether a Backend_Gateway base URL is configured (Req 1.1).
 *   2. Whether a Session_Token is present in the Secure_Store (Req 1.4, 1.5).
 *
 * The function is deliberately free of Electron, React, and I/O so it can be
 * exhaustively property-tested (design Property 1). Callers load the state
 * (config base URL + `SecureStore.hasToken()`) and pass it in.
 */

/**
 * The three possible first views the Desktop_App can boot into.
 *
 * - `base-url-prompt`     — no valid base URL configured; the User must enter
 *                           one before sign-in is allowed (Req 1.1).
 * - `authenticated-home`  — a Session_Token exists, so the Session is restored
 *                           and the authenticated home view is shown (Req 1.4).
 * - `sign-in`             — a base URL is configured but no token exists, so the
 *                           User must sign in (Req 1.5).
 */
export type StartupDestination = 'base-url-prompt' | 'authenticated-home' | 'sign-in';

/** The persisted state the startup decision depends on. */
export interface StartupState {
  /**
   * The Backend_Gateway base URL persisted in {@link AppConfig}, or `null` when
   * none has been stored. Only non-empty HTTPS URLs count as "configured"
   * (Req 1.2, 1.3); anything else routes to the base-URL prompt.
   */
  configuredBaseUrl: string | null;
  /** Whether a Session_Token is present in the Secure_Store. */
  hasToken: boolean;
}

/**
 * Returns `true` iff `value` is a non-empty HTTPS URL.
 *
 * The config layer only ever persists HTTPS URLs, but the router stays robust
 * (and total) by re-checking here: any empty, non-string, or non-HTTPS value is
 * treated as "not configured" and routes to the base-URL prompt.
 */
function isConfiguredBaseUrl(value: string | null): boolean {
  if (value === null || value.trim() === '') {
    return false;
  }
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Decide the first view to present at startup.
 *
 * Precedence (Req 1.1 gates everything else):
 *   1. No configured base URL          → `base-url-prompt`
 *   2. Base URL present + token present → `authenticated-home`
 *   3. Base URL present + no token      → `sign-in`
 *
 * The result is always exactly one destination, for every combination of
 * inputs, making this a total function of `state`.
 */
export function routeStartup(state: StartupState): StartupDestination {
  if (!isConfiguredBaseUrl(state.configuredBaseUrl)) {
    return 'base-url-prompt';
  }
  if (state.hasToken) {
    return 'authenticated-home';
  }
  return 'sign-in';
}
