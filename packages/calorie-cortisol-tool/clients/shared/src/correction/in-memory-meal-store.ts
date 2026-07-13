/**
 * In-memory reference {@link MealStore} for meal correction (Task 14.7).
 *
 * Stands in for the on-device Data Vault behind the same store-agnostic
 * interface, so the {@link MealCorrector} logic is validated once and reused
 * across all three clients. Stores defensive copies so external mutation of a
 * returned meal can't corrupt persisted state.
 *
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.6, 5.7
 */

import type { Meal } from '@calorie-cortisol/shared';

import type { MealStore } from './types';

/** A simple `Map`-backed {@link MealStore}. */
export class InMemoryMealStore implements MealStore {
  private readonly meals = new Map<string, Meal>();

  constructor(initial: readonly Meal[] = []) {
    for (const meal of initial) {
      this.saveMeal(meal);
    }
  }

  getMeal(mealId: string): Meal | undefined {
    const meal = this.meals.get(mealId);
    return meal ? clone(meal) : undefined;
  }

  saveMeal(meal: Meal): void {
    this.meals.set(meal.id, clone(meal));
  }

  /** Number of meals currently stored (test/helper affordance). */
  get size(): number {
    return this.meals.size;
  }
}

/** Structured deep copy, falling back to JSON when unavailable. */
function clone<T>(value: T): T {
  const structured = (
    globalThis as { structuredClone?: <U>(input: U) => U }
  ).structuredClone;
  return structured
    ? structured(value)
    : (JSON.parse(JSON.stringify(value)) as T);
}
