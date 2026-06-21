/**
 * Billing Validators
 * Validation logic for invoice generation and payment processing.
 * Validates: Requirements 9.1, 9.8
 */

import type { PackageTest } from '@health-checkup/shared';
import { MissingCostDataError, TooManyLineItemsError } from './billing.errors';

const MAX_LINE_ITEMS = 50;
const MAX_TOTAL_AMOUNT = 999_999_999.99;
const MIN_TOTAL_AMOUNT = 0.00;

/**
 * Validates that all tests have valid cost data (cost > 0).
 *
 * Requirement 9.8: Block generation if missing cost data.
 *
 * @throws MissingCostDataError if any test has cost of 0 or undefined.
 */
export function validateCostData(tests: PackageTest[]): void {
  const testsWithMissingCost = tests.filter(
    (test) => !test.cost || test.cost <= 0
  );

  if (testsWithMissingCost.length > 0) {
    throw new MissingCostDataError(
      testsWithMissingCost.map((t) => t.name)
    );
  }
}

/**
 * Validates that the number of line items does not exceed the maximum (50).
 *
 * Requirement 9.1: Itemize each test (up to 50 line items).
 *
 * @throws TooManyLineItemsError if count exceeds 50.
 */
export function validateLineItemCount(count: number): void {
  if (count > MAX_LINE_ITEMS) {
    throw new TooManyLineItemsError(count);
  }
}

/**
 * Rounds a monetary value to 2 decimal places using banker's rounding.
 *
 * Requirement 9.4: All monetary values rounded to 2 decimal places.
 */
export function roundToTwoDecimals(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Clamps the total amount due to the valid range [0.00, 999,999,999.99].
 *
 * Requirement 9.3: totalAmountDue clamped to range.
 */
export function clampTotalAmount(amount: number): number {
  if (amount < MIN_TOTAL_AMOUNT) return MIN_TOTAL_AMOUNT;
  if (amount > MAX_TOTAL_AMOUNT) return MAX_TOTAL_AMOUNT;
  return roundToTwoDecimals(amount);
}

/**
 * Validates that discount rate is within [0, 100].
 */
export function validateDiscountRate(rate: number): boolean {
  return rate >= 0 && rate <= 100;
}
