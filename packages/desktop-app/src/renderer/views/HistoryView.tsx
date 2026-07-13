/**
 * Conversation history view (Task 13.14 — Req 14.1, 14.2, 14.3, 14.4).
 *
 * Renders the Active_Workspace's Conversation_History in backend order
 * (most-recent-first as the `conversations` Backend_Endpoint returns it — no
 * client-side re-sorting) (Req 14.1). Each entry surfaces the question text, the
 * Answer text, the submitting User identity, and the time the Answer was
 * produced (Req 14.3). When the backend returns an empty history the
 * empty-history state is shown (Req 14.2).
 *
 * When the Backend_Gateway reports the User is not authorized to read the
 * history, the wiring layer (Task 14.2) feeds the mapped {@link UiOutcome} in as
 * the `error` prop: an authorization message is displayed and **no**
 * Conversation_History content is rendered (Req 14.4). Any other error outcome
 * yields a generic, secret-free describe-the-failure message and likewise
 * withholds content.
 */

import React from 'react';
import type { UiOutcome } from '../app-client/types';
import { EmptyState } from '../components/EmptyState';
import {
  EMPTY_STATE_MESSAGES,
  resolveHistoryDisplay,
} from '../components/empty-states';

/** A single conversation-history entry (mirrors the backend by name). */
export interface ConversationEntry {
  id: string;
  question: string;
  answer: string;
  user: string;
  producedAt: string;
}

/**
 * Backend error `code` that identifies an unauthorized read of the
 * Conversation_History (Req 14.4). It is the SCREAMING_SNAKE_CASE form of the
 * `ConversationAccessError` class the gateway maps to a 403 (see
 * `api-copilot-support.ts`).
 */
export const HISTORY_AUTHORIZATION_CODE = 'CONVERSATION_ACCESS_ERROR';

/** Secret-free, user-facing messages for the history view (Req 14.4). */
export const HISTORY_MESSAGES = {
  /** Req 14.4 — the User is not authorized to read this workspace's history. */
  authorizationDenied:
    'You are not authorized to view the conversation history for this workspace.',
  /** Generic describe-the-failure fallback for any other error outcome. */
  loadFailed: 'The conversation history could not be loaded. Please try again.',
} as const;

/**
 * Resolve the message for a history error outcome, or `null` when the outcome
 * is a success (or absent) and content should render normally.
 *
 * The authorization-denied backend error maps to its specific message
 * (Req 14.4); every other error outcome maps to the generic load-failure
 * message so the User is always told what happened.
 */
export function resolveHistoryError(
  outcome: UiOutcome<unknown> | undefined,
): string | null {
  if (outcome === undefined || outcome.kind === 'success') {
    return null;
  }
  if (
    outcome.kind === 'backend_error' &&
    outcome.code === HISTORY_AUTHORIZATION_CODE
  ) {
    return HISTORY_MESSAGES.authorizationDenied;
  }
  return HISTORY_MESSAGES.loadFailed;
}

export interface HistoryViewProps {
  /** Entries in backend order, or undefined before history has loaded. */
  entries?: readonly ConversationEntry[];
  /**
   * The mapped outcome of the history request, if it failed. An authorization
   * error suppresses all content and shows an authorization message (Req 14.4).
   */
  error?: UiOutcome<unknown>;
}

export function HistoryView({
  entries,
  error,
}: HistoryViewProps): React.ReactElement {
  const errorMessage = resolveHistoryError(error);
  const display = resolveHistoryDisplay(entries);

  return (
    <section className="view view--history" aria-labelledby="history-title">
      <h1 id="history-title">Conversation history</h1>

      {/* Req 14.4 — on an authorization (or other) error, show the message and
          render no Conversation_History content. */}
      {errorMessage !== null ? (
        <p className="error" role="alert">
          {errorMessage}
        </p>
      ) : null}

      {errorMessage === null && display === 'empty' ? (
        <EmptyState message={EMPTY_STATE_MESSAGES.emptyHistory} />
      ) : null}

      {errorMessage === null && display === 'entries' && entries ? (
        <ol className="conversation-history">
          {entries.map((entry) => (
            <li key={entry.id} className="conversation-history__entry">
              <p className="conversation-history__question">{entry.question}</p>
              <p className="conversation-history__answer">{entry.answer}</p>
              <p className="conversation-history__meta">
                <span className="conversation-history__user">{entry.user}</span>
                <time className="conversation-history__time">
                  {entry.producedAt}
                </time>
              </p>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}
