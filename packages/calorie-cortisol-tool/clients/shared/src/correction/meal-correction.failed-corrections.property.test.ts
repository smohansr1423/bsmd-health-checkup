import fc from 'fast-check';

import { ok, type Result } from '@calorie-cortisol/shared/result';
import type {
  FoodItem,
  Meal,
  MealItem,
  NutrientUnit,
  NutrientValue,
} from '@calorie-cortisol/shared';

import {
  applyCorrectionToMeal,
  CorrectionErrorCode,
  InMemoryMealStore,
  MealCorrector,
  recomputeTotals,
  type FoodItemResolver,
  type ResolvedFoodItem,
} from './index';

/**
 * Property-based test for failed corrections leaving the meal unchanged
 * (Task 14.9).
 *
 * Feature: calorie-cortisol-tool, Property 14
 * Property 14: Failed corrections leave the meal unchanged.
 *   For any correction whose lookup (text search or barcode scan) returns no
 *   match, the meal and its totals remain unchanged and a no-match indication
 *   is returned. This holds for both the pure `applyCorrectionToMeal`
 *   transformation (input meal never mutated, failed Result returned) and the
 *   store-backed `MealCorrector` (nothing is persisted, the stored meal stays
 *   byte-for-byte identical).
 *
 * Validates: Requirements 5.6, 7.2, 7.6, 7.8
 */

// --- Resolvers whose lookups never match (clean no-match) ------------------

/** Resolver that always reports a clean no-match (`ok(null)`) for text/barcode. */
class NoMatchResolver implements FoodItemResolver {
  resolveByText(): Promise<Result<ResolvedFoodItem | null>> {
    return Promise.resolve(ok(null));
  }

  resolveByBarcode(): Promise<Result<ResolvedFoodItem | null>> {
    return Promise.resolve(ok(null));
  }
}

// --- Generators ------------------------------------------------------------

const NUTRIENT_UNITS: readonly NutrientUnit[] = ['kcal', 'g', 'mg'];
const NUTRIENT_KEYS = [
  'calories',
  'protein',
  'carbs',
  'fat',
  'fiber',
  'sugar',
  'sodium',
  'satFat',
  'cholesterol',
] as const;

const nutrientValueArb: fc.Arbitrary<NutrientValue> = fc
  .record({
    value: fc.integer({ min: 0, max: 2000 }),
    unit: fc.constantFrom(...NUTRIENT_UNITS),
    available: fc.boolean(),
  })
  .map(({ value, unit, available }) => ({
    value,
    unit,
    lower: Math.max(0, value - 5),
    upper: value + 5,
    available,
  }));

/** A nutrition map over a non-empty subset of the known nutrient keys. */
const nutritionArb: fc.Arbitrary<Record<string, NutrientValue>> = fc
  .subarray([...NUTRIENT_KEYS], { minLength: 1 })
  .chain((keys) =>
    fc
      .tuple(...keys.map(() => nutrientValueArb))
      .map((values) =>
        Object.fromEntries(keys.map((k, i) => [k, values[i]])),
      ),
  );

const portionMultiplierArb = fc.constantFrom(
  0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 2.75, 3,
);

/** A meal item with a caller-assigned, meal-unique id. */
function mealItemArb(id: string): fc.Arbitrary<MealItem> {
  return fc
    .record({
      label: fc.string({ minLength: 1, maxLength: 20 }),
      confidence: fc.integer({ min: 0, max: 100 }),
      portionMultiplier: portionMultiplierArb,
      nutrition: nutritionArb,
    })
    .map(({ label, confidence, portionMultiplier, nutrition }) => {
      const foodItem: FoodItem = { id, label, confidence };
      return { foodItem, portionMultiplier, nutrition };
    });
}

/** A meal with at least one item (so `swap` has a valid target). */
const mealArb: fc.Arbitrary<Meal> = fc
  .integer({ min: 1, max: 8 })
  .chain((count) =>
    fc.tuple(
      ...Array.from({ length: count }, (_, i) => mealItemArb(`item-${i}`)),
    ),
  )
  .chain((items) =>
    fc
      .record({
        id: fc.string({ minLength: 1, maxLength: 16 }),
        userId: fc.string({ minLength: 1, maxLength: 16 }),
        source: fc.constantFrom(
          'photo',
          'barcode',
          'voice',
          'menuOCR',
          'textSearch',
          'manual',
        ) as fc.Arbitrary<Meal['source']>,
        syncStatus: fc.constantFrom(
          'local',
          'pending',
          'synced',
          'conflict',
        ) as fc.Arbitrary<Meal['syncStatus']>,
      })
      .map(({ id, userId, source, syncStatus }) => ({
        id,
        userId,
        loggedAt: '2024-01-01T12:00:00.000Z',
        items,
        totals: recomputeTotals(items),
        source,
        syncStatus,
      })),
  );

/**
 * A lookup correction plus the raw data needed to bind it to a concrete meal.
 * `swap` uses `itemIndex` (taken modulo the meal's item count) to target an
 * existing item so the failure is a *no-match*, not an item-not-found.
 */
type LookupCorrectionSpec =
  | { kind: 'swap'; itemIndex: number; query: string }
  | { kind: 'add'; query: string }
  | { kind: 'addByBarcode'; barcode: string };

const queryArb = fc.string({ minLength: 1, maxLength: 40 });
const barcodeArb = fc.string({ minLength: 6, maxLength: 14 });

const lookupCorrectionSpecArb: fc.Arbitrary<LookupCorrectionSpec> = fc.oneof(
  fc.record({
    kind: fc.constant('swap' as const),
    itemIndex: fc.nat(),
    query: queryArb,
  }),
  fc.record({ kind: fc.constant('add' as const), query: queryArb }),
  fc.record({
    kind: fc.constant('addByBarcode' as const),
    barcode: barcodeArb,
  }),
);

/** Resolve a spec to a concrete {@link CorrectionOp} against a given meal. */
function toOp(spec: LookupCorrectionSpec, meal: Meal) {
  switch (spec.kind) {
    case 'swap': {
      const target = meal.items[spec.itemIndex % meal.items.length];
      return { kind: 'swap' as const, itemId: target.foodItem.id, query: spec.query };
    }
    case 'add':
      return { kind: 'add' as const, query: spec.query };
    case 'addByBarcode':
      return { kind: 'addByBarcode' as const, barcode: spec.barcode };
  }
}

const noMatchResolver = new NoMatchResolver();

describe('Property 14: failed corrections leave the meal unchanged [Feature: calorie-cortisol-tool, Property 14]', () => {
  it('pure applyCorrectionToMeal returns a no-match and never mutates the meal (Req 5.6, 7.2, 7.6, 7.8)', async () => {
    await fc.assert(
      fc.asyncProperty(mealArb, lookupCorrectionSpecArb, async (meal, spec) => {
        const before = JSON.stringify(meal);
        const op = toOp(spec, meal);

        const result = await applyCorrectionToMeal(meal, op, noMatchResolver);

        // A no-match indication is returned (never a success). Req 5.6/7.8.
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.code).toBe(CorrectionErrorCode.NoMatch);
        // Prior state is retained (Req 7.2/7.6).
        expect(result.error.retainedState).toBe(true);
        expect(result.error.message.length).toBeGreaterThan(0);

        // The input meal is byte-for-byte unchanged (no mutation, no re-sum).
        expect(JSON.stringify(meal)).toBe(before);
      }),
      { numRuns: 100 },
    );
  });

  it('store-backed MealCorrector persists nothing on a no-match (Req 5.6)', async () => {
    await fc.assert(
      fc.asyncProperty(mealArb, lookupCorrectionSpecArb, async (meal, spec) => {
        const store = new InMemoryMealStore([meal]);
        const storedBefore = JSON.stringify(store.getMeal(meal.id));
        const corrector = new MealCorrector({ store, resolver: noMatchResolver });
        const op = toOp(spec, meal);

        const result = await corrector.applyCorrection(meal.id, op);

        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.code).toBe(CorrectionErrorCode.NoMatch);

        // The stored meal — items and totals — is unchanged after the failure.
        expect(JSON.stringify(store.getMeal(meal.id))).toBe(storedBefore);
      }),
      { numRuns: 100 },
    );
  });

  it('a no-match correction preserves the meal totals exactly (Req 5.6)', async () => {
    await fc.assert(
      fc.asyncProperty(mealArb, lookupCorrectionSpecArb, async (meal, spec) => {
        const totalsBefore = JSON.stringify(meal.totals);
        const op = toOp(spec, meal);

        const result = await applyCorrectionToMeal(meal, op, noMatchResolver);

        expect(result.ok).toBe(false);
        // Totals are identical to the pre-correction totals and to a fresh
        // recomputation over the (unchanged) item set.
        expect(JSON.stringify(meal.totals)).toBe(totalsBefore);
        expect(meal.totals).toEqual(recomputeTotals(meal.items));
      }),
      { numRuns: 100 },
    );
  });
});
