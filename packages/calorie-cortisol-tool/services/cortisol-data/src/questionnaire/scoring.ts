/**
 * Pure scoring logic for the validated questionnaires (Req 10.1, 10.2).
 *
 * `findIncompleteItems` implements the completeness/validity gate (Req 10.2):
 * a submission is rejected if any item is unanswered or out of its response
 * range. `computeTotalScore` maps a fully-answered submission to a total score
 * that is guaranteed to lie within the instrument's valid range (Req 10.1).
 *
 * All functions are pure and deterministic — the same input always yields the
 * same output.
 */

import {
  PSQI_COMPONENT_ITEM_GROUPS,
  PSS10_REVERSE_ITEM_INDICES,
  QUESTIONNAIRE_ITEM_BOUNDS,
  QUESTIONNAIRE_ITEM_COUNT,
  QUESTIONNAIRE_SCORE_RANGE,
} from './constants';
import type { Answer, QuestionnaireType } from './types';

/** Whether `type` is one of the supported instruments. */
export function isKnownInstrument(type: string): type is QuestionnaireType {
  return type === 'PSS-10' || type === 'GAD-7' || type === 'PSQI';
}

/** Whether a raw answer is a present, finite number. */
function isAnswered(value: Answer): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Return the 0-based indices of items that are unanswered or out of range for
 * the instrument (Req 10.2). An empty array means the submission is complete
 * and every answer is within its response scale.
 *
 * Missing trailing items (a short answer array) are reported as incomplete
 * indices up to the expected item count.
 */
export function findIncompleteItems(
  type: QuestionnaireType,
  answers: ReadonlyArray<Answer>,
): number[] {
  const expected = QUESTIONNAIRE_ITEM_COUNT[type];
  const bounds = QUESTIONNAIRE_ITEM_BOUNDS[type];
  const incomplete: number[] = [];

  for (let i = 0; i < expected; i += 1) {
    const value = answers[i];
    if (!isAnswered(value) || value < bounds.min || value > bounds.max) {
      incomplete.push(i);
    }
  }
  // Extra answers beyond the expected count are also invalid submissions.
  for (let i = expected; i < answers.length; i += 1) {
    incomplete.push(i);
  }
  return incomplete;
}

/**
 * Whether every item is answered and in range for the instrument (Req 10.2).
 */
export function isComplete(
  type: QuestionnaireType,
  answers: ReadonlyArray<Answer>,
): boolean {
  return (
    answers.length === QUESTIONNAIRE_ITEM_COUNT[type] &&
    findIncompleteItems(type, answers).length === 0
  );
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

/** PSS-10: reverse-score the positively-stated items, then sum (0–40). */
function scorePss10(answers: readonly number[]): number {
  const { max } = QUESTIONNAIRE_ITEM_BOUNDS['PSS-10'];
  const reverse = new Set(PSS10_REVERSE_ITEM_INDICES);
  return answers.reduce(
    (sum, value, index) => sum + (reverse.has(index) ? max - value : value),
    0,
  );
}

/** GAD-7: straight sum of the 7 items (0–21). */
function scoreGad7(answers: readonly number[]): number {
  return answers.reduce((sum, value) => sum + value, 0);
}

/**
 * PSQI: sum of 7 component scores (each the clamped, rounded mean of its items),
 * yielding a global score in 0–21.
 */
function scorePsqi(answers: readonly number[]): number {
  const { max } = QUESTIONNAIRE_ITEM_BOUNDS.PSQI;
  return PSQI_COMPONENT_ITEM_GROUPS.reduce((total, group) => {
    const mean = group.reduce((s, idx) => s + answers[idx], 0) / group.length;
    return total + clamp(Math.round(mean), 0, max);
  }, 0);
}

/**
 * Compute the total score for a complete submission (Req 10.1). The caller MUST
 * ensure the submission is complete (see {@link isComplete}); the result is
 * clamped to the instrument's valid range as a defensive guarantee.
 */
export function computeTotalScore(
  type: QuestionnaireType,
  answers: readonly number[],
): number {
  let raw: number;
  switch (type) {
    case 'PSS-10':
      raw = scorePss10(answers);
      break;
    case 'GAD-7':
      raw = scoreGad7(answers);
      break;
    case 'PSQI':
      raw = scorePsqi(answers);
      break;
  }
  const range = QUESTIONNAIRE_SCORE_RANGE[type];
  return clamp(raw, range.min, range.max);
}
