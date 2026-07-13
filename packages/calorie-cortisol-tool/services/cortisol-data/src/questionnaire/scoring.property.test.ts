import fc from 'fast-check';

import {
  QUESTIONNAIRE_ITEM_BOUNDS,
  QUESTIONNAIRE_ITEM_COUNT,
  QUESTIONNAIRE_SCORE_RANGE,
} from './constants';
import { handleQuestionnaireSubmission } from './handler';
import type { Answer, QuestionnaireSubmission, QuestionnaireType } from './types';

/**
 * Property 26: Questionnaire scoring is bounded and complete-input gated
 * Validates: Requirements 10.1, 10.2
 * Feature: calorie-cortisol-tool, Property 26
 *
 * For any fully answered questionnaire, the total score lies within its defined
 * valid range (PSS-10 0–40, GAD-7 0–21, PSQI 0–21); any submission with one or
 * more unanswered items is rejected with the entered answers retained.
 *
 * The test drives the `POST /questionnaire` entry point
 * ({@link handleQuestionnaireSubmission}) across the full input space: every
 * instrument, every per-item answer within its response scale, and — for the
 * completeness gate (Req 10.2) — a range of corruptions (unanswered items,
 * out-of-range items, and short/long answer arrays).
 */

const INSTRUMENTS: readonly QuestionnaireType[] = ['PSS-10', 'GAD-7', 'PSQI'];

const arbInstrument: fc.Arbitrary<QuestionnaireType> = fc.constantFrom(...INSTRUMENTS);

/** A complete, in-range answer array for the given instrument. */
function arbCompleteAnswers(type: QuestionnaireType): fc.Arbitrary<number[]> {
  const count = QUESTIONNAIRE_ITEM_COUNT[type];
  const { min, max } = QUESTIONNAIRE_ITEM_BOUNDS[type];
  return fc.array(fc.integer({ min, max }), { minLength: count, maxLength: count });
}

/** An instrument paired with a complete, in-range set of answers. */
const arbCompleteSubmission: fc.Arbitrary<QuestionnaireSubmission> = arbInstrument.chain(
  (type) =>
    arbCompleteAnswers(type).map(
      (answers): QuestionnaireSubmission => ({ type, answers }),
    ),
);

/** The three ways a single item can be "unanswered" (Req 10.2). */
const arbUnansweredValue: fc.Arbitrary<Answer> = fc.constantFrom<Answer>(
  null,
  undefined,
  NaN,
);

describe('Property 26: Questionnaire scoring is bounded and complete-input gated (Req 10.1, 10.2)', () => {
  it('scores every complete submission to a total within the instrument valid range (Req 10.1)', () => {
    fc.assert(
      fc.property(arbCompleteSubmission, (submission) => {
        const outcome = handleQuestionnaireSubmission(submission);

        expect(outcome.ok).toBe(true);
        if (!outcome.ok) return;

        const range = QUESTIONNAIRE_SCORE_RANGE[submission.type];
        expect(Number.isInteger(outcome.result.totalScore)).toBe(true);
        expect(outcome.result.totalScore).toBeGreaterThanOrEqual(range.min);
        expect(outcome.result.totalScore).toBeLessThanOrEqual(range.max);
      }),
      { numRuns: 100 },
    );
  });

  it('rejects a submission with one or more unanswered items and retains entered answers (Req 10.2)', () => {
    const arbSubmissionWithUnansweredItems = arbInstrument.chain((type) => {
      const count = QUESTIONNAIRE_ITEM_COUNT[type];
      return fc
        .record({
          answers: arbCompleteAnswers(type),
          // Choose a non-empty set of item indices to blank out.
          missingIndices: fc.uniqueArray(fc.integer({ min: 0, max: count - 1 }), {
            minLength: 1,
            maxLength: count,
          }),
          unanswered: arbUnansweredValue,
        })
        .map(({ answers, missingIndices, unanswered }) => {
          const corrupted: Answer[] = [...answers];
          for (const idx of missingIndices) {
            corrupted[idx] = unanswered;
          }
          const submission: QuestionnaireSubmission = { type, answers: corrupted };
          return { submission, missingIndices };
        });
    });

    fc.assert(
      fc.property(arbSubmissionWithUnansweredItems, ({ submission, missingIndices }) => {
        const outcome = handleQuestionnaireSubmission(submission);

        // Rejected (Req 10.2).
        expect(outcome.ok).toBe(false);
        if (outcome.ok) return;

        // Entered answers retained unchanged.
        expect(outcome.retainedAnswers).toEqual(submission.answers);
        // Every blanked item is reported as incomplete.
        expect(outcome.incompleteItems.length).toBeGreaterThan(0);
        for (const idx of missingIndices) {
          expect(outcome.incompleteItems).toContain(idx);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('rejects a submission with an out-of-range item and retains entered answers (Req 10.2)', () => {
    const arbSubmissionWithOutOfRangeItem = arbInstrument.chain((type) => {
      const count = QUESTIONNAIRE_ITEM_COUNT[type];
      const { min, max } = QUESTIONNAIRE_ITEM_BOUNDS[type];
      return fc
        .record({
          answers: arbCompleteAnswers(type),
          index: fc.integer({ min: 0, max: count - 1 }),
          // A value strictly below min or strictly above max.
          outOfRange: fc.oneof(
            fc.integer({ min: min - 100, max: min - 1 }),
            fc.integer({ min: max + 1, max: max + 100 }),
          ),
        })
        .map(({ answers, index, outOfRange }) => {
          const corrupted: Answer[] = [...answers];
          corrupted[index] = outOfRange;
          const submission: QuestionnaireSubmission = { type, answers: corrupted };
          return { submission, index };
        });
    });

    fc.assert(
      fc.property(arbSubmissionWithOutOfRangeItem, ({ submission, index }) => {
        const outcome = handleQuestionnaireSubmission(submission);

        expect(outcome.ok).toBe(false);
        if (outcome.ok) return;

        expect(outcome.retainedAnswers).toEqual(submission.answers);
        expect(outcome.incompleteItems).toContain(index);
      }),
      { numRuns: 100 },
    );
  });

  it('rejects a submission whose answer count does not match the instrument (Req 10.2)', () => {
    const arbWrongLengthSubmission = arbInstrument.chain((type) => {
      const count = QUESTIONNAIRE_ITEM_COUNT[type];
      const { min, max } = QUESTIONNAIRE_ITEM_BOUNDS[type];
      // A length other than the expected item count (shorter or longer).
      return fc
        .integer({ min: 0, max: count * 2 })
        .filter((len) => len !== count)
        .chain((len) =>
          fc
            .array(fc.integer({ min, max }), { minLength: len, maxLength: len })
            .map((answers): QuestionnaireSubmission => ({ type, answers })),
        );
    });

    fc.assert(
      fc.property(arbWrongLengthSubmission, (submission) => {
        const outcome = handleQuestionnaireSubmission(submission);

        expect(outcome.ok).toBe(false);
        if (outcome.ok) return;

        expect(outcome.retainedAnswers).toEqual(submission.answers);
        expect(outcome.incompleteItems.length).toBeGreaterThan(0);
      }),
      { numRuns: 100 },
    );
  });
});
