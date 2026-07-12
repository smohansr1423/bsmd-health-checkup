/**
 * Food domain types — language-neutral core model (design: Data Models).
 *
 * TypeScript is the source of truth; Python (cc_contracts) and Go (contracts)
 * mirror these definitions.
 */

/** Axis-aligned bounding box in normalized [0,1] image coordinates. */
export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A recognized food item (Req 2.1/2.2). */
export interface FoodItem {
  id: string;
  /** One of ≥2000 categories. */
  label: string;
  /** 0..100 (Req 2.2). */
  confidence: number;
  bbox?: BoundingBox;
}

/** Reference object used to scale a portion estimate (Req 3.3/3.4). */
export type ReferenceObject = 'plate' | 'hand' | 'utensil';

/** A portion/volume estimate for a detected food region (Req 3). */
export interface PortionEstimate {
  /** ≥ 0. */
  volumeMl: number;
  /** ±15% single-angle / ±8% multi-angle (Req 3.1/3.2). */
  errorPct: number;
  /** false → accuracy reduced but estimate still returned (Req 3.4). */
  scaled: boolean;
  referenceObject?: ReferenceObject;
}

/** Unit of a nutrient value. */
export type NutrientUnit = 'kcal' | 'g' | 'mg';

/** A single nutrient value with its confidence range (Req 4.5/4.6). */
export interface NutrientValue {
  /** ≥ 0. */
  value: number;
  unit: NutrientUnit;
  /** lower ≤ value ≤ upper (Req 4.5). */
  lower: number;
  upper: number;
  /** false → "unavailable" (Req 4.6). */
  available: boolean;
}

/** Origin of a logged meal. */
export type MealSource =
  | 'photo'
  | 'barcode'
  | 'voice'
  | 'menuOCR'
  | 'textSearch'
  | 'manual';

/** Local-first sync lifecycle of a meal record (Req 17/27). */
export type SyncStatus = 'local' | 'pending' | 'synced' | 'conflict';

/** A single item within a meal. */
export interface MealItem {
  foodItem: FoodItem;
  /** 0.25..3.0 step 0.25 (Req 5.1). */
  portionMultiplier: number;
  nutrition: Record<string, NutrientValue>;
}

/** Aggregated nutrition for a meal (Req 4.1/4.2/4.3/4.4). */
export interface NutritionTotals {
  /** Primary macros (Req 4.1). */
  calories: NutrientValue;
  protein: NutrientValue;
  carbs: NutrientValue;
  fat: NutrientValue;
  /** fiber, sugar, sodium, satFat, cholesterol (Req 4.2). */
  secondary: Record<string, NutrientValue>;
  /** Optional micronutrient overlay (Req 4.3/4.4). */
  micronutrients?: Record<string, NutrientValue>;
}

/** A logged meal (Req 5 — totals recomputed on every correction). */
export interface Meal {
  id: string;
  userId: string;
  /** ISO timestamp (local + offset). */
  loggedAt: string;
  /** 0..20 items. */
  items: MealItem[];
  totals: NutritionTotals;
  source: MealSource;
  syncStatus: SyncStatus;
}

/** Persisted personal plate calibration (Req 3.6/3.7). */
export interface PlateCalibration {
  userId: string;
  referenceScale: number;
  updatedAt: string;
}

/** A correction operation applied to a meal (Req 5). */
export type CorrectionOp =
  | { kind: 'setPortion'; itemId: string; multiplier: number }
  | { kind: 'swap'; itemId: string; query: string }
  | { kind: 'add'; query: string }
  | { kind: 'addByBarcode'; barcode: string }
  | { kind: 'delete'; itemId: string };

/** Record of an applied correction and its training-queue status (Req 5.5/5.8). */
export interface Correction {
  mealId: string;
  op: CorrectionOp;
  trainingQueued: boolean;
}
