/**
 * Shared domain constants — the field-level constraints from the design's
 * Data Models section, expressed once so guards and downstream services agree.
 *
 * These mirror the constraints called out in requirements 2.2, 3.x, 4.5, 5.1,
 * 8.x, 9.4, 10.x, 15.x, 17.1, and 19.1.
 */

/** Per-item recognition confidence range, inclusive (Req 2.2). */
export const CONFIDENCE_MIN = 0;
export const CONFIDENCE_MAX = 100;

/** Confidence at/above which a detection is auto-classified (Req 2.3/2.7). */
export const CONFIDENCE_AUTO_THRESHOLD = 70;

/** Maximum number of detected/logged items in a single meal (Req 2.2 / Meal.items 0..20). */
export const MAX_MEAL_ITEMS = 20;

/** Portion multiplier bounds and step (Req 5.1). */
export const PORTION_MULTIPLIER_MIN = 0.25;
export const PORTION_MULTIPLIER_MAX = 3.0;
export const PORTION_MULTIPLIER_STEP = 0.25;

/** Wearable/patch reading value bounds in the reported unit (Req 9.4). */
export const READING_VALUE_MIN = 0.01;
export const READING_VALUE_MAX = 100.0;

/** Maximum members in a single family account (Req 19.1). */
export const MAX_FAMILY_MEMBERS = 5;

/** Consecutive-day logging streak bounds (Req 6.4/6.5). */
export const STREAK_MIN = 0;
export const STREAK_MAX = 3650;

/** Correlation alignment window in minutes, inclusive (Req 15.1). */
export const ALIGNMENT_WINDOW_MINUTES = 180;

/** Correlation significance gates (Req 15.3/15.4). */
export const SIGNIFICANCE_MIN_PAIRS = 20;
export const SIGNIFICANCE_MIN_ABS_COEFFICIENT = 0.5;
export const SIGNIFICANCE_MAX_P_VALUE = 0.05;

/** Guidance recommendation-card count bounds (Req 13.1). */
export const GUIDANCE_MIN_CARDS = 1;
export const GUIDANCE_MAX_CARDS = 5;

/** Valid total-score ranges per questionnaire instrument (Req 10.1). */
export const QUESTIONNAIRE_SCORE_RANGE = {
  'PSS-10': { min: 0, max: 40 },
  'GAD-7': { min: 0, max: 21 },
  PSQI: { min: 0, max: 21 },
} as const;

/** Expected item counts per questionnaire instrument (Req 10.2). */
export const QUESTIONNAIRE_ITEM_COUNT = {
  'PSS-10': 10,
  'GAD-7': 7,
  PSQI: 19,
} as const;
