/**
 * Navigation model (Task 13.1 — Req 18.3, 5, 7–15).
 *
 * **Pure** description of the views the User can navigate between while signed
 * in, and a guard that decides whether a given view is reachable for the
 * current session. `sign-in` and `sign-up` are the unauthenticated entry
 * points and are intentionally absent from the signed-in navigation; every
 * other view is reachable once a Session is established.
 */

import type { SessionState, ViewId } from '../state/types';

/** A single entry in the signed-in navigation bar. */
export interface NavItem {
  /** The view this control routes to. */
  view: ViewId;
  /** The label shown on the control. */
  label: string;
}

/**
 * The ordered navigation controls presented while signed in (Req 18.3). The
 * order mirrors a natural workflow: pick a workspace, browse the API, then use
 * each capability, ending with history and the usage dashboard.
 */
export const SIGNED_IN_NAV_ITEMS: readonly NavItem[] = [
  { view: 'workspaces', label: 'Workspaces' },
  { view: 'api-browser', label: 'API Browser' },
  { view: 'qa', label: 'Q&A' },
  { view: 'search', label: 'Search' },
  { view: 'testing-console', label: 'Testing Console' },
  { view: 'code-gen', label: 'Code Generation' },
  { view: 'history', label: 'History' },
  { view: 'dashboard', label: 'Dashboard' },
];

/** The views that require an established Session to reach. */
const AUTHENTICATED_VIEWS: ReadonlySet<ViewId> = new Set(
  SIGNED_IN_NAV_ITEMS.map((item) => item.view),
);

/** The unauthenticated entry-point views. */
const PUBLIC_VIEWS: ReadonlySet<ViewId> = new Set<ViewId>(['sign-in', 'sign-up']);

/**
 * Whether `view` is reachable for the given session.
 *
 * While signed out only the public views (`sign-in`, `sign-up`) are reachable;
 * while signed in every authenticated view is reachable (Req 18.3). This is the
 * guard the shell uses to reject navigation to a view the session cannot access.
 */
export function isViewReachable(session: SessionState, view: ViewId): boolean {
  if (session.status === 'signed_in') {
    return AUTHENTICATED_VIEWS.has(view) || PUBLIC_VIEWS.has(view);
  }
  return PUBLIC_VIEWS.has(view);
}
