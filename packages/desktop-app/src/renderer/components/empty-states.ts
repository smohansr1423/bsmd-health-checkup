/**
 * Empty / "nothing found" state resolution (Task 13.1).
 *
 * **Pure** functions that decide, from the data a view was given, whether it
 * should render its populated content or one of the specified empty states:
 *
 *   - Q&A: the backend reported no grounded answer exists in the uploaded API
 *     knowledge — show "no answer found" and never fabricate an Answer (Req 8.5).
 *   - Search: zero results were returned — show "no relevant content found"
 *     (Req 9.3).
 *   - Conversation history: an empty history — show "no conversation history"
 *     (Req 14.2).
 *   - Usage dashboard: dashboard data reporting no recorded usage — counts are
 *     zero and a "no usage data" message is shown (Req 15.4).
 *
 * Keeping these decisions pure lets the views stay declarative and lets the
 * logic be unit-tested without rendering.
 */

/** User-facing empty-state messages (secret-free, presentation constants). */
export const EMPTY_STATE_MESSAGES = {
  /** Req 8.5 — Q&A had no grounded answer. */
  noAnswer: 'No answer was found in the uploaded API knowledge.',
  /** Req 9.3 — semantic search returned zero results. */
  noResults: 'No relevant content was found for your search.',
  /** Req 14.2 — the Active_Workspace has no conversation history. */
  emptyHistory: 'No conversation history exists for this workspace yet.',
  /** Req 15.4 — the dashboard reports no recorded usage. */
  noUsage: 'No usage data is available for this workspace yet.',
} as const;

/** What the Q&A view should render for a given result (Req 8.4, 8.5). */
export type QaDisplay = 'idle' | 'no-answer' | 'answer';

/** The minimal Q&A result shape the display decision needs. */
export interface QaResultLike {
  /** `false` when the backend found no grounded answer (Req 8.5). */
  grounded: boolean;
  /** The answer text; only rendered when `grounded` is true (Req 8.4). */
  text: string;
}

/**
 * Decide how the Q&A view renders a result.
 *
 * `idle` before any question has been answered; `no-answer` when the backend
 * reported no grounded answer exists (never fabricate — Req 8.5); otherwise
 * `answer`.
 */
export function resolveQaDisplay(result: QaResultLike | null | undefined): QaDisplay {
  if (result === null || result === undefined) {
    return 'idle';
  }
  return result.grounded ? 'answer' : 'no-answer';
}

/** What the search view should render (Req 9.2, 9.3). */
export type SearchDisplay = 'idle' | 'no-results' | 'results';

/**
 * Decide how the search view renders. `idle` before a search has run;
 * `no-results` when the backend returned zero results (Req 9.3); otherwise
 * `results`.
 */
export function resolveSearchDisplay(
  results: readonly unknown[] | null | undefined,
): SearchDisplay {
  if (results === null || results === undefined) {
    return 'idle';
  }
  return results.length === 0 ? 'no-results' : 'results';
}

/** What the conversation-history view should render (Req 14.1, 14.2). */
export type HistoryDisplay = 'idle' | 'empty' | 'entries';

/**
 * Decide how the conversation-history view renders. `idle` before history has
 * loaded; `empty` when the backend returned an empty history (Req 14.2);
 * otherwise `entries`.
 */
export function resolveHistoryDisplay(
  entries: readonly unknown[] | null | undefined,
): HistoryDisplay {
  if (entries === null || entries === undefined) {
    return 'idle';
  }
  return entries.length === 0 ? 'empty' : 'entries';
}

/** What the usage dashboard should render (Req 15.2, 15.4). */
export type DashboardDisplay = 'idle' | 'no-usage' | 'data';

/** The minimal usage-count shape the empty-state decision needs. */
export interface UsageCountsLike {
  aiQueries: number;
  apiExecutions: number;
  codeGenerations: number;
}

/**
 * Decide how the usage dashboard renders. `idle` before data has loaded;
 * `no-usage` when every recorded count is zero (Req 15.4); otherwise `data`.
 */
export function resolveDashboardDisplay(
  counts: UsageCountsLike | null | undefined,
): DashboardDisplay {
  if (counts === null || counts === undefined) {
    return 'idle';
  }
  const total = counts.aiQueries + counts.apiExecutions + counts.codeGenerations;
  return total === 0 ? 'no-usage' : 'data';
}
