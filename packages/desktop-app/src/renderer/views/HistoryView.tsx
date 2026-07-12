/**
 * Conversation history view (Task 13.1 — Req 14.1, 14.2, 14.3).
 *
 * Renders the Active_Workspace's conversation history in backend order
 * (most-recent-first) and the empty-history state when there is none (Req 14.2).
 * The exact ordered rendering of populated entries is refined by Task 13.2; this
 * view owns the scaffolding and the empty state.
 */

import React from 'react';
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

export interface HistoryViewProps {
  /** Entries in backend order, or undefined before history has loaded. */
  entries?: readonly ConversationEntry[];
}

export function HistoryView({ entries }: HistoryViewProps): React.ReactElement {
  const display = resolveHistoryDisplay(entries);

  return (
    <section className="view view--history" aria-labelledby="history-title">
      <h1 id="history-title">Conversation history</h1>

      {display === 'empty' ? (
        <EmptyState message={EMPTY_STATE_MESSAGES.emptyHistory} />
      ) : null}

      {display === 'entries' && entries ? (
        <ol className="conversation-history">
          {entries.map((entry) => (
            <li key={entry.id}>
              <p className="conversation-history__question">{entry.question}</p>
              <p className="conversation-history__answer">{entry.answer}</p>
              <p className="conversation-history__meta">
                <span>{entry.user}</span>
                <span>{entry.producedAt}</span>
              </p>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}
