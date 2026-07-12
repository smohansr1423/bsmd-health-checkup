/**
 * Camera_Capture media handling — types, constants, and injectable ports
 * (Task 14.1).
 *
 * Camera_Capture is the shared-client component that turns raw device media
 * (single photo, multi-angle 3-shot set, gallery selection, or recorded video)
 * into a normalized {@link SubmittableImage} ready for on-device inference /
 * cloud recognition, while enforcing the capture rules of Requirement 1:
 *
 *   - single / multi-angle capture: 3 sequential shots at 0°, 45°, 90° from
 *     vertical, each within ±10° (Req 1.3, 1.4)
 *   - a multi-angle session exited before all 3 shots discards the partial set
 *     and submits nothing for volume reconstruction (Req 1.5)
 *   - gallery selections are accepted iff they are a supported format AND
 *     ≤ 20 MB, otherwise rejected without submission (Req 1.6, 1.7)
 *   - a recorded video ≤ 60 s has its single sharpest sampled frame extracted
 *     and submitted (Req 1.8)
 *   - while ambient light is < 50 lux, on-device enhancement is applied before
 *     submission (Req 1.9)
 *   - failed or timed-out recognition retains the captured input for retry with
 *     no partial result stored (Req 1.2, 21.6)
 *
 * All device / camera / recognition effects are modeled behind injectable ports
 * ({@link ImageEnhancer}, {@link SharpnessScorer}, {@link FoodRecognizer}) so the
 * capture logic itself is pure and testable — no real camera, AVFoundation,
 * CameraX, or WebRTC dependency is required to exercise it.
 *
 * Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 21.6
 */

// ---------------------------------------------------------------------------
// Constants (single source of truth for the Requirement 1 thresholds)
// ---------------------------------------------------------------------------

/** Ordered target angles (degrees from vertical) for the multi-angle flow (Req 1.3). */
export const MULTI_ANGLE_TARGETS_DEG = [0, 45, 90] as const;

/** Per-shot angular tolerance in degrees (Req 1.3). */
export const ANGLE_TOLERANCE_DEG = 10;

/** Number of shots in a complete multi-angle capture (Req 1.3, 1.4). */
export const MULTI_ANGLE_SHOT_COUNT = MULTI_ANGLE_TARGETS_DEG.length;

/** Maximum accepted media size, 20 MB (binary) (Req 1.6, 1.7). */
export const MAX_MEDIA_BYTES = 20 * 1024 * 1024;

/** Maximum accepted recorded-video duration in seconds (Req 1.8). */
export const MAX_VIDEO_DURATION_SECONDS = 60;

/** Ambient light threshold, in lux, below which enhancement is applied (Req 1.9). */
export const LOW_LIGHT_LUX_THRESHOLD = 50;

/** Supported still-image container formats (lower-case, no dot). */
export const SUPPORTED_IMAGE_FORMATS = [
  'jpeg',
  'jpg',
  'png',
  'heic',
  'heif',
  'webp',
] as const;

/** Supported recorded/gallery video container formats (lower-case, no dot). */
export const SUPPORTED_VIDEO_FORMATS = ['mp4', 'mov', 'm4v'] as const;

/** Stable, machine-readable error codes surfaced by Camera_Capture. */
export const CaptureErrorCode = {
  /** Selected media is an unsupported format or exceeds 20 MB (Req 1.7). */
  UnsupportedMedia: 'capture/unsupported-media',
  /** A multi-angle shot's measured angle is outside the ±10° window (Req 1.3). */
  AngleOutOfTolerance: 'capture/angle-out-of-tolerance',
  /** A shot was captured after the 3-shot session was already complete. */
  SessionComplete: 'capture/session-complete',
  /** Recorded video exceeds the 60 s maximum (Req 1.8). */
  VideoTooLong: 'capture/video-too-long',
  /** No frames were sampled from the video, so none can be submitted (Req 1.8). */
  NoFrames: 'capture/no-frames',
  /** Recognition returned an unsuccessful result; input retained (Req 1.2). */
  RecognitionFailed: 'capture/recognition-failed',
  /** Recognition did not complete in time; input retained (Req 1.2, 21.6). */
  RecognitionTimedOut: 'capture/recognition-timed-out',
} as const;

export type CaptureErrorCode =
  (typeof CaptureErrorCode)[keyof typeof CaptureErrorCode];

// ---------------------------------------------------------------------------
// Media models
// ---------------------------------------------------------------------------

/** How a piece of media entered the pipeline. */
export type CaptureMode = 'single' | 'multiAngle' | 'gallery' | 'video';

/**
 * Raw media as produced by the device layer (a captured photo or a
 * gallery/recorded selection). Pixel bytes are intentionally opaque here — the
 * capture logic only reasons about metadata and delegates pixel work to ports.
 */
export interface CapturedMedia {
  /** Stable identifier for the underlying media asset. */
  id: string;
  /** Container format, lower-case without a leading dot (e.g. `jpeg`, `mp4`). */
  format: string;
  /** Size of the asset in bytes. */
  byteSize: number;
  /**
   * Ambient light reading, in lux, at capture time. Present for live camera
   * captures; typically absent for gallery selections (already-captured media).
   */
  ambientLux?: number;
}

/**
 * A normalized image ready to be submitted for recognition / volume
 * reconstruction. This is the single artifact the rest of the client pipeline
 * (on-device inference, recognition) consumes.
 */
export interface SubmittableImage {
  /** Id of the source {@link CapturedMedia} (or the extracted frame's source). */
  sourceId: string;
  /** How this image was produced. */
  mode: CaptureMode;
  format: string;
  byteSize: number;
  /** Whether low-light enhancement was applied before submission (Req 1.9). */
  enhanced: boolean;
}

// ---------------------------------------------------------------------------
// Multi-angle capture
// ---------------------------------------------------------------------------

/** A single multi-angle shot with its measured angle from vertical (Req 1.3). */
export interface AngleShot {
  media: CapturedMedia;
  /** Measured angle from vertical, in degrees. */
  angleDeg: number;
}

/**
 * Progress reported after each accepted multi-angle shot. When
 * {@link isComplete} is true, all 3 shots have been captured and
 * {@link submission} carries the images passed to the Portion_Estimator for
 * volume reconstruction (Req 1.4).
 */
export interface MultiAngleProgress {
  capturedCount: number;
  isComplete: boolean;
  /** The next target angle to guide the user toward, or `null` when complete. */
  nextTargetDeg: number | null;
  /** Present iff the 3rd valid shot has just been captured (Req 1.4). */
  submission?: MultiAngleSubmission;
}

/** The complete, ordered 3-image set submitted for volume reconstruction (Req 1.4). */
export interface MultiAngleSubmission {
  images: [SubmittableImage, SubmittableImage, SubmittableImage];
}

/** Outcome of closing / abandoning a multi-angle session. */
export type MultiAngleCloseOutcome =
  | { status: 'submitted'; submission: MultiAngleSubmission }
  | { status: 'discarded'; discardedShotCount: number };

// ---------------------------------------------------------------------------
// Video frame extraction
// ---------------------------------------------------------------------------

/** A sampled video frame. `data` is an opaque handle the scorer understands. */
export interface VideoFrame {
  index: number;
  /** Presentation time of the frame within the video, in seconds. */
  timestampSeconds: number;
  data: unknown;
}

/** A recorded or gallery-selected video to extract a single frame from (Req 1.8). */
export interface VideoInput {
  id: string;
  format: string;
  byteSize: number;
  durationSeconds: number;
  /** Frames already sampled from the video by the device layer. */
  frames: readonly VideoFrame[];
  ambientLux?: number;
}

// ---------------------------------------------------------------------------
// Recognition
// ---------------------------------------------------------------------------

/** The three terminal states a recognition attempt can reach (Req 1.2). */
export type RecognitionOutcome =
  | { status: 'recognized'; result: unknown }
  | { status: 'failed'; reason?: string }
  | { status: 'timedOut' };

/**
 * The result of attempting recognition on a submittable image. On an
 * unsuccessful attempt (failed or timed out) the {@link retainedInput} is the
 * exact image kept available for retry without recapture (Req 1.2, 21.6).
 */
export interface RecognitionAttempt {
  outcome: import('@calorie-cortisol/shared/result').Result<unknown>;
  /** The retained input, present iff recognition was unsuccessful. */
  retainedInput?: SubmittableImage;
}

// ---------------------------------------------------------------------------
// Injectable ports (device / model effects)
// ---------------------------------------------------------------------------

/** Applies on-device low-light image enhancement (Req 1.9). */
export interface ImageEnhancer {
  /** Return an enhanced copy of the media. */
  enhance(media: CapturedMedia): CapturedMedia;
}

/** Scores the sharpness of a video frame; higher is sharper (Req 1.8). */
export interface SharpnessScorer {
  score(frame: VideoFrame): number;
}

/** Performs recognition on a submittable image; may fail or time out (Req 1.2). */
export interface FoodRecognizer {
  recognize(image: SubmittableImage): RecognitionOutcome;
}
