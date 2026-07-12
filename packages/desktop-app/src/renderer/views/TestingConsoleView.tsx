/**
 * Testing console view (Task 13.1 — Req 12.1, 12.3, 12.4, 12.5, 16.1).
 *
 * Provides the scaffolding for running requests, viewing the saved run history
 * (ordered most-recent-first as returned by the backend), and replaying a saved
 * entry (Req 12.4). It renders the empty-history state and the replay
 * authentication-problem error while keeping the entry in the list (Req 12.5).
 *
 * The exact, unaltered rendering of a run/replay result payload (status,
 * headers, body, elapsed time) is owned by Task 13.2 and slots into the
 * `runResultSlot` region; this view owns the surrounding scaffolding.
 */

import React from 'react';
import { testingConsole } from '../app-client/builders';
import { EmptyState } from '../components/EmptyState';
import { LoadingIndicator } from '../components/LoadingIndicator';
import { resolveHistoryDisplay } from '../components/empty-states';
import { useAppStore } from '../state/store';
import { useViewActions } from './actions';

/** Stable operation id for a console replay. */
export const REPLAY_OP = 'testing-console:replay';

/** A saved run-history entry summary (mirrors the backend by name). */
export interface ConsoleHistoryEntry {
  id: string;
  method: string;
  url: string;
}

export interface TestingConsoleViewProps {
  /** Saved run history in backend order, or undefined before it loads. */
  history?: readonly ConsoleHistoryEntry[];
  /** A replay authentication problem to surface, if any (Req 12.5). */
  replayAuthError?: string;
  /** Region for Task 13.2's exact run/replay payload rendering. */
  runResultSlot?: React.ReactNode;
}

export function TestingConsoleView({
  history,
  replayAuthError,
  runResultSlot,
}: TestingConsoleViewProps): React.ReactElement {
  const { state } = useAppStore();
  const actions = useViewActions();
  const workspaceId = state.activeWorkspaceId;

  const replaying = state.requests[REPLAY_OP] === 'loading';
  const display = resolveHistoryDisplay(history);

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

      {replayAuthError !== undefined ? (
        <p className="error" role="alert">
          {replayAuthError}
        </p>
      ) : null}

      {replaying ? <LoadingIndicator label="Replaying request…" /> : null}

      <div className="testing-console__result">{runResultSlot}</div>

      <section aria-labelledby="console-history-title">
        <h2 id="console-history-title">Run history</h2>
        {display === 'empty' ? (
          <EmptyState message="No saved runs in this workspace's history yet." />
        ) : null}
        {display === 'entries' && history ? (
          <ol className="console-history">
            {history.map((entry) => (
              <li key={entry.id}>
                <span className="console-history__method">{entry.method}</span>
                <span className="console-history__url">{entry.url}</span>
                <button type="button" onClick={() => replay(entry.id)}>
                  Replay
                </button>
              </li>
            ))}
          </ol>
        ) : null}
      </section>
    </section>
  );
}
