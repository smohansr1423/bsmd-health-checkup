/**
 * Test Result Recording Form — Lab Technician UI
 *
 * Provides type definitions, validation logic, and state management for
 * recording test results with plausible range validation, out-of-range
 * confirmation dialog, and age-adjusted reference range display.
 *
 * Requirements: 5.1, 5.2, 5.3, 5.6, 5.7
 */

import type { AgeGroup, RiskCategory } from '@health-checkup/shared';

// ─── Types ───────────────────────────────────────────────────────────────────

/** Configuration for a test's plausible range (system-maintained) */
export interface PlausibleRange {
  min: number;
  max: number;
}

/** Age-adjusted reference range displayed alongside the measured value (Req 5.6) */
export interface AgeAdjustedReferenceRange {
  min: number;
  max: number;
  borderlineLow: number;
  borderlineHigh: number;
  criticalLow: number;
  criticalHigh: number;
  ageGroup: AgeGroup;
}

/** A single test definition within the assigned checkup package */
export interface PackageTestDefinition {
  testType: string;
  displayName: string;
  unit: string;
  plausibleRange: PlausibleRange;
  referenceRange?: AgeAdjustedReferenceRange;
}

/** Form field values for a test result entry */
export interface TestResultFormValues {
  checkupSessionId: string;
  testType: string;
  measuredValue: string; // string for form input; parsed to number on submit
  unit: string;
  collectionTimestamp: string; // ISO string
  technicianId: string;
  confirmOutOfRange: boolean;
}

/** Validation result for plausible range check */
export interface PlausibleRangeValidation {
  isWithinRange: boolean;
  plausibleMin: number;
  plausibleMax: number;
  measuredValue: number;
  requiresConfirmation: boolean;
}

/** Out-of-range confirmation dialog state */
export interface OutOfRangeConfirmation {
  visible: boolean;
  testType: string;
  measuredValue: number;
  plausibleMin: number;
  plausibleMax: number;
}

/** Save operation error with preserved form data (Req 5.7) */
export interface SaveError {
  message: string;
  failureReason: string;
  preservedFormData: TestResultFormValues;
  canRetry: boolean;
}

/** Overall form state for the test result recording UI */
export interface TestResultFormState {
  /** Current form values */
  values: TestResultFormValues;
  /** Validation errors keyed by field name */
  errors: Record<string, string>;
  /** Whether the form is currently submitting */
  isSubmitting: boolean;
  /** Out-of-range confirmation dialog state */
  outOfRangeConfirmation: OutOfRangeConfirmation | null;
  /** Save error state with preserved data for retry (Req 5.7) */
  saveError: SaveError | null;
  /** The age-adjusted reference range for the selected test (Req 5.6) */
  referenceRange: AgeAdjustedReferenceRange | null;
  /** Available tests from the assigned package */
  availableTests: PackageTestDefinition[];
  /** Whether initial data is loading */
  isLoading: boolean;
}

// ─── Initial State ───────────────────────────────────────────────────────────

export const INITIAL_FORM_VALUES: TestResultFormValues = {
  checkupSessionId: '',
  testType: '',
  measuredValue: '',
  unit: '',
  collectionTimestamp: '',
  technicianId: '',
  confirmOutOfRange: false,
};

export const INITIAL_FORM_STATE: TestResultFormState = {
  values: { ...INITIAL_FORM_VALUES },
  errors: {},
  isSubmitting: false,
  outOfRangeConfirmation: null,
  saveError: null,
  referenceRange: null,
  availableTests: [],
  isLoading: false,
};

// ─── Validation Logic ────────────────────────────────────────────────────────

/**
 * Validate that a measured value is within the plausible range for a test type.
 *
 * Requirement 5.2: Validate plausible range before saving.
 * Requirement 5.3: If outside range, require explicit confirmation.
 */
export function validatePlausibleRange(
  measuredValue: number,
  plausibleRange: PlausibleRange
): PlausibleRangeValidation {
  const isWithinRange =
    measuredValue >= plausibleRange.min && measuredValue <= plausibleRange.max;

  return {
    isWithinRange,
    plausibleMin: plausibleRange.min,
    plausibleMax: plausibleRange.max,
    measuredValue,
    requiresConfirmation: !isWithinRange,
  };
}

/**
 * Validate all form fields before submission.
 * Returns a record of field-level errors (empty if all valid).
 */
export function validateFormFields(
  values: TestResultFormValues,
  availableTests: PackageTestDefinition[]
): Record<string, string> {
  const errors: Record<string, string> = {};

  if (!values.checkupSessionId.trim()) {
    errors.checkupSessionId = 'Checkup session is required';
  }

  if (!values.testType.trim()) {
    errors.testType = 'Test type is required';
  } else {
    const testExists = availableTests.some((t) => t.testType === values.testType);
    if (!testExists) {
      errors.testType = 'Selected test is not part of the assigned package';
    }
  }

  if (!values.measuredValue.trim()) {
    errors.measuredValue = 'Measured value is required';
  } else {
    const numericValue = parseFloat(values.measuredValue);
    if (isNaN(numericValue)) {
      errors.measuredValue = 'Measured value must be a valid number';
    }
  }

  if (!values.unit.trim()) {
    errors.unit = 'Unit is required';
  }

  if (!values.collectionTimestamp.trim()) {
    errors.collectionTimestamp = 'Collection timestamp is required';
  } else {
    const date = new Date(values.collectionTimestamp);
    if (isNaN(date.getTime())) {
      errors.collectionTimestamp = 'Invalid date format';
    }
  }

  if (!values.technicianId.trim()) {
    errors.technicianId = 'Technician ID is required';
  }

  return errors;
}

// ─── State Management Helpers ────────────────────────────────────────────────

/**
 * Determine the risk indicator class based on measured value vs reference range.
 * Used for visual warning when out-of-range (Req 5.3).
 */
export function getRangeStatus(
  measuredValue: number,
  referenceRange: AgeAdjustedReferenceRange | null
): 'normal' | 'borderline' | 'critical' | 'unknown' {
  if (!referenceRange) return 'unknown';

  if (measuredValue <= referenceRange.criticalLow || measuredValue >= referenceRange.criticalHigh) {
    return 'critical';
  }
  if (measuredValue <= referenceRange.borderlineLow || measuredValue >= referenceRange.borderlineHigh) {
    return 'borderline';
  }
  if (measuredValue >= referenceRange.min && measuredValue <= referenceRange.max) {
    return 'normal';
  }
  return 'borderline';
}

/**
 * Build the out-of-range confirmation dialog state from a validation result.
 */
export function buildOutOfRangeConfirmation(
  testType: string,
  validation: PlausibleRangeValidation
): OutOfRangeConfirmation {
  return {
    visible: true,
    testType,
    measuredValue: validation.measuredValue,
    plausibleMin: validation.plausibleMin,
    plausibleMax: validation.plausibleMax,
  };
}

/**
 * Build a SaveError from a failed save attempt, preserving form data for retry (Req 5.7).
 */
export function buildSaveError(
  failureReason: string,
  preservedFormData: TestResultFormValues
): SaveError {
  return {
    message: `Save operation failed: ${failureReason}. Your data has been preserved — you can retry without re-entering values.`,
    failureReason,
    preservedFormData,
    canRetry: true,
  };
}

/**
 * Get the reference range for a selected test from the available tests list (Req 5.6).
 */
export function getTestReferenceRange(
  testType: string,
  availableTests: PackageTestDefinition[]
): AgeAdjustedReferenceRange | null {
  const test = availableTests.find((t) => t.testType === testType);
  return test?.referenceRange ?? null;
}

/**
 * Prepare a form submission payload from form values.
 * Converts string values to appropriate types.
 */
export function prepareSubmissionPayload(values: TestResultFormValues): {
  checkupSessionId: string;
  testType: string;
  measuredValue: number;
  unit: string;
  collectionTimestamp: Date;
  technicianId: string;
  confirmOutOfRange: boolean;
} {
  return {
    checkupSessionId: values.checkupSessionId,
    testType: values.testType,
    measuredValue: parseFloat(values.measuredValue),
    unit: values.unit,
    collectionTimestamp: new Date(values.collectionTimestamp),
    technicianId: values.technicianId,
    confirmOutOfRange: values.confirmOutOfRange,
  };
}

// ─── ARIA / Accessibility Helpers ────────────────────────────────────────────

/**
 * Generate ARIA attributes for the out-of-range warning indicator (Req 5.3).
 */
export function getOutOfRangeWarningAriaProps(
  testType: string,
  measuredValue: number,
  plausibleMin: number,
  plausibleMax: number
): Record<string, string> {
  return {
    role: 'alert',
    'aria-live': 'assertive',
    'aria-label': `Warning: Value ${measuredValue} for ${testType} is outside the plausible range of ${plausibleMin} to ${plausibleMax}. Confirmation required.`,
  };
}

/**
 * Generate ARIA attributes for the reference range display (Req 5.6).
 */
export function getReferenceRangeAriaProps(
  testType: string,
  range: AgeAdjustedReferenceRange
): Record<string, string> {
  return {
    'aria-label': `Reference range for ${testType} (age group ${range.ageGroup}): normal ${range.min} to ${range.max}, borderline ${range.borderlineLow} to ${range.borderlineHigh}`,
    role: 'note',
  };
}
