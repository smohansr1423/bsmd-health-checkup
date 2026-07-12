/**
 * Cortisol trend query — the `GET /trend?range=` logic (Req 12).
 *
 * This module owns ONLY the trend read path: selecting a 7/30/90-day window,
 * filtering cortisol readings to that window plus their reference bands
 * (Req 12.1), producing an empty-state that retains the selected range
 * (Req 12.2), annotating in-range life events while omitting out-of-range ones
 * without error (Req 12.3, 12.4), and attaching exactly one optional overlay
 * metric on the shared time axis with a no-overlay-data indication when the
 * metric has no readings in range (Req 12.5, 12.6).
 *
 * Every read is routed through the read-replica router with `trendRead` intent
 * so dashboard reads never contend with the ingestion write path (Req 12.1).
 *
 * All range-filtering, band-derivation, annotation-selection and
 * overlay-selection helpers are pure and dependency-free; the orchestrating
 * {@link queryTrend} composes them over the injected {@link TrendReadPort} and
 * {@link ReplicaRouter} without embedding SQL or transport concerns.
 *
 * Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6
 */

import type {
  CortisolReading,
  LifeEvent,
  TimeOfDayBucket,
} from '@calorie-cortisol/shared';
import {
  type Result,
  err,
  ok,
  validationRejection,
} from '@calorie-cortisol/shared/result';
import type { ReplicaRouter } from '../db/replica-router';
import { TrendErrorCode } from './errors';
import {
  OVERLAY_METRICS,
  type OverlayMetric,
  type OverlayPoint,
  type TimeWindow,
  type TrendReadPort,
} from './ports';

// ---------------------------------------------------------------------------
// Range constants (single source of truth for the supported windows, Req 12.1)
// ---------------------------------------------------------------------------

/** A supported trend window length, in days (Req 12.1). */
export type TrendRange = 7 | 30 | 90;

/** The three supported trend windows (Req 12.1). */
export const TREND_RANGES: readonly TrendRange[] = [7, 30, 90];

const MS_PER_DAY = 86_400_000;

// ---------------------------------------------------------------------------
// Pure parsing helpers
// ---------------------------------------------------------------------------

/**
 * Parse a `range` query parameter into a supported {@link TrendRange}, or
 * `null` when it is not one of 7/30/90 (Req 12.1). Accepts a number or a string
 * such as `"7"`, `"30d"`, `"90 days"` (leading digits are used).
 */
export function parseTrendRange(
  raw: string | number | undefined | null,
): TrendRange | null {
  if (typeof raw === 'number') {
    return (TREND_RANGES as readonly number[]).includes(raw)
      ? (raw as TrendRange)
      : null;
  }
  if (typeof raw !== 'string') {
    return null;
  }
  const match = raw.trim().match(/^(\d+)/);
  if (!match) {
    return null;
  }
  const days = Number.parseInt(match[1], 10);
  return (TREND_RANGES as readonly number[]).includes(days)
    ? (days as TrendRange)
    : null;
}

/**
 * Parse an overlay-metric query parameter into a supported {@link OverlayMetric}
 * (Req 12.5), or `null` when it is unsupported. An absent/blank value yields
 * `null` (no overlay requested) — the caller distinguishes "not requested" from
 * "invalid" via {@link isOverlayRequested}.
 */
export function parseOverlayMetric(
  raw: string | undefined | null,
): OverlayMetric | null {
  if (typeof raw !== 'string') {
    return null;
  }
  const value = raw.trim().toLowerCase();
  return (OVERLAY_METRICS as readonly string[]).includes(value)
    ? (value as OverlayMetric)
    : null;
}

/** Whether a raw overlay parameter was actually supplied (non-blank). */
export function isOverlayRequested(raw: string | undefined | null): boolean {
  return typeof raw === 'string' && raw.trim().length > 0;
}

/** Parse an ISO timestamp to epoch ms, or `null` when unparseable. */
export function parseTrendInstant(iso: string): number | null {
  if (typeof iso !== 'string' || iso.trim() === '') {
    return null;
  }
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

// ---------------------------------------------------------------------------
// Pure window + filtering helpers (Req 12.1)
// ---------------------------------------------------------------------------

/**
 * Compute the inclusive `[startMs, endMs]` window anchored at `asOf`, spanning
 * `range` days back from it, or `null` when `asOf` is unparseable.
 */
export function computeWindow(
  range: TrendRange,
  asOfIso: string,
): TimeWindow | null {
  const endMs = parseTrendInstant(asOfIso);
  if (endMs === null) {
    return null;
  }
  return { startMs: endMs - range * MS_PER_DAY, endMs };
}

/**
 * Whether an ISO timestamp falls within the inclusive window. Unparseable
 * timestamps are treated as out-of-window (never rendered).
 */
export function isWithinWindow(iso: string, window: TimeWindow): boolean {
  const ms = parseTrendInstant(iso);
  if (ms === null) {
    return false;
  }
  return ms >= window.startMs && ms <= window.endMs;
}

/**
 * Select exactly the cortisol readings whose `measuredAt` falls within the
 * window (Req 12.1 / Property 31), returned in ascending time order for a
 * left-to-right chart. Filtering is purely by timestamp — no validity or source
 * filtering — so the rendered series is exactly the in-range readings.
 */
export function filterReadingsInRange(
  readings: readonly CortisolReading[],
  window: TimeWindow,
): CortisolReading[] {
  return readings
    .filter((r) => isWithinWindow(r.measuredAt, window))
    .sort(
      (a, b) =>
        (parseTrendInstant(a.measuredAt) ?? 0) - (parseTrendInstant(b.measuredAt) ?? 0),
    );
}

// ---------------------------------------------------------------------------
// Reference bands (Req 12.1)
// ---------------------------------------------------------------------------

/** A per-time-of-day reference band drawn behind the trend line (Req 12.1). */
export interface ReferenceBand {
  readonly bucket: TimeOfDayBucket;
  readonly refLower: number;
  readonly refUpper: number;
}

const BUCKET_ORDER: readonly TimeOfDayBucket[] = [
  'morning',
  'noon',
  'afternoon',
  'evening',
];

/**
 * Derive the upper/lower reference bands for the rendered readings (Req 12.1).
 *
 * Each contextualized reading (Req 8.5) carries the reference interval for its
 * time-of-day bucket; the trend chart shades those intervals as bands. Bands
 * are de-duplicated per bucket (a single user has one interval per bucket) and
 * returned in diurnal order. Readings that were never contextualized (age/sex
 * unavailable) contribute no band.
 */
export function deriveReferenceBands(
  readings: readonly CortisolReading[],
): ReferenceBand[] {
  const byBucket = new Map<TimeOfDayBucket, ReferenceBand>();
  for (const reading of readings) {
    const ctx = reading.contextualized;
    if (!ctx) {
      continue;
    }
    if (!byBucket.has(reading.timeOfDayBucket)) {
      byBucket.set(reading.timeOfDayBucket, {
        bucket: reading.timeOfDayBucket,
        refLower: ctx.refLower,
        refUpper: ctx.refUpper,
      });
    }
  }
  return BUCKET_ORDER.filter((b) => byBucket.has(b)).map(
    (b) => byBucket.get(b) as ReferenceBand,
  );
}

// ---------------------------------------------------------------------------
// Life-event annotations (Req 12.3, 12.4)
// ---------------------------------------------------------------------------

/** A life-event marker positioned on the trend chart (Req 12.3). */
export interface TrendAnnotation {
  readonly date: string;
  readonly label: string;
}

/**
 * Select the life-event annotations for the chart (Req 12.3, 12.4).
 *
 * An event is annotated if and only if its date falls within the selected
 * window (Req 12.3). Out-of-range events are omitted without raising an error,
 * and events with an unparseable date are treated as out-of-range and skipped
 * (Req 12.4). Annotations are returned in ascending date order.
 */
export function selectInRangeAnnotations(
  events: readonly LifeEvent[],
  window: TimeWindow,
): TrendAnnotation[] {
  return events
    .filter((e) => isWithinWindow(e.date, window))
    .sort((a, b) => (parseTrendInstant(a.date) ?? 0) - (parseTrendInstant(b.date) ?? 0))
    .map((e) => ({ date: e.date, label: e.label }));
}

// ---------------------------------------------------------------------------
// Overlay selection (Req 12.5, 12.6)
// ---------------------------------------------------------------------------

/** The resolved overlay series shown alongside cortisol (Req 12.5, 12.6). */
export interface OverlaySeries {
  readonly metric: OverlayMetric;
  /** In-range overlay points on the shared time axis, ascending (Req 12.5). */
  readonly points: readonly OverlayPoint[];
  /** False → render cortisol alone with a no-overlay-data indication (Req 12.6). */
  readonly available: boolean;
  /** Present when no overlay data exists in range (Req 12.6). */
  readonly message?: string;
}

/**
 * Select the overlay series for a metric over the window (Req 12.5, 12.6).
 *
 * Only points within the shared window are kept (Req 12.5). When none remain,
 * `available` is false and a no-overlay-data indication is returned so the
 * cortisol trend renders alone (Req 12.6).
 */
export function selectOverlay(
  metric: OverlayMetric,
  points: readonly OverlayPoint[],
  window: TimeWindow,
): OverlaySeries {
  const inRange = points
    .filter((p) => isWithinWindow(p.at, window))
    .sort((a, b) => (parseTrendInstant(a.at) ?? 0) - (parseTrendInstant(b.at) ?? 0));

  if (inRange.length === 0) {
    return {
      metric,
      points: [],
      available: false,
      message: `No ${metric} data is available to overlay for the selected range.`,
    };
  }
  return { metric, points: inRange, available: true };
}

// ---------------------------------------------------------------------------
// Orchestration — GET /trend?range= (Req 12.1–12.6)
// ---------------------------------------------------------------------------

/** Inbound trend request at the endpoint boundary. */
export interface TrendQueryInput {
  readonly userId: string;
  /** Raw `range` query parameter (7 / 30 / 90). */
  readonly range: string | number;
  /**
   * Reference instant the window is anchored to (ISO). Injected rather than read
   * from the wall clock so the query is deterministic and testable.
   */
  readonly asOf: string;
  /** Optional overlay metric (calories / sleep / hrv), exactly one (Req 12.5). */
  readonly overlay?: string | null;
}

/** Everything {@link queryTrend} depends on. */
export interface TrendDeps {
  /** Read-replica router; trend reads use `trendRead` intent (Req 12.1). */
  readonly router: ReplicaRouter;
  /** Replica-routed read-side data access. */
  readonly reads: TrendReadPort;
}

/** The fully assembled trend view returned to the client. */
export interface TrendView {
  readonly userId: string;
  readonly range: TrendRange;
  readonly window: TimeWindow;
  /** Cortisol readings within the range, ascending (Req 12.1). */
  readonly readings: readonly CortisolReading[];
  /** Upper/lower reference bands for the rendered readings (Req 12.1). */
  readonly referenceBands: readonly ReferenceBand[];
  /** In-range life-event annotations (Req 12.3, 12.4). */
  readonly annotations: readonly TrendAnnotation[];
  /** The overlay series, or `null` when no overlay was requested (Req 12.5). */
  readonly overlay: OverlaySeries | null;
  /** True when no cortisol readings fall in the range (Req 12.2). */
  readonly empty: boolean;
  /** Empty-state message, present iff `empty` (Req 12.2). */
  readonly emptyMessage?: string;
  /** The range remains selected across an empty result (Req 12.2). */
  readonly retainedRange: TrendRange;
}

/**
 * Execute a `GET /trend?range=` query (Req 12.1–12.6).
 *
 * Validation failures (blank user, unsupported range/overlay, unparseable
 * anchor) return a rejected {@link Result} whose error retains the caller's
 * prior state — including the currently selected range (Req 12.2). Otherwise a
 * {@link TrendView} is assembled:
 *  - reads are routed through the replica router with `trendRead` intent
 *    (Req 12.1);
 *  - cortisol readings are filtered to exactly the in-range readings plus their
 *    reference bands (Req 12.1);
 *  - when no readings fall in range, `empty` is set with a message and the
 *    range is retained (Req 12.2);
 *  - in-range life events are annotated and out-of-range ones omitted without
 *    error (Req 12.3, 12.4);
 *  - a requested overlay metric is attached on the shared axis, with a
 *    no-overlay-data indication when it has no in-range points (Req 12.5, 12.6).
 */
export async function queryTrend(
  input: TrendQueryInput,
  deps: TrendDeps,
): Promise<Result<TrendView>> {
  if (typeof input.userId !== 'string' || input.userId.trim() === '') {
    return err(
      validationRejection(
        TrendErrorCode.INVALID_REQUEST,
        'A userId is required to query the cortisol trend.',
      ),
    );
  }

  const range = parseTrendRange(input.range);
  if (range === null) {
    return err(
      validationRejection(
        TrendErrorCode.INVALID_RANGE,
        'The trend range must be one of 7, 30, or 90 days. The current range is retained.',
      ),
    );
  }

  const window = computeWindow(range, input.asOf);
  if (window === null) {
    return err(
      validationRejection(
        TrendErrorCode.INVALID_AS_OF,
        'A valid reference instant is required to anchor the trend range.',
      ),
    );
  }

  // Resolve the overlay metric up front so an unsupported metric is rejected
  // rather than silently ignored (Req 12.5).
  let overlayMetric: OverlayMetric | null = null;
  if (isOverlayRequested(input.overlay)) {
    overlayMetric = parseOverlayMetric(input.overlay);
    if (overlayMetric === null) {
      return err(
        validationRejection(
          TrendErrorCode.INVALID_OVERLAY_METRIC,
          'The overlay metric must be exactly one of calories, sleep, or heart-rate variability.',
        ),
      );
    }
  }

  // Req 12.1: route read-heavy trend reads through a read replica when available.
  const decision = deps.router.route('trendRead');
  const { endpoint } = decision;

  const [rawReadings, rawEvents] = await Promise.all([
    deps.reads.fetchCortisolReadings(endpoint, input.userId, window),
    deps.reads.fetchLifeEvents(endpoint, input.userId),
  ]);

  const readings = filterReadingsInRange(rawReadings, window);
  const referenceBands = deriveReferenceBands(readings);
  const annotations = selectInRangeAnnotations(rawEvents, window);

  let overlay: OverlaySeries | null = null;
  if (overlayMetric !== null) {
    const rawOverlay = await deps.reads.fetchOverlaySeries(
      endpoint,
      input.userId,
      overlayMetric,
      window,
    );
    overlay = selectOverlay(overlayMetric, rawOverlay, window);
  }

  const empty = readings.length === 0;

  const view: TrendView = {
    userId: input.userId,
    range,
    window,
    readings,
    referenceBands,
    annotations,
    overlay,
    empty,
    retainedRange: range,
    ...(empty
      ? {
          emptyMessage: `No cortisol data is available for the selected ${range}-day range.`,
        }
      : {}),
  };

  return ok(view);
}
