/**
 * Injectable read ports for the Cortisol trend query (`GET /trend?range=`,
 * Req 12).
 *
 * Trend rendering is a read-heavy, replica-eligible workload (Req 12.1). The
 * orchestrator ({@link ../trend#queryTrend}) asks the {@link ReplicaRouter} for
 * a `trendRead` endpoint and hands the resolved {@link DbEndpoint} to these
 * ports, so every read is explicitly routed through the read-replica router and
 * never contends with the ingestion write path. The ports themselves are pure
 * interfaces: they take an endpoint + query window and return domain rows,
 * which keeps all range-filtering / annotation / overlay-selection logic
 * testable with in-memory doubles and no database or wall-clock coupling.
 */

import type { CortisolReading, LifeEvent } from '@calorie-cortisol/shared';
import type { DbEndpoint } from '../db/config';

/** A half-open-agnostic inclusive time window `[startMs, endMs]` in epoch ms. */
export interface TimeWindow {
  readonly startMs: number;
  readonly endMs: number;
}

/** The single overlay metric that can be shown alongside cortisol (Req 12.5). */
export type OverlayMetric = 'calories' | 'sleep' | 'hrv';

/** Supported overlay metrics — exactly one may be selected (Req 12.5). */
export const OVERLAY_METRICS: readonly OverlayMetric[] = [
  'calories',
  'sleep',
  'hrv',
];

/** A single timestamped overlay-metric sample. */
export interface OverlayPoint {
  /** ISO timestamp on the shared time axis (Req 12.5). */
  readonly at: string;
  readonly value: number;
}

/**
 * Read-side data access for the trend query. Each method receives the
 * replica-routed {@link DbEndpoint} chosen by the orchestrator so the read is
 * served by a read replica when one is configured (Req 12.1).
 */
export interface TrendReadPort {
  /** Cortisol readings for a user within (or overlapping) the query window. */
  fetchCortisolReadings(
    endpoint: DbEndpoint,
    userId: string,
    window: TimeWindow,
  ): Promise<readonly CortisolReading[]>;

  /** User-recorded life events for annotation (Req 12.3, 12.4). */
  fetchLifeEvents(
    endpoint: DbEndpoint,
    userId: string,
  ): Promise<readonly LifeEvent[]>;

  /** Overlay-metric samples for the selected metric and window (Req 12.5). */
  fetchOverlaySeries(
    endpoint: DbEndpoint,
    userId: string,
    metric: OverlayMetric,
    window: TimeWindow,
  ): Promise<readonly OverlayPoint[]>;
}
