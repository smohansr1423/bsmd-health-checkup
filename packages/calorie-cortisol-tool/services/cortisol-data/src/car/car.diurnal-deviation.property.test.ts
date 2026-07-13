import fc from 'fast-check';
import { isOk } from '@calorie-cortisol/shared/result';

import {
  CAR_FLATTENED_THRESHOLD_PCT,
  classifyCar,
  processCarSubmission,
  type CarSubmission,
  type EveningSample,
} from './car';

/**
 * Property 30: Diurnal deviation classification
 * Validates: Requirements 11.5, 11.6
 * Feature: calorie-cortisol-tool, Property 30
 *
 * For any COMPLETE CAR measurement (both waking and +30-minute samples present),
 * the Diurnal_Tracker classification (task 9.15) must satisfy two biconditionals:
 *
 *  - Flattened CAR (Req 11.5): the pattern is classified as flattened AND a
 *    deviation alert identifying the flattened CAR is raised IF AND ONLY IF the
 *    percentage increase from the waking sample to the +30-minute sample is
 *    below 50%.
 *  - Elevated evening cortisol (Req 11.6): an elevated-evening deviation alert
 *    is raised IF AND ONLY IF the evening sample strictly exceeds the upper
 *    bound of the age-matched reference range.
 *
 * Each direction is pinned against an INDEPENDENT oracle. The flattened oracle
 * is expressed multiplicatively (`s2 < 1.5 * s1`) rather than reusing the
 * implementation's percentage arithmetic, so the two disagree if the
 * implementation drifts from the 50% requirement. The evening oracle encodes the
 * strict `>` comparison of Req 11.6 directly.
 */

/** A finite, strictly-positive cortisol value (baseline is well-defined). */
const arbPositiveValue = fc.double({ min: 0.1, max: 200, noNaN: true });

/** Independent oracle: is a rise from s1 to s2 flattened (< 50% increase)? */
function isFlattenedOracle(s1: number, s2: number): boolean {
  // Equivalent to ((s2 - s1) / s1) * 100 < 50, computed differently so the
  // oracle is genuinely independent of the implementation's arithmetic.
  return s2 < 1.5 * s1;
}

/** Independent oracle: is the evening sample elevated (strictly above upper)? */
function isEveningElevatedOracle(value: number, referenceUpper: number): boolean {
  return value > referenceUpper;
}

const USER_ID = 'car-user';
const WAKE_ISO = '2024-03-01T06:00:00.000Z';
const SAMPLE1_ISO = '2024-03-01T06:05:00.000Z';
const SAMPLE2_ISO = '2024-03-01T06:35:00.000Z';

describe('Property 30: Diurnal deviation classification (Req 11.5, 11.6)', () => {
  it('classifies a flattened CAR (with alert) iff the waking→+30min increase is below 50% (Req 11.5)', () => {
    fc.assert(
      fc.property(arbPositiveValue, arbPositiveValue, (s1, s2) => {
        const evaluation = classifyCar({
          sample1: { at: SAMPLE1_ISO, value: s1 },
          sample2: { at: SAMPLE2_ISO, value: s2 },
        });

        const expectedFlattened = isFlattenedOracle(s1, s2);

        // Two valid samples → evaluation proceeds (never withheld here).
        expect(evaluation.status).not.toBe('incomplete');
        expect(evaluation.increasePct).toBeDefined();

        const hasFlattenedAlert = evaluation.alerts.some(
          (a) => a.cause === 'flattened_car',
        );

        // Biconditional: flattened status, flattened alert, and the oracle agree.
        expect(evaluation.status === 'flattened').toBe(expectedFlattened);
        expect(hasFlattenedAlert).toBe(expectedFlattened);

        if (expectedFlattened) {
          // The raised alert identifies the flattened CAR as the cause (Req 11.5).
          const alert = evaluation.alerts.find((a) => a.cause === 'flattened_car');
          expect(alert).toBeDefined();
          expect(alert?.message).toMatch(/flatten/i);
          expect(evaluation.increasePct).toBeLessThan(CAR_FLATTENED_THRESHOLD_PCT);
        } else {
          expect(evaluation.status).toBe('complete');
          expect(evaluation.increasePct).toBeGreaterThanOrEqual(
            CAR_FLATTENED_THRESHOLD_PCT,
          );
        }
      }),
      { numRuns: 100 },
    );
  });

  it('raises an elevated-evening alert iff the evening sample exceeds the age-matched reference upper bound (Req 11.6)', () => {
    fc.assert(
      fc.property(
        arbPositiveValue,
        arbPositiveValue,
        arbPositiveValue,
        arbPositiveValue,
        (s1, s2, eveningValue, referenceUpper) => {
          const evening: EveningSample = { value: eveningValue, referenceUpper };
          const evaluation = classifyCar(
            {
              sample1: { at: SAMPLE1_ISO, value: s1 },
              sample2: { at: SAMPLE2_ISO, value: s2 },
            },
            evening,
          );

          const expectedElevated = isEveningElevatedOracle(
            eveningValue,
            referenceUpper,
          );
          const hasEveningAlert = evaluation.alerts.some(
            (a) => a.cause === 'elevated_evening_cortisol',
          );

          // Biconditional against the independent strict-comparison oracle.
          expect(hasEveningAlert).toBe(expectedElevated);

          if (expectedElevated) {
            const alert = evaluation.alerts.find(
              (a) => a.cause === 'elevated_evening_cortisol',
            );
            expect(alert).toBeDefined();
            expect(alert?.message).toMatch(/evening/i);
          }

          // The elevated-evening decision is independent of the flattened
          // decision: the flattened alert tracks its own oracle regardless.
          const hasFlattenedAlert = evaluation.alerts.some(
            (a) => a.cause === 'flattened_car',
          );
          expect(hasFlattenedAlert).toBe(isFlattenedOracle(s1, s2));
        },
      ),
      { numRuns: 100 },
    );
  });

  it('withholds classification for an incomplete measurement but still evaluates an elevated evening sample (Req 11.6)', () => {
    // Even when the CAR is incomplete (Req 11.3), an evening sample above the
    // reference upper bound must still raise the elevated-evening alert (Req 11.6).
    fc.assert(
      fc.property(
        fc.boolean(),
        arbPositiveValue,
        arbPositiveValue,
        arbPositiveValue,
        (withSample1, s1, eveningValue, referenceUpper) => {
          const evening: EveningSample = { value: eveningValue, referenceUpper };
          const evaluation = classifyCar(
            withSample1
              ? { sample1: { at: SAMPLE1_ISO, value: s1 }, sample2: undefined }
              : { sample1: undefined, sample2: undefined },
            evening,
          );

          expect(evaluation.status).toBe('incomplete');
          expect(evaluation.increasePct).toBeUndefined();
          // No flattened alert is possible without two samples.
          expect(
            evaluation.alerts.some((a) => a.cause === 'flattened_car'),
          ).toBe(false);

          const expectedElevated = isEveningElevatedOracle(
            eveningValue,
            referenceUpper,
          );
          expect(
            evaluation.alerts.some(
              (a) => a.cause === 'elevated_evening_cortisol',
            ),
          ).toBe(expectedElevated);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('surfaces the same classification through the POST /car orchestration (Req 11.5, 11.6)', () => {
    // End-to-end: with in-window samples, processCarSubmission must carry the
    // same flattened/elevated-evening classification as the pure classifier.
    fc.assert(
      fc.property(
        arbPositiveValue,
        arbPositiveValue,
        arbPositiveValue,
        arbPositiveValue,
        (s1, s2, eveningValue, referenceUpper) => {
          const submission: CarSubmission = {
            userId: USER_ID,
            wakeTime: WAKE_ISO,
            sample1: { at: SAMPLE1_ISO, value: s1 },
            sample2: { at: SAMPLE2_ISO, value: s2 },
            evening: { value: eveningValue, referenceUpper },
          };

          const result = processCarSubmission(submission);
          expect(isOk(result)).toBe(true);
          if (isOk(result)) {
            const { evaluation, rejections } = result.value;
            // Both samples are in-window, so nothing is rejected.
            expect(rejections).toHaveLength(0);

            const expectedFlattened = isFlattenedOracle(s1, s2);
            const expectedElevated = isEveningElevatedOracle(
              eveningValue,
              referenceUpper,
            );

            expect(evaluation.status === 'flattened').toBe(expectedFlattened);
            expect(
              evaluation.alerts.some((a) => a.cause === 'flattened_car'),
            ).toBe(expectedFlattened);
            expect(
              evaluation.alerts.some(
                (a) => a.cause === 'elevated_evening_cortisol',
              ),
            ).toBe(expectedElevated);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
