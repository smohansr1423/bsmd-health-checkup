/**
 * Stable, machine-readable identifiers for the gateway's PHI-exchange BAA gate
 * and EU data-residency invariant (Req 30.3, 30.6, 30.7).
 *
 * These mirror the compliance-indicator style already used by the Cortisol Data
 * service's CLIA lab-partner gate (task 9.22) so indicators recorded by every
 * compliance control share the same shape and are distinguishable by their
 * `control` field. The logic here lives in the gateway, where PHI exchange and
 * residency are enforced at the boundary (design: "Compliance by construction").
 */

// ---------------------------------------------------------------------------
// Compliance controls
// ---------------------------------------------------------------------------

/**
 * The compliance-control identifier stamped on every compliance indicator this
 * module records, so indicators from different controls (CLIA, BAA, residency)
 * are distinguishable.
 */
export const ComplianceControl = {
  /** PHI-exchange Business Associate Agreement gate (Req 30.3). */
  BAA: 'baa_agreement',
  /** EU data-residency invariant (Req 30.6, 30.7). */
  RESIDENCY: 'eu_data_residency',
} as const;

export type ComplianceControl =
  (typeof ComplianceControl)[keyof typeof ComplianceControl];

// ---------------------------------------------------------------------------
// BAA gate failure reasons (Req 30.3)
// ---------------------------------------------------------------------------

/** The reason a partner's BAA failed the PHI-exchange gate (Req 30.3). */
export const BaaFailureReason = {
  /** No Business Associate Agreement is on record for the partner. */
  ABSENT: 'baa_absent',
  /** A BAA is on record but has not been executed (signed). */
  NOT_EXECUTED: 'baa_not_executed',
  /** The BAA carries an effective window that has not begun yet. */
  NOT_YET_EFFECTIVE: 'baa_not_yet_effective',
  /** The BAA carries an effective window that has already ended. */
  EXPIRED: 'baa_expired',
} as const;

export type BaaFailureReason =
  (typeof BaaFailureReason)[keyof typeof BaaFailureReason];

// ---------------------------------------------------------------------------
// Residency failure reasons (Req 30.6, 30.7)
// ---------------------------------------------------------------------------

/** The reason an EU resident's data failed the residency invariant (Req 30.7). */
export const ResidencyFailureReason = {
  /** EU-resident data is stored/retained in one or more non-EU regions. */
  EU_DATA_OUTSIDE_EU: 'residency_eu_data_outside_eu',
} as const;

export type ResidencyFailureReason =
  (typeof ResidencyFailureReason)[keyof typeof ResidencyFailureReason];

/** The union of every failure reason a compliance indicator may carry. */
export type ComplianceFailureReason = BaaFailureReason | ResidencyFailureReason;

// ---------------------------------------------------------------------------
// Gateway error codes (structured error contract)
// ---------------------------------------------------------------------------

/**
 * Stable gateway error codes for blocked compliance outcomes. These populate
 * the shared structured `ErrorContract.code` returned to the caller when the
 * gate or invariant blocks an operation.
 */
export const COMPLIANCE_ERROR = {
  /** PHI exchange blocked: no executed BAA on record (Req 30.3). */
  BAA_REQUIRED: 'GATEWAY_BAA_REQUIRED',
  /** Processing blocked: EU-resident data found outside the EU (Req 30.7). */
  RESIDENCY_BLOCKED: 'GATEWAY_RESIDENCY_BLOCKED',
} as const;

// ---------------------------------------------------------------------------
// Compliance indicator (shared shape across BAA + residency controls)
// ---------------------------------------------------------------------------

/**
 * A recorded compliance indicator identifying a blocked compliance outcome
 * (Req 30.3, 30.7). Persisted/emitted by the caller; this module only
 * constructs it. Mirrors the CLIA gate's indicator shape for consistency.
 */
export interface ComplianceIndicator {
  /** Which compliance control produced this indicator. */
  readonly control: ComplianceControl;
  /** Machine-readable reason the operation was blocked. */
  readonly reason: ComplianceFailureReason;
  /** The subject the indicator concerns (a partner id or a user id). */
  readonly subjectId: string;
  /** Human-readable explanation for a compliance officer. */
  readonly message: string;
  /** ISO-8601 timestamp at which the blocked outcome was recorded. */
  readonly recordedAt: string;
  /** Optional structured detail (e.g. the offending non-EU regions). */
  readonly details?: Readonly<Record<string, unknown>>;
}
