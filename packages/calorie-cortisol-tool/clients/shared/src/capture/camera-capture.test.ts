import { isErr, isOk } from '@calorie-cortisol/shared/result';
import {
  CameraCapture,
  CaptureErrorCode,
  MULTI_ANGLE_SHOT_COUNT,
  MAX_MEDIA_BYTES,
  MAX_VIDEO_DURATION_SECONDS,
  isAcceptableMedia,
  isAngleWithinTolerance,
  needsLowLightEnhancement,
  normalizeFormat,
  type CapturedMedia,
  type FoodRecognizer,
  type ImageEnhancer,
  type SharpnessScorer,
  type SubmittableImage,
  type VideoFrame,
  type VideoInput,
} from './index';

/**
 * Unit tests for Camera_Capture media handling (Task 14.1).
 *
 * Covers single/multi-angle capture, partial-session discard, gallery
 * format/size acceptance, video sharpest-frame extraction, low-light
 * enhancement, and failed/timed-out recognition input retention
 * (Req 1.2–1.9, 21.6).
 */

// --- Test doubles for the injectable ports ---------------------------------

/** Marks enhancement by flipping the format so we can assert it ran. */
class TaggingEnhancer implements ImageEnhancer {
  public calls = 0;

  enhance(media: CapturedMedia): CapturedMedia {
    this.calls += 1;
    return { ...media, id: `${media.id}#enhanced` };
  }
}

/** Scores a frame by a numeric `sharpness` we attach to `data`. */
class DataSharpnessScorer implements SharpnessScorer {
  score(frame: VideoFrame): number {
    return (frame.data as { sharpness: number }).sharpness;
  }
}

function frame(index: number, sharpness: number, timestampSeconds = index): VideoFrame {
  return { index, timestampSeconds, data: { sharpness } };
}

function makeCapture(): { capture: CameraCapture; enhancer: TaggingEnhancer } {
  const enhancer = new TaggingEnhancer();
  const capture = new CameraCapture(enhancer, new DataSharpnessScorer());
  return { capture, enhancer };
}

const daylight = (over: Partial<CapturedMedia> = {}): CapturedMedia => ({
  id: 'm1',
  format: 'jpeg',
  byteSize: 1024,
  ambientLux: 300,
  ...over,
});

// --- Pure helpers ----------------------------------------------------------

describe('capture helpers', () => {
  it('normalizes formats to lower-case without a leading dot', () => {
    expect(normalizeFormat('.JPEG')).toBe('jpeg');
    expect(normalizeFormat('PNG')).toBe('png');
  });

  it('accepts supported formats at or below 20 MB and rejects otherwise (Req 1.6/1.7)', () => {
    expect(isAcceptableMedia(daylight({ byteSize: MAX_MEDIA_BYTES }))).toBe(true);
    expect(isAcceptableMedia(daylight({ byteSize: MAX_MEDIA_BYTES + 1 }))).toBe(false);
    expect(isAcceptableMedia(daylight({ format: 'gif' }))).toBe(false);
    expect(isAcceptableMedia(daylight({ format: 'mp4' }))).toBe(true);
  });

  it('treats ±10° as the angle tolerance boundary (Req 1.3)', () => {
    expect(isAngleWithinTolerance(10, 0)).toBe(true);
    expect(isAngleWithinTolerance(-10, 0)).toBe(true);
    expect(isAngleWithinTolerance(10.1, 0)).toBe(false);
    expect(isAngleWithinTolerance(55, 45)).toBe(true);
  });

  it('flags enhancement only when a lux reading is below 50 (Req 1.9)', () => {
    expect(needsLowLightEnhancement(daylight({ ambientLux: 49.9 }))).toBe(true);
    expect(needsLowLightEnhancement(daylight({ ambientLux: 50 }))).toBe(false);
    expect(needsLowLightEnhancement(daylight({ ambientLux: undefined }))).toBe(false);
  });
});

// --- Single capture & low-light enhancement (Req 1.9) ----------------------

describe('single capture', () => {
  it('does not enhance well-lit images', () => {
    const { capture, enhancer } = makeCapture();
    const img = capture.captureSingle(daylight());
    expect(img.enhanced).toBe(false);
    expect(img.mode).toBe('single');
    expect(enhancer.calls).toBe(0);
    expect(img.sourceId).toBe('m1');
  });

  it('applies on-device enhancement below 50 lux (Req 1.9)', () => {
    const { capture, enhancer } = makeCapture();
    const img = capture.captureSingle(daylight({ ambientLux: 12 }));
    expect(img.enhanced).toBe(true);
    expect(enhancer.calls).toBe(1);
    expect(img.sourceId).toBe('m1#enhanced');
  });
});

// --- Gallery acceptance (Req 1.6, 1.7) -------------------------------------

describe('gallery acceptance', () => {
  it('accepts a supported image ≤ 20 MB and submits it (Req 1.6)', () => {
    const { capture } = makeCapture();
    const res = capture.acceptGalleryMedia(daylight({ format: 'png', byteSize: 5_000_000 }));
    expect(isOk(res)).toBe(true);
    if (isOk(res)) {
      expect(res.value.mode).toBe('gallery');
      expect(res.value.format).toBe('png');
    }
  });

  it('rejects oversize media without submitting (Req 1.7)', () => {
    const { capture } = makeCapture();
    const res = capture.acceptGalleryMedia(daylight({ byteSize: MAX_MEDIA_BYTES + 1 }));
    expect(isErr(res)).toBe(true);
    if (isErr(res)) {
      expect(res.error.code).toBe(CaptureErrorCode.UnsupportedMedia);
      expect(res.error.retainedState).toBe(true);
    }
  });

  it('rejects unsupported formats without submitting (Req 1.7)', () => {
    const { capture } = makeCapture();
    const res = capture.acceptGalleryMedia(daylight({ format: 'bmp' }));
    expect(isErr(res)).toBe(true);
  });
});

// --- Multi-angle capture (Req 1.3, 1.4, 1.5) -------------------------------

describe('multi-angle capture', () => {
  const shotAt = (angleDeg: number, id: string) => ({
    media: daylight({ id }),
    angleDeg,
  });

  it('guides through 0/45/90 and submits all 3 when complete (Req 1.3, 1.4)', () => {
    const { capture } = makeCapture();
    const session = capture.startMultiAngleSession();
    expect(session.nextTargetDeg).toBe(0);

    expect(isOk(session.capture(shotAt(2, 'a')))).toBe(true);
    expect(session.nextTargetDeg).toBe(45);
    expect(isOk(session.capture(shotAt(48, 'b')))).toBe(true);
    expect(session.nextTargetDeg).toBe(90);

    const last = session.capture(shotAt(85, 'c'));
    expect(isOk(last)).toBe(true);
    if (isOk(last)) {
      expect(last.value.isComplete).toBe(true);
      expect(last.value.submission?.images).toHaveLength(MULTI_ANGLE_SHOT_COUNT);
    }
  });

  it('rejects a shot outside the current ±10° target without advancing (Req 1.3)', () => {
    const { capture } = makeCapture();
    const session = capture.startMultiAngleSession();
    const bad = session.capture(shotAt(30, 'a')); // target is 0°
    expect(isErr(bad)).toBe(true);
    if (isErr(bad)) {
      expect(bad.error.code).toBe(CaptureErrorCode.AngleOutOfTolerance);
    }
    expect(session.capturedCount).toBe(0);
    expect(session.nextTargetDeg).toBe(0);
  });

  it('discards a partial set on abandon and submits nothing (Req 1.5)', () => {
    const { capture } = makeCapture();
    const session = capture.startMultiAngleSession();
    session.capture(shotAt(0, 'a'));
    session.capture(shotAt(45, 'b'));
    expect(session.capturedCount).toBe(2);

    const outcome = session.abandon();
    expect(outcome.status).toBe('discarded');
    if (outcome.status === 'discarded') {
      expect(outcome.discardedShotCount).toBe(2);
    }
    expect(session.capturedCount).toBe(0);
  });

  it('close() before completion discards; after completion submits (Req 1.4, 1.5)', () => {
    const { capture } = makeCapture();
    const partial = capture.startMultiAngleSession();
    partial.capture(shotAt(0, 'a'));
    expect(partial.close().status).toBe('discarded');

    const full = capture.startMultiAngleSession();
    full.capture(shotAt(0, 'a'));
    full.capture(shotAt(45, 'b'));
    full.capture(shotAt(90, 'c'));
    const closed = full.close();
    expect(closed.status).toBe('submitted');
    if (closed.status === 'submitted') {
      expect(closed.submission.images).toHaveLength(3);
    }
  });

  it('rejects extra shots once complete', () => {
    const { capture } = makeCapture();
    const session = capture.startMultiAngleSession();
    session.capture(shotAt(0, 'a'));
    session.capture(shotAt(45, 'b'));
    session.capture(shotAt(90, 'c'));
    const extra = session.capture(shotAt(90, 'd'));
    expect(isErr(extra)).toBe(true);
    if (isErr(extra)) {
      expect(extra.error.code).toBe(CaptureErrorCode.SessionComplete);
    }
  });
});

// --- Video sharpest-frame extraction (Req 1.8) -----------------------------

describe('video frame extraction', () => {
  const video = (over: Partial<VideoInput> = {}): VideoInput => ({
    id: 'v1',
    format: 'mp4',
    byteSize: 2048,
    durationSeconds: 30,
    frames: [frame(0, 0.2), frame(1, 0.9), frame(2, 0.5)],
    ...over,
  });

  it('selects the maximum-sharpness frame for a ≤ 60 s video (Req 1.8)', () => {
    const { capture } = makeCapture();
    const res = capture.extractSharpestFrame(video());
    expect(isOk(res)).toBe(true);
    if (isOk(res)) {
      expect(res.value.sourceId).toBe('v1#frame-1');
      expect(res.value.mode).toBe('video');
    }
  });

  it('resolves sharpness ties to the earliest frame', () => {
    const { capture } = makeCapture();
    const res = capture.extractSharpestFrame(
      video({ frames: [frame(0, 0.9), frame(1, 0.9)] }),
    );
    expect(isOk(res)).toBe(true);
    if (isOk(res)) {
      expect(res.value.sourceId).toBe('v1#frame-0');
    }
  });

  it('rejects videos longer than 60 s (Req 1.8)', () => {
    const { capture } = makeCapture();
    const res = capture.extractSharpestFrame(
      video({ durationSeconds: MAX_VIDEO_DURATION_SECONDS + 1 }),
    );
    expect(isErr(res)).toBe(true);
    if (isErr(res)) {
      expect(res.error.code).toBe(CaptureErrorCode.VideoTooLong);
    }
  });

  it('rejects videos with no sampled frames', () => {
    const { capture } = makeCapture();
    const res = capture.extractSharpestFrame(video({ frames: [] }));
    expect(isErr(res)).toBe(true);
    if (isErr(res)) {
      expect(res.error.code).toBe(CaptureErrorCode.NoFrames);
    }
  });

  it('enhances the extracted frame when the video was low-light (Req 1.9)', () => {
    const { capture, enhancer } = makeCapture();
    const res = capture.extractSharpestFrame(video({ ambientLux: 10 }));
    expect(isOk(res)).toBe(true);
    if (isOk(res)) {
      expect(res.value.enhanced).toBe(true);
    }
    expect(enhancer.calls).toBe(1);
  });
});

// --- Recognition input retention (Req 1.2, 21.6) ---------------------------

describe('recognition input retention', () => {
  const image: SubmittableImage = {
    sourceId: 'm1',
    mode: 'single',
    format: 'jpeg',
    byteSize: 1024,
    enhanced: false,
  };

  const recognizer = (outcome: ReturnType<FoodRecognizer['recognize']>): FoodRecognizer => ({
    recognize: () => outcome,
  });

  it('returns the recognized result with no retained input on success', () => {
    const { capture } = makeCapture();
    const attempt = capture.recognize(
      image,
      recognizer({ status: 'recognized', result: { items: [] } }),
    );
    expect(isOk(attempt.outcome)).toBe(true);
    expect(attempt.retainedInput).toBeUndefined();
  });

  it('retains the input for retry when recognition fails (Req 1.2)', () => {
    const { capture } = makeCapture();
    const attempt = capture.recognize(image, recognizer({ status: 'failed' }));
    expect(isErr(attempt.outcome)).toBe(true);
    if (isErr(attempt.outcome)) {
      expect(attempt.outcome.error.code).toBe(CaptureErrorCode.RecognitionFailed);
      expect(attempt.outcome.error.retainedState).toBe(true);
    }
    expect(attempt.retainedInput).toEqual(image);
  });

  it('retains the input for retry when recognition times out (Req 1.2, 21.6)', () => {
    const { capture } = makeCapture();
    const attempt = capture.recognize(image, recognizer({ status: 'timedOut' }));
    expect(isErr(attempt.outcome)).toBe(true);
    if (isErr(attempt.outcome)) {
      expect(attempt.outcome.error.code).toBe(CaptureErrorCode.RecognitionTimedOut);
      expect(attempt.outcome.error.retryable).toBe(true);
      expect(attempt.outcome.error.retainedState).toBe(true);
    }
    expect(attempt.retainedInput).toEqual(image);
  });
});
