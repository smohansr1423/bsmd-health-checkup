/**
 * Availability accounting and budget-breach alerting (Task 16.9, Req 24.5).
 *
 * Given the downtime intervals recorded by the {@link MonitorState} state
 * machine, this module computes the accumulated downtime within a specific
 * calendar month and raises an availability-breach alert when that total
 * exceeds the service class's monthly downtime budget (Req 24.5):
 *
 *   - general services      → 43 minutes/month
 *   - lab result ingestion  → 21 minutes/month
 *
 * Intervals that straddle a month boundary are clipped to the month under
 * evaluation so each month is charged only for the downtime that fell within
 * it. An ongoing interval (no `end`) is charged up to the evaluation instant
 * (`now`), clipped to the month.
 *
 * All functions are pure; `now` is supplied by the caller so month evaluation
 * is deterministic.
 *
 * Requirements: 24.5
 */

import {
  AVAILABILITY_BREACH_ALERT,
  MONTHLY_DOWNTIME_BUDGET_MINUTES,
  type ServiceClass,
} from './constants';
import type { DowntimeInterval } from './state-machine';

const MS_PER_MINUTE = 60_000;

// ---------------------------------------------------------------------------
// Calendar month window
// ---------------------------------------------------------------------------

/**
 * A calendar month to account against, expressed in UTC. `month` is 1-based
 * (1 = January … 12 = December) to match human/reporting conventions.
 */
export interface CalendarMonth {
  readonly year: number;
  /** 1-based month (1–12). */
  readonly month: number;
}

/** The UTC calendar month containing the given instant. */
export function monthOf(instant: Date): CalendarMonth {
  return {
    year: instant.getUTCFullYear(),
    month: instant.getUTCMonth() + 1,
  };
}

/** Canonical `YYYY-MM` label for a calendar month. */
export function monthLabel(month: CalendarMonth): string {
  return `${month.year.toString().padStart(4, '0')}-${month.month
    .toString()
    .padStart(2, '0')}`;
}

/** Inclusive-start / exclusive-end UTC bounds of a calendar month. */
export function monthBounds(month: CalendarMonth): {
  start: number;
  end: number;
} {
  const start = Date.UTC(month.year, month.month - 1, 1);
  // Month is 1-based; passing `month` (0-based next month) yields the 1st of
  // the following month — the exclusive upper bound.
  const end = Date.UTC(month.year, month.month, 1);
  return { start, end };
}

// ---------------------------------------------------------------------------
// Downtime accounting (Req 24.5)
// ---------------------------------------------------------------------------

/**
 * Overlap in milliseconds between an interval `[from, to)` and a window
 * `[windowStart, windowEnd)`. Never negative.
 */
function overlapMs(
  from: number,
  to: number,
  windowStart: number,
  windowEnd: number,
): number {
  const lo = Math.max(from, windowStart);
  const hi = Math.min(to, windowEnd);
  return Math.max(0, hi - lo);
}

/**
 * Accumulated downtime, in milliseconds, that falls within the given calendar
 * month across all recorded intervals (Req 24.5). Intervals are clipped to the
 * month; an ongoing interval (undefined `end`) is charged up to `now`.
 */
export function accumulatedDowntimeMs(
  intervals: readonly DowntimeInterval[],
  month: CalendarMonth,
  now: Date,
): number {
  const { start: monthStart, end: monthEnd } = monthBounds(month);
  const nowMs = now.getTime();

  let total = 0;
  for (const interval of intervals) {
    const from = Date.parse(interval.start);
    if (Number.isNaN(from)) {
      continue;
    }
    // Ongoing intervals are charged up to the evaluation instant.
    const to =
      interval.end === undefined ? nowMs : Date.parse(interval.end);
    if (Number.isNaN(to) || to <= from) {
      continue;
    }
    total += overlapMs(from, to, monthStart, monthEnd);
  }
  return total;
}

/** Accumulated downtime within the month, expressed in minutes (Req 24.5). */
export function accumulatedDowntimeMinutes(
  intervals: readonly DowntimeInterval[],
  month: CalendarMonth,
  now: Date,
): number {
  return accumulatedDowntimeMs(intervals, month, now) / MS_PER_MINUTE;
}

// ---------------------------------------------------------------------------
// Availability-breach alert (Req 24.5)
// ---------------------------------------------------------------------------

/**
 * An operator-facing availability-breach alert (Req 24.5). Raised when a
 * service's accumulated monthly downtime exceeds its budget. It names the
 * affected service and reports the total downtime, and the caller retains the
 * `intervals` for the month alongside it.
 */
export interface AvailabilityBreachAlert {
  /** Stable alert identifier. */
  readonly alert: typeof AVAILABILITY_BREACH_ALERT;
  /** The affected service class (Req 24.5). */
  readonly serviceClass: ServiceClass;
  /** The concrete monitored service identifier that breached. */
  readonly serviceId: string;
  /** The calendar month the breach was accounted against (`YYYY-MM`). */
  readonly month: string;
  /** Total accumulated downtime within the month, in minutes (Req 24.5). */
  readonly totalDowntimeMinutes: number;
  /** The monthly downtime budget for the service class, in minutes. */
  readonly budgetMinutes: number;
  /** The retained downtime intervals contributing to the month (Req 24.5). */
  readonly intervals: readonly DowntimeInterval[];
  /** ISO-8601 timestamp at which the alert was raised. */
  readonly recordedAt: string;
}

/** Inputs to a monthly availability-budget evaluation. */
export interface BudgetEvaluationInput {
  /** The concrete monitored service identifier. */
  readonly serviceId: string;
  /** The service class, selecting the applicable budget (Req 24.5). */
  readonly serviceClass: ServiceClass;
  /** All recorded downtime intervals for the service (Req 24.5). */
  readonly intervals: readonly DowntimeInterval[];
  /** The calendar month to account against. */
  readonly month: CalendarMonth;
  /** The evaluation instant (used to charge any ongoing interval). */
  readonly now: Date;
}

/**
 * The outcome of a monthly availability-budget evaluation (Req 24.5): the
 * accumulated downtime, whether it breached the budget, and — when breached —
 * the alert to raise. Intervals are retained on the result regardless of
 * outcome.
 */
export interface BudgetEvaluation {
  readonly serviceId: string;
  readonly serviceClass: ServiceClass;
  readonly month: string;
  readonly totalDowntimeMinutes: number;
  readonly budgetMinutes: number;
  readonly breached: boolean;
  /** Present iff `breached` — the alert to deliver to operators (Req 24.5). */
  readonly alert?: AvailabilityBreachAlert;
  /** Retained downtime intervals for the month (Req 24.5). */
  readonly intervals: readonly DowntimeInterval[];
}

/**
 * Evaluate a service's accumulated downtime for a calendar month against its
 * budget, producing an availability-breach alert when the budget is exceeded
 * (Req 24.5). Recorded intervals are always retained on the result.
 */
export function evaluateMonthlyBudget(
  input: BudgetEvaluationInput,
): BudgetEvaluation {
  const { serviceId, serviceClass, intervals, month, now } = input;
  const budgetMinutes = MONTHLY_DOWNTIME_BUDGET_MINUTES[serviceClass];
  const totalDowntimeMinutes = accumulatedDowntimeMinutes(
    intervals,
    month,
    now,
  );
  const label = monthLabel(month);
  const breached = totalDowntimeMinutes > budgetMinutes;

  const base: BudgetEvaluation = {
    serviceId,
    serviceClass,
    month: label,
    totalDowntimeMinutes,
    budgetMinutes,
    breached,
    intervals,
  };

  if (!breached) {
    return base;
  }

  return {
    ...base,
    alert: {
      alert: AVAILABILITY_BREACH_ALERT,
      serviceClass,
      serviceId,
      month: label,
      totalDowntimeMinutes,
      budgetMinutes,
      intervals,
      recordedAt: now.toISOString(),
    },
  };
}
