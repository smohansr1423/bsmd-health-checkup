/**
 * Personalization training-record queue (Task 14.10).
 *
 * Pure, testable logic that records every applied meal correction as a training
 * input for the Personalization_Model (Req 5.5) and guarantees durability: if
 * delivery to the backend fails, the record is retained locally and queued for
 * retry (Req 5.8) — so every applied correction produces a durable training
 * record (design Property 15).
 *
 * The meal-correction module (Task 14.7) depends only on the
 * {@link CorrectionTrainingRecorder} seam; delivery and durable storage are
 * injected as the {@link TrainingSink} and {@link TrainingQueueBackend} ports so
 * this module runs identically on iOS, Android, and the PWA, and in tests with
 * no backend at all.
 *
 * Requirements: 5.5, 5.8
 */

import {
  isErr,
  retainAndRetry,
  type ErrorContract,
  type Result,
} from '@calorie-cortisol/shared/result';

import {
  PersonalizationErrorCode,
  type Correction,
  type CorrectionTrainingRecorder,
  type RecordContext,
  type TrainingQueueBackend,
  type TrainingRecord,
  type TrainingRecordOutcome,
  type TrainingSink,
} from './types';

/** Summary of a {@link PersonalizationTrainingQueue.retryPending} pass. */
export interface RetryReport {
  /** Number of pending records a delivery was attempted for. */
  readonly attempted: number;
  /** Number of records delivered (and removed from the local queue). */
  readonly delivered: number;
  /** Number of records still pending after the pass. */
  readonly stillPending: number;
}

/** Construction options for {@link PersonalizationTrainingQueue}. */
export interface PersonalizationTrainingQueueOptions {
  /** Clock for timestamps. Defaults to `Date.now`. Injectable for tests. */
  now?: () => Date;
  /**
   * Factory for training-record ids. Defaults to a monotonic id derived from
   * the clock and an internal counter. Injectable for deterministic tests.
   */
  idFactory?: (correction: Correction) => string;
}

/**
 * Durable queue that records corrections as Personalization_Model training
 * inputs, retaining and retrying on delivery failure.
 */
export class PersonalizationTrainingQueue
  implements CorrectionTrainingRecorder
{
  private readonly sink: TrainingSink;

  private readonly backend: TrainingQueueBackend;

  private readonly now: () => Date;

  private readonly idFactory: (correction: Correction) => string;

  private counter = 0;

  constructor(
    sink: TrainingSink,
    backend: TrainingQueueBackend,
    options: PersonalizationTrainingQueueOptions = {},
  ) {
    this.sink = sink;
    this.backend = backend;
    this.now = options.now ?? (() => new Date());
    this.idFactory =
      options.idFactory ??
      ((correction) => {
        this.counter += 1;
        return `train-${correction.mealId}-${this.now().getTime()}-${this.counter}`;
      });
  }

  /**
   * Record an applied correction as a training input (Req 5.5). Delivery is
   * attempted immediately; on failure the record is persisted locally and
   * queued for retry (Req 5.8). Never throws.
   */
  record(
    correction: Correction,
    context: RecordContext = {},
  ): TrainingRecordOutcome {
    const base: TrainingRecord = {
      id: this.idFactory(correction),
      mealId: correction.mealId,
      ...(context.userId !== undefined ? { userId: context.userId } : {}),
      op: correction.op,
      createdAt: this.now().toISOString(),
      attempts: 0,
      status: 'pending',
    };
    return this.attemptDelivery(base);
  }

  /** Records currently persisted awaiting retry (Req 5.8). */
  pending(): TrainingRecord[] {
    return this.backend.readAll();
  }

  /**
   * Re-attempt delivery for every pending record. Delivered records are removed
   * from the local queue; still-failing records remain queued with an
   * incremented attempt count (Req 5.8).
   */
  retryPending(): RetryReport {
    const records = this.backend.readAll();
    let delivered = 0;
    for (const record of records) {
      const outcome = this.attemptDelivery(record);
      if (outcome.delivered) {
        delivered += 1;
      }
    }
    return {
      attempted: records.length,
      delivered,
      stillPending: this.backend.readAll().length,
    };
  }

  /**
   * Attempt to deliver a record, updating its attempt bookkeeping. On success
   * the record is removed from the local queue (if present); on failure it is
   * persisted/updated for retry with the failure retained.
   */
  private attemptDelivery(record: TrainingRecord): TrainingRecordOutcome {
    const attempted: TrainingRecord = {
      ...record,
      attempts: record.attempts + 1,
      lastAttemptAt: this.now().toISOString(),
    };

    const result = this.safeDeliver(attempted);

    if (!isErr(result)) {
      // Delivered: no local copy is retained.
      this.backend.remove(attempted.id);
      const delivered: TrainingRecord = {
        ...attempted,
        status: 'delivered',
      };
      // Clear any stale error from a previous failed attempt.
      delete delivered.lastError;
      return { record: delivered, delivered: true, queuedForRetry: false };
    }

    // Delivery failed: retain and queue for retry (Req 5.8).
    const error = result.error;
    const pending: TrainingRecord = {
      ...attempted,
      status: 'pending',
      lastError: error.message,
    };
    this.backend.save(pending);
    return {
      record: pending,
      delivered: false,
      queuedForRetry: true,
      error,
    };
  }

  /**
   * Invoke the sink, converting a thrown error into a structured
   * retain-and-retry failure so a misbehaving sink can never crash the caller.
   */
  private safeDeliver(record: TrainingRecord): Result<void> {
    try {
      return this.sink.deliver(record);
    } catch (cause) {
      const message =
        cause instanceof Error ? cause.message : 'Training sink threw.';
      const failure: ErrorContract = retainAndRetry(
        PersonalizationErrorCode.DeliveryFailed,
        `Personalization training delivery failed: ${message}`,
        // Unbounded local retry: personalization records are retained until the
        // backend accepts them (Req 5.8); the schedule here only shapes the
        // structured error, retry cadence is driven by the caller.
        { maxRetries: 1, intervalsMinutes: [1] },
        0,
      ).error;
      return { ok: false, error: failure };
    }
  }
}
