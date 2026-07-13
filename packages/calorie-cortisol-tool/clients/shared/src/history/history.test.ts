import type { Meal, NutrientValue, NutritionTotals } from '@calorie-cortisol/shared';

import {
  aggregateRange,
  computeStreak,
  distinctLoggedDays,
  evaluateInsightsGate,
  summarizeDay,
  summarizeWeek,
} from './history';
import { addDays } from './calendar';
import {
  INSIGHTS_MIN_DISTINCT_DAYS,
  MAX_STREAK_DAYS,
  WEEKLY_VIEW_DAYS,
} from './types';

/**
 * Unit tests for the meal history module (Task 14.12).
 *
 * Concrete example / edge-case coverage of daily & weekly aggregation (empty
 * days as zero), the consecutive-day logging streak (reset on gap, bounded
 * 0–3650), and meal-pattern insights gating on ≥7 distinct logged days within
 * the preceding 30 days with an exact-additional-days message otherwise.
 *
 * Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7
 */

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

function nutrient(value: number, available = true): NutrientValue {
  return { value, unit: 'g', lower: value, upper: value, available };
}

function totals(calories: number, protein: number, carbs: number, fat: number): NutritionTotals {
  return {
    calories: { ...nutrient(calories), unit: 'kcal' },
    protein: nutrient(protein),
    carbs: nutrient(carbs),
    fat: nutrient(fat),
    secondary: {},
  };
}

let mealCounter = 0;

/** Build a meal logged on the given local calendar day (noon local). */
function mealOn(
  day: string,
  t: NutritionTotals = totals(500, 30, 40, 20),
): Meal {
  mealCounter += 1;
  return {
    id: `m${mealCounter}`,
    userId: 'u1',
    loggedAt: `${day}T12:00:00Z`,
    items: [],
    totals: t,
    source: 'manual',
    syncStatus: 'local',
  };
}

// ---------------------------------------------------------------------------
// Daily aggregation (Req 6.1, 6.2)
// ---------------------------------------------------------------------------

describe('summarizeDay — daily aggregation (Req 6.1, 6.2)', () => {
  it('sums calories and macros across all meals logged that day', () => {
    const meals = [
      mealOn('2024-03-10', totals(500, 30, 40, 20)),
      mealOn('2024-03-10', totals(300, 10, 25, 15)),
      mealOn('2024-03-09', totals(999, 99, 99, 99)), // other day, excluded
    ];

    const summary = summarizeDay(meals, '2024-03-10');

    expect(summary.mealCount).toBe(2);
    expect(summary.isEmpty).toBe(false);
    expect(summary.totals).toEqual({ calories: 800, protein: 40, carbs: 65, fat: 35 });
  });

  it('returns zeroed totals and an empty indication for a day with no meals (Req 6.2)', () => {
    const meals = [mealOn('2024-03-09')];

    const summary = summarizeDay(meals, '2024-03-10');

    expect(summary.mealCount).toBe(0);
    expect(summary.isEmpty).toBe(true);
    expect(summary.totals).toEqual({ calories: 0, protein: 0, carbs: 0, fat: 0 });
  });

  it('treats unavailable nutrient values as zero', () => {
    const t = totals(500, 30, 40, 20);
    t.protein.available = false;
    const summary = summarizeDay([mealOn('2024-03-10', t)], '2024-03-10');
    expect(summary.totals.protein).toBe(0);
    expect(summary.totals.calories).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// Range / weekly aggregation (Req 6.3)
// ---------------------------------------------------------------------------

describe('aggregateRange & summarizeWeek — weekly aggregation (Req 6.3)', () => {
  it('sums across the 7-day period counting empty days as zero', () => {
    const meals = [
      mealOn('2024-03-04', totals(400, 20, 30, 10)),
      mealOn('2024-03-07', totals(600, 40, 50, 20)),
      mealOn('2024-03-10', totals(200, 10, 15, 5)),
    ];

    const week = summarizeWeek(meals, '2024-03-10');

    expect(week.startDay).toBe('2024-03-04');
    expect(week.endDay).toBe('2024-03-10');
    expect(week.days).toHaveLength(WEEKLY_VIEW_DAYS);
    expect(week.loggedDayCount).toBe(3);
    expect(week.totals).toEqual({ calories: 1200, protein: 70, carbs: 95, fat: 35 });
  });

  it('excludes meals outside the range', () => {
    const meals = [
      mealOn('2024-03-03', totals(999, 0, 0, 0)), // before window
      mealOn('2024-03-05', totals(100, 0, 0, 0)),
      mealOn('2024-03-11', totals(999, 0, 0, 0)), // after window
    ];
    const week = summarizeWeek(meals, '2024-03-10');
    expect(week.totals.calories).toBe(100);
  });

  it('aggregateRange over an empty meal set yields zeroed totals', () => {
    expect(aggregateRange([], '2024-03-04', '2024-03-10')).toEqual({
      calories: 0,
      protein: 0,
      carbs: 0,
      fat: 0,
    });
  });
});

// ---------------------------------------------------------------------------
// Consecutive-day streak (Req 6.4, 6.5)
// ---------------------------------------------------------------------------

describe('computeStreak — consecutive-day logging streak (Req 6.4, 6.5)', () => {
  it('counts unbroken days ending on today', () => {
    const meals = [
      mealOn('2024-03-08'),
      mealOn('2024-03-09'),
      mealOn('2024-03-10'),
    ];
    expect(computeStreak(meals, '2024-03-10')).toBe(3);
  });

  it('is zero when today has no logged meal', () => {
    const meals = [mealOn('2024-03-08'), mealOn('2024-03-09')];
    expect(computeStreak(meals, '2024-03-10')).toBe(0);
  });

  it('resets on a gap day (Req 6.4)', () => {
    const meals = [
      mealOn('2024-03-06'),
      mealOn('2024-03-07'),
      // gap on 2024-03-08
      mealOn('2024-03-09'),
      mealOn('2024-03-10'),
    ];
    expect(computeStreak(meals, '2024-03-10')).toBe(2);
  });

  it('multiple meals on the same day count once', () => {
    const meals = [
      mealOn('2024-03-10'),
      mealOn('2024-03-10'),
      mealOn('2024-03-09'),
    ];
    expect(computeStreak(meals, '2024-03-10')).toBe(2);
  });

  it('is bounded at MAX_STREAK_DAYS (Req 6.5)', () => {
    const start = '2000-01-01';
    // Log more than MAX_STREAK_DAYS consecutive days ending on `today`.
    const today = addDays(start, MAX_STREAK_DAYS + 50);
    const meals: Meal[] = [];
    for (let i = 0; i <= MAX_STREAK_DAYS + 50; i++) {
      meals.push(mealOn(addDays(start, i)));
    }
    expect(computeStreak(meals, today)).toBe(MAX_STREAK_DAYS);
  });

  it('future meals do not extend the streak', () => {
    const meals = [mealOn('2024-03-10'), mealOn('2024-03-11')];
    expect(computeStreak(meals, '2024-03-10')).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Insights gating (Req 6.6, 6.7)
// ---------------------------------------------------------------------------

describe('evaluateInsightsGate — meal-pattern insights gating (Req 6.6, 6.7)', () => {
  const today = '2024-03-30';

  it('is eligible with ≥7 distinct logged days in the preceding 30 days (Req 6.6)', () => {
    const meals: Meal[] = [];
    for (let i = 0; i < INSIGHTS_MIN_DISTINCT_DAYS; i++) {
      meals.push(mealOn(addDays(today, -i)));
    }
    const gate = evaluateInsightsGate(meals, today);
    expect(gate.eligible).toBe(true);
    expect(gate.distinctLoggedDays).toBe(INSIGHTS_MIN_DISTINCT_DAYS);
    expect(gate.additionalDaysRequired).toBe(0);
    expect(gate.message).toBeUndefined();
  });

  it('reports the exact additional days required when short (Req 6.7)', () => {
    const meals = [
      mealOn(addDays(today, -1)),
      mealOn(addDays(today, -2)),
      mealOn(addDays(today, -3)),
    ];
    const gate = evaluateInsightsGate(meals, today);
    expect(gate.eligible).toBe(false);
    expect(gate.distinctLoggedDays).toBe(3);
    expect(gate.additionalDaysRequired).toBe(4);
    expect(gate.message).toContain('4');
  });

  it('counts distinct days once even with multiple meals per day', () => {
    const meals = [
      mealOn(addDays(today, -1)),
      mealOn(addDays(today, -1)),
      mealOn(addDays(today, -2)),
    ];
    const gate = evaluateInsightsGate(meals, today);
    expect(gate.distinctLoggedDays).toBe(2);
    expect(gate.additionalDaysRequired).toBe(5);
  });

  it('excludes days older than the 30-day window', () => {
    // The window is the 30 inclusive days [today-29, today].
    const meals = [
      mealOn(addDays(today, -29)), // window start (in window)
      mealOn(addDays(today, -30)), // just outside the window
      mealOn(addDays(today, -31)), // out of window
    ];
    const gate = evaluateInsightsGate(meals, today);
    expect(gate.distinctLoggedDays).toBe(1);
  });

  it('uses singular wording when exactly one day remains', () => {
    const meals: Meal[] = [];
    for (let i = 0; i < INSIGHTS_MIN_DISTINCT_DAYS - 1; i++) {
      meals.push(mealOn(addDays(today, -i)));
    }
    const gate = evaluateInsightsGate(meals, today);
    expect(gate.additionalDaysRequired).toBe(1);
    expect(gate.message).toMatch(/1 more day\b/);
  });

  it('distinctLoggedDays returns the full set across all history', () => {
    const meals = [mealOn('2024-01-01'), mealOn('2024-01-01'), mealOn('2024-02-01')];
    expect(distinctLoggedDays(meals).size).toBe(2);
  });
});
