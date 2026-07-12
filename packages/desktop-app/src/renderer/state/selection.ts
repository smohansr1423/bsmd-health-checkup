/**
 * Selection slice — Active_Workspace / Active_API_Version persistence and
 * version selection (Req 5.4, 7.2, 7.4, 18.1).
 *
 * This is a pure reducer over {@link AppState}. It owns `state.activeWorkspaceId`,
 * `state.activeApiVersion`, and `state.selectionError`, and it also writes
 * `state.route` for the `NAVIGATED` action (the session slice writes `route`
 * for auth transitions; the two sets of actions are disjoint, so the writers
 * never collide).
 *
 * The central rule is **selection preservation** (Req 18.1): navigating between
 * views changes the `route` only. The Active_Workspace and Active_API_Version
 * persist until the User explicitly changes them (Req 5.4, 7.2). Because the
 * slice returns the input state unchanged for every action other than the four
 * it handles, any navigation or unrelated action automatically preserves the
 * selection.
 *
 * Transitions handled:
 *
 *   - `NAVIGATED` — move to another view. Only `route` changes; the selection
 *     and its error are left exactly as they were (Req 18.1).
 *   - `WORKSPACE_SELECTED` — set the Active_Workspace to the chosen id (Req 5.4)
 *     and clear any stale selection error.
 *   - `API_VERSION_SELECTED` — a version-select succeeded: set the returned
 *     selection as the Active_API_Version (Req 7.2) and clear any error.
 *   - `API_VERSION_UNAVAILABLE` — a version-select returned an unavailable
 *     outcome: retain the previously Active_API_Version unchanged and surface a
 *     `version-unavailable` error (Req 7.4).
 *
 * All other actions leave the selection state untouched.
 */

import type { AppAction, AppState, ReducerSlice } from './types';

/**
 * Pure selection reducer. Returns a new {@link AppState} for the four
 * selection/navigation actions and the input state unchanged for everything
 * else — which is exactly what makes the selection persist across navigation.
 */
export function selectionReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'NAVIGATED':
      // Navigation moves the view only. The Active_Workspace, Active_API_Version,
      // and any selection error are preserved across the navigation (Req 18.1).
      // Avoid producing a new object when the route is unchanged so referential
      // equality holds for no-op navigations.
      if (state.route === action.view) {
        return state;
      }
      return { ...state, route: action.view };

    case 'WORKSPACE_SELECTED':
      // Explicit Workspace selection (Req 5.4). Set the Active_Workspace and
      // clear any prior selection error. The Active_API_Version is left as-is;
      // it persists until the User explicitly changes it (Req 18.1).
      return {
        ...state,
        activeWorkspaceId: action.workspaceId,
        selectionError: null,
      };

    case 'API_VERSION_SELECTED':
      // A version-select succeeded (Req 7.2). Adopt the returned selection as
      // the Active_API_Version and clear any prior unavailable error.
      return {
        ...state,
        activeApiVersion: action.selection,
        selectionError: null,
      };

    case 'API_VERSION_UNAVAILABLE':
      // The requested API_Version is unavailable (Req 7.4). Retain the prior
      // Active_API_Version unchanged and surface a `version-unavailable` error
      // naming the attempted selection.
      return {
        ...state,
        selectionError: {
          kind: 'version-unavailable',
          attempted: action.attempted,
        },
      };

    default:
      return state;
  }
}

/** The selection slice, ready to be composed into the root reducer. */
export const selectionSlice: ReducerSlice = {
  reduce: selectionReducer,
};
