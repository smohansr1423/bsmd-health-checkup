/**
 * Structured error / degraded-outcome result contract (Task 1.3).
 *
 * The design ("Error Handling") treats degraded outcomes as first-class
 * results rather than crashes, and standardises every API error on the shape:
 *
 *   { code, message, retryable: boolean, retainedState: boolean }
 *
 * Clients use `retainedState` to decide whether to preserve local input (as in
 * Properties 1, 14, 48), and `retryable` to decide whether re-attempting the
 * operation may succeed.
 *
 * This module also provides helpers for the design's four error-handling
 * patterns:
 *   1. Atomic Failure       — no partial artifact, prior state preserved.
 *   2. Validation Rejection — reject at the boundary with a reason, prior
 *                             state preserved.
 *   3. Retain-and-Retry     — retain affected data, retry on a bounded backoff
 *                             schedule, then notify.
 *   4. Timeout & Capacity   — cancel/shed, retain input, offer retry.
 *
 * This is the TypeScript source of truth for the contract; equivalent modules
 * exist for the Python services (`shared/result.py`) and the Go service
 * (`result.go`) so all languages share the same contract.
 *
 * Requirements: 1.2, 3.5, 21.6, 23.3
 */

/** Machine-readable error code (stable identifier clients can branch on). */
export type ErrorCode = string;

/**
 * The structured error shape returned by every degraded outcome.
 */
export interface ErrorContract {
  /** Stable, machine-readable identifier for the error condition. */
  readonly code: ErrorCode;
  /** Human-readable explanation of what went wrong. */
  readonly message: string;
  /** Whether re-attempting the same operation may succeed. */
  readonly retryable: boolean;
  /**
   * Whether the caller's prior/local state was preserved unchanged (no partial
   * artifact was produced). When true, clients keep the local input available
   * for retry instead of discarding it.
   */
  readonly retainedState: boolean;
}

/** The category of degraded outcome, matching the design's four patterns. */
export type ErrorKind =
  | 'atomic-failure'
  | 'validation-rejection'
  | 'retain-and-retry'
  | 'timeout'
  | 'capacity';

/**
 * A success-or-failure result. Success carries a value; failure carries the
 * structured {@link ErrorContract}.
 */
export type Result<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: ErrorContract };

/** Construct a successful result. */
export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

/** Construct a failed result from a structured error contract. */
export function err<T = never>(error: ErrorContract): Result<T> {
  return { ok: false, error };
}

/** Type guard: narrows a result to its success branch. */
export function isOk<T>(result: Result<T>): result is { ok: true; value: T } {
  return result.ok;
}

/** Type guard: narrows a result to its failure branch. */
export function isErr<T>(
  result: Result<T>,
): result is { ok: false; error: ErrorContract } {
  return !result.ok;
}

// ---------------------------------------------------------------------------
// Pattern 1: Atomic Failure (no partial artifacts)
// ---------------------------------------------------------------------------

/**
 * Build an atomic-failure error contract. The operation produced no partial
 * artifact and the caller's prior state is unchanged (`retainedState: true`).
 * Atomic failures are typically re-attemptable, so `retryable` defaults to
 * true; pass `{ retryable: false }` for terminal conditions.
 *
 * Requirements: 3.7, 14.2, 14.3, 14.5, 14.7, 20.3, 20.7
 */
export function atomicFailure(
  code: ErrorCode,
  message: string,
  opts: { retryable?: boolean } = {},
): ErrorContract {
  return {
    code,
    message,
    retryable: opts.retryable ?? true,
    retainedState: true,
  };
}

// ---------------------------------------------------------------------------
// Pattern 2: Validation Rejection (input rejected at the boundary)
// ---------------------------------------------------------------------------

/**
 * Build a validation-rejection error contract. The input was rejected before
 * any state mutation, so prior state is preserved (`retainedState: true`).
 * The same invalid input will fail again, so `retryable` is false — the caller
 * must correct the input rather than retry as-is.
 *
 * Requirements: 1.7, 3.5, 9.4, 10.2, 11.2, 14.2, 16.5, 27.3
 */
export function validationRejection(
  code: ErrorCode,
  message: string,
): ErrorContract {
  return {
    code,
    message,
    retryable: false,
    retainedState: true,
  };
}

// ---------------------------------------------------------------------------
// Pattern 3: Retain-and-Retry with bounded backoff
// ---------------------------------------------------------------------------

/**
 * A bounded retry schedule: retry at most `maxRetries` times, waiting the
 * corresponding interval (in minutes) before each attempt.
 */
export interface RetrySchedule {
  /** Maximum number of retry attempts after the initial failure. */
  readonly maxRetries: number;
  /**
   * Wait, in minutes, before each retry attempt. `intervalsMinutes[i]` is the
   * delay before retry attempt `i + 1`. Length should equal `maxRetries`.
   */
  readonly intervalsMinutes: readonly number[];
}

/** Wearable background sync: 3 retries at 1, 5, 15 minutes (Req 9.7). */
export const WEARABLE_SYNC_SCHEDULE: RetrySchedule = {
  maxRetries: 3,
  intervalsMinutes: [1, 5, 15],
};

/** Consent-category cloud sync: 3 retries, exponential backoff (Req 17.5, 27.5). */
export const CONSENT_SYNC_SCHEDULE: RetrySchedule = {
  maxRetries: 3,
  intervalsMinutes: [1, 2, 4],
};

/** Weekly digest delivery: 3 retries at 30-minute intervals (Req 15.7). */
export const DIGEST_DELIVERY_SCHEDULE: RetrySchedule = {
  maxRetries: 3,
  intervalsMinutes: [30, 30, 30],
};

/**
 * Whether another retry should be attempted given the number of attempts
 * already made. Returns false once the schedule is exhausted.
 */
export function shouldRetry(schedule: RetrySchedule, attemptsMade: number): boolean {
  return attemptsMade >= 0 && attemptsMade < schedule.maxRetries;
}

/**
 * Delay in minutes before the next retry attempt, or `null` if the schedule is
 * exhausted (no further retry — the caller should surface the final fallback
 * notification).
 */
export function nextRetryDelayMinutes(
  schedule: RetrySchedule,
  attemptsMade: number,
): number | null {
  if (!shouldRetry(schedule, attemptsMade)) {
    return null;
  }
  // Reuse the last defined interval if the intervals list is shorter than
  // maxRetries (defensive; standard schedules define one interval per retry).
  const idx = Math.min(attemptsMade, schedule.intervalsMinutes.length - 1);
  return schedule.intervalsMinutes[idx];
}

/**
 * The outcome of a retain-and-retry step: the structured error plus whether a
 * retry is scheduled and, if so, the delay before it.
 */
export interface RetainAndRetryOutcome {
  readonly error: ErrorContract;
  /** Whether a further retry is scheduled after this failure. */
  readonly willRetry: boolean;
  /** Minutes until the next retry, or null when exhausted. */
  readonly nextDelayMinutes: number | null;
}

/**
 * Build a retain-and-retry outcome. The affected data is always retained
 * (`retainedState: true`). While retries remain, `retryable` is true; once the
 * schedule is exhausted the error is marked non-retryable so the caller
 * presents the notification / in-app fallback.
 *
 * Requirements: 9.7, 15.7, 17.5, 27.5
 */
export function retainAndRetry(
  code: ErrorCode,
  message: string,
  schedule: RetrySchedule,
  attemptsMade: number,
): RetainAndRetryOutcome {
  const willRetry = shouldRetry(schedule, attemptsMade);
  return {
    error: {
      code,
      message,
      retryable: willRetry,
      retainedState: true,
    },
    willRetry,
    nextDelayMinutes: nextRetryDelayMinutes(schedule, attemptsMade),
  };
}

// ---------------------------------------------------------------------------
// Pattern 4: Timeout & Capacity
// ---------------------------------------------------------------------------

/**
 * Build a timeout error contract. The in-flight operation was cancelled, the
 * input is retained, and the caller is offered a retry.
 *
 * Requirements: 1.2, 21.6
 */
export function timeoutOutcome(code: ErrorCode, message: string): ErrorContract {
  return {
    code,
    message,
    retryable: true,
    retainedState: true,
  };
}

/**
 * Build a capacity-exceeded error contract. Excess requests are rejected or
 * queued while accepted in-progress work is preserved; the caller may retry.
 *
 * Requirements: 23.3
 */
export function capacityExceeded(
  code: ErrorCode,
  message: string,
): ErrorContract {
  return {
    code,
    message,
    retryable: true,
    retainedState: true,
  };
}
