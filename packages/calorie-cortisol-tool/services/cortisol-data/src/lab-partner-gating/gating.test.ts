import {
  CLIA_COMPLIANCE_CONTROL,
  CliaVerificationFailureReason,
} from './errors';
import {
  gateLabPartnerIngestion,
  isIngestionEnabled,
  verifyCliaCertification,
  type CliaCertification,
  type LabPartner,
} from './gating';

/**
 * Focused unit tests for the CLIA lab-partner onboarding gate (Req 30.1, 30.2).
 * The optional property test (Property 57) is task 9.23.
 */

const NOW = new Date('2024-06-01T00:00:00.000Z');

/** A verified certification expiring `days` from NOW (negative = in the past). */
function certExpiringInDays(days: number): CliaCertification {
  return {
    certificateNumber: 'CLIA-12D3456789',
    expiresAt: new Date(NOW.getTime() + days * 86_400_000).toISOString(),
    verified: true,
  };
}

describe('verifyCliaCertification (Req 30.1, 30.2)', () => {
  it('verifies a verified certification with a future expiry', () => {
    expect(verifyCliaCertification(certExpiringInDays(30), NOW)).toEqual({
      verified: true,
    });
  });

  it('fails as absent when no certification is on record', () => {
    expect(verifyCliaCertification(null, NOW)).toEqual({
      verified: false,
      reason: CliaVerificationFailureReason.ABSENT,
    });
    expect(verifyCliaCertification(undefined, NOW)).toEqual({
      verified: false,
      reason: CliaVerificationFailureReason.ABSENT,
    });
  });

  it('fails as unverifiable when the certification is not verified', () => {
    const cert = { ...certExpiringInDays(30), verified: false };
    expect(verifyCliaCertification(cert, NOW)).toEqual({
      verified: false,
      reason: CliaVerificationFailureReason.UNVERIFIABLE,
    });
  });

  it('fails with invalid expiry when the expiry is unparseable', () => {
    const cert = { ...certExpiringInDays(30), expiresAt: 'not-a-date' };
    expect(verifyCliaCertification(cert, NOW)).toEqual({
      verified: false,
      reason: CliaVerificationFailureReason.INVALID_EXPIRY,
    });
  });

  it('fails as expired when the expiry is in the past', () => {
    expect(verifyCliaCertification(certExpiringInDays(-1), NOW)).toEqual({
      verified: false,
      reason: CliaVerificationFailureReason.EXPIRED,
    });
  });

  it('treats an expiry exactly at now as expired (must be strictly later)', () => {
    const cert = { ...certExpiringInDays(0), expiresAt: NOW.toISOString() };
    expect(verifyCliaCertification(cert, NOW)).toEqual({
      verified: false,
      reason: CliaVerificationFailureReason.EXPIRED,
    });
  });

  it('reports the earliest blocking reason (unverifiable before expired)', () => {
    const cert: CliaCertification = {
      certificateNumber: 'CLIA-12D3456789',
      expiresAt: new Date(NOW.getTime() - 86_400_000).toISOString(),
      verified: false,
    };
    expect(verifyCliaCertification(cert, NOW)).toEqual({
      verified: false,
      reason: CliaVerificationFailureReason.UNVERIFIABLE,
    });
  });
});

describe('gateLabPartnerIngestion (Req 30.1, 30.2)', () => {
  it('enables ingestion with no compliance indicator for a valid partner', () => {
    const partner: LabPartner = {
      partnerId: 'labcorp',
      certification: certExpiringInDays(365),
    };
    const decision = gateLabPartnerIngestion(partner, NOW);
    expect(decision.ingestionEnabled).toBe(true);
    expect(decision.complianceIndicator).toBeUndefined();
    expect(decision.partnerId).toBe('labcorp');
  });

  it('disables ingestion and records a compliance indicator on failure', () => {
    const partner: LabPartner = {
      partnerId: 'everlywell',
      certification: certExpiringInDays(-10),
    };
    const decision = gateLabPartnerIngestion(partner, NOW);
    expect(decision.ingestionEnabled).toBe(false);
    expect(decision.complianceIndicator).toEqual({
      control: CLIA_COMPLIANCE_CONTROL,
      partnerId: 'everlywell',
      reason: CliaVerificationFailureReason.EXPIRED,
      message: expect.stringContaining('expired'),
      recordedAt: NOW.toISOString(),
    });
  });

  it('records the absent reason when a partner has no certification', () => {
    const partner: LabPartner = { partnerId: 'unknown-lab' };
    const decision = gateLabPartnerIngestion(partner, NOW);
    expect(decision.ingestionEnabled).toBe(false);
    expect(decision.complianceIndicator?.reason).toBe(
      CliaVerificationFailureReason.ABSENT,
    );
  });
});

describe('isIngestionEnabled (Req 30.1)', () => {
  it('mirrors the gate decision without producing an indicator', () => {
    expect(
      isIngestionEnabled(
        { partnerId: 'p', certification: certExpiringInDays(1) },
        NOW,
      ),
    ).toBe(true);
    expect(isIngestionEnabled({ partnerId: 'p' }, NOW)).toBe(false);
  });
});
