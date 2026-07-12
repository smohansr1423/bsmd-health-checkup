/**
 * Deterministic total → cortisol burden tier mapping (Req 10.3).
 *
 * The mapping is:
 *  - total: a given score always maps to exactly one tier via the fixed bands;
 *  - deterministic: the same score always yields the same tier.
 *
 * Because the fixed bands are contiguous and cover the full valid range, and
 * the score is clamped into range, every input yields exactly one tier.
 */

import { QUESTIONNAIRE_SCORE_RANGE, QUESTIONNAIRE_TIER_BANDS } from './constants';
import type { BurdenTier, QuestionnaireType } from './types';

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

/**
 * Map a questionnaire total score to exactly one cortisol burden tier using the
 * instrument's fixed threshold bands (Req 10.3). Scores are clamped into the
 * valid range so the mapping is total for every finite input.
 */
export function mapScoreToTier(
  type: QuestionnaireType,
  totalScore: number,
): BurdenTier {
  const range = QUESTIONNAIRE_SCORE_RANGE[type];
  const score = clamp(Math.round(totalScore), range.min, range.max);
  const bands = QUESTIONNAIRE_TIER_BANDS[type];

  const band = bands.find((b) => score >= b.min && score <= b.max);
  // Bands cover the full clamped range, so a band is always found; the fallback
  // keeps the function total even under future band-table edits.
  return band ? band.tier : bands[bands.length - 1].tier;
}
