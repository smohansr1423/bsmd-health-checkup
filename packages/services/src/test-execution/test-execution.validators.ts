/**
 * Test Execution Validators
 * Validation logic for test result recording.
 * Validates: Requirements 5.1, 5.2, 5.3
 */

import type { TestResultRequest, PlausibleRangeResult } from './test-execution.types';

export interface ValidationResult {
  valid: boolean;
  message?: string;
}

/**
 * Validates that all required fields are present on a test result request.
 */
export function validateTestResultRequest(request: TestResultRequest): ValidationResult {
  if (!request.checkupSessionId || request.checkupSessionId.trim().length === 0) {
    return { valid: false, message: 'Checkup session ID is required.' };
  }

  if (!request.testType || request.testType.trim().length === 0) {
    return { valid: false, message: 'Test type is required.' };
  }

  if (request.measuredValue === undefined || request.measuredValue === null) {
    return { valid: false, message: 'Measured value is required.' };
  }

  if (typeof request.measuredValue !== 'number' || isNaN(request.measuredValue)) {
    return { valid: false, message: 'Measured value must be a valid number.' };
  }

  if (!request.unit || request.unit.trim().length === 0) {
    return { valid: false, message: 'Unit is required.' };
  }

  if (!request.collectionTimestamp) {
    return { valid: false, message: 'Collection timestamp is required.' };
  }

  if (!request.technicianId || request.technicianId.trim().length === 0) {
    return { valid: false, message: 'Technician ID is required.' };
  }

  return { valid: true };
}

/**
 * Validates whether a measured value falls within the plausible range for a test type.
 *
 * Requirement 5.2: Validate that each recorded Test_Result falls within the configured plausible range.
 * Requirement 5.3: If outside plausible range, require explicit confirmation.
 */
export function validatePlausibleRange(
  testType: string,
  value: number,
  plausibleMin: number,
  plausibleMax: number
): PlausibleRangeResult {
  const isWithinRange = value >= plausibleMin && value <= plausibleMax;

  return {
    isWithinRange,
    plausibleMin,
    plausibleMax,
    measuredValue: value,
    requiresConfirmation: !isWithinRange,
  };
}
