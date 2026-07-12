/**
 * ConversationHistoryList (Task 13.2) — backend-ordered conversation history.
 *
 * Renders conversation-history entries in **exactly** the order the
 * Backend_Gateway returned them (most-recent-first as the backend orders them)
 * (Req 14.1). No client-side re-sorting. Each card surfaces the question text,
 * the answer text, the submitting user's identity, and the answer timestamp
 * (Req 14.3); the empty-history state is handled by the history view
 * (Task 13.1).
 */

import type { apiCopilotShared } from '@health-checkup/services';
import { toConversationItems } from './response-presentation';

export interface ConversationHistoryListProps {
  /** Conversation entries in backend-provided order. */
  readonly entries: readonly apiCopilotShared.ConversationEntry[];
}

/** Renders a single answered-at timestamp without mutating the value. */
function formatAnsweredAt(answeredAt: Date): string {
  // Payloads cross the IPC/JSON boundary, so `answeredAt` may arrive as a Date
  // or an ISO string; render it faithfully in either case.
  return answeredAt instanceof Date ? answeredAt.toISOString() : String(answeredAt);
}

/** Renders conversation history in backend order (Req 14.1). */
export function ConversationHistoryList({
  entries,
}: ConversationHistoryListProps): JSX.Element {
  const items = toConversationItems(entries);

  return (
    <ol className="conversation-history" data-testid="conversation-history">
      {items.map(({ index, item }) => (
        <li
          key={item.entryId}
          className="conversation-history__entry"
          data-entry-id={item.entryId}
          data-order-index={index}
        >
          <p className="conversation-history__question" data-testid="entry-question">
            {item.question}
          </p>
          <p className="conversation-history__answer" data-testid="entry-answer">
            {item.answer.text}
          </p>
          <span className="conversation-history__user" data-testid="entry-user">
            {item.userId}
          </span>
          <time className="conversation-history__time" data-testid="entry-answered-at">
            {formatAnsweredAt(item.answeredAt)}
          </time>
        </li>
      ))}
    </ol>
  );
}
