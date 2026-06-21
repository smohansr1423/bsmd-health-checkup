/**
 * Amendment Workflow — Lab Technician UI
 *
 * Provides type definitions and logic for the test result amendment flow.
 * Shows original value alongside updated value with timestamps, requires
 * confirmation before saving the amendment.
 *
 * Requirements: 5.8
 */

import type { AgeGroup } from '@health-checkup/shared';
import type { AgeAdjustedReferenceRange } from './TestResultForm';

// ─── Types ───────────────────────────────────────────────────────────────────

/** A single amendment entry in the result history */
export interface AmendmentEntry {
  previousValue: number;
  newValue: number;
  amendedBy: string;
  amendedAt: Date;
  reason?: string;
}

/** The existing test result displayed when an amendment is initiated */
export interface ExistingTestResult {
  id: string;
  testType: string;
  displayName: string;
  measuredValue: number;
  unit: string;
  collectionTimestamp: Date;
  technicianId: string;
  referenceRange?: AgeAdjustedReferenceRange;
  amendmentHistory: AmendmentEntry[];
}

/** Form values for the amendment entry */
export interface AmendmentFormValues {
  newValue: string; // string for form input; parsed to number on submit
  unit: string;
  reason: string;
  technicianId: string;
}

/** Confirmation dialog state for amendment (Req 5.8) */
export interface AmendmentConfirmation {
  visible: boolean;
  existingResult: ExistingTestResult;
  proposedValue: number;
  proposedUnit: string;
  reason: string;
}

/** Save error specific to amendment workflow */
export interface AmendmentSaveError {
  message: string;
  failureReason: string;
  preservedFormData: AmendmentFormValues;
  canRetry: boolean;
}

/** Overall state for the amendment workflow */
export interface AmendmentWorkflowState {
  /** The existing result being amended */
  existingResult: ExistingTestResult | null;
  /** Amendment form values */
  values: AmendmentFormValues;
  /** Field-level validation errors */
  errors: Record<string, string>;
  /** Whether submission is in progress */
  isSubmitting: boolean;
  /** Confirmation dialog state */
  confirmation: AmendmentConfirmation | null;
  /** Save error with preserved data for retry */
  saveError: AmendmentSaveError | null;
  /** Whether the workflow is loading the existing result */
  isLoading: boolean;
}

// ─── Initial State ───────────────────────────────────────────────────────────

export const INITIAL_AMENDMENT_VALUES: AmendmentFormValues = {
  newValue: '',
  unit: '',
  reason: '',
  technicianId: '',
};

export const INITIAL_AMENDMENT_STATE: AmendmentWorkflowState = {
  existingResult: null,
  values: { ...INITIAL_AMENDMENT_VALUES },
  errors: {},
  isSubmitting: false,
  confirmation: null,
  saveError: null,
  isLoading: false,
};

// ─── Validation Logic ────────────────────────────────────────────────────────

/**
 * Validate amendment form fields.
 * Returns a record of field-level errors (empty if all valid).
 */
export function validateAmendmentFields(
  values: AmendmentFormValues,
  existingResult: ExistingTestResult | null
): Record<string, string> {
  const errors: Record<string, string> = {};

  if (!values.newValue.trim()) {
    errors.newValue = 'New value is required';
  } else {
    const numericValue = parseFloat(values.newValue);
    if (isNaN(numericValue)) {
      errors.newValue = 'New value must be a valid number';
    } else if (existingResult && numericValue === existingResult.measuredValue) {
      errors.newValue = 'New value must be different from the current value';
    }
  }

  if (!values.unit.trim()) {
    errors.unit = 'Unit is required';
  }

  if (!values.technicianId.trim()) {
    errors.technicianId = 'Technician ID is required';
  }

  // Reason is recommended but not strictly required
  // (keeping it optional per the service layer contract)

  return errors;
}

// ─── State Management Helpers ────────────────────────────────────────────────

/**
 * Build confirmation dialog state from the existing result and proposed values.
 * Requirement 5.8: Present existing result and require confirmation.
 */
export function buildAmendmentConfirmation(
  existingResult: ExistingTestResult,
  proposedValue: number,
  proposedUnit: string,
  reason: string
): AmendmentConfirmation {
  return {
    visible: true,
    existingResult,
    proposedValue,
    proposedUnit,
    reason,
  };
}

/**
 * Build a save error from a failed amendment attempt, preserving form data for retry.
 */
export function buildAmendmentSaveError(
  failureReason: string,
  preservedFormData: AmendmentFormValues
): AmendmentSaveError {
  return {
    message: `Amendment save failed: ${failureReason}. Your data has been preserved — you can retry.`,
    failureReason,
    preservedFormData,
    canRetry: true,
  };
}

/**
 * Prepare the amendment submission payload from form values.
 */
export function prepareAmendmentPayload(
  testResultId: string,
  values: AmendmentFormValues
): {
  testResultId: string;
  newValue: { value: number; unit: string; reason?: string };
  technicianId: string;
} {
  return {
    testResultId,
    newValue: {
      value: parseFloat(values.newValue),
      unit: values.unit,
      reason: values.reason.trim() || undefined,
    },
    technicianId: values.technicianId,
  };
}

/**
 * Format an amendment entry for display in the amendment history list.
 */
export function formatAmendmentEntry(entry: AmendmentEntry): {
  previousValue: string;
  newValue: string;
  amendedBy: string;
  amendedAt: string;
  reason: string;
} {
  return {
    previousValue: String(entry.previousValue),
    newValue: String(entry.newValue),
    amendedBy: entry.amendedBy,
    amendedAt: entry.amendedAt instanceof Date
      ? entry.amendedAt.toISOString()
      : String(entry.amendedAt),
    reason: entry.reason ?? '',
  };
}

/**
 * Get the total number of amendments made to a test result.
 */
export function getAmendmentCount(existingResult: ExistingTestResult | null): number {
  return existingResult?.amendmentHistory.length ?? 0;
}

/**
 * Get the most recent amendment from the history, or null if none exist.
 */
export function getLatestAmendment(
  existingResult: ExistingTestResult | null
): AmendmentEntry | null {
  if (!existingResult || existingResult.amendmentHistory.length === 0) {
    return null;
  }
  return existingResult.amendmentHistory[existingResult.amendmentHistory.length - 1];
}

// ─── ARIA / Accessibility Helpers ────────────────────────────────────────────

/**
 * Generate ARIA attributes for the amendment confirmation dialog.
 */
export function getAmendmentConfirmationAriaProps(
  existingResult: ExistingTestResult,
  proposedValue: number
): Record<string, string> {
  return {
    role: 'alertdialog',
    'aria-modal': 'true',
    'aria-labelledby': 'amendment-confirmation-title',
    'aria-describedby': 'amendment-confirmation-description',
    'aria-label': `Confirm amendment: change ${existingResult.displayName} from ${existingResult.measuredValue} to ${proposedValue} ${existingResult.unit}`,
  };
}

/**
 * Generate ARIA attributes for the amendment history section.
 */
export function getAmendmentHistoryAriaProps(
  testType: string,
  amendmentCount: number
): Record<string, string> {
  return {
    'aria-label': `Amendment history for ${testType}: ${amendmentCount} amendment${amendmentCount !== 1 ? 's' : ''} recorded`,
    role: 'list',
  };
}
