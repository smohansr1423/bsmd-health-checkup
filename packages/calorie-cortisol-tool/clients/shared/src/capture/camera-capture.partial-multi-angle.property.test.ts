/**
 * Property 2: Partial multi-angle capture is never submitted.
 *
 * Feature: calorie-cortisol-tool, Property 2
 * Validates: Requirements 1.5
 *
 * *For any* multi-angle session exited before all 3 shots are captured (0, 1,
 * or 2 valid shots), the partial image set is discarded and nothing is
 * submitted for volume reconstruction.
 *
 * This exercises {@link MultiAngleCaptureSession} produced by
 * {@link CameraCapture.startMultiAngleSession} (Camera_Capture, task 14.1).
 * The property is decomposed into the guarantees Req 1.5 makes:
 *   - **never submitted while incomplete**: no accepted-shot progress ever
 *     carries a `submission` and the session never reports `isComplete` while
 *     fewer than 3 valid shots have been captured; and
 *   - **discarded on exit**: exiting an incomplete session (via `close()` or
 *     `abandon()`) yields a `discarded` outcome carrying no submission, and the
 *     retained partial shots are cleared to zero.
 *
 * Invalid shots (outside the current ±10° window) are interspersed to confirm
 * they are rejected without advancing the session and without ever producing a
 * submission.
 */

import { isErr, isOk } from '@calorie-cortisol/shared/result';
import fc from 'fast-check';

import {
  ANGLE_TOLERANCE_DEG,
  CameraCapture,
  CaptureErrorCode,
  MULTI_ANGLE_SHOT_COUNT,
  MULTI_ANGLE_TARGETS_DEG,
  type CapturedMedia,
  type ImageEnhancer,
  type SharpnessScorer,
  type VideoFrame,
} from './index';

const NUM_RUNS = 100; // ≥100 iterations per task 14.3.

// --- Injectable ports (no device/model effects needed here) ----------------

/** A no-op enhancer; low-light behavior is out of scope for this property. */
class IdentityEnhancer implements ImageEnhancer {
  enhance(media: CapturedMedia): CapturedMedia {
    return media;
  }
}

/** Unused by this property; present only to satisfy the constructor. */
class NoopSharpnessScorer implements SharpnessScorer {
  score(_frame: VideoFrame): number {
    return 0;
  }
}

function makeCapture(): CameraCapture {
  return new CameraCapture(new IdentityEnhancer(), new NoopSharpnessScorer());
}

// --- Generators ------------------------------------------------------------

/** A well-lit media asset so enhancement never interferes with the property. */
function mediaFor(id: string): CapturedMedia {
  return { id, format: 'jpeg', byteSize: 1024, ambientLux: 300 };
}

/** A shot angle strictly within the ±10° window of the given target. */
const arbValidAngle = (targetDeg: number) =>
  fc.double({
    min: targetDeg - ANGLE_TOLERANCE_DEG,
    max: targetDeg + ANGLE_TOLERANCE_DEG,
    noNaN: true,
  });

/**
 * An angle that lies in the gaps between every target window
 * ((10,35) or (55,80)), so it is > 10° from *any* of the 0/45/90 targets and is
 * therefore rejected regardless of which step the session is currently on.
 */
const arbInvalidAngle = fc.oneof(
  fc.double({ min: 11, max: 34, noNaN: true }),
  fc.double({ min: 56, max: 79, noNaN: true }),
);

/** Up to a few invalid "noise" shots per slot to intersperse between valid ones. */
const arbNoiseSlot = fc.array(arbInvalidAngle, { maxLength: 3 });

const arbScenario = fc.record({
  // Number of *valid* shots captured before exiting — always < 3 (partial).
  validCount: fc.integer({ min: 0, max: MULTI_ANGLE_SHOT_COUNT - 1 }),
  // One valid angle per target step (only the first `validCount` are used).
  validAngles: fc.tuple(
    arbValidAngle(MULTI_ANGLE_TARGETS_DEG[0]),
    arbValidAngle(MULTI_ANGLE_TARGETS_DEG[1]),
    arbValidAngle(MULTI_ANGLE_TARGETS_DEG[2]),
  ),
  // Invalid noise: slot i is fed before valid shot i; the last slot is trailing.
  noise: fc.tuple(arbNoiseSlot, arbNoiseSlot, arbNoiseSlot),
  // How the user exits the incomplete session.
  exit: fc.constantFrom<'close' | 'abandon'>('close', 'abandon'),
});

describe('Property 2: partial multi-angle capture is never submitted (Req 1.5) [Feature: calorie-cortisol-tool, Property 2]', () => {
  it('discards a session exited before all 3 shots and submits nothing for volume reconstruction', () => {
    fc.assert(
      fc.property(arbScenario, ({ validCount, validAngles, noise, exit }) => {
        const capture = makeCapture();
        const session = capture.startMultiAngleSession();

        let sawSubmission = false;
        let sawComplete = false;

        const feedNoise = (angles: readonly number[]) => {
          for (const angleDeg of angles) {
            const before = session.capturedCount;
            const res = session.capture({ media: mediaFor('noise'), angleDeg });
            // Guaranteed-invalid angle: rejected without advancing the session.
            expect(isErr(res)).toBe(true);
            if (isErr(res)) {
              expect(res.error.code).toBe(CaptureErrorCode.AngleOutOfTolerance);
            }
            expect(session.capturedCount).toBe(before);
          }
        };

        for (let i = 0; i < validCount; i += 1) {
          feedNoise(noise[i]);

          const res = session.capture({
            media: mediaFor(`shot-${i}`),
            angleDeg: validAngles[i],
          });
          expect(isOk(res)).toBe(true);
          if (isOk(res)) {
            // While partial, progress must never be complete nor carry a submission.
            expect(res.value.isComplete).toBe(false);
            expect(res.value.submission).toBeUndefined();
            sawComplete ||= res.value.isComplete;
            sawSubmission ||= res.value.submission !== undefined;
          }
          expect(session.capturedCount).toBe(i + 1);
        }

        // Trailing invalid noise before the user exits.
        feedNoise(noise[MULTI_ANGLE_SHOT_COUNT - 1]);

        // Sanity: we are genuinely partial (never reached completion).
        expect(session.capturedCount).toBe(validCount);
        expect(session.capturedCount).toBeLessThan(MULTI_ANGLE_SHOT_COUNT);
        expect(session.isComplete).toBe(false);
        expect(sawSubmission).toBe(false);
        expect(sawComplete).toBe(false);

        // Exit the incomplete session.
        const outcome = exit === 'close' ? session.close() : session.abandon();

        // Nothing is submitted for volume reconstruction: the outcome is a
        // discard carrying no submission, and the partial set is cleared.
        expect(outcome.status).toBe('discarded');
        expect('submission' in outcome).toBe(false);
        if (outcome.status === 'discarded') {
          expect(outcome.discardedShotCount).toBe(validCount);
        }
        expect(session.capturedCount).toBe(0);

        // After exit the session is closed: no further shot can be submitted.
        const afterExit = session.capture({ media: mediaFor('after'), angleDeg: 0 });
        expect(isErr(afterExit)).toBe(true);
        if (isErr(afterExit)) {
          expect(afterExit.error.code).toBe(CaptureErrorCode.SessionComplete);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
