/**
 * Fixed, deterministic scoring and tier-band constants for the three validated
 * questionnaires (Req 10.1, 10.3).
 *
 * The item counts and total-score ranges mirror the shared contract
 * (`QUESTIONNAIRE_ITEM_COUNT` / `QUESTIONNAIRE_SCORE_RANGE`). All bands are
 * fixed data so a given score always maps to the same tier (Req 10.3).
 */

import type { BurdenTier, QuestionnaireType } from './types';

/** Expected item counts per instrument (Req 10.2). */
export const QUESTIONNAIRE_ITEM_COUNT: Record<QuestionnaireType, number> = {
  'PSS-10': 10,
  'GAD-7': 7,
  PSQI: 19,
};

/**
 * Inclusive per-item answer bounds on the item's response scale. Any answer
 * outside these bounds is treated as invalid so that computed totals are
 * guaranteed to stay within the instrument's valid range (Req 10.1).
 */
export const QUESTIONNAIRE_ITEM_BOUNDS: Record<
  QuestionnaireType,
  { min: number; max: number }
> = {
  'PSS-10': { min: 0, max: 4 },
  'GAD-7': { min: 0, max: 3 },
  PSQI: { min: 0, max: 3 },
};

/** Valid total-score ranges per instrument (Req 10.1). */
export const QUESTIONNAIRE_SCORE_RANGE: Record<
  QuestionnaireType,
  { min: number; max: number }
> = {
  'PSS-10': { min: 0, max: 40 },
  'GAD-7': { min: 0, max: 21 },
  PSQI: { min: 0, max: 21 },
};

/**
 * PSS-10 positively-stated items are reverse scored (`reversed = max - value`).
 * These are items 4, 5, 7, and 8 (1-based) → 0-based indices below.
 */
export const PSS10_REVERSE_ITEM_INDICES: readonly number[] = [3, 4, 6, 7];

/**
 * PSQI global score is the sum of 7 component scores (each 0–3). This groups
 * the 19 self-rated items (0-based indices) into those components. Each
 * component score is the clamped, rounded mean of its items, keeping the global
 * score within 0–21 (Req 10.1). This is a simplified, deterministic proxy of
 * the PSQI component model appropriate to the v1.0 general-wellness scope.
 */
export const PSQI_COMPONENT_ITEM_GROUPS: readonly (readonly number[])[] = [
  [0], // C1 subjective sleep quality
  [1, 2], // C2 sleep latency
  [3], // C3 sleep duration
  [4, 5], // C4 habitual sleep efficiency
  [6, 7, 8, 9, 10, 11, 12, 13, 14], // C5 sleep disturbances
  [15], // C6 use of sleep medication
  [16, 17, 18], // C7 daytime dysfunction
];

/**
 * A single fixed tier band, inclusive on both ends. Bands for an instrument are
 * contiguous and cover its entire valid score range, making the score → tier
 * mapping total (Req 10.3).
 */
export interface TierBand {
  readonly tier: BurdenTier;
  readonly min: number;
  readonly max: number;
}

/**
 * Fixed threshold bands per instrument (Req 10.3). Bands are ordered ascending
 * and jointly cover the full valid range with no gaps or overlaps.
 */
export const QUESTIONNAIRE_TIER_BANDS: Record<QuestionnaireType, readonly TierBand[]> = {
  // PSS-10 (0–40): higher = greater perceived stress.
  'PSS-10': [
    { tier: 'Low', min: 0, max: 13 },
    { tier: 'Moderate', min: 14, max: 20 },
    { tier: 'Elevated', min: 21, max: 26 },
    { tier: 'High', min: 27, max: 40 },
  ],
  // GAD-7 (0–21): minimal / mild / moderate / severe.
  'GAD-7': [
    { tier: 'Low', min: 0, max: 4 },
    { tier: 'Moderate', min: 5, max: 9 },
    { tier: 'Elevated', min: 10, max: 14 },
    { tier: 'High', min: 15, max: 21 },
  ],
  // PSQI (0–21): global score >5 indicates poorer sleep quality.
  PSQI: [
    { tier: 'Low', min: 0, max: 5 },
    { tier: 'Moderate', min: 6, max: 10 },
    { tier: 'Elevated', min: 11, max: 15 },
    { tier: 'High', min: 16, max: 21 },
  ],
};

/** Re-prompt interval for the proxy questionnaire (Req 10.5). */
export const REPROMPT_INTERVAL_DAYS = 30;
