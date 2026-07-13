/**
 * Workspaces view (Task 13.4 — Req 5.1, 5.2, 5.3, 5.4, 5.5, 16.1).
 *
 * Lists the accessible Workspaces by name (Req 5.1), lets the User create one
 * (validating the 1..100-character name before sending — Req 5.3), and lets the
 * User select the Active_Workspace (Req 5.4), which the selection slice
 * preserves across navigation. The Workspace list is provided by the wiring
 * layer (Task 16); this view renders it and its empty state.
 *
 * When the Backend_Gateway reports that the User is not authorized for a
 * requested Workspace (Req 5.5), the wiring layer supplies an
 * {@link WorkspaceAuthorizationError} through props and this view displays the
 * authorization error. This view never renders a Workspace's APIs,
 * conversations, or settings (those live in the API browser, history, and
 * dashboard views), so an authorization error here surfaces the message without
 * exposing any of that Workspace's content.
 */

import React, { useState } from 'react';
import { workspaces as workspaceBuilders } from '../app-client/builders';
import { validateWorkspaceName } from '../app-client/validation';
import { EmptyState } from '../components/EmptyState';
import { LoadingIndicator } from '../components/LoadingIndicator';
import { useAppStore } from '../state/store';
import { useViewActions } from './actions';

/** Stable operation id for creating a Workspace. */
export const CREATE_WORKSPACE_OP = 'workspaces:create';

/** Minimal Workspace shape the list needs (mirrors the backend by name). */
export interface WorkspaceSummary {
  id: string;
  name: string;
}

/**
 * A workspace-access authorization failure (Req 5.5). Supplied by the wiring
 * layer when the Backend_Gateway reports the User is not authorized for a
 * requested Workspace, so the view can display the authorization error without
 * revealing any of that Workspace's content.
 */
export interface WorkspaceAuthorizationError {
  /** The name (or id) of the Workspace the User attempted to access, when known. */
  workspaceName?: string;
  /** The authorization error detail returned by the Backend_Gateway. */
  message: string;
}

export interface WorkspacesViewProps {
  /** The accessible Workspaces, or undefined before they have loaded. */
  workspaces?: readonly WorkspaceSummary[];
  /**
   * An authorization error for a requested Workspace (Req 5.5). When present the
   * view displays the error and does not surface that Workspace's content.
   */
  authorizationError?: WorkspaceAuthorizationError;
}

export function WorkspacesView({
  workspaces,
  authorizationError,
}: WorkspacesViewProps): React.ReactElement {
  const { state, dispatch } = useAppStore();
  const actions = useViewActions();
  const [name, setName] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);

  const loading = state.requests[CREATE_WORKSPACE_OP] === 'loading';

  const handleCreate = (event: React.FormEvent): void => {
    event.preventDefault();
    const validation = validateWorkspaceName(name);
    if (validation) {
      setFieldError(validation.message);
      return;
    }
    setFieldError(null);
    void actions.runRequest?.({
      operationId: CREATE_WORKSPACE_OP,
      view: 'workspaces',
      descriptor: workspaceBuilders.create(name),
      retainInput: { name },
    });
  };

  return (
    <section className="view view--workspaces" aria-labelledby="workspaces-title">
      <h1 id="workspaces-title">Workspaces</h1>

      <form onSubmit={handleCreate}>
        <label>
          New workspace name
          <input
            type="text"
            name="workspaceName"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        {fieldError !== null ? (
          <p className="error" role="alert">
            {fieldError}
          </p>
        ) : null}
        <button type="submit" disabled={loading}>
          Create workspace
        </button>
      </form>

      {loading ? <LoadingIndicator label="Creating workspace…" /> : null}

      {authorizationError ? (
        <p className="error error--authorization" role="alert">
          {authorizationError.workspaceName
            ? `You are not authorized to access "${authorizationError.workspaceName}": ${authorizationError.message}`
            : authorizationError.message}
        </p>
      ) : null}

      {workspaces === undefined ? null : workspaces.length === 0 ? (
        <EmptyState message="No workspaces yet. Create one to get started." />
      ) : (
        <ul className="workspace-list">
          {workspaces.map((ws) => (
            <li key={ws.id}>
              <button
                type="button"
                aria-current={
                  ws.id === state.activeWorkspaceId ? 'true' : undefined
                }
                onClick={() =>
                  dispatch({ type: 'WORKSPACE_SELECTED', workspaceId: ws.id })
                }
              >
                {ws.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
