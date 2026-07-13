/**
 * Property 27: Tier mapping is total and deterministic.
 *
 * Feature: calorie-cortisol-tool, Property 27
 * Validates: Requirements 10.3
 *
 * *For any* valid questionnaire score, the mapping to a cortisol burden tier
 * (Low, Moderate, Elevated, High) yields exactly one tier and always the same
 * tier for the same score, using the fixed threshold bands.
 *
 * This exercises {@link mapScoreToTier} for the Questionnaire_Engine
 * (task 9.11). The property is decomposed into the two guarantees Req 10.3
 * makes about the mapping:
 *   - **total**: every in-range score (and, since the score is clamped, every
 *     finite score) maps to exactly one of the four known tiers via the fixed
 *     bands — never `undefined` and never an unknown value; and
 *   - **deterministic**: the same score always yields the same tier, regardless
 *     of how many times it is evaluated.
 */

import fc from 'fast-check';

import { QUESTIONNAIRE_SCORE_RANGE, QUESTIONNAIRE_TIER_BANDS } from './constants';
import { mapScoreToTier } from './tiers';
import type { BurdenTier, QuestionnaireType } from './types';

const NUM_RUNS = 100; // ≥100 iterations per task 9.13.

const INSTRUMENTS: QuestionnaireType[] = ['PSS-10', 'GAD-7', 'PSQI'];
const TIERS: readonly BurdenTier[] = ['Low', 'Moderate', 'Elevated', 'High'];

/** A questionnaire type paired with a score inside its valid range (Req 10.1/10.3). */
const arbTypeAndInRangeScore = fc
  .constantFrom<QuestionnaireType>(...INSTRUMENTS)
  .chain((type) => {
    const range = QUESTIONNAIRE_SCORE_RANGE[type];
    return fc.record({
      type: fc.constant(type),
      score: fc.integer({ min: range.min, max: range.max }),
    });
  });

describe('Property 27: tier mapping is total and deterministic (Req 10.3) [Feature: calorie-cortisol-tool, Property 27]', () => {
  it('maps every valid score to exactly one known burden tier (total)', () => {
    fc.assert(
      fc.property(arbTypeAndInRangeScore, ({ type, score }) => {
        const tier = mapScoreToTier(type, score);

        // Exactly one tier, drawn from the known, fixed set of four.
        expect(TIERS).toContain(tier);

        // The chosen tier is exactly the band that contains the score, and it
        // is the only band that does so (no ambiguity → "exactly one").
        const bands = QUESTIONNAIRE_TIER_BANDS[type];
        const matching = bands.filter((b) => score >= b.min && score <= b.max);
        expect(matching).toHaveLength(1);
        expect(tier).toBe(matching[0].tier);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('yields the same tier for the same score across repeated evaluations (deterministic)', () => {
    fc.assert(
      fc.property(
        arbTypeAndInRangeScore,
        fc.integer({ min: 2, max: 6 }),
        ({ type, score }, repeats) => {
          const first = mapScoreToTier(type, score);
          for (let i = 0; i < repeats; i += 1) {
            expect(mapScoreToTier(type, score)).toBe(first);
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('remains total for arbitrary finite (including out-of-range) scores via clamping', () => {
    fc.assert(
      fc.property(
        fc.constantFrom<QuestionnaireType>(...INSTRUMENTS),
        fc.integer({ min: -10_000, max: 10_000 }),
        (type, score) => {
          // Even outside the valid range, the mapping is defined and total:
          // it always returns one of the four known tiers, never undefined.
          const tier = mapScoreToTier(type, score);
          expect(TIERS).toContain(tier);

          const range = QUESTIONNAIRE_SCORE_RANGE[type];
          if (score <= range.min) expect(tier).toBe('Low');
          if (score >= range.max) expect(tier).toBe('High');
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
