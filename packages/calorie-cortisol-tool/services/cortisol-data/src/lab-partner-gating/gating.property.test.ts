import fc from 'fast-check';

import {
  CLIA_COMPLIANCE_CONTROL,
  CliaVerificationFailureReason,
} from './errors';
import {
  gateLabPartnerIngestion,
  type CliaCertification,
  type LabPartner,
} from './gating';

/**
 * Property-based test for CLIA lab-partner onboarding gating (Task 9.23).
 *
 * Feature: calorie-cortisol-tool, Property 57
 * Property 57: CLIA lab-partner gating.
 *   For any lab partner, result ingestion is enabled if and only if the partner
 *   holds a CLIA certification whose expiration date is later than the current
 *   date (and that certification is verified); otherwise ingestion stays
 *   disabled and a compliance indicator records the failed verification.
 *
 * Validates: Requirements 30.1, 30.2
 */

/** Reference-instant generator spanning a wide range so expiry can fall on either side. */
const nowArb: fc.Arbitrary<Date> = fc.date({
  min: new Date('2000-01-01T00:00:00.000Z'),
  max: new Date('2035-12-31T23:59:59.999Z'),
});

/**
 * Certification generator that intelligently covers every branch: verified vs
 * not, parseable expiry vs unparseable string, and — for parseable expiries —
 * offsets clustered around a base instant so both future and past/boundary
 * expiries are well represented. `null`/absent is generated at the partner level.
 */
function certArb(): fc.Arbitrary<CliaCertification> {
  const parseableExpiry: fc.Arbitrary<string> = fc
    .date({
      min: new Date('1999-01-01T00:00:00.000Z'),
      max: new Date('2036-12-31T23:59:59.999Z'),
    })
    .map((d) => d.toISOString());

  const unparseableExpiry: fc.Arbitrary<string> = fc.constantFrom(
    '',
    '   ',
    'not-a-date',
    'yesterday',
    '2024-13-45T99:99:99Z',
    'null',
  );

  return fc.record({
    certificateNumber: fc
      .string({ minLength: 1, maxLength: 20 })
      .map((s) => `CLIA-${s}`),
    expiresAt: fc.oneof(
      { weight: 4, arbitrary: parseableExpiry },
      { weight: 1, arbitrary: unparseableExpiry },
    ),
    verified: fc.boolean(),
  });
}

const partnerArb: fc.Arbitrary<LabPartner> = fc.record({
  partnerId: fc.string({ minLength: 1, maxLength: 24 }).map((s) => `lab-${s}`),
  certification: fc.oneof(
    { weight: 5, arbitrary: certArb() },
    { weight: 1, arbitrary: fc.constant(null) },
    { weight: 1, arbitrary: fc.constant(undefined) },
  ),
});

/**
 * Independent oracle: recomputes the expected outcome directly from Req 30.1/30.2
 * without reusing the module's verify helper, so the test genuinely constrains
 * behaviour rather than mirroring the implementation.
 */
function expectedOutcome(
  partner: LabPartner,
  now: Date,
): { enabled: boolean; reason?: CliaVerificationFailureReason } {
  const cert = partner.certification;
  if (cert === null || cert === undefined) {
    return { enabled: false, reason: CliaVerificationFailureReason.ABSENT };
  }
  if (cert.verified !== true) {
    return {
      enabled: false,
      reason: CliaVerificationFailureReason.UNVERIFIABLE,
    };
  }
  const parsed = Date.parse(cert.expiresAt);
  if (Number.isNaN(parsed)) {
    return {
      enabled: false,
      reason: CliaVerificationFailureReason.INVALID_EXPIRY,
    };
  }
  if (parsed <= now.getTime()) {
    return { enabled: false, reason: CliaVerificationFailureReason.EXPIRED };
  }
  return { enabled: true };
}

describe('Property 57: CLIA lab-partner gating [Feature: calorie-cortisol-tool, Property 57]', () => {
  it('enables ingestion iff a verified CLIA cert with a future expiry is on record, else disables and records a compliance indicator (Req 30.1, 30.2)', () => {
    fc.assert(
      fc.property(partnerArb, nowArb, (partner, now) => {
        const decision = gateLabPartnerIngestion(partner, now);
        const expected = expectedOutcome(partner, now);

        // Decision always concerns the partner it was asked about.
        expect(decision.partnerId).toBe(partner.partnerId);

        // Req 30.1: enabled if and only if the gate's condition holds.
        expect(decision.ingestionEnabled).toBe(expected.enabled);

        if (expected.enabled) {
          // Enabled ⇒ no compliance indicator is recorded.
          expect(decision.complianceIndicator).toBeUndefined();
        } else {
          // Req 30.2: disabled ⇒ a compliance indicator records the failure.
          const indicator = decision.complianceIndicator;
          expect(indicator).toBeDefined();
          expect(indicator?.control).toBe(CLIA_COMPLIANCE_CONTROL);
          expect(indicator?.partnerId).toBe(partner.partnerId);
          expect(indicator?.reason).toBe(expected.reason);
          expect(indicator?.recordedAt).toBe(now.toISOString());
          expect(typeof indicator?.message).toBe('string');
          expect(indicator?.message.length).toBeGreaterThan(0);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('always enables (never records an indicator) when a verified cert expires strictly after now (Req 30.1)', () => {
    const validPartnerArb = fc
      .tuple(
        nowArb,
        fc.integer({ min: 1, max: 3650 }),
        fc.string({ minLength: 1, maxLength: 24 }).map((s) => `lab-${s}`),
      )
      .map(([now, daysAhead, partnerId]) => {
        const partner: LabPartner = {
          partnerId,
          certification: {
            certificateNumber: 'CLIA-12D3456789',
            expiresAt: new Date(
              now.getTime() + daysAhead * 86_400_000,
            ).toISOString(),
            verified: true,
          },
        };
        return { partner, now };
      });

    fc.assert(
      fc.property(validPartnerArb, ({ partner, now }) => {
        const decision = gateLabPartnerIngestion(partner, now);
        expect(decision.ingestionEnabled).toBe(true);
        expect(decision.complianceIndicator).toBeUndefined();
      }),
      { numRuns: 100 },
    );
  });
});
