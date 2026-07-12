/**
 * Signed-in navigation bar (Task 13.1 — Req 18.3).
 *
 * Renders a control for each authenticated view and a sign-out control. The
 * items come from the pure {@link SIGNED_IN_NAV_ITEMS} model; selecting one
 * dispatches a `NAVIGATED` action to the store, which changes only the route
 * and preserves the Active_Workspace / Active_API_Version (Req 18.1).
 *
 * The bar is only rendered while signed in (the shell decides that), so every
 * listed view is reachable.
 */

import React from 'react';
import { SIGNED_IN_NAV_ITEMS } from '../views/navigation';
import type { ViewId } from '../state/types';

export interface NavigationProps {
  /** The currently active view, highlighted in the bar. */
  currentView: ViewId;
  /** Navigate to `view`. */
  onNavigate: (view: ViewId) => void;
  /** Sign the User out. */
  onSignOut: () => void;
}

/** The signed-in navigation bar with a control per view plus sign-out. */
export function Navigation({
  currentView,
  onNavigate,
  onSignOut,
}: NavigationProps): React.ReactElement {
  return (
    <nav className="app-nav" aria-label="Primary">
      <ul className="app-nav__items">
        {SIGNED_IN_NAV_ITEMS.map((item) => (
          <li key={item.view}>
            <button
              type="button"
              aria-current={item.view === currentView ? 'page' : undefined}
              onClick={() => onNavigate(item.view)}
            >
              {item.label}
            </button>
          </li>
        ))}
      </ul>
      <button type="button" className="app-nav__sign-out" onClick={onSignOut}>
        Sign out
      </button>
    </nav>
  );
}
