/**
 * Connectivity & input-retention slice — degraded-mode behaviour (Req 8.7,
 * 11.5, 17).
 *
 * This is a pure reducer over {@link AppState}. It owns `state.connectivity`
 * (backend reachability) and `state.retainedInputs` (per-view input kept for
 * retry). It performs no I/O and, crucially, never touches `state.session`:
 * losing connectivity must keep the User signed in and must not clear the
 * Session_Token (Req 17.2). Because the slice emits no `clear-token` effect,
 * that requirement is satisfied structurally.
 *
 * Transitions handled:
 *
 *   - `OPERATION_UNREACHABLE` — a request failed because the Backend_Gateway
 *     could not be reached (a network-connection failure). Set
 *     `connectivity='unreachable'` (which gates backend-requiring actions — see
 *     {@link backendActionsEnabled}) and retain the operation's `input` under
 *     its `view` so the User can retry (Req 17.1, 17.3, 17.5).
 *   - `OPERATION_TIMED_OUT` — a request timed out (deadline exceeded). Retain
 *     the operation's `input` for retry, but leave `connectivity` unchanged: a
 *     timeout is not proof the gateway is unreachable (Req 8.7, 11.5, 17.5).
 *   - `OPERATION_SUCCEEDED` — a request succeeded. Set `connectivity='reachable'`
 *     (re-enabling backend-requiring actions) and clear any input retained for
 *     that `view`, since it no longer needs to be retried (Req 17.4).
 *
 * All other actions leave connectivity and retained inputs untouched.
 */

import type { AppAction, AppState, ReducerSlice, ViewId } from './types';

/**
 * Whether backend-requiring actions are currently enabled (Req 17.3, 17.4).
 *
 * Derived purely from connectivity: while the Backend_Gateway is unreachable
 * the Desktop_App disables actions that need it and, on the next success,
 * re-enables them. Views read this selector rather than storing a separate
 * "disabled" flag, so the gate can never drift out of sync with connectivity.
 */
export function backendActionsEnabled(state: AppState): boolean {
  return state.connectivity === 'reachable';
}

/** Return `retainedInputs` with `view`'s entry removed (no-op if absent). */
function clearRetainedInput(
  retainedInputs: AppState['retainedInputs'],
  view: ViewId,
): AppState['retainedInputs'] {
  if (!(view in retainedInputs)) {
    return retainedInputs;
  }
  const next = { ...retainedInputs };
  delete next[view];
  return next;
}

/**
 * Pure connectivity reducer. Returns a new {@link AppState} for the
 * connectivity/input-retention actions and the input state unchanged for
 * everything else.
 */
export function connectivityReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'OPERATION_UNREACHABLE':
      // Gateway unreachable: enter degraded mode and keep the input for retry.
      // Session is deliberately untouched (Req 17.2 — never clear the token).
      return {
        ...state,
        connectivity: 'unreachable',
        retainedInputs: { ...state.retainedInputs, [action.view]: action.input },
      };

    case 'OPERATION_TIMED_OUT':
      // Timeout: keep the input for retry, but a timeout alone does not prove
      // the gateway is unreachable, so connectivity is left as-is (Req 8.7).
      return {
        ...state,
        retainedInputs: { ...state.retainedInputs, [action.view]: action.input },
      };

    case 'OPERATION_SUCCEEDED':
      // Success: connectivity is confirmed reachable (re-enabling actions) and
      // the operation's retained input is no longer needed (Req 17.4).
      return {
        ...state,
        connectivity: 'reachable',
        retainedInputs: clearRetainedInput(state.retainedInputs, action.view),
      };

    default:
      return state;
  }
}

/** The connectivity slice, ready to be composed into the root reducer. */
export const connectivitySlice: ReducerSlice = {
  reduce: connectivityReducer,
};
