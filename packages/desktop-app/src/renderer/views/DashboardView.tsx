/**
 * Usage dashboard view (Task 13.1 — Req 15.1, 15.2, 15.3, 15.4, 15.5, 16.1).
 *
 * Displays the Active_Workspace's usage counts and query-quota consumption
 * (Req 15.2, 15.3), the "no usage data" empty state when nothing has been
 * recorded (Req 15.4), and a load-failure message with a retry action (Req
 * 15.5). Data is supplied by the wiring layer.
 */

import React from 'react';
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

  return (
    <section className="view view--dashboard" aria-labelledby="dashboard-title">
      <h1 id="dashboard-title">Usage dashboard</h1>

      {loading ? <LoadingIndicator label="Loading usage…" /> : null}

      {error !== undefined ? (
        <div className="error" role="alert">
          <p>{error}</p>
          <button type="button" onClick={() => onRetry?.()}>
            Retry
          </button>
        </div>
      ) : null}

      {display === 'no-usage' ? (
        <EmptyState message={EMPTY_STATE_MESSAGES.noUsage} />
      ) : null}

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
