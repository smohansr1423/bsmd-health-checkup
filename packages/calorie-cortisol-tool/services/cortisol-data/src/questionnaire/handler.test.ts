import { QuestionnaireErrorCode } from './errors';
import { NON_CLINICAL_FRAMING_TEXT } from './framing';
import { handleQuestionnaireSubmission } from './handler';
import type { QuestionnaireSubmission } from './types';

describe('handleQuestionnaireSubmission — success (Req 10.1, 10.3, 10.4)', () => {
  it('scores a complete GAD-7 submission and presents framing before the tier', () => {
    const submission: QuestionnaireSubmission = {
      type: 'GAD-7',
      answers: [3, 3, 3, 3, 3, 3, 3],
      userId: 'u-1',
    };
    const outcome = handleQuestionnaireSubmission(submission);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    expect(outcome.result.totalScore).toBe(21);
    expect(outcome.result.tier).toBe('High');
    // Non-clinical framing precedes the tier value (Req 10.4).
    expect(outcome.presentation.segments[0]).toEqual({
      kind: 'framing',
      text: NON_CLINICAL_FRAMING_TEXT,
    });
    expect(outcome.presentation.segments[1]).toEqual({ kind: 'tier', value: 'High' });
  });

  it('maps a low GAD-7 total to the Low tier', () => {
    const outcome = handleQuestionnaireSubmission({
      type: 'GAD-7',
      answers: [0, 0, 0, 0, 0, 0, 0],
    });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.result.totalScore).toBe(0);
      expect(outcome.result.tier).toBe('Low');
    }
  });
});

describe('handleQuestionnaireSubmission — incomplete (Req 10.2)', () => {
  it('rejects a submission with unanswered items and retains the answers', () => {
    const answers = [3, 3, null, 3, 3, undefined, 3];
    const outcome = handleQuestionnaireSubmission({ type: 'GAD-7', answers });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;

    expect(outcome.error.code).toBe(QuestionnaireErrorCode.INCOMPLETE_SUBMISSION);
    expect(outcome.error.retainedState).toBe(true);
    expect(outcome.error.retryable).toBe(false);
    expect(outcome.incompleteItems).toEqual([2, 5]);
    // Answers are retained unchanged (Req 10.2).
    expect(outcome.retainedAnswers).toBe(answers);
  });

  it('rejects an unknown instrument', () => {
    const outcome = handleQuestionnaireSubmission({
      type: 'BDI' as unknown as QuestionnaireSubmission['type'],
      answers: [],
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error.code).toBe(QuestionnaireErrorCode.UNKNOWN_INSTRUMENT);
      expect(outcome.error.retainedState).toBe(true);
    }
  });
});
