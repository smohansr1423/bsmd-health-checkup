/**
 * Age/sex/time-of-day reference-range classification (Req 8.5, design
 * Property 21 + `ReferenceContext`).
 *
 * WHEN results are ingested AND the user's age and sex are available, each
 * reading is contextualized against a reference range appropriate to the user's
 * age band, sex, and the time-of-day bucket of collection, and classified as
 * `below` / `normal` / `above`.
 *
 * The concrete range values below are plausible salivary-cortisol ranges
 * (nmol/L) that follow the expected diurnal shape (highest in the morning,
 * lowest in the evening). They are defined here as the single source of truth so
 * the classification behaviour is deterministic and testable; clinical tuning of
 * the numbers does not change the classification logic.
 */

import type {
  Classification,
  ReferenceContext,
  Sex,
  TimeOfDayBucket,
} from '@calorie-cortisol/shared';

/** A closed reference interval in nmol/L. */
export interface ReferenceRange {
  readonly refLower: number;
  readonly refUpper: number;
}

/** Coarse age bands used for reference-range selection. */
export type AgeBand = '0-17' | '18-64' | '65+';

/** Map an age in years to its reference age band. */
export function resolveAgeBand(age: number): AgeBand {
  if (age < 18) return '0-17';
  if (age < 65) return '18-64';
  return '65+';
}

/**
 * Base adult (18–64) salivary-cortisol reference ranges by time-of-day bucket,
 * in nmol/L. Ordered so that refLower ≤ refUpper always holds.
 */
const ADULT_BASE_RANGES: Readonly<Record<TimeOfDayBucket, ReferenceRange>> = {
  morning: { refLower: 5.0, refUpper: 23.0 },
  noon: { refLower: 2.0, refUpper: 12.0 },
  afternoon: { refLower: 1.5, refUpper: 8.0 },
  evening: { refLower: 0.5, refUpper: 4.0 },
};

/**
 * Multiplicative adjustment applied to the adult base range per age band.
 * Children/adolescents and seniors trend slightly higher on the upper bound;
 * factors keep ranges ordered and positive.
 */
const AGE_BAND_FACTOR: Readonly<Record<AgeBand, { lower: number; upper: number }>> = {
  '0-17': { lower: 1.0, upper: 1.1 },
  '18-64': { lower: 1.0, upper: 1.0 },
  '65+': { lower: 1.05, upper: 1.15 },
};

/**
 * Small additive nmol/L adjustment to the upper bound by sex. Kept modest and
 * documented; `other` uses the neutral (female-baseline) range.
 */
const SEX_UPPER_DELTA: Readonly<Record<Sex, number>> = {
  M: 0.5,
  F: 0.0,
  other: 0.0,
};

/**
 * Resolve the reference range for a given age band, sex, and time-of-day
 * bucket. Always returns an ordered interval (refLower ≤ refUpper).
 */
export function resolveReferenceRange(
  ageBand: AgeBand,
  sex: Sex,
  bucket: TimeOfDayBucket,
): ReferenceRange {
  const base = ADULT_BASE_RANGES[bucket];
  const ageFactor = AGE_BAND_FACTOR[ageBand];
  const refLower = base.refLower * ageFactor.lower;
  const refUpper = base.refUpper * ageFactor.upper + SEX_UPPER_DELTA[sex];
  return {
    refLower: Number(refLower.toFixed(4)),
    refUpper: Number(refUpper.toFixed(4)),
  };
}

/**
 * Classify a value against a reference range. The reference interval is
 * inclusive: a value on either bound is `normal`.
 */
export function classifyAgainstRange(
  valueNmolL: number,
  range: ReferenceRange,
): Classification {
  if (valueNmolL < range.refLower) return 'below';
  if (valueNmolL > range.refUpper) return 'above';
  return 'normal';
}

/** Demographic inputs required to contextualize a reading (Req 8.5). */
export interface UserDemographics {
  /** Age in whole years. */
  age?: number;
  sex?: Sex;
}

/**
 * Build the full {@link ReferenceContext} for a reading, or return `null` when
 * age or sex is unavailable (Req 8.5 applies only when both are known).
 */
export function contextualizeReading(
  valueNmolL: number,
  bucket: TimeOfDayBucket,
  demographics: UserDemographics,
): ReferenceContext | null {
  const { age, sex } = demographics;
  if (age === undefined || !Number.isFinite(age) || sex === undefined) {
    return null;
  }
  const ageBand = resolveAgeBand(age);
  const range = resolveReferenceRange(ageBand, sex, bucket);
  return {
    ageBand,
    sex,
    refLower: range.refLower,
    refUpper: range.refUpper,
    classification: classifyAgainstRange(valueNmolL, range),
  };
}
