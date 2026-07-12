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
 * Focused unit tests for the PHI-exchange BAA gate (Req 30.3).
 * The optional property test (Property 58) is task 16.7.
 */

const NOW = new Date('2025-01-15T00:00:00.000Z');

/** An executed BAA with no effective window (in force whenever). */
function executedBaa(): BusinessAssociateAgreement {
  return { agreementId: 'BAA-001', executed: true };
}

/** A partner that handles PHI, with the supplied (optional) BAA. */
function phiPartner(
  baa?: BusinessAssociateAgreement | null,
): PhiPartner {
  return { partnerId: 'labcorp', handlesPhi: true, baa };
}

describe('verifyBaa (Req 30.3)', () => {
  it('permits exchange for an executed BAA with no window', () => {
    expect(verifyBaa(executedBaa(), NOW)).toEqual({ permitted: true });
  });

  it('fails as absent when no BAA is on record', () => {
    expect(verifyBaa(null, NOW)).toEqual({
      permitted: false,
      reason: BaaFailureReason.ABSENT,
    });
    expect(verifyBaa(undefined, NOW)).toEqual({
      permitted: false,
      reason: BaaFailureReason.ABSENT,
    });
  });

  it('fails as not-executed when the BAA is on record but unsigned', () => {
    expect(verifyBaa({ ...executedBaa(), executed: false }, NOW)).toEqual({
      permitted: false,
      reason: BaaFailureReason.NOT_EXECUTED,
    });
  });

  it('fails as not-yet-effective when now precedes the effective date', () => {
    const baa = { ...executedBaa(), effectiveAt: '2025-02-01T00:00:00.000Z' };
    expect(verifyBaa(baa, NOW)).toEqual({
      permitted: false,
      reason: BaaFailureReason.NOT_YET_EFFECTIVE,
    });
  });

  it('fails as expired when now is at or past the expiry', () => {
    const baa = { ...executedBaa(), expiresAt: '2025-01-15T00:00:00.000Z' };
    expect(verifyBaa(baa, NOW)).toEqual({
      permitted: false,
      reason: BaaFailureReason.EXPIRED,
    });
  });

  it('permits exchange when now falls within the effective window', () => {
    const baa = {
      ...executedBaa(),
      effectiveAt: '2025-01-01T00:00:00.000Z',
      expiresAt: '2025-12-31T00:00:00.000Z',
    };
    expect(verifyBaa(baa, NOW)).toEqual({ permitted: true });
  });

  it('reports the earliest blocking reason (not-executed before window)', () => {
    const baa = {
      ...executedBaa(),
      executed: false,
      effectiveAt: '2025-02-01T00:00:00.000Z',
    };
    expect(verifyBaa(baa, NOW)).toEqual({
      permitted: false,
      reason: BaaFailureReason.NOT_EXECUTED,
    });
  });
});

describe('gatePhiExchange (Req 30.3)', () => {
  it('permits exchange for a non-PHI partner without any BAA', () => {
    const decision = gatePhiExchange(
      { partnerId: 'analytics', handlesPhi: false },
      NOW,
    );
    expect(decision.exchangeAllowed).toBe(true);
    expect(decision.complianceIndicator).toBeUndefined();
    expect(decision.error).toBeUndefined();
  });

  it('permits PHI exchange when an executed BAA is on record', () => {
    const decision = gatePhiExchange(phiPartner(executedBaa()), NOW);
    expect(decision.exchangeAllowed).toBe(true);
    expect(decision.complianceIndicator).toBeUndefined();
    expect(decision.error).toBeUndefined();
    expect(decision.partnerId).toBe('labcorp');
  });

  it('blocks PHI exchange and records an indicator when no BAA is on record', () => {
    const decision = gatePhiExchange(phiPartner(null), NOW);
    expect(decision.exchangeAllowed).toBe(false);
    expect(decision.complianceIndicator).toEqual({
      control: ComplianceControl.BAA,
      reason: BaaFailureReason.ABSENT,
      subjectId: 'labcorp',
      message: expect.stringContaining('no executed Business Associate Agreement'),
      recordedAt: NOW.toISOString(),
    });
  });

  it('blocks PHI exchange with a non-retryable validation error contract', () => {
    const decision = gatePhiExchange(
      phiPartner({ ...executedBaa(), executed: false }),
      NOW,
    );
    expect(decision.exchangeAllowed).toBe(false);
    expect(decision.complianceIndicator?.reason).toBe(
      BaaFailureReason.NOT_EXECUTED,
    );
    expect(decision.error).toMatchObject({
      code: COMPLIANCE_ERROR.BAA_REQUIRED,
      retryable: false,
      retainedState: true,
    });
  });
});

describe('isPhiExchangeAllowed (Req 30.3)', () => {
  it('is true for a non-PHI partner and for a PHI partner with an executed BAA', () => {
    expect(
      isPhiExchangeAllowed({ partnerId: 'x', handlesPhi: false }, NOW),
    ).toBe(true);
    expect(isPhiExchangeAllowed(phiPartner(executedBaa()), NOW)).toBe(true);
  });

  it('is false for a PHI partner without an executed BAA', () => {
    expect(isPhiExchangeAllowed(phiPartner(null), NOW)).toBe(false);
  });
});
