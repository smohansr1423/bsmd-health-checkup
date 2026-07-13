/**
 * Unit tests for the specification-upload view outcome screens
 * (Task 13.5 — Req 6.4, 6.5, 6.6).
 *
 * RTL/jsdom are not part of this workspace and the Jest environment is `node`,
 * so — following the repo's node-environment test pattern — these tests render
 * the view to static markup with `react-dom/server` and assert on the
 * prop-driven output.
 *
 * Note on selection retention (Req 6.5): the selected file lives in the view's
 * own state and is only ever cleared by a *new* file selection — no completed
 * error prop touches it. There is therefore no code path where a parse failure
 * discards the selection, and the failure render keeps the upload form (the
 * retry affordance) intact. These tests assert that retry-preserving contract
 * at the props boundary that a node-only render can observe.
 */

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SpecificationUploadView } from './SpecificationUploadView';
import type { UploadFailure, UploadedApiSummary } from './SpecificationUploadView';
import { AppStoreProvider } from '../state/store';
import { initialAppState } from '../state/types';
import type { AppState } from '../state/types';

/** State with an Active_Workspace so the upload form is not gated. */
const withWorkspace: AppState = {
  ...initialAppState,
  session: { status: 'signed_in', expiredNotice: false },
  activeWorkspaceId: 'ws-1',
  route: 'workspaces',
};

function renderView(
  ui: React.ReactElement,
  state: AppState = withWorkspace,
): string {
  return renderToStaticMarkup(
    <AppStoreProvider initialState={state}>{ui}</AppStoreProvider>,
  );
}

describe('SpecificationUploadView success confirmation (Req 6.4)', () => {
  it('names the uploaded API and its version', () => {
    const uploadResult: UploadedApiSummary = {
      apiName: 'Billing API',
      version: 3,
    };

    const html = renderView(
      <SpecificationUploadView uploadResult={uploadResult} />,
    );

    expect(html).toContain('Billing API');
    expect(html).toContain('version 3');
    expect(html).toContain('upload-success');
    // A success confirmation is a status region, not an error.
    expect(html).toContain('role="status"');
  });
});

describe('SpecificationUploadView parse failure (Req 6.5)', () => {
  const parseFailure: UploadFailure = {
    kind: 'parse-failure',
    detail: 'line 12: expected mapping but found sequence',
  };

  it("passes the backend's parse detail through unaltered", () => {
    const html = renderView(
      <SpecificationUploadView uploadError={parseFailure} />,
    );

    expect(html).toContain('line 12: expected mapping but found sequence');
    expect(html).toContain('error--parse-failure');
    expect(html).toContain('role="alert"');
  });

  it('retains the upload form for retry and shows no success on parse failure', () => {
    const html = renderView(
      <SpecificationUploadView uploadError={parseFailure} />,
    );

    // The selection UI / retry affordance is retained (never cleared by the error).
    expect(html).toContain('type="file"');
    expect(html).toContain('name="specification"');
    expect(html).toContain('Upload specification');
    // The failure never implies a successful upload.
    expect(html).not.toContain('upload-success');
  });
});

describe('SpecificationUploadView plan limit (Req 6.6)', () => {
  const planLimit: UploadFailure = {
    kind: 'plan-limit',
    message: 'Your plan allows up to 5 APIs. Upgrade to add more.',
  };

  it('renders the plan-tier limit message', () => {
    const html = renderView(<SpecificationUploadView uploadError={planLimit} />);

    expect(html).toContain('Your plan allows up to 5 APIs. Upgrade to add more.');
    expect(html).toContain('error--plan-limit');
    expect(html).toContain('role="alert"');
  });

  it('never implies an API was added', () => {
    const html = renderView(<SpecificationUploadView uploadError={planLimit} />);
    expect(html).not.toContain('upload-success');
    expect(html).not.toContain('error--parse-failure');
  });
});
