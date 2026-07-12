/**
 * Meal history aggregation, streaks, and insights gating — types & constants
 * (Task 14.12).
 *
 * The history module is the pure, deterministic client-side aggregation layer
 * behind Requirement 6's dashboard: it turns a set of logged {@link Meal}s into
 * daily/weekly nutrition summaries (empty days counted as zero), computes the
 * consecutive-day logging streak, and decides whether enough distinct logged
 * days exist to surface meal-pattern insights.
 *
 * "Today" is always injected by the caller (never read from the system clock)
 * so every function is referentially transparent and easy to test.
 *
 * Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7
 */

import type { CalendarDay } from './calendar';

// ---------------------------------------------------------------------------
// Constants (single source of truth for the Requirement 6 thresholds)
// ---------------------------------------------------------------------------

/** Length of the weekly view, in days (Req 6.3). */
export const WEEKLY_VIEW_DAYS = 7;

/** Maximum reported consecutive-day logging streak (Req 6.5). */
export const MAX_STREAK_DAYS = 3650;

/**
 * Number of distinct logged days required within the insights window before
 * meal-pattern insights are surfaced (Req 6.6, 6.7).
 */
export const INSIGHTS_MIN_DISTINCT_DAYS = 7;

/** Size, in days, of the look-back window used for insights gating (Req 6.6, 6.7). */
export const INSIGHTS_WINDOW_DAYS = 30;

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

/**
 * Aggregated nutrition totals over a set of meals: total calories (kcal) and
 * total grams of each primary macronutrient (Req 6.1, 6.3). All values are
 * ≥ 0 and are zero for a day/period with no logged meals (Req 6.2, 6.3).
 */
export interface AggregateTotals {
  /** Total energy in kilocalories. */
  calories: number;
  /** Total protein in grams. */
  protein: number;
  /** Total carbohydrates in grams. */
  carbs: number;
  /** Total fat in grams. */
  fat: number;
}

/** A zeroed {@link AggregateTotals}, used for days/periods with no meals. */
export const ZERO_TOTALS: Readonly<AggregateTotals> = Object.freeze({
  calories: 0,
  protein: 0,
  carbs: 0,
  fat: 0,
});

/** Daily dashboard summary for a single calendar day (Req 6.1, 6.2). */
export interface DailySummary {
  day: CalendarDay;
  totals: AggregateTotals;
  /** Number of meals logged on this day. */
  mealCount: number;
  /**
   * True iff no meals were logged for this day; drives the "no meals logged"
   * indication with zeroed totals (Req 6.2).
   */
  isEmpty: boolean;
}

/** Weekly dashboard summary over a 7-day period (Req 6.3). */
export interface WeeklySummary {
  /** First day of the 7-day period (inclusive). */
  startDay: CalendarDay;
  /** Last day of the 7-day period (inclusive). */
  endDay: CalendarDay;
  /** Totals summed across the period, empty days counted as zero (Req 6.3). */
  totals: AggregateTotals;
  /** Per-day breakdown, one entry per day in the period (empty days included). */
  days: DailySummary[];
  /** Number of days in the period with at least one logged meal. */
  loggedDayCount: number;
}

// ---------------------------------------------------------------------------
// Insights gating
// ---------------------------------------------------------------------------

/**
 * Result of the meal-pattern insights gate (Req 6.6, 6.7).
 *
 * When {@link eligible} is true, at least {@link INSIGHTS_MIN_DISTINCT_DAYS}
 * distinct logged days exist in the preceding {@link INSIGHTS_WINDOW_DAYS}
 * days and insights may be shown. Otherwise {@link additionalDaysRequired} is
 * the exact count of further logging days needed and {@link message} carries
 * the insufficient-history indication.
 */
export interface InsightsGate {
  eligible: boolean;
  /** Distinct logged calendar days found within the window. */
  distinctLoggedDays: number;
  /** Exactly `max(0, 7 - distinctLoggedDays)` additional days required (Req 6.7). */
  additionalDaysRequired: number;
  /** Insufficient-history message when not eligible; `undefined` when eligible. */
  message?: string;
}
