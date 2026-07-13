import fc from 'fast-check';

import type { Meal, NutritionTotals } from '@calorie-cortisol/shared';

import { evaluateInsightsGate } from './history';
import { addDays, type CalendarDay } from './calendar';
import { INSIGHTS_MIN_DISTINCT_DAYS, INSIGHTS_WINDOW_DAYS } from './types';

/**
 * Property 18: Insights gating on distinct logged days
 * Validates: Requirements 6.6, 6.7
 * Feature: calorie-cortisol-tool, Property 18
 *
 * For any logging history, meal-pattern insights are shown if and only if at
 * least 7 distinct calendar days with a logged meal exist in the preceding 30
 * days; otherwise the insufficient-history message states exactly
 * (7 - distinctDays) additional days required.
 *
 * The window used by the gate is the INSIGHTS_WINDOW_DAYS-day span ending on
 * (and including) `today`, i.e. `[today - 29, today]`. The property is checked
 * two independent ways:
 *
 *  1. By construction — we choose an intended number of distinct in-window
 *     logged days D, log exactly D distinct calendar days inside the window
 *     (with duplicate meals per day to prove distinctness is by calendar day),
 *     and scatter noise strictly before the window and strictly in the future.
 *     The gate must then report `distinctLoggedDays === D`,
 *     `eligible === (D >= 7)`, and — when ineligible — exactly `7 - D`
 *     additional days required, with a message naming that exact number.
 *
 *  2. Against an independent oracle — for arbitrary logging histories we
 *     recompute the distinct-in-window count in integer day-offset space (a
 *     different representation from the string-calendar implementation) and
 *     assert the full gate contract, including the biconditional and the exact
 *     additional-days arithmetic.
 */

// --- Meal factory ----------------------------------------------------------

/** Gating logic ignores nutrition, so every meal carries the same fixed totals. */
function fixedTotals(): NutritionTotals {
  const n = (value: number, unit: 'kcal' | 'g') => ({
    value,
    unit,
    lower: value,
    upper: value,
    available: true,
  });
  return {
    calories: n(500, 'kcal'),
    protein: n(30, 'g'),
    carbs: n(40, 'g'),
    fat: n(20, 'g'),
    secondary: {},
  };
}

let mealCounter = 0;
/** Build a meal logged at noon (local) on the given calendar day. */
function mealOn(day: CalendarDay): Meal {
  mealCounter += 1;
  return {
    id: `m${mealCounter}`,
    userId: 'u1',
    loggedAt: `${day}T12:00:00Z`,
    items: [],
    totals: fixedTotals(),
    source: 'manual' as const,
    syncStatus: 'local' as const,
  };
}

// --- Anchoring & independent oracle ----------------------------------------

/** Anchor date; every generated day is a whole-day offset from this. */
const BASE_DAY: CalendarDay = '2024-06-15';

/** Day at a signed whole-day offset from {@link BASE_DAY}. */
const dayAt = (offset: number): CalendarDay => addDays(BASE_DAY, offset);

/**
 * Independent oracle computed in integer day-offset space: the number of
 * distinct logged offsets that fall inside the inclusive window
 * `[todayOffset - (INSIGHTS_WINDOW_DAYS - 1), todayOffset]`.
 */
function distinctInWindow(loggedOffsets: ReadonlySet<number>, todayOffset: number): number {
  const windowStart = todayOffset - (INSIGHTS_WINDOW_DAYS - 1);
  let count = 0;
  for (const off of loggedOffsets) {
    if (off >= windowStart && off <= todayOffset) count += 1;
  }
  return count;
}

// --- Arbitraries -----------------------------------------------------------

/** A signed day offset within a bounded window around the anchor. */
const arbOffset = fc.integer({ min: -120, max: 120 });

describe('Property 18: Insights gating on distinct logged days (Req 6.6, 6.7) [Feature: calorie-cortisol-tool, Property 18]', () => {
  it('reports the constructed distinct-in-window count and gates exactly on 7 days, ignoring out-of-window noise', () => {
    fc.assert(
      fc.property(
        // The calendar day treated as "today".
        arbOffset,
        // Distinct in-window logged days, chosen as unique relative positions
        // 0..29 back from today (0 = today itself). Length is the intended D.
        fc.uniqueArray(fc.integer({ min: 0, max: INSIGHTS_WINDOW_DAYS - 1 }), {
          minLength: 0,
          maxLength: INSIGHTS_WINDOW_DAYS,
        }),
        // Extra meals for some in-window days (duplicates prove distinct-by-day).
        fc.array(fc.integer({ min: 0, max: INSIGHTS_WINDOW_DAYS - 1 }), { maxLength: 20 }),
        // Noise strictly before the window (must never count).
        fc.array(fc.integer({ min: 1, max: 200 }), { maxLength: 20 }),
        // Noise strictly in the future (must never count).
        fc.array(fc.integer({ min: 1, max: 200 }), { maxLength: 20 }),
        (todayOffset, inWindowRel, dupRel, pastGaps, futureGaps) => {
          const distinctD = inWindowRel.length;
          const inWindowSet = new Set(inWindowRel);
          const meals: Meal[] = [];

          // Log exactly the D distinct in-window days.
          for (const rel of inWindowRel) {
            meals.push(mealOn(dayAt(todayOffset - rel)));
          }
          // Duplicate meals on already-logged in-window days: must not change D.
          for (const rel of dupRel) {
            if (inWindowSet.has(rel)) meals.push(mealOn(dayAt(todayOffset - rel)));
          }
          // Noise strictly before windowStart: offset = todayOffset - 29 - k, k>=1.
          for (const k of pastGaps) {
            meals.push(mealOn(dayAt(todayOffset - (INSIGHTS_WINDOW_DAYS - 1) - k)));
          }
          // Noise strictly after today: offset = todayOffset + k, k>=1.
          for (const k of futureGaps) {
            meals.push(mealOn(dayAt(todayOffset + k)));
          }

          const gate = evaluateInsightsGate(meals, dayAt(todayOffset));

          expect(gate.distinctLoggedDays).toBe(distinctD);
          expect(gate.eligible).toBe(distinctD >= INSIGHTS_MIN_DISTINCT_DAYS);

          if (gate.eligible) {
            expect(gate.additionalDaysRequired).toBe(0);
            expect(gate.message).toBeUndefined();
          } else {
            const expectedAdditional = INSIGHTS_MIN_DISTINCT_DAYS - distinctD;
            expect(gate.additionalDaysRequired).toBe(expectedAdditional);
            // The insufficient-history message must state the exact number.
            expect(typeof gate.message).toBe('string');
            expect(gate.message).toContain(String(expectedAdditional));
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('matches an independent day-offset oracle for arbitrary histories (biconditional + exact arithmetic)', () => {
    fc.assert(
      fc.property(
        fc.array(arbOffset, { maxLength: 80 }),
        arbOffset,
        (offsets, todayOffset) => {
          const loggedOffsets = new Set<number>(offsets);
          const meals = offsets.map((off) => mealOn(dayAt(off)));

          const gate = evaluateInsightsGate(meals, dayAt(todayOffset));
          const expectedDistinct = distinctInWindow(loggedOffsets, todayOffset);
          const expectedEligible = expectedDistinct >= INSIGHTS_MIN_DISTINCT_DAYS;

          expect(gate.distinctLoggedDays).toBe(expectedDistinct);
          expect(gate.eligible).toBe(expectedEligible);

          if (expectedEligible) {
            expect(gate.additionalDaysRequired).toBe(0);
            expect(gate.message).toBeUndefined();
          } else {
            const expectedAdditional = INSIGHTS_MIN_DISTINCT_DAYS - expectedDistinct;
            expect(gate.additionalDaysRequired).toBe(expectedAdditional);
            expect(expectedAdditional).toBeGreaterThanOrEqual(1);
            expect(expectedAdditional).toBeLessThanOrEqual(INSIGHTS_MIN_DISTINCT_DAYS);
            expect(gate.message).toContain(String(expectedAdditional));
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('needs exactly 7 more days from an empty history and exactly 1 more at the 6-day boundary', () => {
    // Empty history: not eligible, exactly 7 additional days required.
    const today = dayAt(0);
    const emptyGate = evaluateInsightsGate([], today);
    expect(emptyGate.eligible).toBe(false);
    expect(emptyGate.distinctLoggedDays).toBe(0);
    expect(emptyGate.additionalDaysRequired).toBe(INSIGHTS_MIN_DISTINCT_DAYS);
    expect(emptyGate.message).toContain(String(INSIGHTS_MIN_DISTINCT_DAYS));

    // Exactly 6 distinct in-window days: one short of the threshold.
    const sixDayMeals: Meal[] = [];
    for (let i = 0; i < INSIGHTS_MIN_DISTINCT_DAYS - 1; i += 1) {
      sixDayMeals.push(mealOn(dayAt(-i)));
    }
    const sixGate = evaluateInsightsGate(sixDayMeals, today);
    expect(sixGate.eligible).toBe(false);
    expect(sixGate.distinctLoggedDays).toBe(INSIGHTS_MIN_DISTINCT_DAYS - 1);
    expect(sixGate.additionalDaysRequired).toBe(1);
    expect(sixGate.message).toContain('1');

    // Exactly 7 distinct in-window days: eligible, no message.
    const sevenDayMeals = [...sixDayMeals, mealOn(dayAt(-(INSIGHTS_MIN_DISTINCT_DAYS - 1)))];
    const sevenGate = evaluateInsightsGate(sevenDayMeals, today);
    expect(sevenGate.eligible).toBe(true);
    expect(sevenGate.distinctLoggedDays).toBe(INSIGHTS_MIN_DISTINCT_DAYS);
    expect(sevenGate.additionalDaysRequired).toBe(0);
    expect(sevenGate.message).toBeUndefined();
  });
});
