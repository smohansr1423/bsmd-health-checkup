import { isErr, isOk } from '@calorie-cortisol/shared/result';
import { CarErrorCode } from './errors';
import {
  CAR_FLATTENED_THRESHOLD_PCT,
  classifyCar,
  classifyEvening,
  computeIncreasePct,
  isSample1InWindow,
  isSample2InWindow,
  minutesBetween,
  processCarSubmission,
  type CarSubmission,
} from './car';

/**
 * Focused unit tests for CAR window validation and diurnal deviation
 * classification (Req 11.1, 11.2, 11.3, 11.5, 11.6). The optional property
 * tests (Properties 29/30) are tasks 9.16/9.17.
 */

const WAKE = '2024-03-01T06:00:00.000Z';

/** Build an ISO timestamp `minutes` after the fixed wake time. */
function afterWake(minutes: number): string {
  return new Date(Date.parse(WAKE) + minutes * 60_000).toISOString();
}

/** Build an ISO timestamp `minutes` after an arbitrary base ISO timestamp. */
function after(baseIso: string, minutes: number): string {
  return new Date(Date.parse(baseIso) + minutes * 60_000).toISOString();
}

describe('minutesBetween / parsing', () => {
  it('computes signed minute differences', () => {
    expect(minutesBetween(WAKE, afterWake(30))).toBe(30);
    expect(minutesBetween(afterWake(30), WAKE)).toBe(-30);
  });

  it('returns null for unparseable timestamps', () => {
    expect(minutesBetween('not-a-date', WAKE)).toBeNull();
    expect(minutesBetween(WAKE, '')).toBeNull();
  });
});

describe('isSample1InWindow (Req 11.1, 11.2)', () => {
  it('accepts samples from wake time up to 35 minutes after', () => {
    expect(isSample1InWindow(WAKE, afterWake(0))).toBe(true);
    expect(isSample1InWindow(WAKE, afterWake(30))).toBe(true);
    expect(isSample1InWindow(WAKE, afterWake(35))).toBe(true);
  });

  it('rejects samples later than 35 minutes after wake', () => {
    expect(isSample1InWindow(WAKE, afterWake(35.5))).toBe(false);
    expect(isSample1InWindow(WAKE, afterWake(60))).toBe(false);
  });

  it('rejects samples taken before wake time', () => {
    expect(isSample1InWindow(WAKE, afterWake(-1))).toBe(false);
  });
});

describe('isSample2InWindow (Req 11.1, 11.2)', () => {
  const s1 = afterWake(30);

  it('accepts samples 25 to 35 minutes after sample 1', () => {
    expect(isSample2InWindow(s1, after(s1, 25))).toBe(true);
    expect(isSample2InWindow(s1, after(s1, 30))).toBe(true);
    expect(isSample2InWindow(s1, after(s1, 35))).toBe(true);
  });

  it('rejects samples outside the 25-35 minute window', () => {
    expect(isSample2InWindow(s1, after(s1, 24))).toBe(false);
    expect(isSample2InWindow(s1, after(s1, 36))).toBe(false);
  });
});

describe('computeIncreasePct', () => {
  it('computes a percentage rise', () => {
    expect(computeIncreasePct(10, 15)).toBeCloseTo(50);
    expect(computeIncreasePct(10, 14)).toBeCloseTo(40);
  });

  it('guards a non-positive baseline', () => {
    expect(computeIncreasePct(0, 5)).toBe(Number.POSITIVE_INFINITY);
    expect(computeIncreasePct(0, 0)).toBe(0);
  });
});

describe('classifyEvening (Req 11.6)', () => {
  it('raises an alert only when the sample exceeds the reference upper bound', () => {
    expect(classifyEvening({ value: 12, referenceUpper: 10 })?.cause).toBe(
      'elevated_evening_cortisol',
    );
    expect(classifyEvening({ value: 10, referenceUpper: 10 })).toBeNull();
    expect(classifyEvening({ value: 5, referenceUpper: 10 })).toBeNull();
  });
});

describe('classifyCar (Req 11.3, 11.5, 11.6)', () => {
  it('withholds evaluation with fewer than two valid samples', () => {
    const evaluation = classifyCar({ sample1: { at: afterWake(5), value: 8 } });
    expect(evaluation.status).toBe('incomplete');
    expect(evaluation.increasePct).toBeUndefined();
    expect(evaluation.message).toMatch(/incomplete/i);
    expect(evaluation.alerts).toHaveLength(0);
  });

  it('flags a flattened CAR when the rise is below 50%', () => {
    const evaluation = classifyCar({
      sample1: { at: afterWake(5), value: 10 },
      sample2: { at: afterWake(35), value: 14 }, // +40%
    });
    expect(evaluation.status).toBe('flattened');
    expect(evaluation.increasePct).toBeLessThan(CAR_FLATTENED_THRESHOLD_PCT);
    expect(evaluation.alerts.map((a) => a.cause)).toContain('flattened_car');
  });

  it('marks a healthy CAR complete when the rise is at least 50%', () => {
    const evaluation = classifyCar({
      sample1: { at: afterWake(5), value: 10 },
      sample2: { at: afterWake(35), value: 16 }, // +60%
    });
    expect(evaluation.status).toBe('complete');
    expect(evaluation.alerts).toHaveLength(0);
  });

  it('raises an elevated-evening alert alongside a complete CAR', () => {
    const evaluation = classifyCar(
      {
        sample1: { at: afterWake(5), value: 10 },
        sample2: { at: afterWake(35), value: 16 },
      },
      { value: 9, referenceUpper: 8 },
    );
    expect(evaluation.status).toBe('complete');
    expect(evaluation.alerts.map((a) => a.cause)).toContain(
      'elevated_evening_cortisol',
    );
  });

  it('can raise both flattened and elevated-evening alerts', () => {
    const evaluation = classifyCar(
      {
        sample1: { at: afterWake(5), value: 10 },
        sample2: { at: afterWake(35), value: 11 }, // +10%
      },
      { value: 12, referenceUpper: 8 },
    );
    const causes = evaluation.alerts.map((a) => a.cause);
    expect(causes).toContain('flattened_car');
    expect(causes).toContain('elevated_evening_cortisol');
  });
});

describe('processCarSubmission (Req 11.1, 11.2, 11.3)', () => {
  const base: CarSubmission = { userId: 'u1', wakeTime: WAKE };

  it('rejects a request with no userId', () => {
    const result = processCarSubmission({ ...base, userId: '' });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.code).toBe(CarErrorCode.INVALID_REQUEST);
    }
  });

  it('rejects a request with an invalid wake time', () => {
    const result = processCarSubmission({ ...base, wakeTime: 'nope' });
    expect(isErr(result)).toBe(true);
  });

  it('accepts an in-window sample 1 and withholds evaluation (Req 11.3)', () => {
    const result = processCarSubmission({
      ...base,
      sample1: { at: afterWake(20), value: 8 },
    });
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.measurement.sample1).toBeDefined();
      expect(result.value.rejections).toHaveLength(0);
      expect(result.value.evaluation.status).toBe('incomplete');
    }
  });

  it('rejects an out-of-window sample 1 while retaining prior samples (Req 11.2)', () => {
    const priorSample1 = { at: afterWake(10), value: 8 };
    const result = processCarSubmission({
      ...base,
      existing: { sample1: priorSample1 },
      sample1: { at: afterWake(50), value: 9 }, // out of window
    });
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      // The prior accepted sample 1 is retained unchanged.
      expect(result.value.measurement.sample1).toEqual(priorSample1);
      expect(result.value.rejections).toHaveLength(1);
      expect(result.value.rejections[0].code).toBe(
        CarErrorCode.SAMPLE1_OUT_OF_WINDOW,
      );
      expect(result.value.rejections[0].retainedState).toBe(true);
    }
  });

  it('accepts a full in-window pair and classifies it', () => {
    const s1At = afterWake(15);
    const result = processCarSubmission({
      ...base,
      sample1: { at: s1At, value: 10 },
      sample2: { at: after(s1At, 30), value: 20 }, // +100%
    });
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.rejections).toHaveLength(0);
      expect(result.value.measurement.status).toBe('complete');
      expect(result.value.evaluation.increasePct).toBeCloseTo(100);
    }
  });

  it('rejects an out-of-window sample 2 while keeping sample 1 (Req 11.2)', () => {
    const s1At = afterWake(15);
    const result = processCarSubmission({
      ...base,
      sample1: { at: s1At, value: 10 },
      sample2: { at: after(s1At, 10), value: 20 }, // too soon
    });
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.measurement.sample1).toBeDefined();
      expect(result.value.measurement.sample2).toBeUndefined();
      expect(result.value.rejections[0].code).toBe(
        CarErrorCode.SAMPLE2_OUT_OF_WINDOW,
      );
      expect(result.value.evaluation.status).toBe('incomplete');
    }
  });

  it('rejects a sample 2 submitted without an accepted sample 1', () => {
    const result = processCarSubmission({
      ...base,
      sample2: { at: afterWake(45), value: 20 },
    });
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.rejections[0].code).toBe(
        CarErrorCode.SAMPLE2_WITHOUT_SAMPLE1,
      );
    }
  });
});
