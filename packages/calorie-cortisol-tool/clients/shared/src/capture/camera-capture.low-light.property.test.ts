import fc from 'fast-check';

import {
  isOk,
} from '@calorie-cortisol/shared/result';
import {
  CameraCapture,
  LOW_LIGHT_LUX_THRESHOLD,
  needsLowLightEnhancement,
  type CapturedMedia,
  type ImageEnhancer,
  type SharpnessScorer,
  type VideoFrame,
  type VideoInput,
} from './index';

/**
 * Property 5: Low-light enhancement threshold
 * Validates: Requirements 1.9
 * Feature: calorie-cortisol-tool, Property 5
 *
 * For any ambient light reading, on-device enhancement is applied before
 * submission if and only if the reading is below 50 lux.
 *
 * The property is checked against an INDEPENDENT restatement of Req 1.9 rather
 * than reusing the implementation's `needsLowLightEnhancement`: enhancement
 * must occur exactly when a lux reading is present AND strictly below the
 * 50-lux threshold. "Before submission" is observed through the produced
 * `SubmittableImage` — the artifact the rest of the pipeline consumes — whose
 * `enhanced` flag and enhanced-source id both reflect that the enhancement ran
 * on the media that became the submitted image.
 *
 * Every capture path that yields a submittable image is exercised:
 *   1. single live capture,
 *   2. gallery acceptance,
 *   3. video sharpest-frame extraction, and
 *   4. multi-angle shots (each shot enhanced independently by its own lux).
 */

// --- Injectable test doubles -----------------------------------------------

/**
 * Counts enhancement calls and tags the media id so we can prove the enhanced
 * copy (not the raw media) is what gets submitted.
 */
class TaggingEnhancer implements ImageEnhancer {
  public calls = 0;

  enhance(media: CapturedMedia): CapturedMedia {
    this.calls += 1;
    return { ...media, id: `${media.id}#enhanced` };
  }
}

class ConstantSharpnessScorer implements SharpnessScorer {
  score(_frame: VideoFrame): number {
    return 1;
  }
}

function makeCapture(): { capture: CameraCapture; enhancer: TaggingEnhancer } {
  const enhancer = new TaggingEnhancer();
  const capture = new CameraCapture(enhancer, new ConstantSharpnessScorer());
  return { capture, enhancer };
}

// --- Independent oracle for Req 1.9 ----------------------------------------

/** Enhancement is due iff a reading is present AND strictly below 50 lux. */
function shouldEnhance(lux: number | undefined): boolean {
  return lux !== undefined && lux < LOW_LIGHT_LUX_THRESHOLD;
}

// --- Arbitraries -----------------------------------------------------------

/**
 * A lux reading spanning the whole interesting input space: absent, the exact
 * boundary (50), just-below/just-above the boundary, zero, negatives, and a
 * broad spread of finite magnitudes.
 */
const arbLux: fc.Arbitrary<number | undefined> = fc.oneof(
  fc.constant<number | undefined>(undefined),
  fc.constantFrom(
    0,
    LOW_LIGHT_LUX_THRESHOLD, // 50 — not below, must NOT enhance
    LOW_LIGHT_LUX_THRESHOLD - 0.0001, // just below — must enhance
    LOW_LIGHT_LUX_THRESHOLD + 0.0001, // just above — must NOT enhance
    -1,
  ),
  fc.float({ min: 0, max: 100_000, noNaN: true, noDefaultInfinity: true }),
  fc.integer({ min: -10, max: 200 }),
);

const arbFormat = fc.constantFrom('jpeg', 'png', 'heic', 'webp');

function arbMedia(over: { lux: number | undefined }): fc.Arbitrary<CapturedMedia> {
  return fc.record({
    id: fc.string({ minLength: 1, maxLength: 12 }),
    format: arbFormat,
    byteSize: fc.integer({ min: 0, max: 5_000_000 }),
  }).map((base) => ({
    ...base,
    ...(over.lux !== undefined ? { ambientLux: over.lux } : {}),
  }));
}

describe('Property 5: Low-light enhancement threshold (Req 1.9) [Feature: calorie-cortisol-tool, Property 5]', () => {
  it('the implementation predicate agrees with the independent < 50 lux oracle', () => {
    fc.assert(
      fc.property(arbLux, (lux) => {
        const media: CapturedMedia = {
          id: 'm',
          format: 'jpeg',
          byteSize: 1,
          ...(lux !== undefined ? { ambientLux: lux } : {}),
        };
        expect(needsLowLightEnhancement(media)).toBe(shouldEnhance(lux));
      }),
      { numRuns: 100 },
    );
  });

  it('single capture enhances before submission iff the reading is below 50 lux', () => {
    fc.assert(
      fc.property(arbLux.chain((lux) => arbMedia({ lux }).map((media) => ({ lux, media }))), ({ lux, media }) => {
        const { capture, enhancer } = makeCapture();
        const img = capture.captureSingle(media);
        const expected = shouldEnhance(lux);

        // Submitted artifact records whether enhancement was applied.
        expect(img.enhanced).toBe(expected);
        // Enhancement ran exactly when due — never otherwise.
        expect(enhancer.calls).toBe(expected ? 1 : 0);
        // When enhanced, the submitted image derives from the enhanced copy,
        // proving enhancement happened *before* the submittable image was built.
        expect(img.sourceId).toBe(expected ? `${media.id}#enhanced` : media.id);
      }),
      { numRuns: 100 },
    );
  });

  it('gallery acceptance enhances before submission iff the reading is below 50 lux', () => {
    fc.assert(
      fc.property(arbLux.chain((lux) => arbMedia({ lux }).map((media) => ({ lux, media }))), ({ lux, media }) => {
        const { capture, enhancer } = makeCapture();
        const res = capture.acceptGalleryMedia(media);
        // These media are always a supported format and within size, so accepted.
        expect(isOk(res)).toBe(true);
        if (!isOk(res)) return;

        const expected = shouldEnhance(lux);
        expect(res.value.enhanced).toBe(expected);
        expect(enhancer.calls).toBe(expected ? 1 : 0);
        expect(res.value.sourceId).toBe(expected ? `${media.id}#enhanced` : media.id);
      }),
      { numRuns: 100 },
    );
  });

  it('extracted video frame is enhanced before submission iff the video was below 50 lux', () => {
    const arbVideo = arbLux.map<{ lux: number | undefined; video: VideoInput }>((lux) => ({
      lux,
      video: {
        id: 'v',
        format: 'mp4',
        byteSize: 2048,
        durationSeconds: 30,
        frames: [
          { index: 0, timestampSeconds: 0, data: {} },
          { index: 1, timestampSeconds: 1, data: {} },
        ],
        ...(lux !== undefined ? { ambientLux: lux } : {}),
      },
    }));

    fc.assert(
      fc.property(arbVideo, ({ lux, video }) => {
        const { capture, enhancer } = makeCapture();
        const res = capture.extractSharpestFrame(video);
        expect(isOk(res)).toBe(true);
        if (!isOk(res)) return;

        const expected = shouldEnhance(lux);
        expect(res.value.enhanced).toBe(expected);
        expect(enhancer.calls).toBe(expected ? 1 : 0);
      }),
      { numRuns: 100 },
    );
  });

  it('each multi-angle shot is enhanced before submission iff its own reading is below 50 lux', () => {
    // Three shots, one per 0/45/90 target, each with an independent lux reading.
    const arbShots = fc.tuple(arbLux, arbLux, arbLux);

    fc.assert(
      fc.property(arbShots, ([l0, l45, l90]) => {
        const { capture, enhancer } = makeCapture();
        const session = capture.startMultiAngleSession();
        const luxByStep = [l0, l45, l90];
        const targets = [0, 45, 90];

        for (let step = 0; step < 3; step += 1) {
          const lux = luxByStep[step];
          const media: CapturedMedia = {
            id: `s${step}`,
            format: 'jpeg',
            byteSize: 100,
            ...(lux !== undefined ? { ambientLux: lux } : {}),
          };
          const res = session.capture({ media, angleDeg: targets[step] });
          expect(isOk(res)).toBe(true);
        }

        const closed = session.close();
        expect(closed.status).toBe('submitted');
        if (closed.status !== 'submitted') return;

        const expectedFlags = luxByStep.map(shouldEnhance);
        closed.submission.images.forEach((img, i) => {
          expect(img.enhanced).toBe(expectedFlags[i]);
          expect(img.sourceId).toBe(expectedFlags[i] ? `s${i}#enhanced` : `s${i}`);
        });
        // Enhancer is invoked exactly once per shot that is below threshold.
        expect(enhancer.calls).toBe(expectedFlags.filter(Boolean).length);
      }),
      { numRuns: 100 },
    );
  });
});
