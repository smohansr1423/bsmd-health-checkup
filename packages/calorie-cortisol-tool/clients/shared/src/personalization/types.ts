/**
 * Personalization training-record queue — types, constants, and injectable
 * ports (Task 14.10).
 *
 * When a user applies a meal correction (Task 14.7), that correction must be
 * recorded as a training input for the per-user Personalization_Model
 * (Req 5.5). Recording flows to the backend asynchronously (SQS in production);
 * if that enqueue/delivery fails, the correction must remain applied in the
 * user's food log and be queued locally for retry (Req 5.8), so that **every**
 * applied correction produces a durable training record (design Property 15).
 *
 * This module owns only the durable-queue concern. The food-log/meal state is
 * owned by the meal-correction module (Task 14.7); that module depends on the
 * clean {@link CorrectionTrainingRecorder} seam exported here to hand off each
 * applied correction — it never reaches into the queue internals.
 *
 * All effects are modeled behind injectable ports so the queue logic is pure
 * and testable:
 *   - {@link TrainingSink}         — delivers a record to the backend (may fail)
 *   - {@link TrainingQueueBackend} — local durable store for pending retries
 *
 * Requirements: 5.5, 5.8
 */

import type { Correction, CorrectionOp } from '@calorie-cortisol/shared';
import type { ErrorContract, Result } from '@calorie-cortisol/shared/result';

// Re-export the shared correction contract for convenience so consumers of the
// recorder seam can refer to it without a second import.
export type { Correction, CorrectionOp };

/** Stable, machine-readable error codes surfaced by the training queue. */
export const PersonalizationErrorCode = {
  /**
   * Delivery of a training record to the Personalization_Model backend failed
   * (network/backend error or the sink threw). The record is retained locally
   * and queued for retry (Req 5.8).
   */
  DeliveryFailed: 'personalization/delivery-failed',
} as const;

export type PersonalizationErrorCode =
  (typeof PersonalizationErrorCode)[keyof typeof PersonalizationErrorCode];

/** Lifecycle of a training record. */
export type TrainingRecordStatus =
  /** Persisted locally, awaiting (re)delivery to the backend (Req 5.8). */
  | 'pending'
  /** Successfully delivered to the Personalization_Model backend (Req 5.5). */
  | 'delivered';

/**
 * A training input derived from a single applied correction. This is the
 * durable artifact guaranteed by Property 15: every applied correction yields
 * exactly one of these, either delivered to the backend or persisted for retry.
 */
export interface TrainingRecord {
  /** Stable unique id for this training record. */
  id: string;
  /** The meal the correction was applied to (Req 5.5). */
  mealId: string;
  /** Owning user, when known (family accounts hold multiple users — Req 19). */
  userId?: string;
  /** The correction operation that produced this training input. */
  op: CorrectionOp;
  /** ISO timestamp when the record was created. */
  createdAt: string;
  /** ISO timestamp of the most recent delivery attempt, if any. */
  lastAttemptAt?: string;
  /** Number of delivery attempts made so far (≥ 1 once first attempted). */
  attempts: number;
  /** Current lifecycle state. */
  status: TrainingRecordStatus;
  /** Human-readable reason for the last failed delivery, if any. */
  lastError?: string;
}

/** Optional context supplied by the caller when recording a correction. */
export interface RecordContext {
  /** Owning user id (recorded onto the training record when present). */
  userId?: string;
}

/**
 * Outcome of recording (or retrying) a correction as a training input. The
 * correction is **always** durably captured: either it was delivered to the
 * backend, or it is now persisted in the local retry queue.
 */
export interface TrainingRecordOutcome {
  /** The durable training record (delivered or pending). */
  readonly record: TrainingRecord;
  /** Whether the record was delivered to the backend on this attempt. */
  readonly delivered: boolean;
  /** Whether the record is now persisted locally awaiting retry (Req 5.8). */
  readonly queuedForRetry: boolean;
  /** The delivery error, present iff delivery failed on this attempt. */
  readonly error?: ErrorContract;
}

/**
 * The clean seam the meal-correction module (Task 14.7) depends on: hand every
 * applied correction to {@link record} and the queue guarantees durability.
 *
 * Kept intentionally minimal so the correction module can depend on the
 * interface without importing the concrete queue implementation.
 */
export interface CorrectionTrainingRecorder {
  /**
   * Record an applied correction as a training input for the
   * Personalization_Model (Req 5.5). On delivery failure the record is retained
   * and queued for retry (Req 5.8). Never throws.
   */
  record(
    correction: Correction,
    context?: RecordContext,
  ): TrainingRecordOutcome;
}

/**
 * Injectable delivery port to the Personalization_Model backend (SQS/HTTP in
 * production). Implementations return a failed {@link Result} — or throw — when
 * delivery is unsuccessful; the queue treats either as a retryable failure.
 */
export interface TrainingSink {
  /** Attempt to deliver a training record to the backend. */
  deliver(record: TrainingRecord): Result<void>;
}

/**
 * Local durable store for records awaiting retry. Concrete implementations wrap
 * the on-device Data Vault / platform store; {@link InMemoryTrainingQueueBackend}
 * is the reference backend used for testing.
 *
 * Only records that failed delivery are persisted here; successfully delivered
 * records are not stored locally.
 */
export interface TrainingQueueBackend {
  /** Insert or replace a pending record. */
  save(record: TrainingRecord): void;
  /** Return the pending record with the given id, or `undefined`. */
  read(id: string): TrainingRecord | undefined;
  /** Return all persisted pending records (order is not guaranteed). */
  readAll(): TrainingRecord[];
  /** Remove the record with the given id; returns whether one was removed. */
  remove(id: string): boolean;
}
