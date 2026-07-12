/**
 * Stable, machine-readable error codes for the Questionnaire_Engine
 * `POST /questionnaire` flow (Req 10.1, 10.2).
 *
 * These are the `code` field of the structured error shape
 * `{ code, message, retryable, retainedState }`. Clients branch on them to
 * render the correct message and decide whether to retry.
 */
export const QuestionnaireErrorCode = {
  /** The submission referenced an unknown instrument (not PSS-10/GAD-7/PSQI). */
  UNKNOWN_INSTRUMENT: 'questionnaire_unknown_instrument',
  /**
   * One or more items are unanswered or out of range. The submission is
   * rejected, entered answers are retained, and the incomplete items are
   * reported (Req 10.2).
   */
  INCOMPLETE_SUBMISSION: 'questionnaire_incomplete_submission',
} as const;

export type QuestionnaireErrorCode =
  (typeof QuestionnaireErrorCode)[keyof typeof QuestionnaireErrorCode];
