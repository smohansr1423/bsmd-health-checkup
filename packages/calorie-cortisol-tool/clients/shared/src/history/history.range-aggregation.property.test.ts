import fc from 'fast-check';

import type { Meal, NutritionTotals } from '@calorie-cortisol/shared';

import {
  aggregateRange,
  defaultDayOf,
  summarizeDay,
  summarizeWeek,
} from './history';
import { addDays, calendarDayOf, isWithinRange, type CalendarDay } from './calendar';
import { WEEKLY_VIEW_DAYS, ZERO_TOTALS, type AggregateTotals } from './types';

/**
 * Property 16: Range aggregation equals the sum over the range
 * Validates: Requirements 6.1, 6.2, 6.3
 * Feature: calorie-cortisol-tool, Property 16
 *
 * For any set of logged meals and any calendar-day range, the aggregated
 * calorie/macronutrient totals equal the sum over exactly those meals whose
 * log date falls within the range (inclusive). Meals outside the range
 * contribute nothing, an empty range (or a range containing no meals) yields
 * zeroed totals, and a single-day range is just the special case start = end.
 *
 * The property is checked against an INDEPENDENT restatement of Req 6.1–6.3:
 * a fresh fold over the meals, keeping only those whose local calendar day is
 * within `[start, end]`, rather than reusing `aggregateRange`'s own traversal.
 * Nutrient values are generated as non-negative integers so the reference sum
 * is exact and order-independent (no floating-point slack).
 */

// --- Independent oracle for Req 6.1–6.3 ------------------------------------

/** Sum of one meal's four primary totals, treating unavailable values as 0. */
function readTotals(meal: Meal): AggregateTotals {
  const read = (n: { value: number; available: boolean }): number =>
    n.available && n.value > 0 ? n.value : 0;
  return {
    calories: read(meal.totals.calories),
    protein: read(meal.totals.protein),
    carbs: read(meal.totals.carbs),
    fat: read(meal.totals.fat),
  };
}

/** Independent sum over exactly the meals whose day lies within [start, end]. */
function expectedSumOverRange(
  meals: readonly Meal[],
  start: CalendarDay,
  end: CalendarDay,
): AggregateTotals {
  return meals.reduce<AggregateTotals>(
    (acc, meal) => {
      if (!isWithinRange(calendarDayOf(meal.loggedAt), start, end)) return acc;
      const t = readTotals(meal);
      return {
        calories: acc.calories + t.calories,
        protein: acc.protein + t.protein,
        carbs: acc.carbs + t.carbs,
        fat: acc.fat + t.fat,
      };
    },
    { ...ZERO_TOTALS },
  );
}

// --- Arbitraries -----------------------------------------------------------

/** Anchor date; every generated day is a whole-day offset from this. */
const BASE_DAY: CalendarDay = '2024-06-15';

/** A calendar day within a bounded window so ranges and meals overlap often. */
const arbDay: fc.Arbitrary<CalendarDay> = fc
  .integer({ min: -45, max: 45 })
  .map((delta) => addDays(BASE_DAY, delta));

function nutrient(value: number, unit: 'kcal' | 'g', available: boolean) {
  return { value, unit, lower: value, upper: value, available };
}

const arbTotals: fc.Arbitrary<NutritionTotals> = fc
  .record({
    calories: fc.integer({ min: 0, max: 5000 }),
    protein: fc.integer({ min: 0, max: 500 }),
    carbs: fc.integer({ min: 0, max: 800 }),
    fat: fc.integer({ min: 0, max: 400 }),
    // Occasionally mark a value unavailable — it must then count as zero.
    caloriesAvail: fc.boolean(),
    proteinAvail: fc.boolean(),
    carbsAvail: fc.boolean(),
    fatAvail: fc.boolean(),
  })
  .map((r) => ({
    calories: nutrient(r.calories, 'kcal', r.caloriesAvail),
    protein: nutrient(r.protein, 'g', r.proteinAvail),
    carbs: nutrient(r.carbs, 'g', r.carbsAvail),
    fat: nutrient(r.fat, 'g', r.fatAvail),
    secondary: {},
  }));

let mealCounter = 0;
const arbMeal: fc.Arbitrary<Meal> = fc
  .record({ day: arbDay, totals: arbTotals })
  .map(({ day, totals }) => {
    mealCounter += 1;
    return {
      id: `m${mealCounter}`,
      userId: 'u1',
      loggedAt: `${day}T12:00:00Z`,
      items: [],
      totals,
      source: 'manual' as const,
      syncStatus: 'local' as const,
    };
  });

const arbMeals = fc.array(arbMeal, { minLength: 0, maxLength: 40 });

/**
 * A [start, end] pair over the same window. The pair is used verbatim, so it
 * spans normal ranges, single-day ranges (start = end), and "empty" ranges
 * where end precedes start — all of which the property must handle.
 */
const arbRange: fc.Arbitrary<[CalendarDay, CalendarDay]> = fc.tuple(arbDay, arbDay);

describe('Property 16: Range aggregation equals the sum over the range (Req 6.1, 6.2, 6.3) [Feature: calorie-cortisol-tool, Property 16]', () => {
  it('aggregateRange equals the independent sum over meals whose day is in range', () => {
    fc.assert(
      fc.property(arbMeals, arbRange, (meals, [start, end]) => {
        expect(aggregateRange(meals, start, end)).toEqual(expectedSumOverRange(meals, start, end));
      }),
      { numRuns: 100 },
    );
  });

  it('a single-day range (start = end) equals that day’s summary totals', () => {
    fc.assert(
      fc.property(arbMeals, arbDay, (meals, day) => {
        expect(aggregateRange(meals, day, day)).toEqual(summarizeDay(meals, day).totals);
      }),
      { numRuns: 100 },
    );
  });

  it('a range containing no meals (and the empty meal set) yields zeroed totals (Req 6.2)', () => {
    fc.assert(
      fc.property(arbMeals, arbDay, (meals, day) => {
        // A far-future day range no generated meal can fall into.
        const start = addDays(day, 5_000);
        const end = addDays(day, 5_006);
        expect(aggregateRange(meals, start, end)).toEqual({ ...ZERO_TOTALS });
        // The empty meal set is always zero for any range.
        expect(aggregateRange([], start, end)).toEqual({ ...ZERO_TOTALS });
      }),
      { numRuns: 100 },
    );
  });

  it('is additive: a range splits into two adjacent sub-ranges that sum to the whole (Req 6.1, 6.3)', () => {
    fc.assert(
      fc.property(
        arbMeals,
        arbDay,
        fc.integer({ min: 0, max: 60 }),
        fc.integer({ min: 0, max: 60 }),
        (meals, start, leftSpan, rightSpan) => {
          const mid = addDays(start, leftSpan);
          const end = addDays(mid, rightSpan);
          const whole = aggregateRange(meals, start, end);
          const left = aggregateRange(meals, start, mid);
          const right = aggregateRange(meals, addDays(mid, 1), end);
          expect({
            calories: left.calories + right.calories,
            protein: left.protein + right.protein,
            carbs: left.carbs + right.carbs,
            fat: left.fat + right.fat,
          }).toEqual(whole);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('the 7-day weekly summary totals equal the range aggregate over the same window (Req 6.3)', () => {
    fc.assert(
      fc.property(arbMeals, arbDay, (meals, endDay) => {
        const startDay = addDays(endDay, -(WEEKLY_VIEW_DAYS - 1));
        expect(summarizeWeek(meals, endDay).totals).toEqual(
          aggregateRange(meals, startDay, endDay, defaultDayOf),
        );
      }),
      { numRuns: 100 },
    );
  });
});
