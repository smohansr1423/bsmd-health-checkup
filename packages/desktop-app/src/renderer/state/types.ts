/**
 * Shared app-state types for the renderer store.
 *
 * The renderer uses a single reducer-driven store (see design "App State Store
 * & Navigation"). This module is the one shared surface every reducer slice
 * builds on: it defines the whole {@link AppState} shape, the view/route and
 * per-operation status vocabularies, the side-effect descriptors reducers can
 * request, and the growing {@link AppAction} union.
 *
 * Each reducer slice (session, loading-lifecycle, selection, connectivity, …)
 * lives in its own file and only *reads and writes its own portion* of
 * {@link AppState}. New slices extend this module by adding their fields to
 * {@link AppState}, their initial values to {@link initialAppState}, and their
 * action variants to {@link AppAction} — without touching sibling slices.
 */

// Type-only: payload shapes mirror the backend contract (never in-process code).
import type { apiCopilotShared } from '@health-checkup/services';

/**
 * The renderer views the app can route to. `sign-in` is the unauthenticated
 * entry point; the remaining views are reachable while signed in. The
 * authenticated home view is {@link AUTHENTICATED_HOME_VIEW}.
 */
export type ViewId =
  | 'sign-in'
  | 'sign-up'
  | 'workspaces'
  | 'api-browser'
  | 'qa'
  | 'search'
  | 'testing-console'
  | 'code-gen'
  | 'history'
  | 'dashboard';

/**
 * The view presented as the authenticated home after a successful sign-in
 * (Req 3.2 / 1.4). Workspace selection is the first thing a signed-in User
 * does, so the workspaces view is the home surface.
 */
export const AUTHENTICATED_HOME_VIEW: ViewId = 'workspaces';

/** Per-operation request lifecycle status (Req 16.1, 16.2). */
export type RequestStatus = 'idle' | 'loading' | 'success' | 'error';

/** Whether the Backend_Gateway is currently reachable (Req 17). */
export type ConnectivityState = 'reachable' | 'unreachable';

/**
 * A selection-related error surfaced by the selection slice (Req 7.4).
 *
 * Today the only variant is `version-unavailable`: the Backend_Gateway reported
 * that a requested API_Version could not be selected, so the previously
 * Active_API_Version is retained and this error is surfaced to the view.
 */
export interface SelectionError {
  /** The kind of selection failure. */
  kind: 'version-unavailable';
  /**
   * The API/version the User attempted to select, preserved so the view can
   * name the unavailable version in its message. Never mutates the active
   * selection.
   */
  attempted: apiCopilotShared.ApiSelection;
}

/** The authenticated-session portion of {@link AppState} (Req 3, 4). */
export interface SessionState {
  /** `signed_in` once a Session is established; `signed_out` otherwise. */
  status: 'signed_out' | 'signed_in';
  /**
   * `true` when the User was signed out because the Backend_Gateway reported
   * the Session_Token expired/invalid (Req 4.4). The sign-in view uses this to
   * show a "your session has expired" message. Cleared on the next sign-in.
   */
  expiredNotice: boolean;
}

/**
 * The complete renderer application state. Reducer slices own disjoint parts of
 * this shape; the fields are grouped here so the store has a single source of
 * truth and property tests can reason about the whole transition.
 */
export interface AppState {
  /** Authenticated-session status + expiry notice (Req 3, 4). Owned by the session slice. */
  session: SessionState;
  /** Backend reachability (Req 17). Owned by the connectivity slice. */
  connectivity: ConnectivityState;
  /** Selected Active_Workspace, or null (Req 5.4, 18.1). Owned by the selection slice. */
  activeWorkspaceId: string | null;
  /** Selected Active_API_Version, or null (Req 7.2, 18.1). Owned by the selection slice. */
  activeApiVersion: apiCopilotShared.ApiSelection | null;
  /**
   * The last selection failure to surface, or null when there is none (Req 7.4).
   * Owned by the selection slice; set on an unavailable-version outcome and
   * cleared on the next successful selection or workspace change.
   */
  selectionError: SelectionError | null;
  /** The current view (Req 18.3). Written by the session slice on sign-in/out and by navigation. */
  route: ViewId;
  /** Per-operation loading/result status (Req 16.1, 16.2). Owned by the loading slice. */
  requests: Record<string, RequestStatus>;
  /** Inputs retained for retry on failure (Req 8.7, 11.5, 17.5). Owned by the connectivity slice. */
  retainedInputs: Partial<Record<ViewId, unknown>>;
}

/** The store's starting state before any action is dispatched. */
export const initialAppState: AppState = {
  session: { status: 'signed_out', expiredNotice: false },
  connectivity: 'reachable',
  activeWorkspaceId: null,
  activeApiVersion: null,
  selectionError: null,
  route: 'sign-in',
  requests: {},
  retainedInputs: {},
};

/**
 * A side effect a reducer wants performed as a result of an action.
 *
 * Reducers are pure and never call the preload bridge directly. Instead they
 * declare the effects an action implies (via each slice's `*Effects` function),
 * and the store executes them against `window.copilot`. This keeps state
 * transitions fully deterministic and property-testable while still satisfying
 * requirements that mandate a side effect (e.g. clearing the token on expiry).
 *
 * New effect kinds are added here as later slices need them.
 */
export type AppEffect =
  /** Delete the Session_Token from the Secure_Store via the bridge (Req 4.3, 4.4). */
  | { type: 'clear-token' };

/**
 * Actions dispatched to the store. This is the shared, appendable union: each
 * reducer slice contributes its own variants under its section below, so new
 * slices extend the union without editing sibling entries.
 */
export type AppAction =
  // ---- session slice (Req 3, 4) ----
  /** A sign-in request succeeded and a Session_Token was stored (Req 3.2). */
  | { type: 'SIGN_IN_SUCCEEDED' }
  /** The User explicitly signed out (Req 4.3). */
  | { type: 'SIGNED_OUT' }
  /** The backend reported the Session_Token expired/invalid (Req 4.4). */
  | { type: 'SESSION_EXPIRED' }
  // ---- loading-lifecycle slice (Req 16.1, 16.2) ----
  /**
   * A backend request for `operationId` was dispatched: its per-operation
   * status becomes `loading` and its Loading_Indicator is shown (Req 16.1).
   */
  | { type: 'REQUEST_DISPATCHED'; operationId: string }
  /**
   * The request for `operationId` completed successfully: its status becomes
   * `success`, clearing the Loading_Indicator (Req 16.2).
   */
  | { type: 'REQUEST_SUCCEEDED'; operationId: string }
  /**
   * The request for `operationId` completed with a failure: its status becomes
   * `error`, clearing the Loading_Indicator (Req 16.2).
   */
  | { type: 'REQUEST_FAILED'; operationId: string }
  // ---- connectivity & input-retention slice (Req 8.7, 11.5, 17) ----
  /**
   * A backend operation for `view` failed because the Backend_Gateway could not
   * be reached (transport `unreachable` / a network-connection failure). Sets
   * connectivity to unreachable and retains `input` for retry (Req 17.1, 17.5).
   */
  | { type: 'OPERATION_UNREACHABLE'; view: ViewId; input: unknown }
  /**
   * A backend operation for `view` failed with a timeout (deadline exceeded).
   * Retains `input` for retry but does not change connectivity, because a
   * timeout alone is not proof the gateway is unreachable (Req 8.7, 11.5, 17.5).
   */
  | { type: 'OPERATION_TIMED_OUT'; view: ViewId; input: unknown }
  /**
   * A backend operation for `view` succeeded. Marks connectivity reachable
   * (re-enabling backend-requiring actions) and clears any input retained for
   * that view (Req 17.4).
   */
  | { type: 'OPERATION_SUCCEEDED'; view: ViewId }
  // ---- selection slice (Req 5.4, 7.2, 7.4, 18.1) ----
  /**
   * The User navigated to another view (Req 18.3). Changes `route` only; the
   * Active_Workspace and Active_API_Version are preserved across the navigation
   * (Req 18.1).
   */
  | { type: 'NAVIGATED'; view: ViewId }
  /** The User selected a Workspace as the Active_Workspace (Req 5.4). */
  | { type: 'WORKSPACE_SELECTED'; workspaceId: string }
  /**
   * A version-select request succeeded; `selection` is the Active_API_Version
   * returned by the Backend_Gateway (Req 7.2).
   */
  | { type: 'API_VERSION_SELECTED'; selection: apiCopilotShared.ApiSelection }
  /**
   * A version-select attempt returned an unavailable-version outcome (Req 7.4).
   * The prior Active_API_Version is retained and a `version-unavailable` error
   * is surfaced. `attempted` is the selection the User tried to activate.
   */
  | { type: 'API_VERSION_UNAVAILABLE'; attempted: apiCopilotShared.ApiSelection };
// ---- future slices append their action variants above this line ----

/**
 * A reducer slice: a pure state transition plus the effects an action implies.
 *
 * `reduce` returns the input state unchanged for actions the slice does not
 * handle, so slices compose by piping state through each in turn. `effects` is
 * optional and defaults to "no effects".
 */
export interface ReducerSlice {
  reduce(state: AppState, action: AppAction): AppState;
  effects?(action: AppAction): AppEffect[];
}
