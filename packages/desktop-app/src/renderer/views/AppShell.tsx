/**
 * Application shell (Task 13.1 — Req 18.3, 18.4, 16.1).
 *
 * Renders the current view for `state.route`, the signed-in navigation bar
 * (only while a Session is established, so every listed view is reachable —
 * Req 18.3), and the close-confirmation dialog shown when the User tries to
 * close the window with a request in flight (Req 18.4).
 *
 * Views are rendered without domain data here (their idle / empty states show);
 * Task 16.2 supplies live data and the action seam. The close-confirmation is
 * controlled by props so the main process (which intercepts the OS `close`
 * event) can drive it via the preload bridge.
 */

import React from 'react';
import { CloseConfirmationDialog } from '../components/CloseConfirmationDialog';
import { Navigation } from '../components/Navigation';
import { shouldConfirmClose } from '../components/close-confirmation';
import { useAppStore } from '../state/store';
import type { ViewId } from '../state/types';
import { ApiBrowserView } from './ApiBrowserView';
import { CodeGenView } from './CodeGenView';
import { DashboardView } from './DashboardView';
import { HistoryView } from './HistoryView';
import { QaView } from './QaView';
import { SearchView } from './SearchView';
import { SignInView } from './SignInView';
import { SignUpView } from './SignUpView';
import { TestingConsoleView } from './TestingConsoleView';
import { WorkspacesView } from './WorkspacesView';

/** Render the component for a given route. */
function renderView(route: ViewId): React.ReactElement {
  switch (route) {
    case 'sign-in':
      return <SignInView />;
    case 'sign-up':
      return <SignUpView />;
    case 'workspaces':
      return <WorkspacesView />;
    case 'api-browser':
      return <ApiBrowserView />;
    case 'qa':
      return <QaView />;
    case 'search':
      return <SearchView />;
    case 'testing-console':
      return <TestingConsoleView />;
    case 'code-gen':
      return <CodeGenView />;
    case 'history':
      return <HistoryView />;
    case 'dashboard':
      return <DashboardView />;
    default:
      return <SignInView />;
  }
}

export interface AppShellProps {
  /**
   * Whether the close-confirmation dialog is open. Driven by the main process
   * on an OS close event; `shouldConfirmClose` decides whether it is warranted.
   */
  closeConfirmationOpen?: boolean;
  /** Confirm closing despite an in-flight request (Req 18.4). */
  onConfirmClose?: () => void;
  /** Cancel the close and keep working (Req 18.4). */
  onCancelClose?: () => void;
}

/** The top-level renderer shell: navigation + routed view + close dialog. */
export function AppShell({
  closeConfirmationOpen,
  onConfirmClose,
  onCancelClose,
}: AppShellProps): React.ReactElement {
  const { state, dispatch } = useAppStore();
  const signedIn = state.session.status === 'signed_in';

  // Only prompt when a request is genuinely in flight (Req 18.4).
  const confirmClose =
    (closeConfirmationOpen ?? false) && shouldConfirmClose(state);

  return (
    <div className="app-shell">
      {signedIn ? (
        <Navigation
          currentView={state.route}
          onNavigate={(view) => dispatch({ type: 'NAVIGATED', view })}
          onSignOut={() => dispatch({ type: 'SIGNED_OUT' })}
        />
      ) : null}

      <main className="app-shell__main">{renderView(state.route)}</main>

      <CloseConfirmationDialog
        open={confirmClose}
        onConfirm={() => onConfirmClose?.()}
        onCancel={() => onCancelClose?.()}
      />
    </div>
  );
}
