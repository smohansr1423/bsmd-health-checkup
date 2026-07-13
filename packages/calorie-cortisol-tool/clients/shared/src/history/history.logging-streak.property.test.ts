import fc from 'fast-check';

import type { Meal, NutritionTotals } from '@calorie-cortisol/shared';

import { computeStreak } from './history';
import { addDays, calendarDayOf, type CalendarDay } from './calendar';
import { MAX_STREAK_DAYS } from './types';

/**
 * Property 17: Logging streak definition
 * Validates: Requirements 6.4, 6.5
 * Feature: calorie-cortisol-tool, Property 17
 *
 * For any logging history, the consecutive-day streak equals the number of
 * unbroken calendar days ending on the current day on which at least one meal
 * was logged, resets to zero on any gap day, and is always a whole number in
 * [0, 3650].
 *
 * The property is checked two independent ways:
 *
 *  1. By construction — we choose an intended streak length L, log exactly the
 *     L consecutive days ending on `today`, force the day immediately before
 *     that block to be un-logged (the gap), and scatter arbitrary un-related
 *     noise strictly before the gap and strictly in the future. `computeStreak`
 *     must then return exactly L, no matter the noise. This directly exercises
 *     "unbroken days ending on today", "reset on the gap day", "same-day meals
 *     counted once", and "future meals never extend the streak".
 *
 *  2. Against an independent oracle — for arbitrary logging histories we
 *     recompute the expected streak in integer *day-offset* space (a different
 *     representation from the string-calendar implementation) and assert
 *     equality, together with the whole-number and [0, 3650] bounds.
 */

// --- Meal factory ----------------------------------------------------------

/** Streak logic ignores nutrition, so every meal carries the same fixed totals. */
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
 * Independent oracle computed in integer day-offset space: count consecutive
 * logged offsets stepping down from `todayOffset`, capped at MAX_STREAK_DAYS.
 */
function expectedStreak(loggedOffsets: ReadonlySet<number>, todayOffset: number): number {
  let count = 0;
  for (let d = todayOffset; loggedOffsets.has(d); d -= 1) {
    count += 1;
    if (count === MAX_STREAK_DAYS) break;
  }
  return count;
}

// --- Arbitraries -----------------------------------------------------------

/** A signed day offset within a bounded window around the anchor. */
const arbOffset = fc.integer({ min: -120, max: 120 });

describe('Property 17: Logging streak definition (Req 6.4, 6.5) [Feature: calorie-cortisol-tool, Property 17]', () => {
  it('returns exactly the constructed unbroken streak, ignoring gaps, future, and older noise', () => {
    fc.assert(
      fc.property(
        // The calendar day treated as "today".
        arbOffset,
        // Intended unbroken streak length ending on today (0 means today unlogged).
        fc.integer({ min: 0, max: 60 }),
        // Arbitrary noise offsets that must not change the answer.
        fc.array(fc.integer({ min: -200, max: 200 }), { maxLength: 40 }),
        (todayOffset, streakLen, noise) => {
          // The L consecutive days ending on today are logged.
          const loggedOffsets = new Set<number>();
          for (let i = 0; i < streakLen; i += 1) {
            loggedOffsets.add(todayOffset - i);
          }
          // The day immediately before the block is the guaranteed gap.
          const gapOffset = todayOffset - streakLen;
          // Add noise everywhere except the gap day (which must stay un-logged
          // so the streak breaks exactly at length L).
          for (const raw of noise) {
            const off = todayOffset + raw;
            if (off !== gapOffset) loggedOffsets.add(off);
          }

          // Shuffle-independent: build meals in offset order plus a duplicate to
          // prove multiple meals on the same day count once.
          const meals: Meal[] = [];
          for (const off of loggedOffsets) {
            meals.push(mealOn(dayAt(off)));
            if (off === todayOffset) meals.push(mealOn(dayAt(off))); // duplicate on today
          }

          const today = dayAt(todayOffset);
          expect(computeStreak(meals, today)).toBe(streakLen);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('equals the independent day-offset oracle and is a whole number in [0, 3650]', () => {
    fc.assert(
      fc.property(
        fc.array(arbOffset, { maxLength: 60 }),
        arbOffset,
        (offsets, todayOffset) => {
          const loggedOffsets = new Set<number>(offsets);
          const meals = offsets.map((off) => mealOn(dayAt(off)));
          const today = dayAt(todayOffset);

          const streak = computeStreak(meals, today);

          expect(streak).toBe(expectedStreak(loggedOffsets, todayOffset));
          expect(Number.isInteger(streak)).toBe(true);
          expect(streak).toBeGreaterThanOrEqual(0);
          expect(streak).toBeLessThanOrEqual(MAX_STREAK_DAYS);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('is zero whenever today itself has no logged meal, regardless of prior history', () => {
    fc.assert(
      fc.property(
        arbOffset,
        fc.array(fc.integer({ min: 1, max: 200 }), { minLength: 1, maxLength: 40 }),
        (todayOffset, priorGaps) => {
          // Log only strictly-past days (today is never logged).
          const meals = priorGaps.map((g) => mealOn(dayAt(todayOffset - g)));
          expect(computeStreak(meals, dayAt(todayOffset))).toBe(0);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('is derived only from calendar days: the meal timestamp time-of-day is irrelevant', () => {
    fc.assert(
      fc.property(
        arbOffset,
        fc.integer({ min: 1, max: 30 }),
        (todayOffset, streakLen) => {
          const today = dayAt(todayOffset);
          const meals: Meal[] = [];
          for (let i = 0; i < streakLen; i += 1) {
            const day = dayAt(todayOffset - i);
            // Log the day but assert the module reduces the timestamp to its day.
            expect(calendarDayOf(`${day}T23:59:00Z`)).toBe(day);
            meals.push(mealOn(day));
          }
          // The gap day just before the block is absent → streak is exactly L.
          expect(computeStreak(meals, today)).toBe(streakLen);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('caps the reported streak at MAX_STREAK_DAYS for an unbroken run longer than the cap', () => {
    // A single very long unbroken run; the reported streak must saturate at 3650.
    const start: CalendarDay = '2000-01-01';
    const runLength = MAX_STREAK_DAYS + 25;
    const today = addDays(start, runLength - 1);
    const meals: Meal[] = [];
    for (let i = 0; i < runLength; i += 1) {
      meals.push(mealOn(addDays(start, i)));
    }
    expect(computeStreak(meals, today)).toBe(MAX_STREAK_DAYS);
  });
});
