import { err, ok, type Result } from '@calorie-cortisol/shared/result';
import type {
  Meal,
  MealItem,
  NutrientUnit,
  NutrientValue,
} from '@calorie-cortisol/shared';

import {
  applyCorrectionToMeal,
  CorrectionErrorCode,
  InMemoryMealStore,
  isValidPortionMultiplier,
  MealCorrector,
  recomputeTotals,
  type FoodItemResolver,
  type ResolvedFoodItem,
} from './index';

/**
 * Unit tests for meal correction and totals recomputation (Task 14.7).
 *
 * Covers portion multiplier bounds/step (Req 5.1), swap (Req 5.2), add by
 * text/barcode (Req 5.3), delete (Req 5.4), no-match leaving the meal unchanged
 * (Req 5.6), and delete-last-item → zero totals (Req 5.7).
 */

// --- Fixtures --------------------------------------------------------------

function nv(
  value: number,
  unit: NutrientUnit = 'g',
  available = true,
): NutrientValue {
  return { value, unit, lower: value * 0.9, upper: value * 1.1, available };
}

function makeItem(
  id: string,
  overrides: Partial<MealItem> = {},
): MealItem {
  return {
    foodItem: { id, label: id, confidence: 90 },
    portionMultiplier: 1,
    nutrition: {
      calories: nv(200, 'kcal'),
      protein: nv(10, 'g'),
      carbs: nv(20, 'g'),
      fat: nv(5, 'g'),
      fiber: nv(3, 'g'),
      sodium: nv(150, 'mg'),
    },
    ...overrides,
  };
}

function makeMeal(items: MealItem[]): Meal {
  return {
    id: 'meal-1',
    userId: 'user-1',
    loggedAt: '2024-01-01T12:00:00.000Z',
    items,
    totals: recomputeTotals(items),
    source: 'photo',
    syncStatus: 'local',
  };
}

/** Resolver that returns a fixed item for text and barcode lookups. */
class MatchingResolver implements FoodItemResolver {
  constructor(private readonly resolved: ResolvedFoodItem) {}

  resolveByText(): Promise<Result<ResolvedFoodItem | null>> {
    return Promise.resolve(ok(this.resolved));
  }

  resolveByBarcode(): Promise<Result<ResolvedFoodItem | null>> {
    return Promise.resolve(ok(this.resolved));
  }
}

/** Resolver that never matches (clean no-match). */
class NoMatchResolver implements FoodItemResolver {
  resolveByText(): Promise<Result<ResolvedFoodItem | null>> {
    return Promise.resolve(ok(null));
  }

  resolveByBarcode(): Promise<Result<ResolvedFoodItem | null>> {
    return Promise.resolve(ok(null));
  }
}

/** Resolver whose backend fails (distinct from a clean no-match). */
class FailingResolver implements FoodItemResolver {
  private failure(): Result<ResolvedFoodItem | null> {
    return err({
      code: 'lookup/backend-unavailable',
      message: 'search backend unavailable',
      retryable: true,
      retainedState: true,
    });
  }

  resolveByText(): Promise<Result<ResolvedFoodItem | null>> {
    return Promise.resolve(this.failure());
  }

  resolveByBarcode(): Promise<Result<ResolvedFoodItem | null>> {
    return Promise.resolve(this.failure());
  }
}

const bananaResolved: ResolvedFoodItem = {
  foodItem: { id: 'banana', label: 'banana', confidence: 88 },
  nutrition: {
    calories: nv(105, 'kcal'),
    protein: nv(1.3, 'g'),
    carbs: nv(27, 'g'),
    fat: nv(0.4, 'g'),
  },
};

const noMatchResolver = new NoMatchResolver();

// --- Portion multiplier validation (Req 5.1) -------------------------------

describe('isValidPortionMultiplier (Req 5.1)', () => {
  it('accepts every 0.25 step from 0.25× to 3×', () => {
    for (let m = 0.25; m <= 3.0000001; m += 0.25) {
      expect(isValidPortionMultiplier(Number(m.toFixed(2)))).toBe(true);
    }
  });

  it('rejects values below 0.25× or above 3×', () => {
    expect(isValidPortionMultiplier(0)).toBe(false);
    expect(isValidPortionMultiplier(0.1)).toBe(false);
    expect(isValidPortionMultiplier(3.25)).toBe(false);
    expect(isValidPortionMultiplier(4)).toBe(false);
  });

  it('rejects off-step values and non-finite numbers', () => {
    expect(isValidPortionMultiplier(0.3)).toBe(false);
    expect(isValidPortionMultiplier(1.1)).toBe(false);
    expect(isValidPortionMultiplier(Number.NaN)).toBe(false);
    expect(isValidPortionMultiplier(Number.POSITIVE_INFINITY)).toBe(false);
  });
});

// --- recomputeTotals (design Property 13) ----------------------------------

describe('recomputeTotals', () => {
  it('sums each nutrient across items into the totals structure', () => {
    const meal = makeMeal([makeItem('a'), makeItem('b')]);
    const totals = recomputeTotals(meal.items);

    expect(totals.calories.value).toBeCloseTo(400);
    expect(totals.calories.unit).toBe('kcal');
    expect(totals.protein.value).toBeCloseTo(20);
    expect(totals.secondary.fiber.value).toBeCloseTo(6);
    expect(totals.secondary.sodium.value).toBeCloseTo(300);
    expect(totals.secondary.sodium.unit).toBe('mg');
  });

  it('yields zero totals for a meal with no items (Req 5.7)', () => {
    const totals = recomputeTotals([]);
    expect(totals.calories.value).toBe(0);
    expect(totals.protein.value).toBe(0);
    expect(totals.carbs.value).toBe(0);
    expect(totals.fat.value).toBe(0);
    expect(totals.calories.available).toBe(false);
    expect(totals.secondary).toEqual({});
    expect(totals.micronutrients).toBeUndefined();
  });

  it('excludes unavailable contributions from the summed value', () => {
    const item = makeItem('a', {
      nutrition: {
        calories: nv(200, 'kcal'),
        protein: nv(10, 'g', false),
      },
    });
    const totals = recomputeTotals([item]);
    expect(totals.calories.value).toBeCloseTo(200);
    expect(totals.protein.value).toBe(0);
    expect(totals.protein.available).toBe(false);
  });
});

// --- setPortion (Req 5.1) --------------------------------------------------

describe('setPortion correction (Req 5.1)', () => {
  it('rescales the item nutrition and recomputes totals', async () => {
    const meal = makeMeal([makeItem('a')]);
    const result = await applyCorrectionToMeal(
      meal,
      { kind: 'setPortion', itemId: 'a', multiplier: 2 },
      noMatchResolver,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const item = result.value.meal.items[0];
    expect(item.portionMultiplier).toBe(2);
    expect(item.nutrition.calories.value).toBeCloseTo(400);
    expect(result.value.totals.calories.value).toBeCloseTo(400);
  });

  it('scales relative to the current multiplier (1.5× from 2× → down)', async () => {
    const meal = makeMeal([makeItem('a', { portionMultiplier: 2 })]);
    const result = await applyCorrectionToMeal(
      meal,
      { kind: 'setPortion', itemId: 'a', multiplier: 1 },
      noMatchResolver,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 200 kcal at 2× → 100 kcal at 1×.
    expect(result.value.meal.items[0].nutrition.calories.value).toBeCloseTo(100);
  });

  it('rejects an out-of-range multiplier and leaves the meal unchanged', async () => {
    const meal = makeMeal([makeItem('a')]);
    const result = await applyCorrectionToMeal(
      meal,
      { kind: 'setPortion', itemId: 'a', multiplier: 5 },
      noMatchResolver,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe(CorrectionErrorCode.InvalidMultiplier);
    expect(result.error.retainedState).toBe(true);
  });

  it('errors when the target item is absent', async () => {
    const meal = makeMeal([makeItem('a')]);
    const result = await applyCorrectionToMeal(
      meal,
      { kind: 'setPortion', itemId: 'missing', multiplier: 1 },
      noMatchResolver,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe(CorrectionErrorCode.ItemNotFound);
  });
});

// --- swap (Req 5.2) --------------------------------------------------------

describe('swap correction (Req 5.2)', () => {
  it('replaces the item and recomputes totals', async () => {
    const meal = makeMeal([makeItem('a'), makeItem('b')]);
    const result = await applyCorrectionToMeal(
      meal,
      { kind: 'swap', itemId: 'a', query: 'banana' },
      new MatchingResolver(bananaResolved),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.meal.items[0].foodItem.id).toBe('banana');
    // 105 (banana) + 200 (item b) = 305 kcal.
    expect(result.value.totals.calories.value).toBeCloseTo(305);
  });

  it('leaves the meal unchanged on a no-match (Req 5.6)', async () => {
    const meal = makeMeal([makeItem('a')]);
    const result = await applyCorrectionToMeal(
      meal,
      { kind: 'swap', itemId: 'a', query: 'nothing' },
      noMatchResolver,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe(CorrectionErrorCode.NoMatch);
    expect(result.error.retainedState).toBe(true);
  });

  it('surfaces a backend lookup failure distinctly from a no-match', async () => {
    const meal = makeMeal([makeItem('a')]);
    const result = await applyCorrectionToMeal(
      meal,
      { kind: 'swap', itemId: 'a', query: 'banana' },
      new FailingResolver(),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe(CorrectionErrorCode.LookupFailed);
    expect(result.error.retryable).toBe(true);
  });
});

// --- add / addByBarcode (Req 5.3) ------------------------------------------

describe('add corrections (Req 5.3)', () => {
  it('appends a text-searched item and recomputes totals', async () => {
    const meal = makeMeal([makeItem('a')]);
    const result = await applyCorrectionToMeal(
      meal,
      { kind: 'add', query: 'banana' },
      new MatchingResolver(bananaResolved),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.meal.items).toHaveLength(2);
    expect(result.value.totals.calories.value).toBeCloseTo(305);
  });

  it('appends a barcode-scanned item and recomputes totals', async () => {
    const meal = makeMeal([makeItem('a')]);
    const result = await applyCorrectionToMeal(
      meal,
      { kind: 'addByBarcode', barcode: '0123456789' },
      new MatchingResolver(bananaResolved),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.meal.items).toHaveLength(2);
    expect(result.value.meal.items[1].foodItem.id).toBe('banana');
  });

  it('leaves the meal unchanged when the barcode has no match (Req 5.6)', async () => {
    const meal = makeMeal([makeItem('a')]);
    const result = await applyCorrectionToMeal(
      meal,
      { kind: 'addByBarcode', barcode: '9999999999' },
      noMatchResolver,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe(CorrectionErrorCode.NoMatch);
  });
});

// --- delete (Req 5.4, 5.7) -------------------------------------------------

describe('delete correction (Req 5.4, 5.7)', () => {
  it('removes an item and recomputes totals', async () => {
    const meal = makeMeal([makeItem('a'), makeItem('b')]);
    const result = await applyCorrectionToMeal(
      meal,
      { kind: 'delete', itemId: 'a' },
      noMatchResolver,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.meal.items).toHaveLength(1);
    expect(result.value.totals.calories.value).toBeCloseTo(200);
  });

  it('sets totals to zero when the last item is deleted (Req 5.7)', async () => {
    const meal = makeMeal([makeItem('a')]);
    const result = await applyCorrectionToMeal(
      meal,
      { kind: 'delete', itemId: 'a' },
      noMatchResolver,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.meal.items).toHaveLength(0);
    expect(result.value.totals.calories.value).toBe(0);
    expect(result.value.totals.protein.value).toBe(0);
    expect(result.value.totals.carbs.value).toBe(0);
    expect(result.value.totals.fat.value).toBe(0);
    expect(result.value.totals.secondary).toEqual({});
  });

  it('errors when deleting an absent item', async () => {
    const meal = makeMeal([makeItem('a')]);
    const result = await applyCorrectionToMeal(
      meal,
      { kind: 'delete', itemId: 'missing' },
      noMatchResolver,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe(CorrectionErrorCode.ItemNotFound);
  });
});

// --- immutability ----------------------------------------------------------

describe('purity', () => {
  it('never mutates the input meal', async () => {
    const meal = makeMeal([makeItem('a')]);
    const snapshot = JSON.stringify(meal);
    await applyCorrectionToMeal(
      meal,
      { kind: 'setPortion', itemId: 'a', multiplier: 2 },
      noMatchResolver,
    );
    expect(JSON.stringify(meal)).toBe(snapshot);
  });
});

// --- MealCorrector: applyCorrection(mealId, op) ----------------------------

describe('MealCorrector.applyCorrection(mealId, op)', () => {
  it('persists the corrected meal on success', async () => {
    const meal = makeMeal([makeItem('a')]);
    const store = new InMemoryMealStore([meal]);
    const corrector = new MealCorrector({
      store,
      resolver: new MatchingResolver(bananaResolved),
    });

    const result = await corrector.applyCorrection('meal-1', {
      kind: 'add',
      query: 'banana',
    });

    expect(result.ok).toBe(true);
    const stored = store.getMeal('meal-1');
    expect(stored?.items).toHaveLength(2);
    expect(stored?.totals.calories.value).toBeCloseTo(305);
  });

  it('does not write to the store on a no-match (Req 5.6)', async () => {
    const meal = makeMeal([makeItem('a')]);
    const store = new InMemoryMealStore([meal]);
    const corrector = new MealCorrector({ store, resolver: noMatchResolver });

    const result = await corrector.applyCorrection('meal-1', {
      kind: 'add',
      query: 'nothing',
    });

    expect(result.ok).toBe(false);
    // Stored meal is byte-for-byte unchanged.
    expect(JSON.stringify(store.getMeal('meal-1'))).toBe(JSON.stringify(meal));
  });

  it('errors when the meal id is unknown', async () => {
    const store = new InMemoryMealStore();
    const corrector = new MealCorrector({ store, resolver: noMatchResolver });

    const result = await corrector.applyCorrection('missing', {
      kind: 'delete',
      itemId: 'a',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe(CorrectionErrorCode.MealNotFound);
  });
});
