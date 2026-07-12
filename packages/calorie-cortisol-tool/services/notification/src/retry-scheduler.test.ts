import {
  CONSENT_SYNC_SCHEDULE,
  DIGEST_DELIVERY_SCHEDULE,
  WEARABLE_SYNC_SCHEDULE,
} from '@calorie-cortisol/shared/result';
import { executeWithRetry, type RetainableOperation } from './retry-scheduler';

/**
 * Unit tests for the shared bounded-retry scheduler (Task 13.1).
 * Covers success, retry-then-succeed, exhaustion → fallback, artifact
 * retention, and the recorded backoff schedule.
 *
 * Requirements: 9.7, 15.7, 17.5, 27.5
 */
describe('executeWithRetry', () => {
  const artifact = { id: 'digest-1', summary: 'weekly digest' } as const;

  /** Build an operation that fails `failures` times before succeeding. */
  const scriptedOperation = (
    failures: number,
  ): RetainableOperation<typeof artifact> & { calls: number } => {
    let calls = 0;
    return {
      artifact,
      get calls() {
        return calls;
      },
      async attempt() {
        calls += 1;
        return calls > failures;
      },
    };
  };

  it('succeeds on the initial attempt with no retries or fallback', async () => {
    const op = scriptedOperation(0);
    const result = await executeWithRetry(op, WEARABLE_SYNC_SCHEDULE);

    expect(result.delivered).toBe(true);
    expect(result.attempts).toBe(1);
    expect(result.retries).toBe(0);
    expect(result.fallbackPresented).toBe(false);
    expect(result.error).toBeUndefined();
    expect(op.calls).toBe(1);
  });

  it('retries on the schedule and succeeds before exhaustion', async () => {
    const op = scriptedOperation(2); // fail, fail, succeed
    const waited: number[] = [];
    const result = await executeWithRetry(op, WEARABLE_SYNC_SCHEDULE, {
      waitMinutes: async (m) => {
        waited.push(m);
      },
    });

    expect(result.delivered).toBe(true);
    expect(result.retries).toBe(2);
    expect(result.attempts).toBe(3);
    expect(result.fallbackPresented).toBe(false);
    // Waited the first two wearable intervals (1 min, then 5 min).
    expect(waited).toEqual([1, 5]);
  });

  it('exhausts the schedule and signals the fallback with a non-retryable retained error', async () => {
    const op = scriptedOperation(Number.POSITIVE_INFINITY); // always fails
    const waited: number[] = [];
    const result = await executeWithRetry(op, WEARABLE_SYNC_SCHEDULE, {
      waitMinutes: async (m) => {
        waited.push(m);
      },
      errorCode: 'WEARABLE_SYNC_FAILED',
      errorMessage: 'nope',
    });

    expect(result.delivered).toBe(false);
    // Initial attempt + 3 retries = 4 attempts.
    expect(result.attempts).toBe(4);
    expect(result.retries).toBe(WEARABLE_SYNC_SCHEDULE.maxRetries);
    expect(result.fallbackPresented).toBe(true);
    expect(result.error).toEqual({
      code: 'WEARABLE_SYNC_FAILED',
      message: 'nope',
      retryable: false,
      retainedState: true,
    });
    // Full wearable backoff schedule was walked.
    expect(waited).toEqual([1, 5, 15]);
  });

  it('retains the affected artifact unchanged across retries and into the fallback', async () => {
    const op = scriptedOperation(Number.POSITIVE_INFINITY);
    const result = await executeWithRetry(op, CONSENT_SYNC_SCHEDULE);

    expect(result.retainedArtifact).toBe(artifact);
    expect(result.fallbackPresented).toBe(true);
  });

  it('treats a rejected attempt as a failure', async () => {
    let calls = 0;
    const op: RetainableOperation<typeof artifact> = {
      artifact,
      async attempt() {
        calls += 1;
        if (calls === 1) throw new Error('transport down');
        return true;
      },
    };
    const result = await executeWithRetry(op, DIGEST_DELIVERY_SCHEDULE);

    expect(result.delivered).toBe(true);
    expect(result.retries).toBe(1);
    expect(result.history[0]).toMatchObject({ attemptNumber: 1, succeeded: false });
  });
});
