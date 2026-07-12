/**
 * Camera_Capture media handling (Task 14.1).
 *
 * Pure, testable capture logic for Requirement 1. Device/camera/recognition
 * effects are injected as ports so this module runs identically on iOS
 * (AVFoundation), Android (CameraX), and the PWA (WebRTC), and in tests with no
 * hardware at all.
 *
 * Requirements: 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 21.6
 */

import {
  atomicFailure,
  err,
  ok,
  timeoutOutcome,
  validationRejection,
  type Result,
} from '@calorie-cortisol/shared/result';

import {
  ANGLE_TOLERANCE_DEG,
  CaptureErrorCode,
  LOW_LIGHT_LUX_THRESHOLD,
  MAX_MEDIA_BYTES,
  MAX_VIDEO_DURATION_SECONDS,
  MULTI_ANGLE_SHOT_COUNT,
  MULTI_ANGLE_TARGETS_DEG,
  SUPPORTED_IMAGE_FORMATS,
  SUPPORTED_VIDEO_FORMATS,
  type AngleShot,
  type CaptureMode,
  type CapturedMedia,
  type FoodRecognizer,
  type ImageEnhancer,
  type MultiAngleCloseOutcome,
  type MultiAngleProgress,
  type MultiAngleSubmission,
  type RecognitionAttempt,
  type SharpnessScorer,
  type SubmittableImage,
  type VideoInput,
} from './types';

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** Normalize a format string to lower-case without a leading dot. */
export function normalizeFormat(format: string): string {
  return format.trim().toLowerCase().replace(/^\./, '');
}

/** Whether a format is an accepted still-image container. */
export function isSupportedImageFormat(format: string): boolean {
  return (SUPPORTED_IMAGE_FORMATS as readonly string[]).includes(
    normalizeFormat(format),
  );
}

/** Whether a format is an accepted video container. */
export function isSupportedVideoFormat(format: string): boolean {
  return (SUPPORTED_VIDEO_FORMATS as readonly string[]).includes(
    normalizeFormat(format),
  );
}

/**
 * The media-acceptance rule (Req 1.6, 1.7): a piece of media is accepted iff
 * its format is supported (image or video) AND its size is ≤ 20 MB.
 */
export function isAcceptableMedia(media: CapturedMedia): boolean {
  const formatOk =
    isSupportedImageFormat(media.format) || isSupportedVideoFormat(media.format);
  const sizeOk = media.byteSize >= 0 && media.byteSize <= MAX_MEDIA_BYTES;
  return formatOk && sizeOk;
}

/** Whether a measured angle is within ±{@link ANGLE_TOLERANCE_DEG} of a target. */
export function isAngleWithinTolerance(
  angleDeg: number,
  targetDeg: number,
): boolean {
  return Math.abs(angleDeg - targetDeg) <= ANGLE_TOLERANCE_DEG;
}

/**
 * Whether ambient light warrants on-device enhancement (Req 1.9): enhancement
 * applies if and only if a lux reading is present and strictly below 50 lux.
 */
export function needsLowLightEnhancement(media: CapturedMedia): boolean {
  return (
    media.ambientLux !== undefined && media.ambientLux < LOW_LIGHT_LUX_THRESHOLD
  );
}

// ---------------------------------------------------------------------------
// Multi-angle capture session
// ---------------------------------------------------------------------------

/**
 * A stateful 3-shot multi-angle capture session (Req 1.3–1.5).
 *
 * Shots are captured in order against the targets 0° → 45° → 90°, each within
 * ±10°. A shot outside the current step's tolerance is rejected and does not
 * advance the session. When the 3rd valid shot is captured the session is
 * complete and yields a {@link MultiAngleSubmission} of all 3 images.
 *
 * If the session is abandoned (or closed) before all 3 shots are captured, the
 * partial image set is discarded and nothing is submitted for volume
 * reconstruction (Req 1.5).
 */
export class MultiAngleCaptureSession {
  private readonly shots: SubmittableImage[] = [];

  private closed = false;

  constructor(private readonly enhancer: ImageEnhancer) {}

  /** Number of valid shots captured so far (0–3). */
  get capturedCount(): number {
    return this.shots.length;
  }

  /** Whether all 3 valid shots have been captured. */
  get isComplete(): boolean {
    return this.shots.length === MULTI_ANGLE_SHOT_COUNT;
  }

  /** The next target angle to guide the user toward, or `null` when complete. */
  get nextTargetDeg(): number | null {
    return this.isComplete ? null : MULTI_ANGLE_TARGETS_DEG[this.shots.length];
  }

  /**
   * Capture the next shot. The shot's measured angle must be within ±10° of the
   * current step's target angle, otherwise it is rejected without advancing.
   * When the 3rd valid shot is captured, the returned progress carries the
   * complete submission (Req 1.4).
   */
  capture(shot: AngleShot): Result<MultiAngleProgress> {
    if (this.closed || this.isComplete) {
      return err(
        validationRejection(
          CaptureErrorCode.SessionComplete,
          'Multi-angle session already has all 3 shots or has been closed.',
        ),
      );
    }

    const targetDeg = MULTI_ANGLE_TARGETS_DEG[this.shots.length];
    if (!isAngleWithinTolerance(shot.angleDeg, targetDeg)) {
      return err(
        validationRejection(
          CaptureErrorCode.AngleOutOfTolerance,
          `Shot angle ${shot.angleDeg}° is outside ±${ANGLE_TOLERANCE_DEG}° of the ${targetDeg}° target.`,
        ),
      );
    }

    this.shots.push(prepareImage(shot.media, 'multiAngle', this.enhancer));

    const submission = this.isComplete ? this.buildSubmission() : undefined;
    return ok({
      capturedCount: this.capturedCount,
      isComplete: this.isComplete,
      nextTargetDeg: this.nextTargetDeg,
      ...(submission ? { submission } : {}),
    });
  }

  /**
   * Close the session. If all 3 shots were captured, returns the submission;
   * otherwise discards the partial set and submits nothing (Req 1.5).
   */
  close(): MultiAngleCloseOutcome {
    if (this.isComplete && !this.closed) {
      this.closed = true;
      return { status: 'submitted', submission: this.buildSubmission() };
    }
    const discardedShotCount = this.shots.length;
    this.shots.length = 0;
    this.closed = true;
    return { status: 'discarded', discardedShotCount };
  }

  /** Explicitly abandon the session, discarding any partial shots (Req 1.5). */
  abandon(): MultiAngleCloseOutcome {
    const discardedShotCount = this.shots.length;
    this.shots.length = 0;
    this.closed = true;
    return { status: 'discarded', discardedShotCount };
  }

  private buildSubmission(): MultiAngleSubmission {
    // Invariant: only called when exactly 3 shots are present.
    return {
      images: [this.shots[0], this.shots[1], this.shots[2]],
    };
  }
}

// ---------------------------------------------------------------------------
// Camera_Capture façade
// ---------------------------------------------------------------------------

/**
 * Prepare a piece of media for submission, applying low-light enhancement when
 * ambient light is below the 50-lux threshold (Req 1.9).
 */
function prepareImage(
  media: CapturedMedia,
  mode: CaptureMode,
  enhancer: ImageEnhancer,
): SubmittableImage {
  const enhance = needsLowLightEnhancement(media);
  const effective = enhance ? enhancer.enhance(media) : media;
  return {
    sourceId: effective.id,
    mode,
    format: normalizeFormat(effective.format),
    byteSize: effective.byteSize,
    enhanced: enhance,
  };
}

/**
 * Camera_Capture: the shared-client component that validates and normalizes
 * captured media into {@link SubmittableImage}s and mediates recognition with
 * input retention on failure/timeout.
 */
export class CameraCapture {
  constructor(
    private readonly enhancer: ImageEnhancer,
    private readonly sharpnessScorer: SharpnessScorer,
  ) {}

  /**
   * Capture a single live photo, applying low-light enhancement as needed
   * (Req 1.9). Returns the image ready for recognition submission.
   */
  captureSingle(media: CapturedMedia): SubmittableImage {
    return prepareImage(media, 'single', this.enhancer);
  }

  /** Begin a 3-shot multi-angle capture session (Req 1.3–1.5). */
  startMultiAngleSession(): MultiAngleCaptureSession {
    return new MultiAngleCaptureSession(this.enhancer);
  }

  /**
   * Accept a gallery selection (photo or video) for submission. The media is
   * accepted iff it is a supported format AND ≤ 20 MB; otherwise it is rejected
   * with no submission (Req 1.6, 1.7).
   */
  acceptGalleryMedia(media: CapturedMedia): Result<SubmittableImage> {
    if (!isAcceptableMedia(media)) {
      return err(
        validationRejection(
          CaptureErrorCode.UnsupportedMedia,
          `Media "${media.id}" (${normalizeFormat(media.format)}, ${media.byteSize} bytes) is an unsupported format or exceeds ${MAX_MEDIA_BYTES} bytes.`,
        ),
      );
    }
    return ok(prepareImage(media, 'gallery', this.enhancer));
  }

  /**
   * Extract the single sharpest sampled frame from a recorded/gallery video of
   * 60 s or less and prepare it for submission (Req 1.8). Videos longer than
   * 60 s, or with no sampled frames, are rejected without submission.
   */
  extractSharpestFrame(video: VideoInput): Result<SubmittableImage> {
    if (video.durationSeconds > MAX_VIDEO_DURATION_SECONDS) {
      return err(
        validationRejection(
          CaptureErrorCode.VideoTooLong,
          `Video is ${video.durationSeconds}s; the maximum is ${MAX_VIDEO_DURATION_SECONDS}s.`,
        ),
      );
    }
    if (video.frames.length === 0) {
      return err(
        validationRejection(
          CaptureErrorCode.NoFrames,
          'Video has no sampled frames to select from.',
        ),
      );
    }

    // Argmax by sharpness; ties resolve to the earliest sampled frame.
    let best = video.frames[0];
    let bestScore = this.sharpnessScorer.score(best);
    for (let i = 1; i < video.frames.length; i += 1) {
      const frame = video.frames[i];
      const score = this.sharpnessScorer.score(frame);
      if (score > bestScore) {
        best = frame;
        bestScore = score;
      }
    }

    const frameMedia: CapturedMedia = {
      id: `${video.id}#frame-${best.index}`,
      format: 'jpeg',
      byteSize: video.byteSize,
      ...(video.ambientLux !== undefined ? { ambientLux: video.ambientLux } : {}),
    };
    return ok(prepareImage(frameMedia, 'video', this.enhancer));
  }

  /**
   * Submit an image for recognition. On an unsuccessful outcome — a recognition
   * failure or a timeout — the captured input is retained for retry without
   * recapture and no partial result is produced (Req 1.2, 21.6).
   */
  recognize(image: SubmittableImage, recognizer: FoodRecognizer): RecognitionAttempt {
    const outcome = recognizer.recognize(image);
    switch (outcome.status) {
      case 'recognized':
        return { outcome: ok(outcome.result) };
      case 'timedOut':
        return {
          outcome: err(
            timeoutOutcome(
              CaptureErrorCode.RecognitionTimedOut,
              'Recognition timed out; the captured input was retained for retry.',
            ),
          ),
          retainedInput: image,
        };
      case 'failed':
      default:
        return {
          outcome: err(
            atomicFailure(
              CaptureErrorCode.RecognitionFailed,
              outcome.reason ??
                'Recognition was unsuccessful; the captured input was retained for retry.',
            ),
          ),
          retainedInput: image,
        };
    }
  }
}
