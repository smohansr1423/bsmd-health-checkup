/**
 * API browser view (Task 13.1 / 13.6 — Req 7.1, 7.2, 7.3, 7.4, 7.5, 10.3).
 *
 * Lists the Active_Workspace's APIs and their versions (Req 7.1), lets the User
 * select an Active_API_Version (Req 7.2), and surfaces the "unavailable version"
 * error while retaining the prior selection (Req 7.4, handled by the selection
 * slice). When an Active_API_Version is set it displays that version's
 * endpoints — each endpoint's path, HTTP method, and parameters — exactly as
 * returned in the API_Metadata (Req 7.3). When no version is selected it shows
 * the selection-required indication that gates Q&A / execution / code
 * generation (Req 7.5).
 *
 * It also renders any configured target-API credentials in **masked form only**
 * (Req 10.3) — the plaintext secret never reaches this component.
 */

import React from 'react';
import type { apiCopilotShared } from '@health-checkup/services';
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
  /**
   * The API_Metadata for the Active_API_Version, supplied by the wiring layer
   * once a version is selected. Its endpoints are displayed with each path,
   * HTTP method, and parameters (Req 7.3). `undefined` while the metadata is
   * still loading.
   */
  activeVersionMetadata?: apiCopilotShared.ApiMetadata;
  /** Configured target-API credentials, already masked (Req 10.3). */
  credentials?: readonly MaskedCredentialView[];
}

/**
 * Human-readable summary of a single endpoint parameter (Req 7.3). Renders the
 * parameter name, its location, and whether it is required, exactly as carried
 * in the API_Metadata.
 */
function ParameterItem({
  parameter,
}: {
  parameter: apiCopilotShared.ParameterMeta;
}): React.ReactElement {
  return (
    <li className="endpoint__parameter">
      <span className="endpoint__parameter-name">{parameter.name}</span>
      <span className="endpoint__parameter-location">{parameter.location}</span>
      <span className="endpoint__parameter-required">
        {parameter.required ? 'required' : 'optional'}
      </span>
    </li>
  );
}

/**
 * The endpoints of the Active_API_Version, listed with path, method, and
 * parameters (Req 7.3). Shown only while an Active_API_Version is set.
 */
function EndpointList({
  metadata,
}: {
  metadata?: apiCopilotShared.ApiMetadata;
}): React.ReactElement {
  return (
    <section className="api-endpoints" aria-labelledby="api-endpoints-title">
      <h2 id="api-endpoints-title">Endpoints</h2>
      {metadata === undefined ? null : metadata.endpoints.length === 0 ? (
        <EmptyState message="This API version exposes no endpoints." />
      ) : (
        <ul className="endpoint-list">
          {metadata.endpoints.map((endpoint) => (
            <li key={endpoint.endpointId} className="endpoint">
              <span className="endpoint__method">{endpoint.method}</span>
              <span className="endpoint__path">{endpoint.path}</span>
              {endpoint.parameters.length === 0 ? (
                <span className="endpoint__no-parameters">No parameters</span>
              ) : (
                <ul className="endpoint__parameters">
                  {endpoint.parameters.map((parameter) => (
                    <ParameterItem
                      key={`${endpoint.endpointId}:${parameter.location}:${parameter.name}`}
                      parameter={parameter}
                    />
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function ApiBrowserView({
  apis,
  activeVersionMetadata,
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

      {state.activeApiVersion !== null ? (
        <EndpointList metadata={activeVersionMetadata} />
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
