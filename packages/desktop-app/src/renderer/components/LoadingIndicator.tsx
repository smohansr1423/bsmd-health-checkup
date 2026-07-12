/**
 * Loading indicator (Task 13.1 — Req 16.1).
 *
 * A minimal presentational spinner/text shown while an operation's request
 * status is `loading`. Views read the per-operation status from the store and
 * render this while it is in flight; the loading slice guarantees the status is
 * cleared on completion (Req 16.2).
 */

import React from 'react';

export interface LoadingIndicatorProps {
  /** Optional label describing the operation in progress. */
  label?: string;
}

/** Render an in-progress indicator for an operation. */
export function LoadingIndicator({
  label = 'Loading…',
}: LoadingIndicatorProps): React.ReactElement {
  return (
    <p className="loading-indicator" role="status" aria-live="polite">
      {label}
    </p>
  );
}
