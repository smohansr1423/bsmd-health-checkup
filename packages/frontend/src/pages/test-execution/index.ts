/**
 * Test Execution UI — Barrel Export
 *
 * Lab Technician interface for recording test results with plausible range
 * validation, out-of-range confirmation, age-adjusted reference ranges,
 * and the amendment workflow.
 *
 * Requirements: 5.1, 5.2, 5.3, 5.6, 5.7, 5.8
 */

// ─── Test Result Form ────────────────────────────────────────────────────────
export {
  type PlausibleRange,
  type AgeAdjustedReferenceRange,
  type PackageTestDefinition,
  type TestResultFormValues,
  type PlausibleRangeValidation,
  type OutOfRangeConfirmation,
  type SaveError,
  type TestResultFormState,
  INITIAL_FORM_VALUES,
  INITIAL_FORM_STATE,
  validatePlausibleRange,
  validateFormFields,
  getRangeStatus,
  buildOutOfRangeConfirmation,
  buildSaveError,
  getTestReferenceRange,
  prepareSubmissionPayload,
  getOutOfRangeWarningAriaProps,
  getReferenceRangeAriaProps,
} from './TestResultForm';

// ─── Amendment Workflow ──────────────────────────────────────────────────────
export {
  type AmendmentEntry,
  type ExistingTestResult,
  type AmendmentFormValues,
  type AmendmentConfirmation,
  type AmendmentSaveError,
  type AmendmentWorkflowState,
  INITIAL_AMENDMENT_VALUES,
  INITIAL_AMENDMENT_STATE,
  validateAmendmentFields,
  buildAmendmentConfirmation,
  buildAmendmentSaveError,
  prepareAmendmentPayload,
  formatAmendmentEntry,
  getAmendmentCount,
  getLatestAmendment,
  getAmendmentConfirmationAriaProps,
  getAmendmentHistoryAriaProps,
} from './AmendmentWorkflow';
