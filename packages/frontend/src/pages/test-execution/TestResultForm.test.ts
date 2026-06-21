/**
 * Unit tests for TestResultForm validation logic and state helpers.
 *
 * Requirements: 5.1, 5.2, 5.3, 5.6, 5.7
 */

import { AgeGroup } from '@health-checkup/shared';
import {
  validatePlausibleRange,
  validateFormFields,
  getRangeStatus,
  buildOutOfRangeConfirmation,
  buildSaveError,
  getTestReferenceRange,
  prepareSubmissionPayload,
  getOutOfRangeWarningAriaProps,
  getReferenceRangeAriaProps,
  INITIAL_FORM_VALUES,
  INITIAL_FORM_STATE,
  type PackageTestDefinition,
  type AgeAdjustedReferenceRange,
  type TestResultFormValues,
} from './TestResultForm';

// ─── Test Data ───────────────────────────────────────────────────────────────

const sampleReferenceRange: AgeAdjustedReferenceRange = {
  min: 70,
  max: 100,
  borderlineLow: 60,
  borderlineHigh: 110,
  criticalLow: 40,
  criticalHigh: 130,
  ageGroup: AgeGroup.SixtyToSixtyNine,
};

const sampleTests: PackageTestDefinition[] = [
  {
    testType: 'blood_sugar',
    displayName: 'Blood Sugar',
    unit: 'mg/dL',
    plausibleRange: { min: 20, max: 500 },
    referenceRange: sampleReferenceRange,
  },
  {
    testType: 'lipid_profile',
    displayName: 'Lipid Profile',
    unit: 'mg/dL',
    plausibleRange: { min: 50, max: 400 },
    referenceRange: undefined,
  },
];

const validFormValues: TestResultFormValues = {
  checkupSessionId: 'session-123',
  testType: 'blood_sugar',
  measuredValue: '85',
  unit: 'mg/dL',
  collectionTimestamp: '2024-01-15T10:30:00Z',
  technicianId: 'tech-001',
  confirmOutOfRange: false,
};

// ─── Tests: validatePlausibleRange ───────────────────────────────────────────

describe('validatePlausibleRange', () => {
  it('should return isWithinRange=true when value is within range', () => {
    const result = validatePlausibleRange(85, { min: 20, max: 500 });
    expect(result.isWithinRange).toBe(true);
    expect(result.requiresConfirmation).toBe(false);
  });

  it('should return isWithinRange=true at minimum boundary', () => {
    const result = validatePlausibleRange(20, { min: 20, max: 500 });
    expect(result.isWithinRange).toBe(true);
    expect(result.requiresConfirmation).toBe(false);
  });

  it('should return isWithinRange=true at maximum boundary', () => {
    const result = validatePlausibleRange(500, { min: 20, max: 500 });
    expect(result.isWithinRange).toBe(true);
    expect(result.requiresConfirmation).toBe(false);
  });

  it('should return isWithinRange=false and requiresConfirmation=true when below range', () => {
    const result = validatePlausibleRange(10, { min: 20, max: 500 });
    expect(result.isWithinRange).toBe(false);
    expect(result.requiresConfirmation).toBe(true);
    expect(result.plausibleMin).toBe(20);
    expect(result.plausibleMax).toBe(500);
    expect(result.measuredValue).toBe(10);
  });

  it('should return isWithinRange=false and requiresConfirmation=true when above range', () => {
    const result = validatePlausibleRange(600, { min: 20, max: 500 });
    expect(result.isWithinRange).toBe(false);
    expect(result.requiresConfirmation).toBe(true);
  });
});

// ─── Tests: validateFormFields ───────────────────────────────────────────────

describe('validateFormFields', () => {
  it('should return no errors for valid form values', () => {
    const errors = validateFormFields(validFormValues, sampleTests);
    expect(errors).toEqual({});
  });

  it('should return error when checkupSessionId is empty', () => {
    const errors = validateFormFields(
      { ...validFormValues, checkupSessionId: '' },
      sampleTests
    );
    expect(errors.checkupSessionId).toBeDefined();
  });

  it('should return error when testType is empty', () => {
    const errors = validateFormFields(
      { ...validFormValues, testType: '' },
      sampleTests
    );
    expect(errors.testType).toBeDefined();
  });

  it('should return error when testType is not in available tests', () => {
    const errors = validateFormFields(
      { ...validFormValues, testType: 'nonexistent_test' },
      sampleTests
    );
    expect(errors.testType).toBe('Selected test is not part of the assigned package');
  });

  it('should return error when measuredValue is empty', () => {
    const errors = validateFormFields(
      { ...validFormValues, measuredValue: '' },
      sampleTests
    );
    expect(errors.measuredValue).toBeDefined();
  });

  it('should return error when measuredValue is not a number', () => {
    const errors = validateFormFields(
      { ...validFormValues, measuredValue: 'abc' },
      sampleTests
    );
    expect(errors.measuredValue).toBe('Measured value must be a valid number');
  });

  it('should return error when unit is empty', () => {
    const errors = validateFormFields(
      { ...validFormValues, unit: '' },
      sampleTests
    );
    expect(errors.unit).toBeDefined();
  });

  it('should return error when collectionTimestamp is invalid', () => {
    const errors = validateFormFields(
      { ...validFormValues, collectionTimestamp: 'not-a-date' },
      sampleTests
    );
    expect(errors.collectionTimestamp).toBe('Invalid date format');
  });

  it('should return error when technicianId is empty', () => {
    const errors = validateFormFields(
      { ...validFormValues, technicianId: '' },
      sampleTests
    );
    expect(errors.technicianId).toBeDefined();
  });
});

// ─── Tests: getRangeStatus ───────────────────────────────────────────────────

describe('getRangeStatus', () => {
  it('should return "normal" when value is within normal range', () => {
    expect(getRangeStatus(85, sampleReferenceRange)).toBe('normal');
  });

  it('should return "borderline" when value is between normal and critical', () => {
    expect(getRangeStatus(55, sampleReferenceRange)).toBe('borderline');
    expect(getRangeStatus(115, sampleReferenceRange)).toBe('borderline');
  });

  it('should return "critical" when value is at or beyond critical thresholds', () => {
    expect(getRangeStatus(40, sampleReferenceRange)).toBe('critical');
    expect(getRangeStatus(130, sampleReferenceRange)).toBe('critical');
    expect(getRangeStatus(30, sampleReferenceRange)).toBe('critical');
    expect(getRangeStatus(150, sampleReferenceRange)).toBe('critical');
  });

  it('should return "unknown" when referenceRange is null', () => {
    expect(getRangeStatus(85, null)).toBe('unknown');
  });
});

// ─── Tests: buildOutOfRangeConfirmation ──────────────────────────────────────

describe('buildOutOfRangeConfirmation', () => {
  it('should build confirmation with visible=true', () => {
    const validation = validatePlausibleRange(600, { min: 20, max: 500 });
    const confirmation = buildOutOfRangeConfirmation('blood_sugar', validation);

    expect(confirmation.visible).toBe(true);
    expect(confirmation.testType).toBe('blood_sugar');
    expect(confirmation.measuredValue).toBe(600);
    expect(confirmation.plausibleMin).toBe(20);
    expect(confirmation.plausibleMax).toBe(500);
  });
});

// ─── Tests: buildSaveError (Req 5.7) ────────────────────────────────────────

describe('buildSaveError', () => {
  it('should preserve form data and mark as retryable', () => {
    const error = buildSaveError('Network timeout', validFormValues);

    expect(error.failureReason).toBe('Network timeout');
    expect(error.preservedFormData).toEqual(validFormValues);
    expect(error.canRetry).toBe(true);
    expect(error.message).toContain('Network timeout');
    expect(error.message).toContain('preserved');
  });
});

// ─── Tests: getTestReferenceRange ────────────────────────────────────────────

describe('getTestReferenceRange', () => {
  it('should return reference range for a test with one defined', () => {
    const range = getTestReferenceRange('blood_sugar', sampleTests);
    expect(range).toEqual(sampleReferenceRange);
  });

  it('should return null for a test without reference range', () => {
    const range = getTestReferenceRange('lipid_profile', sampleTests);
    expect(range).toBeNull();
  });

  it('should return null for a nonexistent test', () => {
    const range = getTestReferenceRange('nonexistent', sampleTests);
    expect(range).toBeNull();
  });
});

// ─── Tests: prepareSubmissionPayload ─────────────────────────────────────────

describe('prepareSubmissionPayload', () => {
  it('should convert string values to proper types', () => {
    const payload = prepareSubmissionPayload(validFormValues);

    expect(payload.checkupSessionId).toBe('session-123');
    expect(payload.testType).toBe('blood_sugar');
    expect(payload.measuredValue).toBe(85);
    expect(typeof payload.measuredValue).toBe('number');
    expect(payload.collectionTimestamp).toBeInstanceOf(Date);
    expect(payload.technicianId).toBe('tech-001');
    expect(payload.confirmOutOfRange).toBe(false);
  });
});

// ─── Tests: ARIA helpers ─────────────────────────────────────────────────────

describe('getOutOfRangeWarningAriaProps', () => {
  it('should return role=alert with descriptive label', () => {
    const props = getOutOfRangeWarningAriaProps('blood_sugar', 600, 20, 500);

    expect(props.role).toBe('alert');
    expect(props['aria-live']).toBe('assertive');
    expect(props['aria-label']).toContain('600');
    expect(props['aria-label']).toContain('blood_sugar');
    expect(props['aria-label']).toContain('20');
    expect(props['aria-label']).toContain('500');
  });
});

describe('getReferenceRangeAriaProps', () => {
  it('should return descriptive aria-label for the reference range', () => {
    const props = getReferenceRangeAriaProps('blood_sugar', sampleReferenceRange);

    expect(props.role).toBe('note');
    expect(props['aria-label']).toContain('blood_sugar');
    expect(props['aria-label']).toContain(AgeGroup.SixtyToSixtyNine);
  });
});

// ─── Tests: Initial State ────────────────────────────────────────────────────

describe('Initial state constants', () => {
  it('should have empty initial form values', () => {
    expect(INITIAL_FORM_VALUES.checkupSessionId).toBe('');
    expect(INITIAL_FORM_VALUES.measuredValue).toBe('');
    expect(INITIAL_FORM_VALUES.confirmOutOfRange).toBe(false);
  });

  it('should have clean initial form state', () => {
    expect(INITIAL_FORM_STATE.isSubmitting).toBe(false);
    expect(INITIAL_FORM_STATE.outOfRangeConfirmation).toBeNull();
    expect(INITIAL_FORM_STATE.saveError).toBeNull();
    expect(INITIAL_FORM_STATE.errors).toEqual({});
  });
});
