/**
 * Testing console view (Task 13.10 — Req 12.1, 12.2, 12.3, 12.4, 12.5, 16.1).
 *
 * The interactive testing console over the `testing-console` Backend_Endpoints:
 *
 *   - **Run** a request for the Active_API_Version + a chosen endpoint (Req
 *     12.1). A Loading_Indicator is shown until a response is received (Req
 *     16.1). The run itself is gated on an Active_API_Version.
 *   - **Display** the request that was sent (method, URL, headers, body) and the
 *     response that was received (status, headers, body, elapsed ms) **exactly
 *     as returned** (Req 12.2) via the shared response-presentation components.
 *   - **History**: the workspace's saved run history is displayed ordered
 *     most-recent-first — in **exactly** the backend-provided order, with no
 *     client-side re-sorting (Req 12.3).
 *   - **Replay** a saved history entry through the replays Backend_Endpoint and
 *     display the replayed run result (Req 12.4).
 *   - **Replay auth problem**: when the Backend_Gateway reports a replay's saved
 *     authentication is missing/invalid/expired, an error describing the problem
 *     is shown while the saved history entry is **kept** in the displayed
 *     history (Req 12.5).
 *
 * Exact-payload and backend-order rendering live in the shared presentation
 * components (`RequestDetails`, `ResponseDetails`, `TestingConsoleHistoryList`)
 * so the fidelity guarantees are verified in one place.
 */

import React, { useState } from 'react';
import type { apiCopilotShared } from '@health-checkup/services';
import { testingConsole } from '../app-client/builders';
import { EmptyState } from '../components/EmptyState';
import { LoadingIndicator } from '../components/LoadingIndicator';
import { RequestDetails } from '../components/RequestDetails';
import { ResponseDetails } from '../components/ResponseDetails';
import { TestingConsoleHistoryList } from '../components/TestingConsoleHistoryList';
import { resolveHistoryDisplay } from '../components/empty-states';
import { useAppStore } from '../state/store';
import { useViewActions } from './actions';

/** Stable operation id for a console run (Req 12.1). */
export const RUN_OP = 'testing-console:run';

/** Stable operation id for a console replay (Req 12.4). */
export const REPLAY_OP = 'testing-console:replay';

/**
 * A saved run-history entry summary (mirrors the backend by name). Retained as
 * a named export for compatibility; the view renders the full
 * {@link apiCopilotShared.HistoryEntry} shape via the shared presentation
 * components so request/response payloads are shown exactly as returned.
 */
export interface ConsoleHistoryEntry {
  id: string;
  method: string;
  url: string;
}

export interface TestingConsoleViewProps {
  /**
   * Saved run history in backend-provided order (most-recent-first), or
   * `undefined` before it loads (Req 12.3).
   */
  history?: readonly apiCopilotShared.HistoryEntry[];
  /**
   * The latest run/replay result to present (request + response), or `undefined`
   * before a run has completed (Req 12.2).
   */
  runResult?: apiCopilotShared.HistoryEntry;
  /** A replay authentication problem to surface, if any (Req 12.5). */
  replayAuthError?: string;
}

export function TestingConsoleView({
  history,
  runResult,
  replayAuthError,
}: TestingConsoleViewProps): React.ReactElement {
  const { state } = useAppStore();
  const actions = useViewActions();
  const workspaceId = state.activeWorkspaceId;
  const selection = state.activeApiVersion;

  const [endpointId, setEndpointId] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const running = state.requests[RUN_OP] === 'loading';
  const replaying = state.requests[REPLAY_OP] === 'loading';
  const display = resolveHistoryDisplay(history);

  const run = (): void => {
    if (!selection) {
      // Gated on an Active_API_Version — send nothing (Req 7.5).
      setMessage('Select an API version before running a request.');
      return;
    }
    if (endpointId.trim().length === 0) {
      setMessage('Enter an endpoint to run.');
      return;
    }
    setMessage(null);
    void actions.runRequest?.({
      operationId: RUN_OP,
      view: 'testing-console',
      descriptor: testingConsole.run({
        selection,
        endpointId: endpointId.trim(),
        values: {},
      }),
    });
  };

  const handleRunSubmit = (event: React.FormEvent): void => {
    event.preventDefault();
    run();
  };

  const replay = (historyId: string): void => {
    if (!workspaceId) {
      return;
    }
    void actions.runRequest?.({
      operationId: REPLAY_OP,
      view: 'testing-console',
      descriptor: testingConsole.replay(workspaceId, historyId),
    });
  };

  return (
    <section
      className="view view--testing-console"
      aria-labelledby="testing-console-title"
    >
      <h1 id="testing-console-title">Testing Console</h1>

      {/* Run a request (Req 12.1). */}
      <form onSubmit={handleRunSubmit}>
        <label>
          Endpoint
          <input
            type="text"
            name="endpointId"
            value={endpointId}
            onChange={(e) => setEndpointId(e.target.value)}
          />
        </label>
        {message !== null ? (
          <p className="error" role="alert">
            {message}
          </p>
        ) : null}
        <button type="submit" disabled={running || selection === null}>
          Run
        </button>
      </form>

      {running ? <LoadingIndicator label="Running request…" /> : null}
      {replaying ? <LoadingIndicator label="Replaying request…" /> : null}

      {/* Replay auth problem — shown while the history entry is kept (Req 12.5). */}
      {replayAuthError !== undefined ? (
        <p className="error error--replay-auth" role="alert">
          {replayAuthError}
        </p>
      ) : null}

      {/* Latest run/replay result: request + response, exactly as returned (Req 12.2). */}
      {runResult !== undefined ? (
        <section
          className="testing-console__result"
          aria-labelledby="console-result-title"
        >
          <h2 id="console-result-title">Result</h2>
          <RequestDetails request={runResult.request} />
          <ResponseDetails result={runResult.result} />
        </section>
      ) : null}

      {/* Saved run history, most-recent-first in backend order (Req 12.3, 12.4). */}
      <section aria-labelledby="console-history-title">
        <h2 id="console-history-title">Run history</h2>
        {display === 'empty' ? (
          <EmptyState message="No saved runs in this workspace's history yet." />
        ) : null}
        {display === 'entries' && history ? (
          <TestingConsoleHistoryList entries={history} onReplay={replay} />
        ) : null}
      </section>
    </section>
  );
}
