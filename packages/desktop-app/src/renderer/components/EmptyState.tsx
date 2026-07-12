/**
 * Empty-state message (Task 13.1 — Req 8.5, 9.3, 14.2, 15.4).
 *
 * A small presentational component used by views to render a "nothing found" /
 * "no data" message. The specific message comes from
 * {@link EMPTY_STATE_MESSAGES}; the decision of *when* to show it comes from the
 * pure resolvers in `empty-states.ts`.
 */

import React from 'react';

export interface EmptyStateProps {
  /** The message to display. */
  message: string;
}

/** Render an empty-state message region. */
export function EmptyState({ message }: EmptyStateProps): React.ReactElement {
  return (
    <p className="empty-state" role="status">
      {message}
    </p>
  );
}
