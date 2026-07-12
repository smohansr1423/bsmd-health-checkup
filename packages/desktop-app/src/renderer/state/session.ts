/**
 * Session slice — session status and session-expiry handling (Req 3.2, 4.4).
 *
 * This is a pure reducer over {@link AppState}. It owns `state.session` and,
 * because sign-in/expiry change which view is shown, it also writes
 * `state.route`. It never performs I/O: the token clear that Req 4.4 mandates
 * is expressed as an {@link AppEffect} the store executes against the preload
 * bridge, keeping the transition deterministic and property-testable.
 *
 * Transitions handled:
 *
 *   - `SIGN_IN_SUCCEEDED` — a sign-in succeeded (the token is already stored by
 *     the broker). Set the Session to `signed_in`, clear any stale expiry
 *     notice, and route to the authenticated home view (Req 3.2).
 *   - `SESSION_EXPIRED` — the backend reported the Session_Token expired or
 *     invalid. Set the Session to `signed_out`, flag the expiry notice, route
 *     to the sign-in view (Req 4.4), and request a `clear-token` effect so the
 *     stored token is deleted from the Secure_Store.
 *   - `SIGNED_OUT` — the User signed out explicitly. Set the Session to
 *     `signed_out` (no expiry notice), route to sign-in, and request
 *     `clear-token` (Req 4.3).
 *
 * All other actions leave session and route untouched.
 */

import type { AppAction, AppEffect, AppState, ReducerSlice } from './types';
import { AUTHENTICATED_HOME_VIEW } from './types';

/**
 * Pure session reducer. Returns a new {@link AppState} for the session-related
 * actions and the input state unchanged for everything else.
 */
export function sessionReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'SIGN_IN_SUCCEEDED':
      // Establish the Session and land on the authenticated home view. Any
      // expiry notice from a previous expiry is now stale, so clear it.
      return {
        ...state,
        session: { status: 'signed_in', expiredNotice: false },
        route: AUTHENTICATED_HOME_VIEW,
      };

    case 'SESSION_EXPIRED':
      // End the Session, surface the expiry notice, and return to sign-in. The
      // token deletion happens via the `clear-token` effect (see below).
      return {
        ...state,
        session: { status: 'signed_out', expiredNotice: true },
        route: 'sign-in',
      };

    case 'SIGNED_OUT':
      // Explicit sign-out: end the Session and return to sign-in with no expiry
      // notice. Token deletion happens via the `clear-token` effect.
      return {
        ...state,
        session: { status: 'signed_out', expiredNotice: false },
        route: 'sign-in',
      };

    default:
      return state;
  }
}

/**
 * Effects implied by a session action. Session expiry (Req 4.4) and explicit
 * sign-out (Req 4.3) both require the stored Session_Token to be cleared from
 * the Secure_Store; the store performs this via `window.copilot`.
 */
export function sessionEffects(action: AppAction): AppEffect[] {
  switch (action.type) {
    case 'SESSION_EXPIRED':
    case 'SIGNED_OUT':
      return [{ type: 'clear-token' }];
    default:
      return [];
  }
}

/** The session slice, ready to be composed into the root reducer. */
export const sessionSlice: ReducerSlice = {
  reduce: sessionReducer,
  effects: sessionEffects,
};
