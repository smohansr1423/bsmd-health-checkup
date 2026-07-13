import fc from 'fast-check';

import {
  QUESTIONNAIRE_ITEM_BOUNDS,
  QUESTIONNAIRE_ITEM_COUNT,
} from './constants';
import { NON_CLINICAL_FRAMING_TEXT, framingPrecedesTier, presentTier } from './framing';
import { handleQuestionnaireSubmission } from './handler';
import type {
  BurdenTier,
  QuestionnaireType,
  TierPresentation,
} from './types';

/**
 * Property 28: Non-clinical framing precedes the tier value
 * Validates: Requirements 10.4
 * Feature: calorie-cortisol-tool, Property 28
 *
 * For any presented cortisol burden tier, the non-clinical wellness framing
 * text appears adjacent to and before the tier value.
 *
 * The test exercises every path that can produce a tier presentation:
 *   1. `presentTier` directly, over all four tiers; and
 *   2. the full `handleQuestionnaireSubmission` path, over randomly generated
 *      complete, in-range submissions for each instrument (so the tier value is
 *      derived from real scoring rather than hand-picked).
 *
 * The ordering constraint is checked against an INDEPENDENT restatement of
 * Req 10.4: the framing segment must exist, the tier segment must exist, the
 * framing segment must come strictly before the tier segment, they must be
 * adjacent, and the framing must carry the non-clinical wellness wording
 * ("wellness estimate", "not a medical diagnosis").
 */

const TIERS: readonly BurdenTier[] = ['Low', 'Moderate', 'Elevated', 'High'];
const INSTRUMENTS: readonly QuestionnaireType[] = ['PSS-10', 'GAD-7', 'PSQI'];

/**
 * Independent oracle for Req 10.4 — deliberately re-derives the framing-before-tier
 * ordering from the raw segment list rather than reusing the implementation's
 * `framingPrecedesTier`, so the two can disagree if the implementation drifts.
 */
function framingIsAdjacentAndBeforeTier(presentation: TierPresentation): boolean {
  const { segments } = presentation;
  const framingIndex = segments.findIndex((s) => s.kind === 'framing');
  const tierIndex = segments.findIndex((s) => s.kind === 'tier');

  if (framingIndex < 0 || tierIndex < 0) return false;
  if (framingIndex >= tierIndex) return false;
  // Adjacent: no segment sits between the framing and the tier value.
  if (tierIndex !== framingIndex + 1) return false;

  const framing = segments[framingIndex];
  const text = framing.kind === 'framing' ? framing.text.toLowerCase() : '';
  return text.includes('wellness estimate') && text.includes('not a medical diagnosis');
}

/** Generate a complete, in-range answer array for the given instrument. */
function arbCompleteAnswers(type: QuestionnaireType): fc.Arbitrary<number[]> {
  const { min, max } = QUESTIONNAIRE_ITEM_BOUNDS[type];
  return fc.array(fc.integer({ min, max }), {
    minLength: QUESTIONNAIRE_ITEM_COUNT[type],
    maxLength: QUESTIONNAIRE_ITEM_COUNT[type],
  });
}

const arbTier: fc.Arbitrary<BurdenTier> = fc.constantFrom(...TIERS);

describe('Property 28: Non-clinical framing precedes the tier value (Req 10.4)', () => {
  it('places the framing text adjacent to and before the tier value for any presented tier', () => {
    fc.assert(
      fc.property(arbTier, (tier) => {
        const presentation = presentTier(tier);
        expect(framingIsAdjacentAndBeforeTier(presentation)).toBe(true);
        // The implementation's own predicate must agree with the oracle.
        expect(framingPrecedesTier(presentation)).toBe(true);
        // The tier value in the presentation is the one that was presented.
        expect(presentation.tier).toBe(tier);
      }),
      { numRuns: 100 },
    );
  });

  it('never emits the tier value before its non-clinical framing (all four tiers)', () => {
    fc.assert(
      fc.property(arbTier, (tier) => {
        const { segments } = presentTier(tier);
        const framingIndex = segments.findIndex((s) => s.kind === 'framing');
        const tierIndex = segments.findIndex((s) => s.kind === 'tier');
        // Tier value must not appear at or before the framing text.
        expect(tierIndex).toBeGreaterThan(framingIndex);
      }),
      { numRuns: 100 },
    );
  });

  it('preserves framing-before-tier through the full scoring handler for any valid submission', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...INSTRUMENTS).chain((type) =>
          arbCompleteAnswers(type).map((answers) => ({ type, answers })),
        ),
        ({ type, answers }) => {
          const outcome = handleQuestionnaireSubmission({ type, answers });
          // A complete, in-range submission always scores successfully.
          expect(outcome.ok).toBe(true);
          if (!outcome.ok) return;

          const { presentation, result } = outcome;
          // The presentation's tier matches the scored tier.
          expect(presentation.tier).toBe(result.tier);
          // Ordering + wording invariant holds on the derived presentation.
          expect(framingIsAdjacentAndBeforeTier(presentation)).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('uses the canonical non-clinical framing text as the leading segment', () => {
    fc.assert(
      fc.property(arbTier, (tier) => {
        const presentation = presentTier(tier);
        expect(presentation.segments[0]).toEqual({
          kind: 'framing',
          text: NON_CLINICAL_FRAMING_TEXT,
        });
      }),
      { numRuns: 100 },
    );
  });
});
