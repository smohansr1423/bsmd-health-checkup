/**
 * Stable, machine-readable identifiers for the CLIA lab-partner onboarding
 * gate (Req 30.1, 30.2).
 *
 * A partner's result ingestion is enabled only when a CLIA certification with a
 * future expiry is verified. Every failure mode below keeps ingestion disabled
 * and is recorded on the compliance indicator so a compliance officer can see
 * exactly why verification failed (Req 30.2).
 */

/** The reason a CLIA certification failed verification (Req 30.2). */
export const CliaVerificationFailureReason = {
  /** No CLIA certification is on record for the partner. */
  ABSENT: 'clia_certification_absent',
  /**
   * A certification is on record but has not been (or cannot be) verified — the
   * "cannot be verified" branch of Req 30.2.
   */
  UNVERIFIABLE: 'clia_certification_unverifiable',
  /** The certification's expiration date is missing or unparseable. */
  INVALID_EXPIRY: 'clia_certification_invalid_expiry',
  /** The certification's expiration date is not later than the current date. */
  EXPIRED: 'clia_certification_expired',
} as const;

export type CliaVerificationFailureReason =
  (typeof CliaVerificationFailureReason)[keyof typeof CliaVerificationFailureReason];

/**
 * The compliance-control identifier stamped on every compliance indicator this
 * module records, so indicators from different controls (CLIA, BAA, residency)
 * are distinguishable.
 */
export const CLIA_COMPLIANCE_CONTROL = 'clia_certification' as const;
