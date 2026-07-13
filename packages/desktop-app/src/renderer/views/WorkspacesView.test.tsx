/**
 * Unit tests for the Workspaces view authorization-error screen
 * (Task 13.5 — Req 5.5).
 *
 * RTL/jsdom are not part of this workspace and the Jest environment is `node`,
 * so — following the repo's node-environment test pattern — these tests render
 * the view to static markup with `react-dom/server` and assert on the
 * prop-driven output. The view is pure with respect to its props, so a
 * single static render exercises every branch under test.
 */

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { WorkspacesView } from './WorkspacesView';
import type { WorkspaceAuthorizationError } from './WorkspacesView';
import { AppStoreProvider } from '../state/store';
import { initialAppState } from '../state/types';
import type { AppState } from '../state/types';

/** Render a view wrapped in a store provider seeded with `state`. */
function renderView(
  ui: React.ReactElement,
  state: AppState = initialAppState,
): string {
  return renderToStaticMarkup(
    <AppStoreProvider initialState={state}>{ui}</AppStoreProvider>,
  );
}

describe('WorkspacesView authorization error (Req 5.5)', () => {
  it('renders the authorization error message returned by the gateway', () => {
    const authorizationError: WorkspaceAuthorizationError = {
      workspaceName: 'Payments API',
      message: 'You do not have access to this workspace.',
    };

    const html = renderView(
      <WorkspacesView authorizationError={authorizationError} />,
    );

    // The gateway's detail is surfaced verbatim.
    expect(html).toContain('You do not have access to this workspace.');
    // Named workspace the user attempted to reach is identified.
    expect(html).toContain('Payments API');
    // Rendered as an assertive error region.
    expect(html).toContain('role="alert"');
    expect(html).toContain('error--authorization');
  });

  it('renders a bare message when no workspace name is known', () => {
    const html = renderView(
      <WorkspacesView
        authorizationError={{ message: 'Access to that workspace was denied.' }}
      />,
    );

    expect(html).toContain('Access to that workspace was denied.');
    expect(html).toContain('error--authorization');
  });

  it('does not expose the workspace APIs, conversations, or settings (Req 5.5)', () => {
    const html = renderView(
      <WorkspacesView
        authorizationError={{
          workspaceName: 'Payments API',
          message: 'Not authorized.',
        }}
        // Even if a stray list were supplied, the auth error must not turn the
        // view into a content surface for the denied workspace.
        workspaces={undefined}
      />,
    );

    // The view only ever renders the workspaces section + the error; it never
    // renders any of the denied workspace's content, which lives in other views.
    const forbidden = [
      'conversation',
      'endpoint',
      'credential',
      'dashboard',
      'api version',
      'api-version',
      'settings',
    ];
    const lower = html.toLowerCase();
    for (const token of forbidden) {
      expect(lower).not.toContain(token);
    }
  });

  it('shows the empty state (not workspace content) when the list is empty', () => {
    const html = renderView(<WorkspacesView workspaces={[]} />);
    expect(html).toContain('No workspaces yet');
  });
});
