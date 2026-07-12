import {
  QUESTIONNAIRE_ITEM_BOUNDS,
  QUESTIONNAIRE_ITEM_COUNT,
  QUESTIONNAIRE_SCORE_RANGE,
} from './constants';
import {
  computeTotalScore,
  findIncompleteItems,
  isComplete,
  isKnownInstrument,
} from './scoring';
import type { QuestionnaireType } from './types';

const INSTRUMENTS: QuestionnaireType[] = ['PSS-10', 'GAD-7', 'PSQI'];

const filled = (type: QuestionnaireType, value: number): number[] =>
  new Array(QUESTIONNAIRE_ITEM_COUNT[type]).fill(value);

describe('isKnownInstrument', () => {
  it('accepts the three validated instruments and rejects others', () => {
    expect(isKnownInstrument('PSS-10')).toBe(true);
    expect(isKnownInstrument('GAD-7')).toBe(true);
    expect(isKnownInstrument('PSQI')).toBe(true);
    expect(isKnownInstrument('BDI')).toBe(false);
    expect(isKnownInstrument('')).toBe(false);
  });
});

describe('findIncompleteItems / isComplete (Req 10.2)', () => {
  it('reports no incomplete items for a fully, in-range answered submission', () => {
    for (const type of INSTRUMENTS) {
      expect(findIncompleteItems(type, filled(type, 1))).toEqual([]);
      expect(isComplete(type, filled(type, 1))).toBe(true);
    }
  });

  it('flags unanswered items (null / undefined / NaN)', () => {
    const answers = filled('GAD-7', 2) as (number | null | undefined)[];
    answers[0] = null;
    answers[3] = undefined;
    answers[6] = Number.NaN;
    expect(findIncompleteItems('GAD-7', answers)).toEqual([0, 3, 6]);
    expect(isComplete('GAD-7', answers)).toBe(false);
  });

  it('flags out-of-range answers as incomplete', () => {
    const bounds = QUESTIONNAIRE_ITEM_BOUNDS['PSS-10'];
    const answers = filled('PSS-10', 1);
    answers[2] = bounds.max + 1;
    answers[5] = bounds.min - 1;
    expect(findIncompleteItems('PSS-10', answers)).toEqual([2, 5]);
  });

  it('flags a short answer array as missing the trailing items', () => {
    expect(findIncompleteItems('GAD-7', [0, 1, 2])).toEqual([3, 4, 5, 6]);
  });

  it('flags extra answers beyond the expected item count', () => {
    const answers = [...filled('GAD-7', 1), 1];
    expect(findIncompleteItems('GAD-7', answers)).toEqual([7]);
  });
});

describe('computeTotalScore stays within valid range (Req 10.1)', () => {
  it('produces min/max totals at the response extremes for every instrument', () => {
    for (const type of INSTRUMENTS) {
      const range = QUESTIONNAIRE_SCORE_RANGE[type];
      const bounds = QUESTIONNAIRE_ITEM_BOUNDS[type];
      const allMin = computeTotalScore(type, filled(type, bounds.min));
      const allMax = computeTotalScore(type, filled(type, bounds.max));
      expect(allMin).toBeGreaterThanOrEqual(range.min);
      expect(allMax).toBeLessThanOrEqual(range.max);
    }
  });
});

describe('GAD-7 scoring', () => {
  it('is the straight sum of items (0–21)', () => {
    expect(computeTotalScore('GAD-7', [0, 0, 0, 0, 0, 0, 0])).toBe(0);
    expect(computeTotalScore('GAD-7', [3, 3, 3, 3, 3, 3, 3])).toBe(21);
    expect(computeTotalScore('GAD-7', [1, 2, 3, 0, 1, 2, 0])).toBe(9);
  });
});

describe('PSS-10 scoring (reverse-scored items)', () => {
  it('applies reverse scoring for the uniform-answer extremes', () => {
    // 6 non-reversed + 4 reversed items. All-zero: reversed contribute 4 each.
    expect(computeTotalScore('PSS-10', new Array(10).fill(0))).toBe(16);
    // All-4: non-reversed contribute 4 each; reversed contribute 0.
    expect(computeTotalScore('PSS-10', new Array(10).fill(4))).toBe(24);
  });

  it('reverse-scores items 4,5,7,8 (0-based 3,4,6,7)', () => {
    // Only a reversed item is non-zero: value 1 → contributes (4 - 1) = 3.
    const answers = new Array(10).fill(0);
    answers[3] = 1;
    expect(computeTotalScore('PSS-10', answers)).toBe(4 + 4 + 4 + 3); // three untouched reversed (4 each) + this one (3)
  });

  it('maximizes stress when non-reversed items are high and reversed items are low', () => {
    const answers = new Array(10).fill(0);
    // non-reversed indices 0,1,2,5,8,9 set to max (4)
    [0, 1, 2, 5, 8, 9].forEach((i) => {
      answers[i] = 4;
    });
    // reversed indices 3,4,6,7 left at 0 → each contributes 4
    expect(computeTotalScore('PSS-10', answers)).toBe(6 * 4 + 4 * 4);
    expect(computeTotalScore('PSS-10', answers)).toBe(40);
  });
});

describe('PSQI scoring (7-component model)', () => {
  it('reaches 0 and 21 at the extremes', () => {
    expect(computeTotalScore('PSQI', new Array(19).fill(0))).toBe(0);
    expect(computeTotalScore('PSQI', new Array(19).fill(3))).toBe(21);
  });

  it('rounds each component mean and clamps to 0–3', () => {
    // Disturbance component (indices 6..14) averaged; set half to 3 half to 0.
    const answers = new Array(19).fill(0);
    [6, 7, 8, 9].forEach((i) => {
      answers[i] = 3;
    });
    // component mean = (4*3)/9 ≈ 1.33 → rounds to 1
    expect(computeTotalScore('PSQI', answers)).toBe(1);
  });
});
