import fc from 'fast-check';
import { isErr, isOk } from '@calorie-cortisol/shared/result';

import {
  CameraCapture,
  MAX_VIDEO_DURATION_SECONDS,
  type CapturedMedia,
  type ImageEnhancer,
  type SharpnessScorer,
  type VideoFrame,
  type VideoInput,
} from './index';

/**
 * Property 4: Video frame selection picks maximum sharpness
 * Validates: Requirements 1.8
 * Feature: calorie-cortisol-tool, Property 4
 *
 * For any recorded/gallery video of 60 seconds or less that has at least one
 * sampled frame, the single frame Camera_Capture extracts and submits for
 * recognition is a frame whose sharpness score is the MAXIMUM among all sampled
 * frames (Req 1.8). The design further fixes tie-breaking to the earliest such
 * frame, which we also assert for a fully-deterministic selection.
 *
 * The test drives {@link CameraCapture.extractSharpestFrame} over randomly
 * generated videos (frame counts, per-frame sharpness scores including
 * deliberate ties, and durations spanning the 60 s boundary) and checks the
 * submitted frame against an INDEPENDENT oracle computed directly from the
 * generated sharpness scores — never from the implementation's own choice.
 */

// ---------------------------------------------------------------------------
// Injectable ports
// ---------------------------------------------------------------------------

/** No-op enhancer: enhancement is orthogonal to sharpness selection here. */
class IdentityEnhancer implements ImageEnhancer {
  enhance(media: CapturedMedia): CapturedMedia {
    return media;
  }
}

/** Scores a frame by the numeric `sharpness` carried on its opaque `data`. */
class DataSharpnessScorer implements SharpnessScorer {
  score(frame: VideoFrame): number {
    return (frame.data as { sharpness: number }).sharpness;
  }
}

function makeCapture(): CameraCapture {
  return new CameraCapture(new IdentityEnhancer(), new DataSharpnessScorer());
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/**
 * Finite sharpness scores. A small integer range is mixed in with fine-grained
 * doubles so exact ties (which exercise the earliest-frame tie-break) occur
 * frequently, while distinct-maximum cases are also well covered.
 */
const sharpnessArb: fc.Arbitrary<number> = fc.oneof(
  fc.integer({ min: 0, max: 5 }),
  fc.double({ min: 0, max: 100, noNaN: true, noDefaultInfinity: true }),
);

/**
 * A video with `n` frames (n ≥ 1), each carrying a generated sharpness score.
 * Frame indices are the positions 0..n-1 so the submitted frame's index maps
 * unambiguously back to a generated score. Duration spans [0, 61] so the ≤ 60 s
 * acceptance boundary (Req 1.8) is exercised on both sides.
 */
const videoArb: fc.Arbitrary<{ video: VideoInput; scores: number[] }> = fc
  .tuple(
    fc.array(sharpnessArb, { minLength: 1, maxLength: 12 }),
    fc.double({ min: 0, max: 61, noNaN: true, noDefaultInfinity: true }),
  )
  .map(([scores, durationSeconds]) => {
    const frames: VideoFrame[] = scores.map((sharpness, index) => ({
      index,
      timestampSeconds: index,
      data: { sharpness },
    }));
    const video: VideoInput = {
      id: 'vid',
      format: 'mp4',
      byteSize: 2048,
      durationSeconds,
      frames,
    };
    return { video, scores };
  });

// ---------------------------------------------------------------------------
// Oracle
// ---------------------------------------------------------------------------

/** Index of the earliest frame achieving the maximum sharpness score. */
function argmaxSharpness(scores: number[]): number {
  let best = 0;
  for (let i = 1; i < scores.length; i += 1) {
    if (scores[i] > scores[best]) best = i;
  }
  return best;
}

/** Recover the frame index from a submitted `sourceId` of form `vid#frame-<i>`. */
function parseFrameIndex(sourceId: string): number {
  const match = /#frame-(\d+)$/.exec(sourceId);
  if (match === null) return Number.NaN;
  return Number.parseInt(match[1], 10);
}

// ---------------------------------------------------------------------------
// Property
// ---------------------------------------------------------------------------

describe('Property 4: video frame selection picks maximum sharpness (Req 1.8) [Feature: calorie-cortisol-tool, Property 4]', () => {
  it('submits the earliest maximum-sharpness frame for a ≤ 60 s video, and rejects an over-long one', () => {
    fc.assert(
      fc.property(videoArb, ({ video, scores }) => {
        const capture = makeCapture();
        const result = capture.extractSharpestFrame(video);

        if (video.durationSeconds > MAX_VIDEO_DURATION_SECONDS) {
          // Out of scope for Property 4's core claim, but the ≤ 60 s guard must
          // reject rather than submit an over-long video (Req 1.8).
          return isErr(result);
        }

        if (!isOk(result)) return false;

        const chosenIndex = parseFrameIndex(result.value.sourceId);
        const maxScore = Math.max(...scores);

        // Core property: the submitted frame has the MAXIMUM sharpness score.
        if (scores[chosenIndex] !== maxScore) return false;

        // Determinism: ties resolve to the earliest maximum-sharpness frame.
        if (chosenIndex !== argmaxSharpness(scores)) return false;

        // The submitted artifact is the video-mode frame (Req 1.8).
        return result.value.mode === 'video';
      }),
      { numRuns: 100 },
    );
  });
});
