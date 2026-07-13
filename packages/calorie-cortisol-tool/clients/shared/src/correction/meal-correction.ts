/**
 * Meal correction and totals recomputation — pure logic + store-backed
 * corrector (Task 14.7).
 *
 * The core transformation is pure and deterministic: given a {@link Meal} and a
 * {@link CorrectionOp} it produces the corrected meal with totals recomputed as
 * the exact sum of the current items' nutrition (design Property 13). Swap and
 * add operations consult the injectable {@link FoodItemResolver}; a clean
 * no-match leaves the meal untouched (Req 5.6), and deleting the last item
 * yields zero totals (Req 5.7).
 *
 *   setPortion (0.25×–3× step 0.25)  → rescale item nutrition, recompute totals (Req 5.1)
 *   swap (text)                      → replace item, recompute totals          (Req 5.2)
 *   add (text) / addByBarcode        → append item, recompute totals           (Req 5.3)
 *   delete                           → remove item, recompute totals; last item → zero (Req 5.4, 5.7)
 *
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.6, 5.7
 */

import type {
  CorrectionOp,
  Meal,
  MealItem,
  NutrientUnit,
  NutrientValue,
  NutritionTotals,
} from '@calorie-cortisol/shared';
import {
  err,
  ok,
  validationRejection,
  type ErrorContract,
  type Result,
} from '@calorie-cortisol/shared/result';

import {
  CorrectionErrorCode,
  MAX_PORTION_MULTIPLIER,
  MIN_PORTION_MULTIPLIER,
  PORTION_MULTIPLIER_STEP,
  PRIMARY_NUTRIENT_KEYS,
  SECONDARY_NUTRIENT_KEYS,
  type FoodItemResolver,
  type MealCorrectionResult,
  type MealStore,
  type ResolvedFoodItem,
} from './types';

// ---------------------------------------------------------------------------
// Totals recomputation (design Property 13)
// ---------------------------------------------------------------------------

/** Default unit for each well-known nutrient key. */
const DEFAULT_NUTRIENT_UNITS: Record<string, NutrientUnit> = {
  calories: 'kcal',
  protein: 'g',
  carbs: 'g',
  fat: 'g',
  fiber: 'g',
  sugar: 'g',
  sodium: 'mg',
  satFat: 'g',
  cholesterol: 'mg',
};

const PRIMARY_KEY_SET: ReadonlySet<string> = new Set(PRIMARY_NUTRIENT_KEYS);
const SECONDARY_KEY_SET: ReadonlySet<string> = new Set(SECONDARY_NUTRIENT_KEYS);

/** A zeroed, unavailable nutrient value in the given unit. */
function zeroNutrient(unit: NutrientUnit): NutrientValue {
  return { value: 0, unit, lower: 0, upper: 0, available: false };
}

/** Mutable accumulator mirroring {@link NutrientValue}. */
interface NutrientAccumulator {
  value: number;
  lower: number;
  upper: number;
  unit: NutrientUnit;
  available: boolean;
}

/**
 * Sum every nutrient key found across the meal's items. Unavailable
 * contributions add nothing but never make an otherwise-available total
 * unavailable; a key is available in the total iff at least one item reported
 * it available.
 */
function sumItemNutrition(
  items: readonly MealItem[],
): Map<string, NutrientAccumulator> {
  const acc = new Map<string, NutrientAccumulator>();
  for (const item of items) {
    for (const [key, nutrient] of Object.entries(item.nutrition)) {
      const cur =
        acc.get(key) ??
        ({
          value: 0,
          lower: 0,
          upper: 0,
          unit: nutrient.unit ?? DEFAULT_NUTRIENT_UNITS[key] ?? 'g',
          available: false,
        } satisfies NutrientAccumulator);
      if (nutrient.available) {
        cur.value += nutrient.value;
        cur.lower += nutrient.lower;
        cur.upper += nutrient.upper;
        cur.available = true;
      }
      acc.set(key, cur);
    }
  }
  return acc;
}

function toNutrientValue(
  acc: NutrientAccumulator | undefined,
  fallbackUnit: NutrientUnit,
): NutrientValue {
  if (acc === undefined) {
    return zeroNutrient(fallbackUnit);
  }
  return {
    value: acc.value,
    unit: acc.unit,
    lower: acc.lower,
    upper: acc.upper,
    available: acc.available,
  };
}

/**
 * Recompute a meal's {@link NutritionTotals} as the exact sum of the current
 * items' nutrition. A meal with no items yields zeroed primary macros and
 * empty secondary/micronutrient groups — i.e. zero totals (Req 5.7,
 * design Property 13).
 */
export function recomputeTotals(items: readonly MealItem[]): NutritionTotals {
  const acc = sumItemNutrition(items);

  const secondary: Record<string, NutrientValue> = {};
  const micronutrients: Record<string, NutrientValue> = {};

  for (const [key, value] of acc) {
    if (PRIMARY_KEY_SET.has(key)) {
      continue; // handled explicitly below
    }
    const nutrient = toNutrientValue(value, value.unit);
    if (SECONDARY_KEY_SET.has(key)) {
      secondary[key] = nutrient;
    } else {
      micronutrients[key] = nutrient;
    }
  }

  const totals: NutritionTotals = {
    calories: toNutrientValue(acc.get('calories'), 'kcal'),
    protein: toNutrientValue(acc.get('protein'), 'g'),
    carbs: toNutrientValue(acc.get('carbs'), 'g'),
    fat: toNutrientValue(acc.get('fat'), 'g'),
    secondary,
  };
  if (Object.keys(micronutrients).length > 0) {
    totals.micronutrients = micronutrients;
  }
  return totals;
}

// ---------------------------------------------------------------------------
// Portion-multiplier validation & scaling (Req 5.1)
// ---------------------------------------------------------------------------

/**
 * Whether `multiplier` is an allowed portion multiplier: within
 * [0.25, 3] and an exact multiple of 0.25 (Req 5.1). Uses a small tolerance so
 * ordinary floating-point slider values (e.g. 0.75) are accepted.
 */
export function isValidPortionMultiplier(multiplier: number): boolean {
  if (!Number.isFinite(multiplier)) {
    return false;
  }
  if (
    multiplier < MIN_PORTION_MULTIPLIER - 1e-9 ||
    multiplier > MAX_PORTION_MULTIPLIER + 1e-9
  ) {
    return false;
  }
  const steps = multiplier / PORTION_MULTIPLIER_STEP;
  return Math.abs(steps - Math.round(steps)) < 1e-9;
}

/** Scale a single nutrient value proportionally, preserving unit/availability. */
function scaleNutrient(nutrient: NutrientValue, factor: number): NutrientValue {
  return {
    ...nutrient,
    value: nutrient.value * factor,
    lower: nutrient.lower * factor,
    upper: nutrient.upper * factor,
  };
}

/** Scale every nutrient in an item's nutrition map by `factor`. */
function scaleItemNutrition(
  nutrition: Record<string, NutrientValue>,
  factor: number,
): Record<string, NutrientValue> {
  const scaled: Record<string, NutrientValue> = {};
  for (const [key, nutrient] of Object.entries(nutrition)) {
    scaled[key] = scaleNutrient(nutrient, factor);
  }
  return scaled;
}

// ---------------------------------------------------------------------------
// Pure correction application
// ---------------------------------------------------------------------------

/** Build the success result for a changed meal, recomputing totals. */
function corrected(meal: Meal, op: CorrectionOp): MealCorrectionResult {
  const totals = recomputeTotals(meal.items);
  const next: Meal = { ...meal, totals };
  return { meal: next, totals, op, changed: true };
}

/** Turn a resolved lookup item into a {@link MealItem}. */
function toMealItem(resolved: ResolvedFoodItem): MealItem {
  return {
    foodItem: resolved.foodItem,
    portionMultiplier: resolved.portionMultiplier ?? 1,
    nutrition: { ...resolved.nutrition },
  };
}

/**
 * Apply a correction to a meal, purely. Swap/add operations consult the
 * provided {@link FoodItemResolver}. Returns the corrected meal (with recomputed
 * totals) on success, or a structured error that leaves the meal unchanged on
 * rejection/no-match (Req 5.6). Never mutates the input meal.
 */
export async function applyCorrectionToMeal(
  meal: Meal,
  op: CorrectionOp,
  resolver: FoodItemResolver,
): Promise<Result<MealCorrectionResult>> {
  switch (op.kind) {
    case 'setPortion': {
      if (!isValidPortionMultiplier(op.multiplier)) {
        return err(
          validationRejection(
            CorrectionErrorCode.InvalidMultiplier,
            `Portion multiplier ${op.multiplier} must be between ${MIN_PORTION_MULTIPLIER}× and ${MAX_PORTION_MULTIPLIER}× in ${PORTION_MULTIPLIER_STEP}× steps.`,
          ),
        );
      }
      const index = meal.items.findIndex((i) => i.foodItem.id === op.itemId);
      if (index === -1) {
        return err(itemNotFound(op.itemId));
      }
      const current = meal.items[index];
      const factor =
        current.portionMultiplier === 0
          ? 0
          : op.multiplier / current.portionMultiplier;
      const updatedItem: MealItem = {
        ...current,
        portionMultiplier: op.multiplier,
        nutrition: scaleItemNutrition(current.nutrition, factor),
      };
      const items = replaceAt(meal.items, index, updatedItem);
      return ok(corrected({ ...meal, items }, op));
    }

    case 'swap': {
      const index = meal.items.findIndex((i) => i.foodItem.id === op.itemId);
      if (index === -1) {
        return err(itemNotFound(op.itemId));
      }
      const lookup = await resolver.resolveByText(op.query);
      return resolveThen(lookup, (resolved) => {
        const items = replaceAt(meal.items, index, toMealItem(resolved));
        return ok(corrected({ ...meal, items }, op));
      });
    }

    case 'add': {
      const lookup = await resolver.resolveByText(op.query);
      return resolveThen(lookup, (resolved) => {
        const items = [...meal.items, toMealItem(resolved)];
        return ok(corrected({ ...meal, items }, op));
      });
    }

    case 'addByBarcode': {
      const lookup = await resolver.resolveByBarcode(op.barcode);
      return resolveThen(lookup, (resolved) => {
        const items = [...meal.items, toMealItem(resolved)];
        return ok(corrected({ ...meal, items }, op));
      });
    }

    case 'delete': {
      const index = meal.items.findIndex((i) => i.foodItem.id === op.itemId);
      if (index === -1) {
        return err(itemNotFound(op.itemId));
      }
      const items = meal.items.filter((_, i) => i !== index);
      // When the last item is removed, recomputeTotals yields zero totals (Req 5.7).
      return ok(corrected({ ...meal, items }, op));
    }

    default: {
      const _never: never = op;
      return _never;
    }
  }
}

/** Immutable array replace-at helper. */
function replaceAt<T>(items: readonly T[], index: number, value: T): T[] {
  const next = items.slice();
  next[index] = value;
  return next;
}

function itemNotFound(itemId: string): ErrorContract {
  return validationRejection(
    CorrectionErrorCode.ItemNotFound,
    `No item with id "${itemId}" exists in the meal.`,
  );
}

/**
 * Bridge a resolver {@link Result} to a correction outcome: propagate a backend
 * failure, surface a clean `null` as a no-match that leaves the meal unchanged
 * (Req 5.6), and otherwise apply `onResolved`.
 */
function resolveThen(
  lookup: Result<ResolvedFoodItem | null>,
  onResolved: (resolved: ResolvedFoodItem) => Result<MealCorrectionResult>,
): Result<MealCorrectionResult> {
  if (!lookup.ok) {
    return err({
      code: CorrectionErrorCode.LookupFailed,
      message: lookup.error.message,
      retryable: lookup.error.retryable,
      retainedState: true,
    });
  }
  if (lookup.value === null) {
    return err(
      validationRejection(
        CorrectionErrorCode.NoMatch,
        'No matching food item was found; the meal was left unchanged.',
      ),
    );
  }
  return onResolved(lookup.value);
}

// ---------------------------------------------------------------------------
// Store-backed corrector: applyCorrection(mealId, op)
// ---------------------------------------------------------------------------

/** Collaborators the {@link MealCorrector} composes. */
export interface MealCorrectorDeps {
  /** Loads/saves the meal being corrected (Data Vault in production). */
  store: MealStore;
  /** Resolves text/barcode lookups for swap/add corrections. */
  resolver: FoodItemResolver;
}

/**
 * Applies corrections to a stored meal by id, recomputing and persisting the
 * meal's totals on success (Req 5.1–5.4, 5.7). No-match and rejected
 * corrections leave the stored meal unchanged (Req 5.6).
 */
export class MealCorrector {
  constructor(private readonly deps: MealCorrectorDeps) {}

  /**
   * Apply `op` to the meal identified by `mealId`.
   *
   * Loads the meal, applies the correction purely, and — only when the meal
   * actually changed — persists it before returning the recomputed totals. A
   * missing meal, invalid multiplier, unknown item, backend lookup failure, or
   * no-match returns a structured error and never writes to the store.
   */
  async applyCorrection(
    mealId: string,
    op: CorrectionOp,
  ): Promise<Result<MealCorrectionResult>> {
    const meal = this.deps.store.getMeal(mealId);
    if (meal === undefined) {
      return err(
        validationRejection(
          CorrectionErrorCode.MealNotFound,
          `No meal with id "${mealId}" exists.`,
        ),
      );
    }

    const outcome = await applyCorrectionToMeal(meal, op, this.deps.resolver);
    if (outcome.ok) {
      this.deps.store.saveMeal(outcome.value.meal);
    }
    return outcome;
  }
}
