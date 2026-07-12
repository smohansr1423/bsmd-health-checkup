/**
 * Shared bounded-retry scheduler (Task 13.1).
 *
 * Implements the design's "Retain-and-Retry with bounded backoff" pattern as a
 * single reusable engine. Given a fallible operation and one of the defined
 * retry schedules, it:
 *
 *   1. retains the affected data/artifact unchanged across every attempt,
 *   2. retries on the schedule's bounded backoff (sync 3× at 1/5/15 min;
 *      consent-sync 3×; digest 3× at 30 min), and
 *   3. after the final failed attempt, marks the outcome so the caller can
 *      present a notification / in-app fallback.
 *
 * The schedule definitions and the arithmetic (`shouldRetry`,
 * `nextRetryDelayMinutes`, `retainAndRetry`) are reused verbatim from the shared
 * result contract (`@calorie-cortisol/shared/result`) rather than re-derived
 * here, so the whole system shares one source of truth for the retry policy.
 *
 * Waiting between attempts is delegated to an injectable `waitMinutes` function
 * so tests run instantly and production can plug in a real timer / SQS
 * visibility-timeout delay.
 *
 * Requirements: 9.7, 15.7, 17.5, 27.5
 */

import {
  type ErrorContract,
  type RetrySchedule,
  nextRetryDelayMinutes,
  retainAndRetry,
  shouldRetry,
} from '@calorie-cortisol/shared/result';

export type { RetrySchedule };

/**
 * A fallible, retainable operation. The `artifact` is the affected data that
 * must survive unchanged across retries and into the fallback. `attempt`
 * performs one delivery/sync try and resolves `true` on success, `false` (or
 * rejects) on failure.
 */
export interface RetainableOperation<T> {
  readonly artifact: T;
  attempt(): Promise<boolean>;
}

/** Record of a single attempt within a bounded-retry run. */
export interface AttemptRecord {
  /** 1-based attempt number (1 = the initial attempt). */
  readonly attemptNumber: number;
  /** Minutes waited before this attempt (0 for the initial attempt). */
  readonly waitedMinutes: number;
  /** Whether this attempt succeeded. */
  readonly succeeded: boolean;
}

/** The outcome of a bounded-retry run. */
export interface BoundedRetryResult<T> {
  /** Whether the operation ultimately succeeded within the schedule. */
  readonly delivered: boolean;
  /** Total attempts performed, including the initial attempt. */
  readonly attempts: number;
  /** Number of retries performed after the initial attempt. */
  readonly retries: number;
  /** The affected artifact, retained unchanged. */
  readonly retainedArtifact: T;
  /**
   * True iff the schedule was exhausted without success — the caller must
   * present the notification / in-app fallback.
   */
  readonly fallbackPresented: boolean;
  /**
   * The final structured error when exhausted (retryable=false,
   * retainedState=true), or `undefined` when delivered successfully.
   */
  readonly error?: ErrorContract;
  /** Per-attempt history, useful for assertions and audit. */
  readonly history: ReadonlyArray<AttemptRecord>;
}

/** Options controlling a bounded-retry run. */
export interface BoundedRetryOptions {
  /**
   * Wait hook invoked with the delay (in minutes) before each retry. Defaults
   * to a no-op so tests run instantly; production supplies a real delay.
   */
  waitMinutes?: (minutes: number) => Promise<void>;
  /** Stable error code carried on the exhaustion error contract. */
  errorCode?: string;
  /** Human-readable message carried on the exhaustion error contract. */
  errorMessage?: string;
}

const noWait = async (): Promise<void> => {
  /* instant: no real delay in tests / default */
};

/**
 * Run a retainable operation under a bounded retry schedule.
 *
 * Attempt sequencing matches Req 9.7: the initial attempt runs immediately; on
 * failure the operation is retried at most `schedule.maxRetries` times, waiting
 * `schedule.intervalsMinutes[i]` before retry `i + 1`. After the final failed
 * retry, the run stops and `fallbackPresented` is set so the caller surfaces a
 * notification / in-app fallback. The artifact is never mutated.
 */
export async function executeWithRetry<T>(
  operation: RetainableOperation<T>,
  schedule: RetrySchedule,
  options: BoundedRetryOptions = {},
): Promise<BoundedRetryResult<T>> {
  const waitMinutes = options.waitMinutes ?? noWait;
  const history: AttemptRecord[] = [];

  const runAttempt = async (attemptNumber: number, waitedMinutes: number): Promise<boolean> => {
    let succeeded = false;
    try {
      succeeded = await operation.attempt();
    } catch {
      succeeded = false;
    }
    history.push({ attemptNumber, waitedMinutes, succeeded });
    return succeeded;
  };

  // Initial attempt (retriesMade === 0).
  let delivered = await runAttempt(1, 0);
  let retriesMade = 0;

  // Bounded retries on the schedule's backoff.
  while (!delivered && shouldRetry(schedule, retriesMade)) {
    const delay = nextRetryDelayMinutes(schedule, retriesMade) ?? 0;
    await waitMinutes(delay);
    retriesMade += 1;
    delivered = await runAttempt(retriesMade + 1, delay);
  }

  if (delivered) {
    return {
      delivered: true,
      attempts: history.length,
      retries: retriesMade,
      retainedArtifact: operation.artifact,
      fallbackPresented: false,
      history,
    };
  }

  // Schedule exhausted: build the retain-and-retry outcome. With retriesMade
  // equal to maxRetries, `willRetry` is false and the error is non-retryable —
  // the signal to present the fallback (Property 50).
  const outcome = retainAndRetry(
    options.errorCode ?? 'DELIVERY_FAILED',
    options.errorMessage ?? 'Delivery failed after exhausting the retry schedule.',
    schedule,
    retriesMade,
  );

  return {
    delivered: false,
    attempts: history.length,
    retries: retriesMade,
    retainedArtifact: operation.artifact,
    fallbackPresented: !outcome.willRetry,
    error: outcome.error,
    history,
  };
}
