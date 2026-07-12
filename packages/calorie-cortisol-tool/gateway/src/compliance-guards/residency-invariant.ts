/**
 * EU data-residency invariant (Req 30.6, 30.7).
 *
 * WHERE a user's country of residence is an EU member state, that user's data
 * must be stored and retained exclusively in data-center regions located within
 * the EU (Req 30.6). IF an EU-resident user's data is found stored outside an EU
 * region, further processing of that user's data is blocked and a
 * residency-violation compliance indicator is recorded (Req 30.7).
 *
 * A user who is not an EU resident is unconstrained by this invariant, so
 * processing is permitted with no indicator.
 *
 * All logic here is pure and testable: the caller supplies the user's residency
 * descriptor and the set of regions the user's data currently occupies. Region
 * classification is configurable via an injectable predicate, defaulting to the
 * canonical `eu-` region prefix.
 *
 * Requirements: 30.6, 30.7
 */

import {
  type ErrorContract,
  type Residency,
  validationRejection,
} from '@calorie-cortisol/shared';
import {
  COMPLIANCE_ERROR,
  ComplianceControl,
  type ComplianceIndicator,
  ResidencyFailureReason,
} from './errors';

// ---------------------------------------------------------------------------
// EU region classification
// ---------------------------------------------------------------------------

/**
 * The canonical prefix identifying an EU data-center region (e.g. `eu-west-1`,
 * `eu-central-1`, `eu-north-1`).
 */
export const EU_REGION_PREFIX = 'eu-';

/**
 * Default classification of a region as EU-located: case-insensitive, trimmed,
 * and matching the `eu-` prefix. Callers may inject their own predicate (e.g. an
 * explicit allow-list) via {@link enforceEuResidency}.
 */
export function isEuRegion(region: string): boolean {
  return region.trim().toLowerCase().startsWith(EU_REGION_PREFIX);
}

/** Predicate that classifies a region as EU-located. */
export type EuRegionPredicate = (region: string) => boolean;

// ---------------------------------------------------------------------------
// Domain shapes
// ---------------------------------------------------------------------------

/**
 * The residency state under evaluation: the user's residency descriptor and the
 * distinct regions in which the user's data is currently stored/retained
 * (Req 30.6).
 */
export interface DataResidencyState {
  readonly residency: Residency;
  /** Regions in which the user's data is currently stored/retained. */
  readonly storageRegions: readonly string[];
}

/** The EU data-residency decision for a user (Req 30.6, 30.7). */
export interface ResidencyDecision {
  readonly userId: string;
  /** Whether further processing of the user's data is permitted (Req 30.7). */
  readonly processingAllowed: boolean;
  /** The non-EU regions that triggered a violation, if any (Req 30.7). */
  readonly violatingRegions: readonly string[];
  /**
   * Present iff processing is blocked: the recorded residency-violation
   * compliance indicator (Req 30.7).
   */
  readonly complianceIndicator?: ComplianceIndicator;
  /**
   * Present iff processing is blocked: the structured error contract the
   * gateway returns to the caller.
   */
  readonly error?: ErrorContract;
}

// ---------------------------------------------------------------------------
// Invariant (Req 30.6, 30.7)
// ---------------------------------------------------------------------------

/**
 * Compute the non-EU regions among a user's storage regions (Req 30.6). A pure
 * helper: returns the distinct offending regions, preserving input order.
 */
export function findNonEuRegions(
  storageRegions: readonly string[],
  isEu: EuRegionPredicate = isEuRegion,
): string[] {
  const seen = new Set<string>();
  const offending: string[] = [];
  for (const region of storageRegions) {
    if (!isEu(region) && !seen.has(region)) {
      seen.add(region);
      offending.push(region);
    }
  }
  return offending;
}

/**
 * Enforce the EU data-residency invariant for a user (Req 30.6, 30.7).
 *
 * When the user is not an EU resident, processing is permitted unconditionally.
 * When the user is an EU resident, every region holding their data must be an
 * EU region; if any non-EU region is found, processing is blocked and a
 * residency-violation compliance indicator (listing the offending regions) is
 * produced, stamped with `now` as the recorded time (Req 30.7).
 */
export function enforceEuResidency(
  state: DataResidencyState,
  now: Date,
  isEu: EuRegionPredicate = isEuRegion,
): ResidencyDecision {
  const { residency, storageRegions } = state;

  // Non-EU residents are unconstrained by the EU residency invariant.
  if (!residency.euResident) {
    return {
      userId: residency.userId,
      processingAllowed: true,
      violatingRegions: [],
    };
  }

  const violatingRegions = findNonEuRegions(storageRegions, isEu);
  if (violatingRegions.length === 0) {
    return {
      userId: residency.userId,
      processingAllowed: true,
      violatingRegions: [],
    };
  }

  const message =
    `User ${residency.userId} is an EU resident but has data stored outside the EU ` +
    `(regions: ${violatingRegions.join(', ')}); further processing is blocked.`;

  return {
    userId: residency.userId,
    processingAllowed: false,
    violatingRegions,
    complianceIndicator: {
      control: ComplianceControl.RESIDENCY,
      reason: ResidencyFailureReason.EU_DATA_OUTSIDE_EU,
      subjectId: residency.userId,
      message,
      recordedAt: now.toISOString(),
      details: { violatingRegions },
    },
    // Prior state preserved; the same request fails again until the data is
    // relocated to an EU region — a validation rejection.
    error: validationRejection(COMPLIANCE_ERROR.RESIDENCY_BLOCKED, message),
  };
}

/**
 * Convenience predicate for callers that only need to know whether processing
 * is permitted for a user, without the indicator (Req 30.6, 30.7).
 */
export function isProcessingAllowed(
  state: DataResidencyState,
  isEu: EuRegionPredicate = isEuRegion,
): boolean {
  return (
    !state.residency.euResident ||
    findNonEuRegions(state.storageRegions, isEu).length === 0
  );
}
