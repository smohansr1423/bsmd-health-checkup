/**
 * CAR (Cortisol Awakening Response) window validation and diurnal deviation
 * classification — the Diurnal_Tracker `POST /car` logic (Req 11).
 *
 * This module owns ONLY the CAR two-sample protocol (a waking sample and a
 * +30-minute sample) and the deviation classification (flattened CAR and
 * elevated evening cortisol). The 4-sample diurnal protocol windows
 * (morning/noon/afternoon/evening acceptance, Req 8.3) live in the lab-result
 * ingestion module (task 9.4) and are intentionally kept separate.
 *
 * All window-validation and classification logic here is pure and testable;
 * the orchestrating {@link processCarSubmission} composes it into the endpoint
 * behaviour without touching persistence or transport.
 *
 * Requirements: 11.1, 11.2, 11.3, 11.5, 11.6
 */
import {
  type CARMeasurement,
  type CARSample,
} from '@calorie-cortisol/shared';
import {
  type ErrorContract,
  type Result,
  err,
  ok,
  validationRejection,
} from '@calorie-cortisol/shared/result';
import { CarErrorCode } from './errors';

// ---------------------------------------------------------------------------
// Protocol constants (single source of truth for the CAR windows/thresholds).
// ---------------------------------------------------------------------------

/**
 * Latest sample 1 offset from wake time, in minutes: "within 30 minutes of
 * waking" (Req 11.1) plus the ±5-minute tolerance → 35 minutes. Req 11.2
 * defines the reject condition explicitly as "first sample later than 35
 * minutes after wake time", so acceptance is any offset in [0, 35].
 */
export const CAR_SAMPLE1_MAX_OFFSET_MIN = 35;
/** Earliest sample 1 offset from wake time: a sample before waking is invalid. */
export const CAR_SAMPLE1_MIN_OFFSET_MIN = 0;

/** Sample 2 must be at least 25 minutes after sample 1 (Req 11.1, 11.2). */
export const CAR_SAMPLE2_MIN_DELTA_MIN = 25;
/** Sample 2 must be at most 35 minutes after sample 1 (Req 11.1, 11.2). */
export const CAR_SAMPLE2_MAX_DELTA_MIN = 35;

/**
 * A CAR whose increase from the waking sample to the +30-minute sample is below
 * this percentage is classified as a flattened CAR (Req 11.5).
 */
export const CAR_FLATTENED_THRESHOLD_PCT = 50;

// ---------------------------------------------------------------------------
// Domain result shapes
// ---------------------------------------------------------------------------

/** The cause identifier carried by a diurnal deviation alert (Req 11.5, 11.6). */
export type CARDeviationCause = 'flattened_car' | 'elevated_evening_cortisol';

/** A raised diurnal deviation alert (Req 11.5, 11.6). */
export interface CARDeviationAlert {
  readonly cause: CARDeviationCause;
  readonly message: string;
}

/**
 * An evening cortisol sample evaluated against the age-matched reference upper
 * bound (Req 11.6). Contextualization (selecting the reference range) is done
 * upstream; this module only compares against the provided bound.
 */
export interface EveningSample {
  readonly value: number;
  /** Upper bound of the age-matched reference range (Req 11.6). */
  readonly referenceUpper: number;
}

/** The classification outcome of a CAR measurement (Req 11.3, 11.5, 11.6). */
export interface CAREvaluation {
  /** `incomplete` withholds pattern evaluation (Req 11.3). */
  readonly status: 'incomplete' | 'complete' | 'flattened';
  /** Percent increase from waking to +30-minute sample, when computable. */
  readonly increasePct?: number;
  /** Raised deviation alerts (flattened CAR and/or elevated evening). */
  readonly alerts: readonly CARDeviationAlert[];
  /** Present when evaluation is withheld (Req 11.3). */
  readonly message?: string;
}

/** A single sample submitted for one of the two CAR slots. */
export interface CarSubmission {
  readonly userId: string;
  readonly wakeTime: string;
  /** Previously accepted samples to build on; omitted for a fresh measurement. */
  readonly existing?: Pick<CARMeasurement, 'sample1' | 'sample2'>;
  readonly sample1?: CARSample;
  readonly sample2?: CARSample;
  /** Optional evening sample for the elevated-evening check (Req 11.6). */
  readonly evening?: EveningSample;
}

/** The outcome of processing a CAR submission at the endpoint boundary. */
export interface CarSubmissionOutcome {
  /** The measurement with all currently accepted samples retained (Req 11.2). */
  readonly measurement: CARMeasurement;
  /** Structured rejections for any out-of-window samples (Req 11.2). */
  readonly rejections: readonly ErrorContract[];
  /** Pattern classification / withholding (Req 11.3, 11.5, 11.6). */
  readonly evaluation: CAREvaluation;
}

// ---------------------------------------------------------------------------
// Pure time helpers
// ---------------------------------------------------------------------------

/** Parse an ISO timestamp to epoch milliseconds, or `null` if unparseable. */
export function parseInstant(iso: string): number | null {
  if (typeof iso !== 'string' || iso.trim() === '') {
    return null;
  }
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Minutes elapsed from `fromIso` to `toIso` (positive when `toIso` is later),
 * or `null` if either timestamp is unparseable.
 */
export function minutesBetween(fromIso: string, toIso: string): number | null {
  const from = parseInstant(fromIso);
  const to = parseInstant(toIso);
  if (from === null || to === null) {
    return null;
  }
  return (to - from) / 60_000;
}

// ---------------------------------------------------------------------------
// Pure window predicates (Req 11.1)
// ---------------------------------------------------------------------------

/**
 * Whether sample 1 falls in its window: at or after wake time and no later than
 * 35 minutes after it (Req 11.1, 11.2). Unparseable timestamps are out-of-window.
 */
export function isSample1InWindow(wakeTime: string, sampleAt: string): boolean {
  const offset = minutesBetween(wakeTime, sampleAt);
  if (offset === null) {
    return false;
  }
  return (
    offset >= CAR_SAMPLE1_MIN_OFFSET_MIN && offset <= CAR_SAMPLE1_MAX_OFFSET_MIN
  );
}

/**
 * Whether sample 2 falls in its window: between 25 and 35 minutes after sample
 * 1 (Req 11.1, 11.2). Unparseable timestamps are out-of-window.
 */
export function isSample2InWindow(sample1At: string, sampleAt: string): boolean {
  const delta = minutesBetween(sample1At, sampleAt);
  if (delta === null) {
    return false;
  }
  return (
    delta >= CAR_SAMPLE2_MIN_DELTA_MIN && delta <= CAR_SAMPLE2_MAX_DELTA_MIN
  );
}

// ---------------------------------------------------------------------------
// Classification (Req 11.5, 11.6)
// ---------------------------------------------------------------------------

/**
 * Percent increase from the waking sample value to the +30-minute sample value.
 * Guards against a non-positive baseline: a rise from a non-positive baseline is
 * treated as effectively infinite (never flattened), and no change as 0%.
 */
export function computeIncreasePct(sample1Value: number, sample2Value: number): number {
  if (sample1Value <= 0) {
    return sample2Value > sample1Value ? Number.POSITIVE_INFINITY : 0;
  }
  return ((sample2Value - sample1Value) / sample1Value) * 100;
}

/**
 * Elevated-evening check (Req 11.6): raise an alert iff the evening sample
 * strictly exceeds the age-matched reference upper bound.
 */
export function classifyEvening(evening: EveningSample): CARDeviationAlert | null {
  if (evening.value > evening.referenceUpper) {
    return {
      cause: 'elevated_evening_cortisol',
      message:
        'Evening cortisol exceeds the age-matched reference range (elevated evening cortisol).',
    };
  }
  return null;
}

/**
 * Classify a CAR measurement and raise deviation alerts (Req 11.3, 11.5, 11.6).
 *
 * - With fewer than two valid samples, pattern evaluation is withheld (Req 11.3).
 * - Otherwise the increase is computed; a rise below 50% is a flattened CAR and
 *   raises a flattened-CAR alert (Req 11.5).
 * - An optional evening sample adds an elevated-evening alert (Req 11.6).
 */
export function classifyCar(
  measurement: Pick<CARMeasurement, 'sample1' | 'sample2'>,
  evening?: EveningSample,
): CAREvaluation {
  const eveningAlert = evening ? classifyEvening(evening) : null;
  const eveningAlerts = eveningAlert ? [eveningAlert] : [];

  if (!measurement.sample1 || !measurement.sample2) {
    return {
      status: 'incomplete',
      alerts: eveningAlerts,
      message:
        'CAR measurement is incomplete: two valid samples are required before the pattern can be evaluated.',
    };
  }

  const increasePct = computeIncreasePct(
    measurement.sample1.value,
    measurement.sample2.value,
  );
  const flattened = increasePct < CAR_FLATTENED_THRESHOLD_PCT;

  const alerts: CARDeviationAlert[] = [];
  if (flattened) {
    alerts.push({
      cause: 'flattened_car',
      message:
        'Cortisol awakening response is flattened: the rise from waking to +30 minutes is below 50%.',
    });
  }
  alerts.push(...eveningAlerts);

  return {
    status: flattened ? 'flattened' : 'complete',
    increasePct,
    alerts,
  };
}

// ---------------------------------------------------------------------------
// Orchestration — POST /car (Req 11.1, 11.2, 11.3, 11.5, 11.6)
// ---------------------------------------------------------------------------

function buildMeasurement(
  userId: string,
  wakeTime: string,
  sample1: CARSample | undefined,
  sample2: CARSample | undefined,
  evaluation: CAREvaluation,
): CARMeasurement {
  return {
    userId,
    wakeTime,
    sample1,
    sample2,
    increasePct: evaluation.increasePct,
    status: evaluation.status,
  };
}

/**
 * Process a `POST /car` submission (Req 11.1, 11.2, 11.3, 11.5, 11.6).
 *
 * Request-level validation failures (missing user or unparseable wake time)
 * return a rejected {@link Result}. Otherwise an outcome is returned in which:
 *  - each submitted sample is accepted iff it falls in its window, and
 *    out-of-window samples are rejected while previously accepted samples are
 *    retained (Req 11.2);
 *  - the resulting measurement is classified, withholding evaluation when fewer
 *    than two valid samples are present (Req 11.3), flagging a flattened CAR
 *    (Req 11.5), and raising an elevated-evening alert (Req 11.6).
 */
export function processCarSubmission(
  submission: CarSubmission,
): Result<CarSubmissionOutcome> {
  if (typeof submission.userId !== 'string' || submission.userId.trim() === '') {
    return err(
      validationRejection(
        CarErrorCode.INVALID_REQUEST,
        'A userId is required to record a CAR measurement.',
      ),
    );
  }
  if (parseInstant(submission.wakeTime) === null) {
    return err(
      validationRejection(
        CarErrorCode.INVALID_REQUEST,
        'A valid wake time is required to record a CAR measurement.',
      ),
    );
  }

  // Start from any previously accepted samples so they are retained (Req 11.2).
  let acceptedSample1 = submission.existing?.sample1;
  let acceptedSample2 = submission.existing?.sample2;
  const rejections: ErrorContract[] = [];

  // Validate the incoming sample 1 against its window (Req 11.1).
  if (submission.sample1) {
    if (isSample1InWindow(submission.wakeTime, submission.sample1.at)) {
      acceptedSample1 = submission.sample1;
      // A newly accepted sample 1 invalidates a prior sample 2 whose window is
      // defined relative to the old sample 1; re-validate below if resubmitted.
    } else {
      rejections.push(
        validationRejection(
          CarErrorCode.SAMPLE1_OUT_OF_WINDOW,
          'Sample 1 must be taken within 30 minutes (±5) of your recorded wake time.',
        ),
      );
    }
  }

  // Validate the incoming sample 2 relative to the accepted sample 1 (Req 11.1).
  if (submission.sample2) {
    if (!acceptedSample1) {
      rejections.push(
        validationRejection(
          CarErrorCode.SAMPLE2_WITHOUT_SAMPLE1,
          'Sample 2 cannot be validated without an accepted sample 1.',
        ),
      );
    } else if (isSample2InWindow(acceptedSample1.at, submission.sample2.at)) {
      acceptedSample2 = submission.sample2;
    } else {
      rejections.push(
        validationRejection(
          CarErrorCode.SAMPLE2_OUT_OF_WINDOW,
          'Sample 2 must be taken 25 to 35 minutes after sample 1.',
        ),
      );
    }
  }

  const evaluation = classifyCar(
    { sample1: acceptedSample1, sample2: acceptedSample2 },
    submission.evening,
  );

  return ok({
    measurement: buildMeasurement(
      submission.userId,
      submission.wakeTime,
      acceptedSample1,
      acceptedSample2,
      evaluation,
    ),
    rejections,
    evaluation,
  });
}
