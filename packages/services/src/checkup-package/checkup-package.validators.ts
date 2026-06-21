/**
 * Checkup Package Validators
 * Validation logic for package configuration constraints.
 * Validates: Requirements 2.2, 2.6
 */

import type { PackageTest } from '@health-checkup/shared';

const MIN_TEST_COUNT = 1;
const MAX_TEST_COUNT = 50;

export interface PackageValidationResult {
  valid: boolean;
  message?: string;
}

/**
 * Validates that a custom package test count is within the valid range (1-50).
 * Requirement 2.2: Package must contain between 1 and 50 tests.
 */
export function validateTestCount(testCount: number): PackageValidationResult {
  if (testCount < MIN_TEST_COUNT) {
    return {
      valid: false,
      message: `Custom package must contain at least ${MIN_TEST_COUNT} test, but received ${testCount}.`,
    };
  }
  if (testCount > MAX_TEST_COUNT) {
    return {
      valid: false,
      message: `Custom package must contain no more than ${MAX_TEST_COUNT} tests, but received ${testCount}.`,
    };
  }
  return { valid: true };
}

/**
 * Validates that the discount rate is within the valid range (0-100).
 */
export function validateDiscountRate(discountRate: number): PackageValidationResult {
  if (discountRate < 0 || discountRate > 100) {
    return {
      valid: false,
      message: `Discount rate must be between 0 and 100, but received ${discountRate}.`,
    };
  }
  return { valid: true };
}

/**
 * Validates that each test in the package has a positive cost.
 */
export function validateTestCosts(tests: PackageTest[]): PackageValidationResult {
  for (const test of tests) {
    if (test.cost < 0) {
      return {
        valid: false,
        message: `Test "${test.name}" has an invalid negative cost: ${test.cost}.`,
      };
    }
  }
  return { valid: true };
}

/**
 * Calculate total cost as sum of individual test costs.
 * Requirement 2.6: Total cost = sum of individual test costs.
 */
export function calculateTotalCost(tests: PackageTest[]): number {
  return tests.reduce((sum, test) => sum + test.cost, 0);
}
