/**
 * CLIA lab-partner onboarding gate — the Lab_Integration partner enablement
 * logic (Req 30.1, 30.2).
 *
 * When a laboratory partner is onboarded, result ingestion for that partner is
 * enabled **if and only if** the partner holds a CLIA certification that is
 * verified and whose expiration date is later than the current date (Req 30.1).
 * In every other case — certification absent, unverifiable, with an
 * unparseable expiry, or expired — ingestion stays disabled and a compliance
 * indicator recording the failed verification is produced (Req 30.2).
 *
 * All logic here is pure and testable: the caller supplies the reference
 * "now", and the module performs no persistence or transport. The lab-kit
 * ordering / ingestion flow (src/lab, task 9.1) can consume {@link
 * isIngestionEnabled} / {@link gateLabPartnerIngestion} to gate enablement
 * without this module reaching into it.
 *
 * Requirements: 30.1, 30.2
 */
import {
  CLIA_COMPLIANCE_CONTROL,
  CliaVerificationFailureReason,
} from './errors';

// ---------------------------------------------------------------------------
// Domain shapes
// ---------------------------------------------------------------------------

/** A CLIA certification held by a laboratory partner (Req 30.1). */
export interface CliaCertification {
  /** The CLIA certificate number (identifier of record). */
  readonly certificateNumber: string;
  /** ISO-8601 expiration timestamp of the certification. */
  readonly expiresAt: string;
  /**
   * Whether the certification has been verified against the issuing authority.
   * A certification that could not be verified (`false`) keeps ingestion
   * disabled — the "cannot be verified" branch of Req 30.2.
   */
  readonly verified: boolean;
}

/** A laboratory partner being onboarded for result ingestion (Req 30.1). */
export interface LabPartner {
  /** Stable identifier of the partner. */
  readonly partnerId: string;
  /**
   * The partner's CLIA certification, or `null`/omitted when none is on record
   * (the "absent" branch of Req 30.2).
   */
  readonly certification?: CliaCertification | null;
}

/**
 * A recorded compliance indicator identifying a failed CLIA verification
 * (Req 30.2). Persisted/emitted by the caller; this module only constructs it.
 */
export interface ComplianceIndicator {
  /** Which compliance control produced this indicator. */
  readonly control: typeof CLIA_COMPLIANCE_CONTROL;
  /** The partner the indicator concerns. */
  readonly partnerId: string;
  /** Machine-readable reason the verification failed. */
  readonly reason: CliaVerificationFailureReason;
  /** Human-readable explanation for a compliance officer. */
  readonly message: string;
  /** ISO-8601 timestamp at which the failed verification was recorded. */
  readonly recordedAt: string;
}

/** The outcome of verifying a partner's CLIA certification (Req 30.1, 30.2). */
export type CliaVerification =
  | { readonly verified: true }
  | {
      readonly verified: false;
      readonly reason: CliaVerificationFailureReason;
    };

/** The onboarding gate decision for a partner (Req 30.1, 30.2). */
export interface PartnerGateDecision {
  readonly partnerId: string;
  /** Whether result ingestion is enabled for the partner (Req 30.1). */
  readonly ingestionEnabled: boolean;
  /**
   * Present iff ingestion is disabled: the recorded compliance indicator
   * identifying the failed verification (Req 30.2).
   */
  readonly complianceIndicator?: ComplianceIndicator;
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

/** Human-readable message for each failure reason (Req 30.2). */
function messageForReason(
  partnerId: string,
  reason: CliaVerificationFailureReason,
): string {
  switch (reason) {
    case CliaVerificationFailureReason.ABSENT:
      return `Lab partner ${partnerId} has no CLIA certification on record; result ingestion is disabled.`;
    case CliaVerificationFailureReason.UNVERIFIABLE:
      return `Lab partner ${partnerId}'s CLIA certification could not be verified; result ingestion is disabled.`;
    case CliaVerificationFailureReason.INVALID_EXPIRY:
      return `Lab partner ${partnerId}'s CLIA certification has a missing or invalid expiration date; result ingestion is disabled.`;
    case CliaVerificationFailureReason.EXPIRED:
      return `Lab partner ${partnerId}'s CLIA certification is expired; result ingestion is disabled.`;
    default: {
      // Exhaustiveness guard: a new reason must add a branch above.
      const _exhaustive: never = reason;
      return _exhaustive;
    }
  }
}

// ---------------------------------------------------------------------------
// Verification (Req 30.1, 30.2)
// ---------------------------------------------------------------------------

/**
 * Verify a partner's CLIA certification against the reference `now` (Req 30.1).
 *
 * Verification succeeds iff a certification is present, has been verified, has a
 * parseable expiry, and that expiry is strictly later than `now`. Otherwise the
 * specific failure reason is returned so the caller can record it (Req 30.2).
 * The checks are ordered from most to least fundamental (absent → unverifiable
 * → invalid expiry → expired) so the reported reason is the earliest blocking
 * condition.
 */
export function verifyCliaCertification(
  certification: CliaCertification | null | undefined,
  now: Date,
): CliaVerification {
  if (!certification) {
    return {
      verified: false,
      reason: CliaVerificationFailureReason.ABSENT,
    };
  }

  if (certification.verified !== true) {
    return {
      verified: false,
      reason: CliaVerificationFailureReason.UNVERIFIABLE,
    };
  }

  const expiresAtMs = parseInstant(certification.expiresAt);
  if (expiresAtMs === null) {
    return {
      verified: false,
      reason: CliaVerificationFailureReason.INVALID_EXPIRY,
    };
  }

  // "expiration date later than the current date" (Req 30.1): strictly later.
  if (expiresAtMs <= now.getTime()) {
    return {
      verified: false,
      reason: CliaVerificationFailureReason.EXPIRED,
    };
  }

  return { verified: true };
}

// ---------------------------------------------------------------------------
// Gate (Req 30.1, 30.2)
// ---------------------------------------------------------------------------

/**
 * The onboarding gate for a lab partner (Req 30.1, 30.2).
 *
 * Returns a decision in which `ingestionEnabled` is true iff the partner's CLIA
 * certification passes {@link verifyCliaCertification}. When it does not, the
 * decision carries a compliance indicator identifying the failed verification,
 * stamped with `now` as the recorded time (Req 30.2).
 */
export function gateLabPartnerIngestion(
  partner: LabPartner,
  now: Date,
): PartnerGateDecision {
  const verification = verifyCliaCertification(partner.certification, now);

  if (verification.verified) {
    return {
      partnerId: partner.partnerId,
      ingestionEnabled: true,
    };
  }

  return {
    partnerId: partner.partnerId,
    ingestionEnabled: false,
    complianceIndicator: {
      control: CLIA_COMPLIANCE_CONTROL,
      partnerId: partner.partnerId,
      reason: verification.reason,
      message: messageForReason(partner.partnerId, verification.reason),
      recordedAt: now.toISOString(),
    },
  };
}

/**
 * Convenience predicate for callers (e.g. the ingestion path) that only need to
 * know whether ingestion is permitted for a partner, without the indicator
 * (Req 30.1).
 */
export function isIngestionEnabled(partner: LabPartner, now: Date): boolean {
  return verifyCliaCertification(partner.certification, now).verified;
}
