/**
 * API browser view (Task 13.1 — Req 7.1, 7.2, 7.4, 7.5, 10.3).
 *
 * Lists the Active_Workspace's APIs and their versions, lets the User select an
 * Active_API_Version, and surfaces the "unavailable version" error while
 * retaining the prior selection (Req 7.4, handled by the selection slice). When
 * no version is selected it shows the selection-required indication that gates
 * Q&A / execution / code generation (Req 7.5).
 *
 * It also renders any configured target-API credentials in **masked form only**
 * (Req 10.3) — the plaintext secret never reaches this component.
 */

import React from 'react';
import { knowledgeEngine } from '../app-client/builders';
import { EmptyState } from '../components/EmptyState';
import { MaskedCredential } from '../components/MaskedCredential';
import type { MaskedCredentialView } from '../components/masking';
import { useAppStore } from '../state/store';
import { useViewActions } from './actions';

/** Stable operation id for selecting an API version. */
export const SELECT_VERSION_OP = 'knowledge-engine:select-version';

/** Minimal API shape for the browser list. */
export interface ApiSummary {
  id: string;
  name: string;
  versions: readonly number[];
}

export interface ApiBrowserViewProps {
  /** The Active_Workspace's APIs, or undefined before they load. */
  apis?: readonly ApiSummary[];
  /** Configured target-API credentials, already masked (Req 10.3). */
  credentials?: readonly MaskedCredentialView[];
}

export function ApiBrowserView({
  apis,
  credentials,
}: ApiBrowserViewProps): React.ReactElement {
  const { state } = useAppStore();
  const actions = useViewActions();
  const workspaceId = state.activeWorkspaceId;

  const selectVersion = (apiId: string, version: number): void => {
    if (!workspaceId) {
      return;
    }
    void actions.runRequest?.({
      operationId: SELECT_VERSION_OP,
      view: 'api-browser',
      descriptor: knowledgeEngine.selectVersion(
        { workspaceId, apiId, version },
        state.activeApiVersion ?? undefined,
      ),
    });
  };

  return (
    <section className="view view--api-browser" aria-labelledby="api-browser-title">
      <h1 id="api-browser-title">API Browser</h1>

      {state.activeApiVersion === null ? (
        <p className="notice notice--selection-required" role="status">
          Select an API version before asking questions, executing endpoints, or
          generating code.
        </p>
      ) : (
        <p className="notice notice--active-version">
          Active version: {state.activeApiVersion.apiId} @{' '}
          {state.activeApiVersion.version}
        </p>
      )}

      {state.selectionError?.kind === 'version-unavailable' ? (
        <p className="error" role="alert">
          The requested version ({state.selectionError.attempted.version}) is
          unavailable. The previous selection is still active.
        </p>
      ) : null}

      {apis === undefined ? null : apis.length === 0 ? (
        <EmptyState message="No APIs have been uploaded to this workspace yet." />
      ) : (
        <ul className="api-list">
          {apis.map((api) => (
            <li key={api.id}>
              <span className="api-list__name">{api.name}</span>
              <ul className="api-list__versions">
                {api.versions.map((version) => (
                  <li key={version}>
                    <button
                      type="button"
                      onClick={() => selectVersion(api.id, version)}
                    >
                      {version}
                    </button>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}

      <section className="target-credentials" aria-labelledby="credentials-title">
        <h2 id="credentials-title">Target API credentials</h2>
        {credentials === undefined || credentials.length === 0 ? (
          <EmptyState message="No target-API credentials configured." />
        ) : (
          <ul className="credential-list">
            {credentials.map((credential, index) => (
              <li key={`${credential.scheme}:${credential.label}:${index}`}>
                <MaskedCredential credential={credential} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}
