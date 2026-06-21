/**
 * Unit tests for AmendmentWorkflow validation logic and state helpers.
 *
 * Requirements: 5.8
 */

import { AgeGroup } from '@health-checkup/shared';
import {
  validateAmendmentFields,
  buildAmendmentConfirmation,
  buildAmendmentSaveError,
  prepareAmendmentPayload,
  formatAmendmentEntry,
  getAmendmentCount,
  getLatestAmendment,
  getAmendmentConfirmationAriaProps,
  getAmendmentHistoryAriaProps,
  INITIAL_AMENDMENT_VALUES,
  INITIAL_AMENDMENT_STATE,
  type ExistingTestResult,
  type AmendmentFormValues,
  type AmendmentEntry,
} from './AmendmentWorkflow';

// ─── Test Data ───────────────────────────────────────────────────────────────

const sampleExistingResult: ExistingTestResult = {
  id: 'result-001',
  testType: 'blood_sugar',
  displayName: 'Blood Sugar',
  measuredValue: 95,
  unit: 'mg/dL',
  collectionTimestamp: new Date('2024-01-15T10:30:00Z'),
  technicianId: 'tech-001',
  referenceRange: {
    min: 70,
    max: 100,
    borderlineLow: 60,
    borderlineHigh: 110,
    criticalLow: 40,
    criticalHigh: 130,
    ageGroup: AgeGroup.SixtyToSixtyNine,
  },
  amendmentHistory: [
    {
      previousValue: 90,
      newValue: 95,
      amendedBy: 'tech-002',
      amendedAt: new Date('2024-01-15T11:00:00Z'),
      reason: 'Recalibration correction',
    },
  ],
};

const validAmendmentValues: AmendmentFormValues = {
  newValue: '105',
  unit: 'mg/dL',
  reason: 'Corrected reading after instrument recalibration',
  technicianId: 'tech-003',
};

// ─── Tests: validateAmendmentFields ──────────────────────────────────────────

describe('validateAmendmentFields', () => {
  it('should return no errors for valid amendment values', () => {
    const errors = validateAmendmentFields(validAmendmentValues, sampleExistingResult);
    expect(errors).toEqual({});
  });

  it('should return error when newValue is empty', () => {
    const errors = validateAmendmentFields(
      { ...validAmendmentValues, newValue: '' },
      sampleExistingResult
    );
    expect(errors.newValue).toBeDefined();
  });

  it('should return error when newValue is not a number', () => {
    const errors = validateAmendmentFields(
      { ...validAmendmentValues, newValue: 'xyz' },
      sampleExistingResult
    );
    expect(errors.newValue).toBe('New value must be a valid number');
  });

  it('should return error when newValue equals existing measured value', () => {
    const errors = validateAmendmentFields(
      { ...validAmendmentValues, newValue: '95' },
      sampleExistingResult
    );
    expect(errors.newValue).toBe('New value must be different from the current value');
  });

  it('should return error when unit is empty', () => {
    const errors = validateAmendmentFields(
      { ...validAmendmentValues, unit: '' },
      sampleExistingResult
    );
    expect(errors.unit).toBeDefined();
  });

  it('should return error when technicianId is empty', () => {
    const errors = validateAmendmentFields(
      { ...validAmendmentValues, technicianId: '' },
      sampleExistingResult
    );
    expect(errors.technicianId).toBeDefined();
  });

  it('should not require reason (optional field)', () => {
    const errors = validateAmendmentFields(
      { ...validAmendmentValues, reason: '' },
      sampleExistingResult
    );
    expect(errors.reason).toBeUndefined();
  });

  it('should allow validation when existingResult is null (no same-value check)', () => {
    const errors = validateAmendmentFields(validAmendmentValues, null);
    expect(errors).toEqual({});
  });
});

// ─── Tests: buildAmendmentConfirmation ───────────────────────────────────────

describe('buildAmendmentConfirmation', () => {
  it('should build confirmation dialog state', () => {
    const confirmation = buildAmendmentConfirmation(
      sampleExistingResult,
      105,
      'mg/dL',
      'Recalibration'
    );

    expect(confirmation.visible).toBe(true);
    expect(confirmation.existingResult).toBe(sampleExistingResult);
    expect(confirmation.proposedValue).toBe(105);
    expect(confirmation.proposedUnit).toBe('mg/dL');
    expect(confirmation.reason).toBe('Recalibration');
  });
});

// ─── Tests: buildAmendmentSaveError ──────────────────────────────────────────

describe('buildAmendmentSaveError', () => {
  it('should preserve form data and mark as retryable', () => {
    const error = buildAmendmentSaveError('Database unavailable', validAmendmentValues);

    expect(error.failureReason).toBe('Database unavailable');
    expect(error.preservedFormData).toEqual(validAmendmentValues);
    expect(error.canRetry).toBe(true);
    expect(error.message).toContain('Database unavailable');
  });
});

// ─── Tests: prepareAmendmentPayload ──────────────────────────────────────────

describe('prepareAmendmentPayload', () => {
  it('should convert form values to submission payload', () => {
    const payload = prepareAmendmentPayload('result-001', validAmendmentValues);

    expect(payload.testResultId).toBe('result-001');
    expect(payload.newValue.value).toBe(105);
    expect(typeof payload.newValue.value).toBe('number');
    expect(payload.newValue.unit).toBe('mg/dL');
    expect(payload.newValue.reason).toBe('Corrected reading after instrument recalibration');
    expect(payload.technicianId).toBe('tech-003');
  });

  it('should set reason to undefined when reason is empty', () => {
    const payload = prepareAmendmentPayload('result-001', {
      ...validAmendmentValues,
      reason: '',
    });
    expect(payload.newValue.reason).toBeUndefined();
  });
});

// ─── Tests: formatAmendmentEntry ─────────────────────────────────────────────

describe('formatAmendmentEntry', () => {
  it('should format an amendment entry for display', () => {
    const entry: AmendmentEntry = {
      previousValue: 90,
      newValue: 95,
      amendedBy: 'tech-002',
      amendedAt: new Date('2024-01-15T11:00:00Z'),
      reason: 'Correction',
    };

    const formatted = formatAmendmentEntry(entry);

    expect(formatted.previousValue).toBe('90');
    expect(formatted.newValue).toBe('95');
    expect(formatted.amendedBy).toBe('tech-002');
    expect(formatted.amendedAt).toBe('2024-01-15T11:00:00.000Z');
    expect(formatted.reason).toBe('Correction');
  });

  it('should return empty string for missing reason', () => {
    const entry: AmendmentEntry = {
      previousValue: 90,
      newValue: 95,
      amendedBy: 'tech-002',
      amendedAt: new Date('2024-01-15T11:00:00Z'),
    };

    const formatted = formatAmendmentEntry(entry);
    expect(formatted.reason).toBe('');
  });
});

// ─── Tests: getAmendmentCount ────────────────────────────────────────────────

describe('getAmendmentCount', () => {
  it('should return the number of amendments', () => {
    expect(getAmendmentCount(sampleExistingResult)).toBe(1);
  });

  it('should return 0 when existingResult is null', () => {
    expect(getAmendmentCount(null)).toBe(0);
  });

  it('should return 0 when amendment history is empty', () => {
    const result = { ...sampleExistingResult, amendmentHistory: [] };
    expect(getAmendmentCount(result)).toBe(0);
  });
});

// ─── Tests: getLatestAmendment ───────────────────────────────────────────────

describe('getLatestAmendment', () => {
  it('should return the most recent amendment', () => {
    const latest = getLatestAmendment(sampleExistingResult);
    expect(latest).not.toBeNull();
    expect(latest!.newValue).toBe(95);
    expect(latest!.amendedBy).toBe('tech-002');
  });

  it('should return null when existingResult is null', () => {
    expect(getLatestAmendment(null)).toBeNull();
  });

  it('should return null when amendment history is empty', () => {
    const result = { ...sampleExistingResult, amendmentHistory: [] };
    expect(getLatestAmendment(result)).toBeNull();
  });
});

// ─── Tests: ARIA helpers ─────────────────────────────────────────────────────

describe('getAmendmentConfirmationAriaProps', () => {
  it('should return alertdialog role with descriptive label', () => {
    const props = getAmendmentConfirmationAriaProps(sampleExistingResult, 105);

    expect(props.role).toBe('alertdialog');
    expect(props['aria-modal']).toBe('true');
    expect(props['aria-label']).toContain('Blood Sugar');
    expect(props['aria-label']).toContain('95');
    expect(props['aria-label']).toContain('105');
  });
});

describe('getAmendmentHistoryAriaProps', () => {
  it('should return list role with count', () => {
    const props = getAmendmentHistoryAriaProps('blood_sugar', 3);

    expect(props.role).toBe('list');
    expect(props['aria-label']).toContain('blood_sugar');
    expect(props['aria-label']).toContain('3 amendments');
  });

  it('should use singular "amendment" for count of 1', () => {
    const props = getAmendmentHistoryAriaProps('blood_sugar', 1);
    expect(props['aria-label']).toContain('1 amendment recorded');
  });
});

// ─── Tests: Initial State ────────────────────────────────────────────────────

describe('Initial state constants', () => {
  it('should have empty initial amendment values', () => {
    expect(INITIAL_AMENDMENT_VALUES.newValue).toBe('');
    expect(INITIAL_AMENDMENT_VALUES.unit).toBe('');
    expect(INITIAL_AMENDMENT_VALUES.reason).toBe('');
    expect(INITIAL_AMENDMENT_VALUES.technicianId).toBe('');
  });

  it('should have clean initial amendment state', () => {
    expect(INITIAL_AMENDMENT_STATE.existingResult).toBeNull();
    expect(INITIAL_AMENDMENT_STATE.isSubmitting).toBe(false);
    expect(INITIAL_AMENDMENT_STATE.confirmation).toBeNull();
    expect(INITIAL_AMENDMENT_STATE.saveError).toBeNull();
    expect(INITIAL_AMENDMENT_STATE.errors).toEqual({});
  });
});
