import fc from 'fast-check';

import {
  BaaFailureReason,
  COMPLIANCE_ERROR,
  ComplianceControl,
} from './errors';
import {
  gatePhiExchange,
  isPhiExchangeAllowed,
  verifyBaa,
  type BusinessAssociateAgreement,
  type PhiPartner,
} from './baa-gate';

/**
 * Property-based test for the PHI-exchange Business Associate Agreement gate
 * (Task 16.7), targeting the gateway BAA guard implemented in Task 16.6.
 *
 * Feature: calorie-cortisol-tool, Property 58
 * Property 58: BAA gate on PHI exchange.
 *   For any partner and reference instant, PHI exchange is permitted if and
 *   only if the partner does not handle PHI, or it handles PHI and has an
 *   executed Business Associate Agreement whose effective window (if any)
 *   contains the reference instant. In every blocked case the gate records a
 *   compliance indicator identifying the missing/invalid agreement and returns
 *   a non-retryable, state-preserving validation error.
 *
 * Validates: Requirements 30.3
 */

/** Reference-instant generator spanning a wide range so windows fall on either side. */
const nowArb: fc.Arbitrary<Date> = fc.date({
  min: new Date('2000-01-01T00:00:00.000Z'),
  max: new Date('2035-12-31T23:59:59.999Z'),
});

/** ISO timestamps that parse, clustered across a wide range. */
const parseableInstant: fc.Arbitrary<string> = fc
  .date({
    min: new Date('1999-01-01T00:00:00.000Z'),
    max: new Date('2036-12-31T23:59:59.999Z'),
  })
  .map((d) => d.toISOString());

/** Strings that never parse to a valid instant (treated as "no window bound"). */
const unparseableInstant: fc.Arbitrary<string> = fc.constantFrom(
  '',
  '   ',
  'not-a-date',
  'someday',
  '2024-13-45T99:99:99Z',
  'null',
);

/** An optional window bound: absent, a parseable instant, or an unparseable string. */
const windowBoundArb: fc.Arbitrary<string | undefined> = fc.oneof(
  { weight: 3, arbitrary: fc.constant(undefined) },
  { weight: 4, arbitrary: parseableInstant },
  { weight: 1, arbitrary: unparseableInstant },
);

/**
 * BAA generator covering executed/unexecuted and every combination of present/
 * absent/parseable/unparseable effective and expiry bounds.
 */
function baaArb(): fc.Arbitrary<BusinessAssociateAgreement> {
  return fc.record({
    agreementId: fc
      .string({ minLength: 1, maxLength: 20 })
      .map((s) => `BAA-${s}`),
    executed: fc.boolean(),
    effectiveAt: windowBoundArb,
    expiresAt: windowBoundArb,
  }) as fc.Arbitrary<BusinessAssociateAgreement>;
}

/** Partner generator: PHI vs non-PHI, and BAA present/null/absent. */
const partnerArb: fc.Arbitrary<PhiPartner> = fc.record({
  partnerId: fc.string({ minLength: 1, maxLength: 24 }).map((s) => `partner-${s}`),
  handlesPhi: fc.boolean(),
  baa: fc.oneof(
    { weight: 5, arbitrary: baaArb() },
    { weight: 1, arbitrary: fc.constant(null) },
    { weight: 1, arbitrary: fc.constant(undefined) },
  ),
});

/** Parse an ISO instant to epoch ms, or null when unparseable/absent. */
function parse(iso: string | undefined): number | null {
  if (typeof iso !== 'string' || iso.trim() === '') {
    return null;
  }
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Independent oracle recomputing the expected verification directly from the
 * Req 30.3 rules, so the test constrains behaviour rather than mirroring the
 * implementation. Failure reasons are ordered absent → not-executed →
 * not-yet-effective → expired.
 */
function expectedReason(
  baa: BusinessAssociateAgreement | null | undefined,
  now: Date,
): BaaFailureReason | null {
  if (!baa) {
    return BaaFailureReason.ABSENT;
  }
  if (baa.executed !== true) {
    return BaaFailureReason.NOT_EXECUTED;
  }
  const nowMs = now.getTime();
  const eff = parse(baa.effectiveAt);
  if (eff !== null && nowMs < eff) {
    return BaaFailureReason.NOT_YET_EFFECTIVE;
  }
  const exp = parse(baa.expiresAt);
  if (exp !== null && nowMs >= exp) {
    return BaaFailureReason.EXPIRED;
  }
  return null;
}

describe('Property 58: BAA gate on PHI exchange [Feature: calorie-cortisol-tool, Property 58]', () => {
  it('permits PHI exchange iff a valid executed BAA is in place, else blocks with a recorded indicator and validation error (Req 30.3)', () => {
    fc.assert(
      fc.property(partnerArb, nowArb, (partner, now) => {
        const decision = gatePhiExchange(partner, now);
        const reason = expectedReason(partner.baa, now);

        // A non-PHI partner needs no BAA; a PHI partner needs a valid one.
        const expectedAllowed = !partner.handlesPhi || reason === null;

        // Decision always concerns the partner it was asked about.
        expect(decision.partnerId).toBe(partner.partnerId);

        // Core invariant: permitted iff the gate condition holds.
        expect(decision.exchangeAllowed).toBe(expectedAllowed);

        // The convenience predicate agrees with the full gate.
        expect(isPhiExchangeAllowed(partner, now)).toBe(expectedAllowed);

        if (expectedAllowed) {
          // Permitted ⇒ no indicator and no error are produced.
          expect(decision.complianceIndicator).toBeUndefined();
          expect(decision.error).toBeUndefined();
        } else {
          // Blocked ⇒ a compliance indicator records the missing/invalid BAA.
          const indicator = decision.complianceIndicator;
          expect(indicator).toBeDefined();
          expect(indicator?.control).toBe(ComplianceControl.BAA);
          expect(indicator?.subjectId).toBe(partner.partnerId);
          expect(indicator?.reason).toBe(reason);
          expect(indicator?.recordedAt).toBe(now.toISOString());
          expect(typeof indicator?.message).toBe('string');
          expect(indicator?.message.length).toBeGreaterThan(0);

          // Blocked ⇒ a non-retryable, state-preserving validation error.
          expect(decision.error).toMatchObject({
            code: COMPLIANCE_ERROR.BAA_REQUIRED,
            retryable: false,
            retainedState: true,
          });

          // A PHI partner is blocked only for the specific verification reason.
          expect(verifyBaa(partner.baa, now)).toEqual({
            permitted: false,
            reason,
          });
        }
      }),
      { numRuns: 100 },
    );
  });

  it('always permits PHI exchange for an executed BAA whose window strictly contains now (Req 30.3)', () => {
    const validArb = fc
      .tuple(
        nowArb,
        fc.integer({ min: 1, max: 3650 }),
        fc.integer({ min: 1, max: 3650 }),
        fc.string({ minLength: 1, maxLength: 24 }).map((s) => `partner-${s}`),
      )
      .map(([now, daysBefore, daysAhead, partnerId]) => {
        const partner: PhiPartner = {
          partnerId,
          handlesPhi: true,
          baa: {
            agreementId: 'BAA-0001',
            executed: true,
            effectiveAt: new Date(
              now.getTime() - daysBefore * 86_400_000,
            ).toISOString(),
            expiresAt: new Date(
              now.getTime() + daysAhead * 86_400_000,
            ).toISOString(),
          },
        };
        return { partner, now };
      });

    fc.assert(
      fc.property(validArb, ({ partner, now }) => {
        const decision = gatePhiExchange(partner, now);
        expect(decision.exchangeAllowed).toBe(true);
        expect(decision.complianceIndicator).toBeUndefined();
        expect(decision.error).toBeUndefined();
      }),
      { numRuns: 100 },
    );
  });

  it('always blocks a PHI partner with no BAA on record (Req 30.3)', () => {
    const noBaaArb = fc.record({
      partnerId: fc
        .string({ minLength: 1, maxLength: 24 })
        .map((s) => `partner-${s}`),
      handlesPhi: fc.constant(true),
      baa: fc.constantFrom(null, undefined),
    });

    fc.assert(
      fc.property(noBaaArb, nowArb, (partner, now) => {
        const decision = gatePhiExchange(partner as PhiPartner, now);
        expect(decision.exchangeAllowed).toBe(false);
        expect(decision.complianceIndicator?.reason).toBe(
          BaaFailureReason.ABSENT,
        );
        expect(decision.error?.code).toBe(COMPLIANCE_ERROR.BAA_REQUIRED);
      }),
      { numRuns: 100 },
    );
  });
});
