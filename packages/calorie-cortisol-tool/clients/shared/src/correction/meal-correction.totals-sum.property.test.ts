import fc from 'fast-check';

import { ok, type Result } from '@calorie-cortisol/shared/result';
import type {
  Meal,
  MealItem,
  NutrientUnit,
  NutrientValue,
  NutritionTotals,
} from '@calorie-cortisol/shared';

import {
  applyCorrectionToMeal,
  type FoodItemResolver,
  type ResolvedFoodItem,
} from './index';

/**
 * Property 13: Meal totals always equal the sum of current items.
 * Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.7
 * Feature: calorie-cortisol-tool, Property 13
 *
 * For any meal and any sequence of correction operations (add, swap, delete,
 * portion-multiplier change within 0.25×–3× in 0.25 steps), the meal totals
 * always equal the sum of the current items' nutrition; a meal with no items
 * has zero totals.
 *
 * The invariant is checked against an INDEPENDENT restatement of Req 5.1–5.4/5.7:
 * a fresh per-nutrient fold over the meal's current items (`expectedNutrient`),
 * rather than reusing the production `recomputeTotals` traversal. After every
 * applied correction — and on the empty meal — every nutrient reachable from
 * the meal's totals must equal the summed contribution of the items that
 * currently report it available.
 */

// --- Nutrient vocabulary (fixed key→unit map keeps sums well-defined) ------

const NUTRIENT_UNITS: Record<string, NutrientUnit> = {
  calories: 'kcal',
  protein: 'g',
  carbs: 'g',
  fat: 'g',
  fiber: 'g',
  sugar: 'g',
  sodium: 'mg',
  satFat: 'g',
  cholesterol: 'mg',
  vitaminC: 'mg',
  iron: 'mg',
};

const NUTRIENT_KEYS = Object.keys(NUTRIENT_UNITS);
const PRIMARY_KEYS = ['calories', 'protein', 'carbs', 'fat'] as const;

// --- Independent oracle for Req 5.1–5.4/5.7 --------------------------------

/** The nutrient a meal's totals report for `key`, or `undefined` if absent. */
function totalNutrient(
  totals: NutritionTotals,
  key: string,
): NutrientValue | undefined {
  switch (key) {
    case 'calories':
      return totals.calories;
    case 'protein':
      return totals.protein;
    case 'carbs':
      return totals.carbs;
    case 'fat':
      return totals.fat;
    default:
      return totals.secondary[key] ?? totals.micronutrients?.[key];
  }
}

interface ExpectedNutrient {
  value: number;
  lower: number;
  upper: number;
  available: boolean;
}

/**
 * Independent sum of one nutrient key over the meal's current items. Only
 * available contributions add to the value; the key is available in the total
 * iff at least one item reported it available. Items are summed in item order,
 * mirroring how a fold over `items` accumulates.
 */
function expectedNutrient(
  items: readonly MealItem[],
  key: string,
): ExpectedNutrient {
  let value = 0;
  let lower = 0;
  let upper = 0;
  let available = false;
  let present = false;
  for (const item of items) {
    const n = item.nutrition[key];
    if (n === undefined) continue;
    present = true;
    if (n.available) {
      value += n.value;
      lower += n.lower;
      upper += n.upper;
      available = true;
    }
  }
  return present || (PRIMARY_KEYS as readonly string[]).includes(key)
    ? { value, lower, upper, available }
    : { value: 0, lower: 0, upper: 0, available: false };
}

/**
 * Assert the meal's totals equal the independent sum over its current items for
 * every reachable nutrient key (design Property 13). Also enforces the empty
 * meal → zero totals corollary (Req 5.7).
 */
function assertTotalsEqualItemSum(meal: Meal): void {
  const keys = new Set<string>([...PRIMARY_KEYS]);
  for (const item of meal.items) {
    for (const k of Object.keys(item.nutrition)) keys.add(k);
  }

  for (const key of keys) {
    const expected = expectedNutrient(meal.items, key);
    const actual = totalNutrient(meal.totals, key);
    expect(actual).toBeDefined();
    if (actual === undefined) continue;
    expect(actual.value).toBeCloseTo(expected.value, 8);
    expect(actual.lower).toBeCloseTo(expected.lower, 8);
    expect(actual.upper).toBeCloseTo(expected.upper, 8);
    expect(actual.available).toBe(expected.available);
  }

  // Empty meal → zero totals (Req 5.7).
  if (meal.items.length === 0) {
    for (const key of PRIMARY_KEYS) {
      expect(meal.totals[key].value).toBe(0);
      expect(meal.totals[key].available).toBe(false);
    }
    expect(meal.totals.secondary).toEqual({});
    expect(meal.totals.micronutrients).toBeUndefined();
  }
}

// --- Arbitraries -----------------------------------------------------------

/** A nutrient with lower ≤ value ≤ upper, integer-valued for exact sums. */
function arbNutrientEntry(key: string): fc.Arbitrary<NutrientValue> {
  return fc
    .record({
      value: fc.integer({ min: 0, max: 800 }),
      spread: fc.integer({ min: 0, max: 40 }),
      // ~80% available so the "unavailable contributes zero" branch is exercised.
      availableRoll: fc.integer({ min: 0, max: 4 }),
    })
    .map(({ value, spread, availableRoll }): NutrientValue => ({
      value,
      unit: NUTRIENT_UNITS[key],
      lower: Math.max(0, value - spread),
      upper: value + spread,
      available: availableRoll !== 0,
    }));
}

/** A nutrition map over a non-empty subset of the known nutrient keys. */
const arbNutrition: fc.Arbitrary<Record<string, NutrientValue>> = fc
  .subarray(NUTRIENT_KEYS, { minLength: 1 })
  .chain((keys) =>
    fc
      .tuple(...keys.map((k) => arbNutrientEntry(k)))
      .map((entries) =>
        Object.fromEntries(keys.map((k, i) => [k, entries[i]])),
      ),
  );

const VALID_MULTIPLIERS = [
  0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 2.75, 3,
] as const;
const arbMultiplier = fc.constantFrom(...VALID_MULTIPLIERS);

let idCounter = 0;
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

/** A single meal item with a unique food-item id. */
const arbMealItem: fc.Arbitrary<MealItem> = fc
  .record({ multiplier: arbMultiplier, nutrition: arbNutrition })
  .map(({ multiplier, nutrition }) => {
    const id = nextId('item');
    return {
      foodItem: { id, label: id, confidence: 90 },
      portionMultiplier: multiplier,
      nutrition,
    };
  });

/** A resolved lookup item (for add / swap) with a unique id. */
const arbResolved: fc.Arbitrary<ResolvedFoodItem> = arbNutrition.map(
  (nutrition) => {
    const id = nextId('resolved');
    return {
      foodItem: { id, label: id, confidence: 85 },
      nutrition,
    };
  },
);

/**
 * Abstract correction ops. `pick` is a fraction resolved against the current
 * item count at apply time, so ops always target a real item (or are skipped
 * when the meal is empty).
 */
type AbstractOp =
  | { t: 'setPortion'; pick: number; multiplier: number }
  | { t: 'swap'; pick: number; resolved: ResolvedFoodItem }
  | { t: 'add'; resolved: ResolvedFoodItem }
  | { t: 'addByBarcode'; resolved: ResolvedFoodItem }
  | { t: 'delete'; pick: number };

const arbAbstractOp: fc.Arbitrary<AbstractOp> = fc.oneof(
  fc.record({
    t: fc.constant('setPortion' as const),
    pick: fc.double({ min: 0, max: 0.999, noNaN: true }),
    multiplier: arbMultiplier,
  }),
  fc.record({
    t: fc.constant('swap' as const),
    pick: fc.double({ min: 0, max: 0.999, noNaN: true }),
    resolved: arbResolved,
  }),
  fc.record({ t: fc.constant('add' as const), resolved: arbResolved }),
  fc.record({ t: fc.constant('addByBarcode' as const), resolved: arbResolved }),
  fc.record({
    t: fc.constant('delete' as const),
    pick: fc.double({ min: 0, max: 0.999, noNaN: true }),
  }),
);

const arbMeal: fc.Arbitrary<Meal> = fc
  .array(arbMealItem, { minLength: 0, maxLength: 8 })
  .map((items) => {
    const id = nextId('meal');
    // Seed totals as the sum of the initial items so the meal is already
    // consistent before any correction is applied.
    return recomputedMeal({
      id,
      userId: 'u1',
      loggedAt: '2024-01-01T12:00:00.000Z',
      items,
      source: 'photo',
      syncStatus: 'local',
    });
  });

/** Build a meal whose totals are the independent sum of its items. */
function recomputedMeal(base: Omit<Meal, 'totals'>): Meal {
  const secondary: Record<string, NutrientValue> = {};
  const micronutrients: Record<string, NutrientValue> = {};
  const primary: Record<string, NutrientValue> = {};
  const keys = new Set<string>([...PRIMARY_KEYS]);
  for (const item of base.items) {
    for (const k of Object.keys(item.nutrition)) keys.add(k);
  }
  for (const key of keys) {
    const e = expectedNutrient(base.items, key);
    const nv: NutrientValue = {
      value: e.value,
      unit: NUTRIENT_UNITS[key] ?? 'g',
      lower: e.lower,
      upper: e.upper,
      available: e.available,
    };
    if ((PRIMARY_KEYS as readonly string[]).includes(key)) {
      primary[key] = nv;
    } else if (
      ['fiber', 'sugar', 'sodium', 'satFat', 'cholesterol'].includes(key)
    ) {
      secondary[key] = nv;
    } else {
      micronutrients[key] = nv;
    }
  }
  const totals: NutritionTotals = {
    calories: primary.calories,
    protein: primary.protein,
    carbs: primary.carbs,
    fat: primary.fat,
    secondary,
  };
  if (Object.keys(micronutrients).length > 0) {
    totals.micronutrients = micronutrients;
  }
  return { ...base, totals };
}

// --- Resolver whose next resolution is scripted per op ---------------------

/** Resolver returning a settable resolved item for both text and barcode. */
class ScriptedResolver implements FoodItemResolver {
  public next: ResolvedFoodItem | null = null;

  resolveByText(): Promise<Result<ResolvedFoodItem | null>> {
    return Promise.resolve(ok(this.next));
  }

  resolveByBarcode(): Promise<Result<ResolvedFoodItem | null>> {
    return Promise.resolve(ok(this.next));
  }
}

/** Index into a non-empty item list from a [0,1) fraction. */
function pickIndex(len: number, pick: number): number {
  return Math.min(len - 1, Math.floor(pick * len));
}

describe('Property 13: meal totals always equal the sum of current items (Req 5.1, 5.2, 5.3, 5.4, 5.7) [Feature: calorie-cortisol-tool, Property 13]', () => {
  it('holds after every correction in an arbitrary sequence, and for the empty meal', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbMeal,
        fc.array(arbAbstractOp, { minLength: 0, maxLength: 12 }),
        async (initialMeal, ops) => {
          const resolver = new ScriptedResolver();
          let meal = initialMeal;

          // Invariant holds on the starting meal (including the empty case).
          assertTotalsEqualItemSum(meal);

          for (const op of ops) {
            const count = meal.items.length;

            if (op.t === 'add' || op.t === 'addByBarcode') {
              resolver.next = op.resolved;
              const concrete =
                op.t === 'add'
                  ? ({ kind: 'add', query: 'q' } as const)
                  : ({ kind: 'addByBarcode', barcode: '012345678' } as const);
              const res = await applyCorrectionToMeal(meal, concrete, resolver);
              expect(res.ok).toBe(true);
              if (res.ok) meal = res.value.meal;
            } else if (count === 0) {
              // setPortion/swap/delete need a target item; nothing to do on an
              // empty meal — the invariant below still must hold unchanged.
              continue;
            } else if (op.t === 'setPortion') {
              const item = meal.items[pickIndex(count, op.pick)];
              const res = await applyCorrectionToMeal(
                meal,
                {
                  kind: 'setPortion',
                  itemId: item.foodItem.id,
                  multiplier: op.multiplier,
                },
                resolver,
              );
              expect(res.ok).toBe(true);
              if (res.ok) meal = res.value.meal;
            } else if (op.t === 'swap') {
              resolver.next = op.resolved;
              const item = meal.items[pickIndex(count, op.pick)];
              const res = await applyCorrectionToMeal(
                meal,
                { kind: 'swap', itemId: item.foodItem.id, query: 'q' },
                resolver,
              );
              expect(res.ok).toBe(true);
              if (res.ok) meal = res.value.meal;
            } else {
              // delete
              const item = meal.items[pickIndex(count, op.pick)];
              const res = await applyCorrectionToMeal(
                meal,
                { kind: 'delete', itemId: item.foodItem.id },
                resolver,
              );
              expect(res.ok).toBe(true);
              if (res.ok) meal = res.value.meal;
            }

            // Core invariant: totals == independent sum of current items.
            assertTotalsEqualItemSum(meal);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('a meal with no items has zero totals (Req 5.7)', () => {
    const empty = recomputedMeal({
      id: 'empty',
      userId: 'u1',
      loggedAt: '2024-01-01T12:00:00.000Z',
      items: [],
      source: 'manual',
      syncStatus: 'local',
    });
    assertTotalsEqualItemSum(empty);
  });
});
