/**
 * Proxy-questionnaire re-prompt scheduling (Req 10.5, 10.6).
 *
 *  - Req 10.5: prompt when 30 calendar days have elapsed since the last
 *    completed proxy questionnaire.
 *  - Req 10.6: if the user has never completed a proxy questionnaire, prompt on
 *    first access to the stress-tracking feature.
 *
 * All functions are pure: given the same inputs they always return the same
 * result (no reliance on the ambient clock).
 */

import { REPROMPT_INTERVAL_DAYS } from './constants';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface RepromptContext {
  /** ISO timestamp of the last completed proxy questionnaire, or null if none. */
  readonly lastCompletedAt: string | null;
  /** The reference "now" as an ISO timestamp. */
  readonly now: string;
  /** Whether the user is (or is about to be) accessing the stress feature. */
  readonly hasAccessedStressFeature: boolean;
}

/** Whole calendar days elapsed between two ISO timestamps (floored, ≥ 0). */
function daysElapsed(fromIso: string, toIso: string): number {
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  if (Number.isNaN(from) || Number.isNaN(to)) return 0;
  return Math.max(0, Math.floor((to - from) / MS_PER_DAY));
}

/**
 * Whether the user should be prompted to complete the proxy questionnaire
 * (Req 10.5, 10.6).
 */
export function shouldPromptQuestionnaire(context: RepromptContext): boolean {
  if (context.lastCompletedAt === null) {
    // Never completed → prompt on first access to the stress feature (Req 10.6).
    return context.hasAccessedStressFeature;
  }
  // Completed before → prompt once the interval has elapsed (Req 10.5).
  return daysElapsed(context.lastCompletedAt, context.now) >= REPROMPT_INTERVAL_DAYS;
}

/**
 * The ISO timestamp at which the next re-prompt becomes due after a completion
 * (Req 10.5): the completion time plus the re-prompt interval.
 */
export function nextPromptDate(lastCompletedAt: string): string {
  const base = Date.parse(lastCompletedAt);
  if (Number.isNaN(base)) {
    throw new Error(`Invalid ISO timestamp: ${lastCompletedAt}`);
  }
  return new Date(base + REPROMPT_INTERVAL_DAYS * MS_PER_DAY).toISOString();
}
