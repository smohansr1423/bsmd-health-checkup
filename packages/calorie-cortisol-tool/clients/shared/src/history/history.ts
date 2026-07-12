/**
 * Meal history aggregation, streaks, and insights gating — pure logic
 * (Task 14.12).
 *
 * Every function here is pure and deterministic: it derives results solely from
 * the meals passed in plus an injected `today`/`dayOf` — no clock, no I/O, no
 * hidden state. This mirrors the design's correctness properties 16–18.
 *
 * Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7
 */

import type { Meal } from '@calorie-cortisol/shared';

import {
  addDays,
  assertCalendarDay,
  calendarDayOf,
  dayDifference,
  enumerateDays,
  isWithinRange,
  type CalendarDay,
} from './calendar';
import {
  INSIGHTS_MIN_DISTINCT_DAYS,
  INSIGHTS_WINDOW_DAYS,
  MAX_STREAK_DAYS,
  WEEKLY_VIEW_DAYS,
  ZERO_TOTALS,
  type AggregateTotals,
  type DailySummary,
  type InsightsGate,
  type WeeklySummary,
} from './types';

/**
 * Maps a meal to the local calendar day it counts toward. Defaults to the
 * local wall date embedded in `meal.loggedAt`, but can be injected to support
 * alternative day-boundary policies (e.g. a custom timezone).
 */
export type DayOf = (meal: Meal) => CalendarDay;

/** Default {@link DayOf}: the local calendar day of the meal's `loggedAt`. */
export const defaultDayOf: DayOf = (meal) => calendarDayOf(meal.loggedAt);

/** Read a nutrient's numeric value as a non-negative number (unavailable → 0). */
function nutrientValue(n: { value: number; available: boolean } | undefined): number {
  if (n === undefined || !n.available) return 0;
  return n.value > 0 ? n.value : 0;
}

/** Add a single meal's totals into an accumulator (Req 6.1). */
function addMealTotals(acc: AggregateTotals, meal: Meal): AggregateTotals {
  const t = meal.totals;
  return {
    calories: acc.calories + nutrientValue(t.calories),
    protein: acc.protein + nutrientValue(t.protein),
    carbs: acc.carbs + nutrientValue(t.carbs),
    fat: acc.fat + nutrientValue(t.fat),
  };
}

/**
 * Sum calories and macronutrients across the meals whose calendar day falls
 * within `[startDay, endDay]` (inclusive). Meals outside the range are
 * ignored; a range with no meals yields zeroed totals (Req 6.1, 6.2, 6.3).
 *
 * This is the shared core behind both daily and weekly aggregation.
 */
export function aggregateRange(
  meals: readonly Meal[],
  startDay: CalendarDay,
  endDay: CalendarDay,
  dayOf: DayOf = defaultDayOf,
): AggregateTotals {
  assertCalendarDay(startDay, 'startDay');
  assertCalendarDay(endDay, 'endDay');
  return meals.reduce<AggregateTotals>((acc, meal) => {
    return isWithinRange(dayOf(meal), startDay, endDay) ? addMealTotals(acc, meal) : acc;
  }, { ...ZERO_TOTALS });
}

/**
 * Build the daily summary for `day`: total calories and macros aggregated from
 * all meals logged that day, with an empty indication + zeroed totals when no
 * meals were logged (Req 6.1, 6.2).
 */
export function summarizeDay(
  meals: readonly Meal[],
  day: CalendarDay,
  dayOf: DayOf = defaultDayOf,
): DailySummary {
  assertCalendarDay(day, 'day');
  const dayMeals = meals.filter((m) => dayOf(m) === day);
  const totals = dayMeals.reduce<AggregateTotals>(addMealTotals, { ...ZERO_TOTALS });
  return {
    day,
    totals,
    mealCount: dayMeals.length,
    isEmpty: dayMeals.length === 0,
  };
}

/**
 * Build the weekly summary for the 7-day period ending on `endDay` (inclusive).
 * Every day in the period is represented — days with no meals are counted as
 * zero — and `totals` equals the sum across the whole period (Req 6.3).
 */
export function summarizeWeek(
  meals: readonly Meal[],
  endDay: CalendarDay,
  dayOf: DayOf = defaultDayOf,
): WeeklySummary {
  assertCalendarDay(endDay, 'endDay');
  const startDay = addDays(endDay, -(WEEKLY_VIEW_DAYS - 1));
  const days = enumerateDays(startDay, endDay).map((d) => summarizeDay(meals, d, dayOf));
  const totals = days.reduce<AggregateTotals>(
    (acc, d) => ({
      calories: acc.calories + d.totals.calories,
      protein: acc.protein + d.totals.protein,
      carbs: acc.carbs + d.totals.carbs,
      fat: acc.fat + d.totals.fat,
    }),
    { ...ZERO_TOTALS },
  );
  return {
    startDay,
    endDay,
    totals,
    days,
    loggedDayCount: days.filter((d) => !d.isEmpty).length,
  };
}

/** Return the set of distinct calendar days on which at least one meal was logged. */
export function distinctLoggedDays(
  meals: readonly Meal[],
  dayOf: DayOf = defaultDayOf,
): Set<CalendarDay> {
  const days = new Set<CalendarDay>();
  for (const meal of meals) {
    days.add(dayOf(meal));
  }
  return days;
}

/**
 * Compute the consecutive-day logging streak ending on `today`: the number of
 * unbroken calendar days, ending on `today`, each with at least one logged
 * meal. The streak is 0 when `today` itself has no logged meal, resets to 0 on
 * any gap day, and is always a whole number in `[0, MAX_STREAK_DAYS]`
 * (Req 6.4, 6.5).
 *
 * Meals logged in the future relative to `today` do not extend the streak.
 */
export function computeStreak(
  meals: readonly Meal[],
  today: CalendarDay,
  dayOf: DayOf = defaultDayOf,
): number {
  assertCalendarDay(today, 'today');
  const logged = distinctLoggedDays(meals, dayOf);

  let streak = 0;
  let cursor = today;
  // Walk backwards from today while each day has a logged meal.
  while (logged.has(cursor)) {
    streak++;
    if (streak >= MAX_STREAK_DAYS) break;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

/**
 * Decide whether meal-pattern insights may be shown, based on the number of
 * distinct logged days within the {@link INSIGHTS_WINDOW_DAYS}-day window
 * ending on `today` (inclusive). Insights are eligible iff at least
 * {@link INSIGHTS_MIN_DISTINCT_DAYS} such days exist; otherwise the gate
 * reports exactly `7 - distinctDays` additional days required (Req 6.6, 6.7).
 */
export function evaluateInsightsGate(
  meals: readonly Meal[],
  today: CalendarDay,
  dayOf: DayOf = defaultDayOf,
): InsightsGate {
  assertCalendarDay(today, 'today');
  const windowStart = addDays(today, -(INSIGHTS_WINDOW_DAYS - 1));

  const inWindow = new Set<CalendarDay>();
  for (const meal of meals) {
    const day = dayOf(meal);
    // Only days within [windowStart, today] count toward the gate.
    if (dayDifference(day, windowStart) >= 0 && dayDifference(day, today) <= 0) {
      inWindow.add(day);
    }
  }

  const distinct = inWindow.size;
  const eligible = distinct >= INSIGHTS_MIN_DISTINCT_DAYS;
  const additionalDaysRequired = eligible ? 0 : INSIGHTS_MIN_DISTINCT_DAYS - distinct;

  if (eligible) {
    return { eligible, distinctLoggedDays: distinct, additionalDaysRequired: 0 };
  }

  const dayWord = additionalDaysRequired === 1 ? 'day' : 'days';
  return {
    eligible,
    distinctLoggedDays: distinct,
    additionalDaysRequired,
    message: `Log ${additionalDaysRequired} more ${dayWord} to unlock meal pattern insights.`,
  };
}
