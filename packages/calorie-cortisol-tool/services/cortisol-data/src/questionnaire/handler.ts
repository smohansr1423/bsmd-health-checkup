/**
 * `POST /questionnaire` handler for the Questionnaire_Engine (Req 10.1–10.4).
 *
 * The handler is a pure function of its request: it validates completeness
 * (Req 10.2), computes the bounded total score (Req 10.1), maps it to a single
 * deterministic tier (Req 10.3), and returns the tier wrapped in an ordered
 * presentation whose non-clinical framing precedes the tier value (Req 10.4).
 *
 * No HTTP framework is wired into this service yet; this pure handler is the
 * unit of logic a route (or GraphQL resolver) will call. Re-prompt scheduling
 * (Req 10.5, 10.6) lives in `./reprompt`.
 */

import { QuestionnaireErrorCode } from './errors';
import { presentTier } from './framing';
import { computeTotalScore, findIncompleteItems, isKnownInstrument } from './scoring';
import { mapScoreToTier } from './tiers';
import type {
  QuestionnaireError,
  QuestionnaireOutcome,
  QuestionnaireSubmission,
} from './types';

/** Build a validation-rejection error (`retainedState: true`, not retryable as-is). */
function rejection(code: string, message: string): QuestionnaireError {
  return { code, message, retryable: false, retainedState: true };
}

/**
 * Score a questionnaire submission (Req 10.1–10.4).
 *
 * On success returns the scored result plus the ordered tier presentation.
 * On an incomplete/invalid submission returns a rejection that retains the
 * entered answers and lists the offending item indices (Req 10.2).
 */
export function handleQuestionnaireSubmission(
  submission: QuestionnaireSubmission,
): QuestionnaireOutcome {
  const { type, answers } = submission;

  if (!isKnownInstrument(type)) {
    return {
      ok: false,
      error: rejection(
        QuestionnaireErrorCode.UNKNOWN_INSTRUMENT,
        `Unknown questionnaire instrument: ${String(type)}.`,
      ),
      incompleteItems: [],
      retainedAnswers: answers,
    };
  }

  const incompleteItems = findIncompleteItems(type, answers);
  if (incompleteItems.length > 0) {
    return {
      ok: false,
      error: rejection(
        QuestionnaireErrorCode.INCOMPLETE_SUBMISSION,
        `Submission is incomplete: ${incompleteItems.length} item(s) unanswered or out of range.`,
      ),
      // Answers are retained unchanged so the client can restore in-progress work.
      incompleteItems,
      retainedAnswers: answers,
    };
  }

  // Safe: completeness guarantees every item is a present, in-range number.
  const normalized = answers.map((a) => a as number);
  const totalScore = computeTotalScore(type, normalized);
  const tier = mapScoreToTier(type, totalScore);

  return {
    ok: true,
    result: { type, answers: normalized, totalScore, tier },
    presentation: presentTier(tier),
  };
}
