/**
 * Lightweight validation / guard helpers for the core domain types.
 *
 * These enforce the field-level constraints from the design's Data Models
 * section. They are pure, dependency-free, and shared across services so the
 * same rule is never re-implemented divergently. Business logic (scoring,
 * correlation, consent gating, etc.) lives in later tasks — these guards only
 * check structural/field-level validity.
 */

import {
  ALIGNMENT_WINDOW_MINUTES,
  CONFIDENCE_MAX,
  CONFIDENCE_MIN,
  MAX_FAMILY_MEMBERS,
  MAX_MEAL_ITEMS,
  PORTION_MULTIPLIER_MAX,
  PORTION_MULTIPLIER_MIN,
  PORTION_MULTIPLIER_STEP,
  QUESTIONNAIRE_ITEM_COUNT,
  QUESTIONNAIRE_SCORE_RANGE,
  READING_VALUE_MAX,
  READING_VALUE_MIN,
  SIGNIFICANCE_MIN_ABS_COEFFICIENT,
  SIGNIFICANCE_MAX_P_VALUE,
  SIGNIFICANCE_MIN_PAIRS,
  STREAK_MAX,
  STREAK_MIN,
} from './constants';
import type {
  AlignedPair,
  CorrelationResult,
  FamilyAccount,
  FoodItem,
  Meal,
  MealItem,
  NutrientValue,
  PortionEstimate,
  QuestionnaireResult,
  QuestionnaireType,
} from './domain';

const isFiniteNumber = (n: unknown): n is number =>
  typeof n === 'number' && Number.isFinite(n);

/** Recognition confidence lies within the inclusive 0..100 range (Req 2.2). */
export function isValidConfidence(confidence: number): boolean {
  return (
    isFiniteNumber(confidence) &&
    confidence >= CONFIDENCE_MIN &&
    confidence <= CONFIDENCE_MAX
  );
}

/** A FoodItem has a non-empty label and an in-range confidence (Req 2.2). */
export function isValidFoodItem(item: FoodItem): boolean {
  return (
    typeof item.id === 'string' &&
    item.id.length > 0 &&
    typeof item.label === 'string' &&
    item.label.length > 0 &&
    isValidConfidence(item.confidence)
  );
}

/** Portion volume is a finite value ≥ 0 (Req 3). */
export function isValidPortionEstimate(estimate: PortionEstimate): boolean {
  return (
    isFiniteNumber(estimate.volumeMl) &&
    estimate.volumeMl >= 0 &&
    isFiniteNumber(estimate.errorPct) &&
    typeof estimate.scaled === 'boolean'
  );
}

/** A nutrient value satisfies lower ≤ value ≤ upper with value ≥ 0 (Req 4.5). */
export function isValidNutrientValue(nv: NutrientValue): boolean {
  return (
    isFiniteNumber(nv.value) &&
    isFiniteNumber(nv.lower) &&
    isFiniteNumber(nv.upper) &&
    nv.value >= 0 &&
    nv.lower <= nv.value &&
    nv.value <= nv.upper
  );
}

/**
 * A portion multiplier is within 0.25..3.0 and on a 0.25 step (Req 5.1).
 * The step check tolerates floating-point representation error.
 */
export function isValidPortionMultiplier(multiplier: number): boolean {
  if (!isFiniteNumber(multiplier)) return false;
  if (multiplier < PORTION_MULTIPLIER_MIN || multiplier > PORTION_MULTIPLIER_MAX) {
    return false;
  }
  const steps = multiplier / PORTION_MULTIPLIER_STEP;
  return Math.abs(steps - Math.round(steps)) < 1e-9;
}

/** A meal item has a valid food item and portion multiplier (Req 5.1). */
export function isValidMealItem(item: MealItem): boolean {
  return (
    isValidFoodItem(item.foodItem) &&
    isValidPortionMultiplier(item.portionMultiplier)
  );
}

/** A meal holds 0..20 valid items (Req 2.2 / Meal.items 0..20). */
export function isValidMeal(meal: Meal): boolean {
  return (
    Array.isArray(meal.items) &&
    meal.items.length <= MAX_MEAL_ITEMS &&
    meal.items.every(isValidMealItem)
  );
}

/** A wearable/patch reading value is within [0.01, 100] (Req 9.4). */
export function isValidReadingValue(value: number): boolean {
  return (
    isFiniteNumber(value) &&
    value >= READING_VALUE_MIN &&
    value <= READING_VALUE_MAX
  );
}

/** A consecutive-day logging streak is a whole number in [0, 3650] (Req 6.4/6.5). */
export function isValidStreak(streak: number): boolean {
  return (
    Number.isInteger(streak) && streak >= STREAK_MIN && streak <= STREAK_MAX
  );
}

/** A questionnaire submission has all required items answered (Req 10.2). */
export function isQuestionnaireComplete(
  type: QuestionnaireType,
  answers: number[],
): boolean {
  return (
    Array.isArray(answers) &&
    answers.length === QUESTIONNAIRE_ITEM_COUNT[type] &&
    answers.every((a) => isFiniteNumber(a))
  );
}

/** A questionnaire total score lies within the instrument's valid range (Req 10.1). */
export function isValidQuestionnaireScore(
  type: QuestionnaireType,
  totalScore: number,
): boolean {
  const range = QUESTIONNAIRE_SCORE_RANGE[type];
  return (
    isFiniteNumber(totalScore) &&
    totalScore >= range.min &&
    totalScore <= range.max
  );
}

/** A scored questionnaire result is complete and in-range (Req 10.1/10.2). */
export function isValidQuestionnaireResult(result: QuestionnaireResult): boolean {
  return (
    isQuestionnaireComplete(result.type, result.answers) &&
    isValidQuestionnaireScore(result.type, result.totalScore)
  );
}

/** An aligned pair falls within the ±180 min window (Req 15.1). */
export function isWithinAlignmentWindow(pair: AlignedPair): boolean {
  return (
    isFiniteNumber(pair.deltaMinutes) &&
    Math.abs(pair.deltaMinutes) <= ALIGNMENT_WINDOW_MINUTES
  );
}

/**
 * Whether a correlation result meets the significance gate: ≥20 aligned pairs
 * AND |r| ≥ 0.5 AND p < 0.05 (Req 15.3/15.4). This is the structural gate only;
 * the rolling-window analysis lives in the Insights service.
 */
export function meetsSignificanceGate(result: CorrelationResult): boolean {
  return (
    result.pairCount >= SIGNIFICANCE_MIN_PAIRS &&
    Math.abs(result.coefficient) >= SIGNIFICANCE_MIN_ABS_COEFFICIENT &&
    result.pValue < SIGNIFICANCE_MAX_P_VALUE
  );
}

/** A family account holds no more than 5 members (Req 19.1). */
export function isWithinFamilyCapacity(account: FamilyAccount): boolean {
  return (
    Array.isArray(account.members) &&
    account.members.length <= MAX_FAMILY_MEMBERS
  );
}

/** Whether a wall-clock time string is a valid 24h "HH:MM" in 00:00..23:59 (Req 16.5). */
export function isValidWakeTime(time: string): boolean {
  const match = /^([0-9]{2}):([0-9]{2})$/.exec(time);
  if (!match) return false;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59;
}
