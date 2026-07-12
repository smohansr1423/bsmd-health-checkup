/**
 * Loading-lifecycle slice — per-operation request status (Req 16.1, 16.2).
 *
 * This is a pure reducer over {@link AppState}. It owns `state.requests`, a map
 * from an operation key to its {@link RequestStatus}. Each backend request the
 * User initiates has a stable `operationId` (e.g. the view/action that started
 * it), and this slice records where that operation is in its lifecycle so the
 * views can show and hide the Loading_Indicator.
 *
 * Transitions handled:
 *
 *   - `REQUEST_DISPATCHED` — a request went out for `operationId`. Set that
 *     operation's status to `loading` so its Loading_Indicator is shown while
 *     the request is in progress (Req 16.1).
 *   - `REQUEST_SUCCEEDED` — the request for `operationId` completed
 *     successfully. Set its status to `success`, which clears the
 *     Loading_Indicator (Req 16.2).
 *   - `REQUEST_FAILED` — the request for `operationId` completed with a
 *     failure. Set its status to `error`, which also clears the
 *     Loading_Indicator (Req 16.2).
 *
 * The key invariant (design Property 13): completion always moves an operation
 * out of `loading` — whether it succeeds or fails, no completed operation is
 * left in the `loading` state.
 *
 * All other actions leave `state.requests` untouched.
 */

import type { AppAction, AppState, ReducerSlice } from './types';

/**
 * Return a copy of {@link AppState} with `operationId`'s request status set to
 * `status`. Every other operation's status is preserved, so concurrent
 * operations track their lifecycles independently.
 */
function setRequestStatus(
  state: AppState,
  operationId: string,
  status: AppState['requests'][string],
): AppState {
  return {
    ...state,
    requests: { ...state.requests, [operationId]: status },
  };
}

/**
 * Pure loading-lifecycle reducer. Returns a new {@link AppState} for the
 * request-lifecycle actions and the input state unchanged for everything else.
 */
export function loadingReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'REQUEST_DISPATCHED':
      // A request is in progress: show its Loading_Indicator (Req 16.1).
      return setRequestStatus(state, action.operationId, 'loading');

    case 'REQUEST_SUCCEEDED':
      // Completed successfully: clear loading, record success (Req 16.2).
      return setRequestStatus(state, action.operationId, 'success');

    case 'REQUEST_FAILED':
      // Completed with a failure: clear loading, record error (Req 16.2).
      return setRequestStatus(state, action.operationId, 'error');

    default:
      return state;
  }
}

/** The loading-lifecycle slice, ready to be composed into the root reducer. */
export const loadingSlice: ReducerSlice = {
  reduce: loadingReducer,
};
