import { QUESTIONNAIRE_SCORE_RANGE, QUESTIONNAIRE_TIER_BANDS } from './constants';
import { mapScoreToTier } from './tiers';
import type { BurdenTier, QuestionnaireType } from './types';

const INSTRUMENTS: QuestionnaireType[] = ['PSS-10', 'GAD-7', 'PSQI'];
const TIERS: BurdenTier[] = ['Low', 'Moderate', 'Elevated', 'High'];

describe('mapScoreToTier is total and deterministic (Req 10.3)', () => {
  it('maps every score in the valid range to exactly one known tier', () => {
    for (const type of INSTRUMENTS) {
      const range = QUESTIONNAIRE_SCORE_RANGE[type];
      for (let score = range.min; score <= range.max; score += 1) {
        const tier = mapScoreToTier(type, score);
        expect(TIERS).toContain(tier);
      }
    }
  });

  it('returns the same tier for the same score (deterministic)', () => {
    for (const type of INSTRUMENTS) {
      const range = QUESTIONNAIRE_SCORE_RANGE[type];
      for (let score = range.min; score <= range.max; score += 1) {
        expect(mapScoreToTier(type, score)).toBe(mapScoreToTier(type, score));
      }
    }
  });

  it('produces monotonically non-decreasing tiers as score increases', () => {
    for (const type of INSTRUMENTS) {
      const range = QUESTIONNAIRE_SCORE_RANGE[type];
      let prev = -1;
      for (let score = range.min; score <= range.max; score += 1) {
        const rank = TIERS.indexOf(mapScoreToTier(type, score));
        expect(rank).toBeGreaterThanOrEqual(prev);
        prev = rank;
      }
    }
  });

  it('clamps out-of-range scores into the valid band', () => {
    expect(mapScoreToTier('GAD-7', -100)).toBe('Low');
    expect(mapScoreToTier('GAD-7', 999)).toBe('High');
  });

  it('honors the documented band boundaries for GAD-7', () => {
    expect(mapScoreToTier('GAD-7', 4)).toBe('Low');
    expect(mapScoreToTier('GAD-7', 5)).toBe('Moderate');
    expect(mapScoreToTier('GAD-7', 9)).toBe('Moderate');
    expect(mapScoreToTier('GAD-7', 10)).toBe('Elevated');
    expect(mapScoreToTier('GAD-7', 14)).toBe('Elevated');
    expect(mapScoreToTier('GAD-7', 15)).toBe('High');
  });
});

describe('tier bands cover the full range contiguously (Req 10.3)', () => {
  it('has no gaps or overlaps and spans the valid range', () => {
    for (const type of INSTRUMENTS) {
      const range = QUESTIONNAIRE_SCORE_RANGE[type];
      const bands = QUESTIONNAIRE_TIER_BANDS[type];
      expect(bands[0].min).toBe(range.min);
      expect(bands[bands.length - 1].max).toBe(range.max);
      for (let i = 1; i < bands.length; i += 1) {
        expect(bands[i].min).toBe(bands[i - 1].max + 1);
      }
    }
  });
});
