import fc from 'fast-check';
import { isErr, isOk } from '@calorie-cortisol/shared/result';

import { CarErrorCode } from './errors';
import {
  CAR_SAMPLE1_MAX_OFFSET_MIN,
  CAR_SAMPLE1_MIN_OFFSET_MIN,
  CAR_SAMPLE2_MAX_DELTA_MIN,
  CAR_SAMPLE2_MIN_DELTA_MIN,
  isSample1InWindow,
  isSample2InWindow,
  processCarSubmission,
  type CarSubmission,
} from './car';

/**
 * Property 29: CAR sample window validation and completeness
 * Validates: Requirements 11.1, 11.2, 11.3
 * Feature: calorie-cortisol-tool, Property 29
 *
 * For any CAR measurement (Diurnal_Tracker `POST /car`, task 9.15):
 *  - sample 1 is accepted only within 30 min (±5) of wake time — i.e. an offset
 *    in [0, 35] minutes after the recorded wake time (Req 11.1, 11.2);
 *  - sample 2 is accepted only 25–35 minutes after the accepted sample 1
 *    (Req 11.1, 11.2);
 *  - an out-of-window sample is rejected while previously accepted samples are
 *    retained unchanged (Req 11.2);
 *  - with fewer than two valid samples, pattern evaluation is withheld and the
 *    measurement is reported incomplete (Req 11.3).
 *
 * Acceptance decisions are pinned against an INDEPENDENT oracle that encodes the
 * requirement's windows directly in whole seconds, so the two can disagree if
 * the implementation drifts from the requirement. Times are constructed in whole
 * seconds so millisecond arithmetic is exact and the ±5-minute boundaries
 * (0/2100 s for sample 1, 1500/2100 s for sample 2) are exercised cleanly.
 */

/** Fixed, parseable wake instant used as the base of each measurement. */
const WAKE_MS = Date.parse('2024-03-01T06:00:00.000Z');

/** Build an ISO timestamp `seconds` after an epoch-ms base. */
function isoAfterMs(baseMs: number, seconds: number): string {
  return new Date(baseMs + seconds * 1000).toISOString();
}

/** Sample 1 window as whole seconds: [0 min, 35 min] → [0 s, 2100 s]. */
const SAMPLE1_MIN_SEC = CAR_SAMPLE1_MIN_OFFSET_MIN * 60; // 0
const SAMPLE1_MAX_SEC = CAR_SAMPLE1_MAX_OFFSET_MIN * 60; // 2100

/** Sample 2 window as whole seconds: [25 min, 35 min] → [1500 s, 2100 s]. */
const SAMPLE2_MIN_SEC = CAR_SAMPLE2_MIN_DELTA_MIN * 60; // 1500
const SAMPLE2_MAX_SEC = CAR_SAMPLE2_MAX_DELTA_MIN * 60; // 2100

/** Independent oracle: is a sample-1 offset (seconds after wake) in window? */
function sample1AcceptedOracle(offsetSec: number): boolean {
  return offsetSec >= SAMPLE1_MIN_SEC && offsetSec <= SAMPLE1_MAX_SEC;
}

/** Independent oracle: is a sample-2 delta (seconds after sample 1) in window? */
function sample2AcceptedOracle(deltaSec: number): boolean {
  return deltaSec >= SAMPLE2_MIN_SEC && deltaSec <= SAMPLE2_MAX_SEC;
}

/**
 * Sample-1 offsets in seconds spanning before wake (negative → invalid), the
 * accepted band, and well past the 35-minute cutoff, so both sides of each
 * boundary are exercised.
 */
const arbSample1OffsetSec = fc.integer({ min: -600, max: 4800 });

/**
 * Sample-2 deltas in seconds spanning below 25 min, the accepted band, and past
 * 35 min after sample 1.
 */
const arbSample2DeltaSec = fc.integer({ min: 300, max: 4800 });

/** A finite, non-negative cortisol value. */
const arbValue = fc.double({ min: 0.1, max: 100, noNaN: true });

const USER_ID = 'car-user';

describe('Property 29: CAR sample window validation and completeness (Req 11.1, 11.2, 11.3)', () => {
  it('accepts sample 1 iff it is within 30 min (±5) of wake time (Req 11.1, 11.2)', () => {
    fc.assert(
      fc.property(arbSample1OffsetSec, arbValue, (offsetSec, value) => {
        const at = isoAfterMs(WAKE_MS, offsetSec);
        const wakeTime = isoAfterMs(WAKE_MS, 0);
        const expected = sample1AcceptedOracle(offsetSec);

        // Pure predicate agrees with the oracle.
        expect(isSample1InWindow(wakeTime, at)).toBe(expected);

        // Orchestration: accepted samples are retained; rejected ones surface a
        // structured out-of-window rejection and are not retained (Req 11.2).
        const submission: CarSubmission = {
          userId: USER_ID,
          wakeTime,
          sample1: { at, value },
        };
        const result = processCarSubmission(submission);
        expect(isOk(result)).toBe(true);
        if (isOk(result)) {
          if (expected) {
            expect(result.value.measurement.sample1).toEqual({ at, value });
            expect(result.value.rejections).toHaveLength(0);
          } else {
            expect(result.value.measurement.sample1).toBeUndefined();
            expect(result.value.rejections).toHaveLength(1);
            expect(result.value.rejections[0].code).toBe(
              CarErrorCode.SAMPLE1_OUT_OF_WINDOW,
            );
          }
        }
      }),
      { numRuns: 100 },
    );
  });

  it('accepts sample 2 iff it is 25–35 min after the accepted sample 1 (Req 11.1, 11.2)', () => {
    fc.assert(
      fc.property(
        // Keep sample 1 in-window so sample 2 is validated relative to it.
        fc.integer({ min: SAMPLE1_MIN_SEC, max: SAMPLE1_MAX_SEC }),
        arbSample2DeltaSec,
        arbValue,
        arbValue,
        (s1OffsetSec, deltaSec, v1, v2) => {
          const wakeTime = isoAfterMs(WAKE_MS, 0);
          const s1At = isoAfterMs(WAKE_MS, s1OffsetSec);
          const s1Ms = Date.parse(s1At);
          const s2At = isoAfterMs(s1Ms, deltaSec);
          const expected = sample2AcceptedOracle(deltaSec);

          // Pure predicate agrees with the oracle.
          expect(isSample2InWindow(s1At, s2At)).toBe(expected);

          const submission: CarSubmission = {
            userId: USER_ID,
            wakeTime,
            sample1: { at: s1At, value: v1 },
            sample2: { at: s2At, value: v2 },
          };
          const result = processCarSubmission(submission);
          expect(isOk(result)).toBe(true);
          if (isOk(result)) {
            // Sample 1 was in-window, so it is always retained (Req 11.2).
            expect(result.value.measurement.sample1).toEqual({
              at: s1At,
              value: v1,
            });
            if (expected) {
              expect(result.value.measurement.sample2).toEqual({
                at: s2At,
                value: v2,
              });
              expect(result.value.rejections).toHaveLength(0);
            } else {
              expect(result.value.measurement.sample2).toBeUndefined();
              expect(result.value.rejections).toHaveLength(1);
              expect(result.value.rejections[0].code).toBe(
                CarErrorCode.SAMPLE2_OUT_OF_WINDOW,
              );
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('rejects an out-of-window sample while retaining previously accepted samples (Req 11.2)', () => {
    fc.assert(
      fc.property(
        // A previously accepted (in-window) sample 1.
        fc.integer({ min: SAMPLE1_MIN_SEC, max: SAMPLE1_MAX_SEC }),
        // A new sample 1 offset that is out of window (strictly past 35 min).
        fc.integer({ min: SAMPLE1_MAX_SEC + 60, max: 7200 }),
        arbValue,
        arbValue,
        (priorOffsetSec, badOffsetSec, priorValue, newValue) => {
          const wakeTime = isoAfterMs(WAKE_MS, 0);
          const priorSample1 = {
            at: isoAfterMs(WAKE_MS, priorOffsetSec),
            value: priorValue,
          };
          const badAt = isoAfterMs(WAKE_MS, badOffsetSec);

          const result = processCarSubmission({
            userId: USER_ID,
            wakeTime,
            existing: { sample1: priorSample1 },
            sample1: { at: badAt, value: newValue },
          });

          expect(isOk(result)).toBe(true);
          if (isOk(result)) {
            // The previously accepted sample survives unchanged (Req 11.2)...
            expect(result.value.measurement.sample1).toEqual(priorSample1);
            // ...and the bad sample is reported as a retained-state rejection.
            expect(result.value.rejections).toHaveLength(1);
            expect(result.value.rejections[0].code).toBe(
              CarErrorCode.SAMPLE1_OUT_OF_WINDOW,
            );
            expect(result.value.rejections[0].retainedState).toBe(true);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('withholds pattern evaluation with fewer than two valid samples, evaluates with two (Req 11.3)', () => {
    fc.assert(
      fc.property(
        fc.boolean(), // provide a valid sample 1?
        fc.boolean(), // provide a valid sample 2?
        fc.integer({ min: SAMPLE1_MIN_SEC, max: SAMPLE1_MAX_SEC }),
        fc.integer({ min: SAMPLE2_MIN_SEC, max: SAMPLE2_MAX_SEC }),
        arbValue,
        arbValue,
        (withS1, withS2, s1OffsetSec, deltaSec, v1, v2) => {
          const wakeTime = isoAfterMs(WAKE_MS, 0);
          const s1At = isoAfterMs(WAKE_MS, s1OffsetSec);
          const s2At = isoAfterMs(Date.parse(s1At), deltaSec);

          const submission: CarSubmission = {
            userId: USER_ID,
            wakeTime,
            ...(withS1 ? { sample1: { at: s1At, value: v1 } } : {}),
            // Sample 2 can only ever be accepted when sample 1 is present.
            ...(withS2 && withS1 ? { sample2: { at: s2At, value: v2 } } : {}),
          };

          const result = processCarSubmission(submission);
          expect(isOk(result)).toBe(true);
          if (isOk(result)) {
            const { measurement, evaluation } = result.value;
            const validCount =
              (measurement.sample1 ? 1 : 0) + (measurement.sample2 ? 1 : 0);

            if (validCount < 2) {
              // Evaluation is withheld: status incomplete, no increase, message.
              expect(evaluation.status).toBe('incomplete');
              expect(evaluation.increasePct).toBeUndefined();
              expect(evaluation.message).toMatch(/incomplete/i);
            } else {
              // Two valid samples → evaluation proceeds (not withheld).
              expect(evaluation.status).not.toBe('incomplete');
              expect(evaluation.increasePct).toBeDefined();
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('rejects the whole request for an invalid wake time (Req 11.1)', () => {
    fc.assert(
      fc.property(
        fc.string().filter((s) => Number.isNaN(Date.parse(s))),
        arbValue,
        (badWake, value) => {
          const result = processCarSubmission({
            userId: USER_ID,
            wakeTime: badWake,
            sample1: { at: isoAfterMs(WAKE_MS, 600), value },
          });
          expect(isErr(result)).toBe(true);
          if (isErr(result)) {
            expect(result.error.code).toBe(CarErrorCode.INVALID_REQUEST);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
