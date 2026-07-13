import fc from 'fast-check';

import { isErr, isOk } from '@calorie-cortisol/shared/result';
import {
  CameraCapture,
  CaptureErrorCode,
  MAX_MEDIA_BYTES,
  SUPPORTED_IMAGE_FORMATS,
  SUPPORTED_VIDEO_FORMATS,
  type CapturedMedia,
  type ImageEnhancer,
  type SharpnessScorer,
  type VideoFrame,
} from './index';

/**
 * Property-based test for the media-acceptance rule (Task 14.4).
 *
 * Feature: calorie-cortisol-tool, Property 3
 * Property 3: Media acceptance matches the format/size rule.
 *   For any gallery selection, Camera_Capture accepts it for recognition if and
 *   only if it is in a supported format AND is 20 MB or smaller (Req 1.6); any
 *   file in an unsupported format OR exceeding 20 MB is rejected with an error
 *   indication and is never submitted for recognition (Req 1.7).
 *
 * Validates: Requirements 1.6, 1.7
 */

// --- Injectable-port test doubles ------------------------------------------

/** A no-op enhancer: acceptance must not depend on enhancement effects. */
const enhancer: ImageEnhancer = {
  enhance: (media) => media,
};

/** Unused by the acceptance path, but required by the CameraCapture ctor. */
const sharpnessScorer: SharpnessScorer = {
  score: (frame: VideoFrame) => frame.index,
};

const capture = new CameraCapture(enhancer, sharpnessScorer);

// --- Independent oracle for the format/size rule ---------------------------
//
// Re-derive "acceptable" from the requirement text rather than delegating to
// the implementation's own predicate, so the property is a genuine check.

/** Normalize a raw format token the same way the requirement describes. */
function normalize(raw: string): string {
  return raw.trim().toLowerCase().replace(/^\./, '');
}

const SUPPORTED = new Set<string>([
  ...SUPPORTED_IMAGE_FORMATS,
  ...SUPPORTED_VIDEO_FORMATS,
]);

/** Oracle: supported format AND non-negative size within the 20 MB cap. */
function shouldAccept(media: CapturedMedia): boolean {
  const formatOk = SUPPORTED.has(normalize(media.format));
  const sizeOk = media.byteSize >= 0 && media.byteSize <= MAX_MEDIA_BYTES;
  return formatOk && sizeOk;
}

// --- Generators ------------------------------------------------------------

/**
 * A format token drawn from the full input space: supported image/video
 * containers (including case/leading-dot variants to exercise normalization)
 * and a wide range of unsupported tokens.
 */
const formatArb: fc.Arbitrary<string> = fc.oneof(
  // Supported tokens, possibly with surrounding noise the normalizer strips.
  fc
    .constantFrom(...SUPPORTED_IMAGE_FORMATS, ...SUPPORTED_VIDEO_FORMATS)
    .chain((f) =>
      fc.constantFrom(f, f.toUpperCase(), `.${f}`, ` ${f} `, `.${f.toUpperCase()}`),
    ),
  // Known-unsupported containers.
  fc.constantFrom('gif', 'bmp', 'tiff', 'svg', 'avi', 'mkv', 'wmv', 'txt', 'pdf', ''),
  // Arbitrary tokens (almost surely unsupported).
  fc.string({ maxLength: 8 }),
);

/**
 * A byte size spanning below, exactly at, and above the 20 MB cap, plus the
 * negative/degenerate region, so the size half of the rule is fully exercised.
 */
const byteSizeArb: fc.Arbitrary<number> = fc.oneof(
  fc.integer({ min: 0, max: MAX_MEDIA_BYTES }), // valid range
  fc.constant(MAX_MEDIA_BYTES), // boundary (accepted)
  fc.constant(MAX_MEDIA_BYTES + 1), // boundary (rejected)
  fc.integer({ min: MAX_MEDIA_BYTES + 1, max: MAX_MEDIA_BYTES * 4 }), // oversize
  fc.integer({ min: -1_000_000, max: -1 }), // degenerate/negative
);

const mediaArb: fc.Arbitrary<CapturedMedia> = fc.record({
  id: fc.string({ minLength: 1, maxLength: 24 }).map((s) => `media-${s}`),
  format: formatArb,
  byteSize: byteSizeArb,
  ambientLux: fc.option(fc.double({ min: 0, max: 100_000, noNaN: true }), {
    nil: undefined,
  }),
});

// --- Property --------------------------------------------------------------

describe('Property 3: media acceptance matches the format/size rule (Req 1.6, 1.7) [Feature: calorie-cortisol-tool, Property 3]', () => {
  it('accepts a gallery file for recognition iff it is a supported format AND ≤ 20 MB, and never submits a rejected file', () => {
    fc.assert(
      fc.property(mediaArb, (media) => {
        const result = capture.acceptGalleryMedia(media);
        const expected = shouldAccept(media);

        // Biconditional: acceptance matches the format/size rule exactly.
        expect(isOk(result)).toBe(expected);

        if (expected) {
          // Req 1.6: accepted media is submitted for recognition as a gallery
          // image; the submitted artifact preserves the normalized format.
          expect(isOk(result)).toBe(true);
          if (isOk(result)) {
            expect(result.value.mode).toBe('gallery');
            expect(result.value.sourceId).toBe(media.id);
            expect(result.value.format).toBe(normalize(media.format));
            expect(result.value.byteSize).toBe(media.byteSize);
          }
        } else {
          // Req 1.7: rejected media yields an error indication and is never
          // submitted (no SubmittableImage is produced).
          expect(isErr(result)).toBe(true);
          if (isErr(result)) {
            expect(result.error.code).toBe(CaptureErrorCode.UnsupportedMedia);
            // Rejection is a non-destructive validation outcome.
            expect(result.error.retainedState).toBe(true);
          }
        }
      }),
      { numRuns: 100 },
    );
  });

  it('accepts every supported format exactly at the 20 MB boundary (Req 1.6)', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...SUPPORTED_IMAGE_FORMATS, ...SUPPORTED_VIDEO_FORMATS),
        (format) => {
          const result = capture.acceptGalleryMedia({
            id: 'boundary',
            format,
            byteSize: MAX_MEDIA_BYTES,
          });
          expect(isOk(result)).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('rejects every supported format one byte over the 20 MB cap (Req 1.7)', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...SUPPORTED_IMAGE_FORMATS, ...SUPPORTED_VIDEO_FORMATS),
        (format) => {
          const result = capture.acceptGalleryMedia({
            id: 'oversize',
            format,
            byteSize: MAX_MEDIA_BYTES + 1,
          });
          expect(isErr(result)).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });
});
