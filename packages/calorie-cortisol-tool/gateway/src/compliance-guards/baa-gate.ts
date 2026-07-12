/**
 * PHI-exchange Business Associate Agreement gate (Req 30.3).
 *
 * A partner that handles PHI may exchange PHI **only if** an executed Business
 * Associate Agreement is on record. In every other case — no BAA on record, a
 * BAA that has not been executed, or a BAA whose effective window has not begun
 * or has already ended — the exchange is blocked and a compliance indicator
 * recording the missing/invalid agreement is produced (Req 30.3).
 *
 * A partner that does **not** handle PHI needs no BAA, so its exchange is
 * permitted with no indicator.
 *
 * All logic here is pure and testable: the caller supplies the reference
 * "now", and the module performs no persistence or transport. The gateway
 * middleware chain (task 16.1) can consume {@link gatePhiExchange} /
 * {@link isPhiExchangeAllowed} to block PHI egress at the boundary.
 *
 * Requirements: 30.3
 */

import { type ErrorContract, validationRejection } from '@calorie-cortisol/shared';
import {
  BaaFailureReason,
  COMPLIANCE_ERROR,
  ComplianceControl,
  type ComplianceIndicator,
} from './errors';

// ---------------------------------------------------------------------------
// Domain shapes
// ---------------------------------------------------------------------------

/** A Business Associate Agreement held on record for a partner (Req 30.3). */
export interface BusinessAssociateAgreement {
  /** Identifier of the agreement of record. */
  readonly agreementId: string;
  /**
   * Whether the agreement has been executed (signed by both parties). A BAA
   * that is on record but not executed does not permit PHI exchange.
   */
  readonly executed: boolean;
  /** Optional ISO-8601 timestamp at which the agreement becomes effective. */
  readonly effectiveAt?: string;
  /** Optional ISO-8601 timestamp at which the agreement expires. */
  readonly expiresAt?: string;
}

/** A partner the gateway may exchange data with (Req 30.3). */
export interface PhiPartner {
  /** Stable identifier of the partner. */
  readonly partnerId: string;
  /** Whether this partner handles PHI (and therefore requires a BAA). */
  readonly handlesPhi: boolean;
  /**
   * The partner's Business Associate Agreement, or `null`/omitted when none is
   * on record (the "absent" branch of Req 30.3).
   */
  readonly baa?: BusinessAssociateAgreement | null;
}

/** The outcome of verifying a partner's BAA (Req 30.3). */
export type BaaVerification =
  | { readonly permitted: true }
  | {
      readonly permitted: false;
      readonly reason: BaaFailureReason;
    };

/** The PHI-exchange gate decision for a partner (Req 30.3). */
export interface BaaGateDecision {
  readonly partnerId: string;
  /** Whether PHI exchange is permitted for the partner (Req 30.3). */
  readonly exchangeAllowed: boolean;
  /**
   * Present iff exchange is blocked: the recorded compliance indicator
   * identifying the missing/invalid agreement (Req 30.3).
   */
  readonly complianceIndicator?: ComplianceIndicator;
  /**
   * Present iff exchange is blocked: the structured error contract the gateway
   * returns to the caller.
   */
  readonly error?: ErrorContract;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** Parse an ISO timestamp to epoch milliseconds, or `null` if unparseable. */
function parseInstant(iso: unknown): number | null {
  if (typeof iso !== 'string' || iso.trim() === '') {
    return null;
  }
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

/** Human-readable message for each BAA failure reason (Req 30.3). */
function messageForReason(partnerId: string, reason: BaaFailureReason): string {
  switch (reason) {
    case BaaFailureReason.ABSENT:
      return `Partner ${partnerId} handles PHI but has no executed Business Associate Agreement on record; PHI exchange is blocked.`;
    case BaaFailureReason.NOT_EXECUTED:
      return `Partner ${partnerId}'s Business Associate Agreement is on record but has not been executed; PHI exchange is blocked.`;
    case BaaFailureReason.NOT_YET_EFFECTIVE:
      return `Partner ${partnerId}'s Business Associate Agreement is not yet effective; PHI exchange is blocked.`;
    case BaaFailureReason.EXPIRED:
      return `Partner ${partnerId}'s Business Associate Agreement has expired; PHI exchange is blocked.`;
    default: {
      // Exhaustiveness guard: a new reason must add a branch above.
      const _exhaustive: never = reason;
      return _exhaustive;
    }
  }
}

// ---------------------------------------------------------------------------
// Verification (Req 30.3)
// ---------------------------------------------------------------------------

/**
 * Verify a partner's Business Associate Agreement against the reference `now`
 * (Req 30.3).
 *
 * Exchange is permitted iff the partner has a BAA that is executed and, where
 * an effective window is supplied, `now` falls within it. Otherwise the
 * specific failure reason is returned so the caller can record it. The checks
 * are ordered from most to least fundamental (absent → not executed → not yet
 * effective → expired) so the reported reason is the earliest blocking
 * condition.
 */
export function verifyBaa(
  baa: BusinessAssociateAgreement | null | undefined,
  now: Date,
): BaaVerification {
  if (!baa) {
    return { permitted: false, reason: BaaFailureReason.ABSENT };
  }

  if (baa.executed !== true) {
    return { permitted: false, reason: BaaFailureReason.NOT_EXECUTED };
  }

  const nowMs = now.getTime();

  const effectiveAtMs = parseInstant(baa.effectiveAt);
  if (effectiveAtMs !== null && nowMs < effectiveAtMs) {
    return { permitted: false, reason: BaaFailureReason.NOT_YET_EFFECTIVE };
  }

  const expiresAtMs = parseInstant(baa.expiresAt);
  // An agreement whose expiry is not later than now is no longer in force.
  if (expiresAtMs !== null && nowMs >= expiresAtMs) {
    return { permitted: false, reason: BaaFailureReason.EXPIRED };
  }

  return { permitted: true };
}

// ---------------------------------------------------------------------------
// Gate (Req 30.3)
// ---------------------------------------------------------------------------

/**
 * The PHI-exchange gate for a partner (Req 30.3).
 *
 * Returns a decision in which `exchangeAllowed` is true when the partner does
 * not handle PHI, or when its BAA passes {@link verifyBaa}. When a PHI-handling
 * partner's BAA does not pass, the decision blocks the exchange and carries a
 * compliance indicator identifying the missing/invalid agreement plus a
 * structured error contract, stamped with `now` as the recorded time.
 */
export function gatePhiExchange(partner: PhiPartner, now: Date): BaaGateDecision {
  // A partner that does not handle PHI needs no BAA (Req 30.3 scope).
  if (!partner.handlesPhi) {
    return { partnerId: partner.partnerId, exchangeAllowed: true };
  }

  const verification = verifyBaa(partner.baa, now);
  if (verification.permitted) {
    return { partnerId: partner.partnerId, exchangeAllowed: true };
  }

  const message = messageForReason(partner.partnerId, verification.reason);
  return {
    partnerId: partner.partnerId,
    exchangeAllowed: false,
    complianceIndicator: {
      control: ComplianceControl.BAA,
      reason: verification.reason,
      subjectId: partner.partnerId,
      message,
      recordedAt: now.toISOString(),
    },
    // Prior state preserved, and re-attempting the same request without a
    // valid BAA will fail again — a validation rejection.
    error: validationRejection(COMPLIANCE_ERROR.BAA_REQUIRED, message),
  };
}

/**
 * Convenience predicate for callers that only need to know whether PHI exchange
 * is permitted for a partner, without the indicator (Req 30.3).
 */
export function isPhiExchangeAllowed(partner: PhiPartner, now: Date): boolean {
  return !partner.handlesPhi || verifyBaa(partner.baa, now).permitted;
}
