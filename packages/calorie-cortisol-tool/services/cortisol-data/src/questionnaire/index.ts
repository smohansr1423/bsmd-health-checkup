/**
 * Questionnaire_Engine (Req 10): PSS-10 / GAD-7 / PSQI scoring, deterministic
 * tier mapping, non-clinical framing, and re-prompt scheduling.
 *
 * Entry point: {@link handleQuestionnaireSubmission} implements `POST
 * /questionnaire`. Scoring, tier mapping, framing, and re-prompt logic are pure
 * and independently testable.
 */
export * from './types';
export * from './constants';
export * from './errors';
export * from './scoring';
export * from './tiers';
export * from './framing';
export * from './reprompt';
export * from './handler';
