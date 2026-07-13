import fc from 'fast-check';

import { isErr, isOk } from '@calorie-cortisol/shared/result';

import {
  CameraCapture,
  CaptureErrorCode,
  type CaptureMode,
  type CapturedMedia,
  type FoodRecognizer,
  type ImageEnhancer,
  type RecognitionOutcome,
  type SharpnessScorer,
  type SubmittableImage,
  type VideoFrame,
} from './index';

/**
 * Property-based test for failed-recognition input retention (Task 14.2).
 *
 * Feature: calorie-cortisol-tool, Property 1
 * Property 1: Failed recognition retains the captured input.
 *   For any capture, if recognition fails or times out, the captured image is
 *   retained and available for retry without recapture, and no partial result
 *   is stored. Conversely, a successful recognition produces the result and
 *   retains no input for retry.
 *
 * Validates: Requirements 1.2, 21.6
 */

// --- Injectable ports (no device/model dependency) -------------------------

/** Identity enhancer — capture logic under test never depends on pixel work. */
const noopEnhancer: ImageEnhancer = {
  enhance: (media: CapturedMedia): CapturedMedia => media,
};

/** Sharpness scorer is unused by `recognize`; a constant stub suffices. */
const noopScorer: SharpnessScorer = {
  score: (_frame: VideoFrame): number => 0,
};

/** A recognizer that deterministically returns the outcome it is given. */
function fixedRecognizer(outcome: RecognitionOutcome): FoodRecognizer {
  return { recognize: (): RecognitionOutcome => outcome };
}

// --- Generators ------------------------------------------------------------

const captureModeArb: fc.Arbitrary<CaptureMode> = fc.constantFrom(
  'single',
  'multiAngle',
  'gallery',
  'video',
);

/** Any normalized image that could be handed to recognition. */
const submittableImageArb: fc.Arbitrary<SubmittableImage> = fc.record({
  sourceId: fc.string({ minLength: 1, maxLength: 40 }),
  mode: captureModeArb,
  format: fc.constantFrom('jpeg', 'jpg', 'png', 'heic', 'heif', 'webp'),
  byteSize: fc.integer({ min: 0, max: 20 * 1024 * 1024 }),
  enhanced: fc.boolean(),
});

/** An unsuccessful recognition outcome: a failure (with/without reason) or a timeout. */
const unsuccessfulOutcomeArb: fc.Arbitrary<RecognitionOutcome> = fc.oneof(
  fc.constant<RecognitionOutcome>({ status: 'timedOut' }),
  fc.constant<RecognitionOutcome>({ status: 'failed' }),
  fc
    .string({ minLength: 1, maxLength: 60 })
    .map<RecognitionOutcome>((reason) => ({ status: 'failed', reason })),
);

/** An arbitrary recognized payload for the success branch. */
const recognizedResultArb: fc.Arbitrary<unknown> = fc.oneof(
  fc.record({ items: fc.array(fc.string(), { maxLength: 5 }) }),
  fc.constant(null),
  fc.integer(),
  fc.string(),
);

describe('Property 1: failed recognition retains the captured input [Feature: calorie-cortisol-tool, Property 1]', () => {
  it('retains the exact input for retry and stores no partial result when recognition fails or times out (Req 1.2, 21.6)', () => {
    fc.assert(
      fc.property(submittableImageArb, unsuccessfulOutcomeArb, (image, outcome) => {
        const capture = new CameraCapture(noopEnhancer, noopScorer);

        const attempt = capture.recognize(image, fixedRecognizer(outcome));

        // No partial result: the attempt is an error, never a success value.
        expect(isOk(attempt.outcome)).toBe(false);
        expect(isErr(attempt.outcome)).toBe(true);

        // The captured input is retained and available for retry, byte-for-byte
        // identical to what was submitted — no recapture required (Req 1.2).
        expect(attempt.retainedInput).toEqual(image);

        if (isErr(attempt.outcome)) {
          const { error } = attempt.outcome;
          // The structured error signals that local state was preserved (no
          // partial artifact) so the client keeps the input for retry.
          expect(error.retainedState).toBe(true);

          // The error is classified by the terminal outcome and is retryable
          // (the same retained input can be re-submitted) (Req 21.6).
          if (outcome.status === 'timedOut') {
            expect(error.code).toBe(CaptureErrorCode.RecognitionTimedOut);
            expect(error.retryable).toBe(true);
          } else {
            expect(error.code).toBe(CaptureErrorCode.RecognitionFailed);
          }
        }
      }),
      { numRuns: 100 },
    );
  });

  it('produces the result and retains nothing for retry when recognition succeeds (Req 1.2)', () => {
    fc.assert(
      fc.property(submittableImageArb, recognizedResultArb, (image, result) => {
        const capture = new CameraCapture(noopEnhancer, noopScorer);

        const attempt = capture.recognize(
          image,
          fixedRecognizer({ status: 'recognized', result }),
        );

        // Success yields the recognized result with no retained input: there is
        // nothing to retry, so no captured input is held (Req 1.2).
        expect(isOk(attempt.outcome)).toBe(true);
        expect(attempt.retainedInput).toBeUndefined();
        if (isOk(attempt.outcome)) {
          expect(attempt.outcome.value).toEqual(result);
        }
      }),
      { numRuns: 100 },
    );
  });
});
