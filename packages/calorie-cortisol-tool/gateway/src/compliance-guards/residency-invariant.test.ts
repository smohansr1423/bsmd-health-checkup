import type { Residency } from '@calorie-cortisol/shared';
import {
  COMPLIANCE_ERROR,
  ComplianceControl,
  ResidencyFailureReason,
} from './errors';
import {
  enforceEuResidency,
  findNonEuRegions,
  isEuRegion,
  isProcessingAllowed,
  type DataResidencyState,
} from './residency-invariant';

/**
 * Focused unit tests for the EU data-residency invariant (Req 30.6, 30.7).
 * The optional property test (Property 59) is task 16.8.
 */

const NOW = new Date('2025-01-15T00:00:00.000Z');

function euResident(userId = 'u-eu'): Residency {
  return { userId, region: 'eu-west-1', euResident: true };
}

function nonEuResident(userId = 'u-us'): Residency {
  return { userId, region: 'us-east-1', euResident: false };
}

function state(
  residency: Residency,
  storageRegions: readonly string[],
): DataResidencyState {
  return { residency, storageRegions };
}

describe('isEuRegion (Req 30.6)', () => {
  it('classifies eu- prefixed regions as EU, case/space-insensitively', () => {
    expect(isEuRegion('eu-west-1')).toBe(true);
    expect(isEuRegion('EU-CENTRAL-1')).toBe(true);
    expect(isEuRegion('  eu-north-1 ')).toBe(true);
  });

  it('classifies non-eu regions as non-EU', () => {
    expect(isEuRegion('us-east-1')).toBe(false);
    expect(isEuRegion('ap-southeast-2')).toBe(false);
    expect(isEuRegion('europe-west1')).toBe(false);
  });
});

describe('findNonEuRegions (Req 30.6)', () => {
  it('returns distinct offending regions in input order', () => {
    expect(
      findNonEuRegions(['eu-west-1', 'us-east-1', 'eu-central-1', 'us-east-1', 'ap-south-1']),
    ).toEqual(['us-east-1', 'ap-south-1']);
  });

  it('returns empty when all regions are EU', () => {
    expect(findNonEuRegions(['eu-west-1', 'eu-central-1'])).toEqual([]);
  });
});

describe('enforceEuResidency (Req 30.6, 30.7)', () => {
  it('permits processing for a non-EU resident regardless of storage region', () => {
    const decision = enforceEuResidency(
      state(nonEuResident(), ['us-east-1', 'ap-south-1']),
      NOW,
    );
    expect(decision.processingAllowed).toBe(true);
    expect(decision.violatingRegions).toEqual([]);
    expect(decision.complianceIndicator).toBeUndefined();
    expect(decision.error).toBeUndefined();
  });

  it('permits processing for an EU resident stored only in EU regions', () => {
    const decision = enforceEuResidency(
      state(euResident(), ['eu-west-1', 'eu-central-1']),
      NOW,
    );
    expect(decision.processingAllowed).toBe(true);
    expect(decision.violatingRegions).toEqual([]);
  });

  it('permits processing for an EU resident with no stored regions', () => {
    const decision = enforceEuResidency(state(euResident(), []), NOW);
    expect(decision.processingAllowed).toBe(true);
  });

  it('blocks processing and records an indicator when EU data is outside the EU', () => {
    const decision = enforceEuResidency(
      state(euResident(), ['eu-west-1', 'us-east-1']),
      NOW,
    );
    expect(decision.processingAllowed).toBe(false);
    expect(decision.violatingRegions).toEqual(['us-east-1']);
    expect(decision.complianceIndicator).toEqual({
      control: ComplianceControl.RESIDENCY,
      reason: ResidencyFailureReason.EU_DATA_OUTSIDE_EU,
      subjectId: 'u-eu',
      message: expect.stringContaining('outside the EU'),
      recordedAt: NOW.toISOString(),
      details: { violatingRegions: ['us-east-1'] },
    });
  });

  it('blocks with a non-retryable validation error contract', () => {
    const decision = enforceEuResidency(
      state(euResident(), ['ap-south-1']),
      NOW,
    );
    expect(decision.error).toMatchObject({
      code: COMPLIANCE_ERROR.RESIDENCY_BLOCKED,
      retryable: false,
      retainedState: true,
    });
  });

  it('honours an injected EU-region predicate (explicit allow-list)', () => {
    const allowList = new Set(['de-frankfurt', 'fr-paris']);
    const isEu = (r: string): boolean => allowList.has(r);
    const decision = enforceEuResidency(
      state(euResident(), ['de-frankfurt', 'eu-west-1']),
      NOW,
      isEu,
    );
    // eu-west-1 is not in the injected allow-list, so it violates.
    expect(decision.processingAllowed).toBe(false);
    expect(decision.violatingRegions).toEqual(['eu-west-1']);
  });
});

describe('isProcessingAllowed (Req 30.6, 30.7)', () => {
  it('is true for a compliant EU resident and any non-EU resident', () => {
    expect(isProcessingAllowed(state(euResident(), ['eu-west-1']))).toBe(true);
    expect(isProcessingAllowed(state(nonEuResident(), ['us-east-1']))).toBe(true);
  });

  it('is false for an EU resident with data outside the EU', () => {
    expect(isProcessingAllowed(state(euResident(), ['us-east-1']))).toBe(false);
  });
});
