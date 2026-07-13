/**
 * Meal correction and totals recomputation (Task 14.7).
 *
 * Public surface: the correction types/ports/error codes, the pure
 * `recomputeTotals` / `applyCorrectionToMeal` logic, the store-backed
 * {@link MealCorrector} implementing `applyCorrection(mealId, op)`, and the
 * reference in-memory meal store for testing.
 *
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.6, 5.7
 */
export * from './types';
export * from './meal-correction';
export * from './in-memory-meal-store';
