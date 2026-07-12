import { REPROMPT_INTERVAL_DAYS } from './constants';
import { nextPromptDate, shouldPromptQuestionnaire } from './reprompt';

const iso = (y: number, m: number, d: number): string =>
  new Date(Date.UTC(y, m - 1, d)).toISOString();

describe('shouldPromptQuestionnaire — never completed (Req 10.6)', () => {
  it('prompts on first access to the stress feature', () => {
    expect(
      shouldPromptQuestionnaire({
        lastCompletedAt: null,
        now: iso(2024, 1, 1),
        hasAccessedStressFeature: true,
      }),
    ).toBe(true);
  });

  it('does not prompt before the stress feature is accessed', () => {
    expect(
      shouldPromptQuestionnaire({
        lastCompletedAt: null,
        now: iso(2024, 1, 1),
        hasAccessedStressFeature: false,
      }),
    ).toBe(false);
  });
});

describe('shouldPromptQuestionnaire — previously completed (Req 10.5)', () => {
  it('does not prompt before 30 days have elapsed', () => {
    expect(
      shouldPromptQuestionnaire({
        lastCompletedAt: iso(2024, 1, 1),
        now: iso(2024, 1, 30), // 29 days later
        hasAccessedStressFeature: true,
      }),
    ).toBe(false);
  });

  it('prompts once exactly 30 days have elapsed', () => {
    expect(
      shouldPromptQuestionnaire({
        lastCompletedAt: iso(2024, 1, 1),
        now: iso(2024, 1, 31), // 30 days later
        hasAccessedStressFeature: false,
      }),
    ).toBe(true);
  });

  it('prompts after more than 30 days', () => {
    expect(
      shouldPromptQuestionnaire({
        lastCompletedAt: iso(2024, 1, 1),
        now: iso(2024, 3, 1),
        hasAccessedStressFeature: true,
      }),
    ).toBe(true);
  });
});

describe('nextPromptDate (Req 10.5)', () => {
  it('is the completion time plus the re-prompt interval', () => {
    const completedAt = iso(2024, 1, 1);
    const expected = new Date(
      Date.parse(completedAt) + REPROMPT_INTERVAL_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();
    expect(nextPromptDate(completedAt)).toBe(expected);
  });

  it('throws on an invalid timestamp', () => {
    expect(() => nextPromptDate('not-a-date')).toThrow();
  });
});
