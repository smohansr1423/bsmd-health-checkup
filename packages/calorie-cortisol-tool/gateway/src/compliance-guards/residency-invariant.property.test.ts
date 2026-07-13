import fc from 'fast-check';

import type { Residency } from '@calorie-cortisol/shared';
import {
  COMPLIANCE_ERROR,
  ComplianceControl,
  ResidencyFailureReason,
} from './errors';
import {
  enforceEuResidency,
  type DataResidencyState,
} from './residency-invariant';

/**
 * Property 59: EU data-residency invariant
 * Validates: Requirements 30.6, 30.7
 * Feature: calorie-cortisol-tool, Property 59
 *
 * For any user identified as an EU resident, all stored/retained data must
 * reside exclusively in EU regions (Req 30.6); if any such data is found
 * outside an EU region, further processing is blocked and a residency-violation
 * compliance indicator is recorded (Req 30.7). A user who is not an EU resident
 * is unconstrained by this invariant.
 *
 * The property is checked against an INDEPENDENT restatement of the invariant
 * rather than reusing the implementation's `isEuRegion`/`findNonEuRegions`:
 *   - a region is EU iff its trimmed, lower-cased form starts with `eu-`;
 *   - an EU resident's data is "pinned" to the EU iff EVERY storage region is
 *     an EU region — i.e. no data is routed/stored outside the EU.
 *
 * Both residency branches (EU / non-EU) and both region outcomes (fully-pinned
 * / contains a non-EU region) are generated so the guard is exercised across
 * its whole input space.
 */

const NOW = new Date('2025-01-15T00:00:00.000Z');

// --- Independent oracle for Req 30.6 ---------------------------------------

/** A region is EU iff its trimmed, lower-cased form starts with `eu-`. */
function isEuOracle(region: string): boolean {
  return region.trim().toLowerCase().startsWith('eu-');
}

/** Distinct non-EU regions, preserving first-seen input order. */
function nonEuOracle(regions: readonly string[]): string[] {
  const seen = new Set<string>();
  const offending: string[] = [];
  for (const region of regions) {
    if (!isEuOracle(region) && !seen.has(region)) {
      seen.add(region);
      offending.push(region);
    }
  }
  return offending;
}

// --- Arbitraries -----------------------------------------------------------

/** EU regions, including case / whitespace variants that still classify EU. */
const arbEuRegion = fc.constantFrom(
  'eu-west-1',
  'eu-central-1',
  'eu-north-1',
  'EU-SOUTH-2',
  '  eu-west-3 ',
);

/** Clearly non-EU regions, including a lookalike (`europe-west1`, no `eu-`). */
const arbNonEuRegion = fc.constantFrom(
  'us-east-1',
  'ap-south-1',
  'sa-east-1',
  'ca-central-1',
  'AP-NORTHEAST-1',
  'europe-west1',
);

/**
 * A region drawn from the EU pool, the non-EU pool, or a fully arbitrary
 * string (which the oracle and the implementation classify consistently).
 */
const arbRegion = fc.oneof(
  arbEuRegion,
  arbNonEuRegion,
  fc.string({ maxLength: 12 }),
);

const arbStorageRegions = fc.array(arbRegion, { maxLength: 8 });

function arbResidency(euResident: boolean): fc.Arbitrary<Residency> {
  return fc
    .string({ minLength: 1, maxLength: 10 })
    .map((userId) => ({ userId, region: 'unused', euResident }));
}

const arbState: fc.Arbitrary<DataResidencyState> = fc
  .tuple(fc.boolean(), arbStorageRegions)
  .chain(([euResident, storageRegions]) =>
    arbResidency(euResident).map((residency) => ({ residency, storageRegions })),
  );

describe('Property 59: EU data-residency invariant (Req 30.6, 30.7) [Feature: calorie-cortisol-tool, Property 59]', () => {
  it('pins EU-resident data to the EU and blocks + records an indicator otherwise, leaving non-EU residents unconstrained', () => {
    fc.assert(
      fc.property(arbState, (state) => {
        const decision = enforceEuResidency(state, NOW);
        const { residency, storageRegions } = state;
        const offending = nonEuOracle(storageRegions);

        if (!residency.euResident) {
          // Non-EU residents are unconstrained: always permitted, no indicator.
          expect(decision.processingAllowed).toBe(true);
          expect(decision.violatingRegions).toEqual([]);
          expect(decision.complianceIndicator).toBeUndefined();
          expect(decision.error).toBeUndefined();
          return;
        }

        // EU resident: processing is allowed iff data is pinned to the EU
        // (every storage region is an EU region — nothing outside the EU).
        const pinnedToEu = offending.length === 0;
        expect(decision.processingAllowed).toBe(pinnedToEu);

        if (pinnedToEu) {
          expect(decision.violatingRegions).toEqual([]);
          expect(decision.complianceIndicator).toBeUndefined();
          expect(decision.error).toBeUndefined();
          return;
        }

        // Data found outside the EU: processing is blocked (Req 30.7) and a
        // residency-violation compliance indicator is recorded for the user.
        expect(decision.violatingRegions).toEqual(offending);
        expect(decision.complianceIndicator).toEqual({
          control: ComplianceControl.RESIDENCY,
          reason: ResidencyFailureReason.EU_DATA_OUTSIDE_EU,
          subjectId: residency.userId,
          message: expect.stringContaining('outside the EU'),
          recordedAt: NOW.toISOString(),
          details: { violatingRegions: offending },
        });
        expect(decision.error).toMatchObject({
          code: COMPLIANCE_ERROR.RESIDENCY_BLOCKED,
          retryable: false,
          retainedState: true,
        });
      }),
      { numRuns: 100 },
    );
  });

  it('never permits an EU resident whose data touches any non-EU region', () => {
    // Force at least one non-EU region into the storage set to concentrate on
    // the violation branch: EU-resident data must never be routed outside EU.
    const arbViolatingState = fc
      .tuple(
        arbResidency(true),
        fc.array(arbRegion, { maxLength: 6 }),
        arbNonEuRegion,
        fc.nat(6),
      )
      .map(([residency, regions, forcedNonEu, insertAt]) => {
        const storageRegions = [...regions];
        const idx = Math.min(insertAt, storageRegions.length);
        storageRegions.splice(idx, 0, forcedNonEu);
        return { residency, storageRegions };
      });

    fc.assert(
      fc.property(arbViolatingState, (state) => {
        const decision = enforceEuResidency(state, NOW);
        expect(decision.processingAllowed).toBe(false);
        expect(decision.violatingRegions.length).toBeGreaterThan(0);
        expect(decision.complianceIndicator?.control).toBe(
          ComplianceControl.RESIDENCY,
        );
        expect(decision.error?.code).toBe(COMPLIANCE_ERROR.RESIDENCY_BLOCKED);
      }),
      { numRuns: 100 },
    );
  });
});
