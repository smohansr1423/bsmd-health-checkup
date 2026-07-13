/**
 * Usage dashboard view (Task 13.14 — Req 15.1, 15.2, 15.3, 15.4, 15.5).
 *
 * Displays the Active_Workspace's usage counts — AI queries, API executions,
 * and code-generation requests (Req 15.2) — together with the current
 * query-quota consumption as both the consumed count and the account's
 * plan-tier limit (Req 15.3). A Loading_Indicator is shown while the dashboard
 * request is in flight (Req 15.1). When the backend reports no recorded usage,
 * every count renders as zero and a "no usage data" message is shown (Req 15.4).
 *
 * Error / timeout handling (Req 15.5): the wiring layer (Task 14.2) feeds a
 * mapped error message in as the `error` prop, and this view *additionally*
 * treats a load that has not completed within 3 seconds as a failure. In either
 * case an error message and a Retry action are shown. Any previously loaded
 * dashboard data is retained on screen so the User keeps their context while
 * retrying.
 */

import React, { useEffect, useState } from 'react';
import { EmptyState } from '../components/EmptyState';
import { LoadingIndicator } from '../components/LoadingIndicator';
import {
  EMPTY_STATE_MESSAGES,
  resolveDashboardDisplay,
  type UsageCountsLike,
} from '../components/empty-states';
import { useAppStore } from '../state/store';

/** Stable operation id for loading the dashboard. */
export const DASHBOARD_OP = 'usage-analytics:dashboard';

/**
 * The dashboard request is treated as failed if it has not completed within
 * this many milliseconds (Req 15.5).
 */
export const DASHBOARD_TIMEOUT_MS = 3_000;

/** Secret-free, user-facing messages for the dashboard view (Req 15.5). */
export const DASHBOARD_MESSAGES = {
  /** Req 15.5 — the dashboard data could not be loaded (error or >3s timeout). */
  loadFailed: 'Usage data could not be loaded. Please try again.',
} as const;

/** The dashboard payload (mirrors the backend by name). */
export interface DashboardData {
  counts: UsageCountsLike;
  quota: { consumed: number; limit: number };
}

export interface DashboardViewProps {
  /** Dashboard data, or undefined before it has loaded. */
  data?: DashboardData;
  /** A load-failure message to surface, if any (Req 15.5). */
  error?: string;
  /** Retry the dashboard load (Req 15.5). */
  onRetry?: () => void;
}

export function DashboardView({
  data,
  error,
  onRetry,
}: DashboardViewProps): React.ReactElement {
  const { state } = useAppStore();
  const loading = state.requests[DASHBOARD_OP] === 'loading';
  const display = resolveDashboardDisplay(data?.counts);

  // Req 15.5 — treat a load that runs longer than 3 s as a failure. The timer is
  // (re)started whenever a load begins and cleared the moment it completes, so a
  // response arriving within the window never trips the timeout.
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    if (!loading) {
      return undefined;
    }
    setTimedOut(false);
    const timer = setTimeout(() => setTimedOut(true), DASHBOARD_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [loading]);

  // A wiring-provided error or an elapsed 3 s deadline both surface as a
  // load failure with a Retry action (Req 15.5).
  const failureMessage =
    error ?? (timedOut ? DASHBOARD_MESSAGES.loadFailed : null);

  const handleRetry = (): void => {
    setTimedOut(false);
    onRetry?.();
  };

  return (
    <section className="view view--dashboard" aria-labelledby="dashboard-title">
      <h1 id="dashboard-title">Usage dashboard</h1>

      {loading ? <LoadingIndicator label="Loading usage…" /> : null}

      {failureMessage !== null ? (
        <div className="error" role="alert">
          <p>{failureMessage}</p>
          <button type="button" onClick={handleRetry}>
            Retry
          </button>
        </div>
      ) : null}

      {display === 'no-usage' ? (
        <EmptyState message={EMPTY_STATE_MESSAGES.noUsage} />
      ) : null}

      {/* Req 15.2, 15.3 — counts and quota. Rendered whenever data exists (incl.
          the all-zero no-usage case, Req 15.4) and retained across a retry. */}
      {(display === 'no-usage' || display === 'data') && data ? (
        <dl className="usage-counts">
          <div>
            <dt>AI queries</dt>
            <dd>{data.counts.aiQueries}</dd>
          </div>
          <div>
            <dt>API executions</dt>
            <dd>{data.counts.apiExecutions}</dd>
          </div>
          <div>
            <dt>Code generations</dt>
            <dd>{data.counts.codeGenerations}</dd>
          </div>
          <div>
            <dt>Query quota</dt>
            <dd>
              {data.quota.consumed} / {data.quota.limit}
            </dd>
          </div>
        </dl>
      ) : null}
    </section>
  );
}
