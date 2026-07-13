/**
 * Meal correction and totals recomputation — types, constants, and injectable
 * ports (Task 14.7).
 *
 * The Correction_UI lets a user quickly fix a recognized meal: adjust an
 * item's portion (0.25×–3× in 0.25 steps), swap a mis-identified ingredient,
 * add a missed item by text search or barcode, or delete a false positive.
 * After any successful correction the meal's nutritional totals are recomputed
 * from the current item set; a no-match lookup leaves the meal untouched, and
 * deleting the last remaining item yields zero totals.
 *
 * This module owns only the pure meal/totals transformation and the seams it
 * depends on. Resolving a text query or barcode to a food item + its nutrition
 * crosses the network boundary (Nutrition Lookup `GET /search` / `GET /barcode`)
 * and is expressed as the injectable {@link FoodItemResolver} port, so the
 * correction logic runs identically on iOS, Android, and the PWA and is fully
 * testable with in-memory fakes. Recording the correction as a
 * Personalization_Model training input is a separate concern (Task 14.10) and
 * is intentionally not wired here.
 *
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.6, 5.7
 */

import type {
  CorrectionOp,
  FoodItem,
  Meal,
  NutrientValue,
  NutritionTotals,
} from '@calorie-cortisol/shared';
import type { Result } from '@calorie-cortisol/shared/result';

// Re-export the shared correction contract for convenience so consumers of the
// corrector can refer to it without a second import.
export type { CorrectionOp };

// ---------------------------------------------------------------------------
// Portion-multiplier constraints (Req 5.1)
// ---------------------------------------------------------------------------

/** Minimum portion multiplier the slider allows (Req 5.1). */
export const MIN_PORTION_MULTIPLIER = 0.25;

/** Maximum portion multiplier the slider allows (Req 5.1). */
export const MAX_PORTION_MULTIPLIER = 3;

/** Step size between adjacent portion multipliers (Req 5.1). */
export const PORTION_MULTIPLIER_STEP = 0.25;

/**
 * Recompute latency budget for a correction, in milliseconds (Req 5.1–5.4).
 * Enforced by integration/perf tests, not by this pure logic; exported as the
 * single source of truth for the "within 1 second" requirement.
 */
export const CORRECTION_RECOMPUTE_BUDGET_MS = 1000;

// ---------------------------------------------------------------------------
// Nutrient key taxonomy used when recomputing totals
// ---------------------------------------------------------------------------

/**
 * Primary macro keys, in display order (Req 4.1). These map to the dedicated
 * fields of {@link NutritionTotals}.
 */
export const PRIMARY_NUTRIENT_KEYS = [
  'calories',
  'protein',
  'carbs',
  'fat',
] as const;

/** Secondary-nutrient keys grouped under {@link NutritionTotals.secondary} (Req 4.2). */
export const SECONDARY_NUTRIENT_KEYS = [
  'fiber',
  'sugar',
  'sodium',
  'satFat',
  'cholesterol',
] as const;

export type PrimaryNutrientKey = (typeof PRIMARY_NUTRIENT_KEYS)[number];
export type SecondaryNutrientKey = (typeof SECONDARY_NUTRIENT_KEYS)[number];

// ---------------------------------------------------------------------------
// Error codes
// ---------------------------------------------------------------------------

/** Stable, machine-readable error codes surfaced by meal correction. */
export const CorrectionErrorCode = {
  /** The requested meal could not be found in the store. */
  MealNotFound: 'correction/meal-not-found',
  /** The target item id is not present in the meal (swap/delete/setPortion). */
  ItemNotFound: 'correction/item-not-found',
  /** The requested portion multiplier is outside 0.25×–3× or off-step (Req 5.1). */
  InvalidMultiplier: 'correction/invalid-multiplier',
  /** A text search or barcode scan returned no matching item (Req 5.6). */
  NoMatch: 'correction/no-match',
  /** The lookup backend itself failed (network/backend error, retryable). */
  LookupFailed: 'correction/lookup-failed',
} as const;

export type CorrectionErrorCode =
  (typeof CorrectionErrorCode)[keyof typeof CorrectionErrorCode];

// ---------------------------------------------------------------------------
// Food-item resolution port (client → gateway → Nutrition Lookup)
// ---------------------------------------------------------------------------

/**
 * A food item resolved from a text search or barcode scan, together with the
 * nutrition to attach to the resulting {@link Meal} item.
 *
 * `nutrition` is the effective, portion-applied nutrition for the item at
 * {@link portionMultiplier} (defaults to 1×), mirroring the shape of a
 * {@link Meal}'s `items[].nutrition`. The keys follow the same taxonomy used
 * when recomputing totals ({@link PRIMARY_NUTRIENT_KEYS},
 * {@link SECONDARY_NUTRIENT_KEYS}, then micronutrients).
 */
export interface ResolvedFoodItem {
  foodItem: FoodItem;
  nutrition: Record<string, NutrientValue>;
  /** Portion multiplier for the resolved item; defaults to 1× when omitted. */
  portionMultiplier?: number;
}

/**
 * Gateway-routed Nutrition Lookup seam used by swap/add corrections.
 *
 * Each method resolves the query/barcode to a {@link ResolvedFoodItem}, or a
 * successful `null` when nothing matched — the caller treats `null` as the
 * "no match found" outcome that leaves the meal unchanged (Req 5.6, 7.2, 7.8).
 * A failed {@link Result} signals a backend/network error distinct from a
 * clean no-match.
 */
export interface FoodItemResolver {
  /** Resolve a text search query (1–100 chars) to a food item (Req 5.3, 7.7). */
  resolveByText(query: string): Promise<Result<ResolvedFoodItem | null>>;
  /** Resolve a scanned product barcode to a food item (Req 5.3, 7.1). */
  resolveByBarcode(barcode: string): Promise<Result<ResolvedFoodItem | null>>;
}

// ---------------------------------------------------------------------------
// Meal store port
// ---------------------------------------------------------------------------

/**
 * Minimal persistence seam the {@link MealCorrector} uses to load and save a
 * meal by id. Backed by the on-device Data Vault in production; the reference
 * {@link InMemoryMealStore} stands in for tests. A correction is persisted
 * only when it actually changes the meal — no-match/rejected corrections leave
 * stored state untouched (Req 5.6).
 */
export interface MealStore {
  /** Return the meal with the given id, or `undefined` when absent. */
  getMeal(mealId: string): Meal | undefined;
  /** Persist the updated meal. */
  saveMeal(meal: Meal): void;
}

// ---------------------------------------------------------------------------
// Correction outcome
// ---------------------------------------------------------------------------

/**
 * The successful outcome of applying a correction: the updated meal, its freshly
 * recomputed totals (also available as `meal.totals`), and the op that produced
 * it. `changed` is always true for a returned success — a no-match or rejected
 * correction returns a failed {@link Result} instead, leaving the meal unchanged.
 */
export interface MealCorrectionResult {
  /** The meal after the correction, with recomputed totals (Req 5.1–5.4, 5.7). */
  readonly meal: Meal;
  /** The recomputed meal totals (identical to `meal.totals`). */
  readonly totals: NutritionTotals;
  /** The correction operation that was applied. */
  readonly op: CorrectionOp;
  /** Always true; present for symmetry and explicit call-site intent. */
  readonly changed: boolean;
}
