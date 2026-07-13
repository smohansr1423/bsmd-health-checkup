import fc from 'fast-check';

import {
  CONSENT_SYNC_SCHEDULE,
  DIGEST_DELIVERY_SCHEDULE,
  WEARABLE_SYNC_SCHEDULE,
  type RetrySchedule,
} from '@calorie-cortisol/shared/result';

import { executeWithRetry, type RetainableOperation } from './retry-scheduler';

/**
 * Property-based test for the shared bounded-retry scheduler (Task 13.2).
 *
 * Feature: calorie-cortisol-tool, Property 50
 * Property 50: Bounded retry with data retention.
 *   For any failing synchronization or delivery operation, the affected
 *   data/artifact is retained unchanged, retries are bounded by the operation's
 *   defined schedule (sync 3× at 1/5/15 min; consent-sync 3×; digest 3× at
 *   30 min), and after the final failed attempt a notification/in-app fallback
 *   is presented.
 *
 * Validates: Requirements 9.7, 15.7, 17.5, 27.5
 *
 * The global fast-check default is 10 runs; this suite pins numRuns >= 100
 * inline so the property is exercised across a broad input space.
 */

const NUM_RUNS = 100;

/** The three schedules the design defines for retain-and-retry (Property 50). */
const SCHEDULES: readonly RetrySchedule[] = [
  WEARABLE_SYNC_SCHEDULE, // sync: 3 × [1, 5, 15] min
  CONSENT_SYNC_SCHEDULE, // consent-sync: 3 × [1, 2, 4] min
  DIGEST_DELIVERY_SCHEDULE, // digest: 3 × [30, 30, 30] min
];

interface Artifact {
  id: string;
  kind: string;
  payload: number[];
  meta: Record<string, string>;
}

/** An arbitrary, structured "affected artifact" that must survive unchanged. */
const artifactArb: fc.Arbitrary<Artifact> = fc.record({
  id: fc.string({ minLength: 1, maxLength: 24 }),
  kind: fc.constantFrom('digest', 'sync-batch', 'consent-payload', 'deviation-alert'),
  payload: fc.array(fc.integer({ min: -1000, max: 1000 }), { maxLength: 8 }),
  meta: fc.dictionary(fc.string({ maxLength: 6 }), fc.string({ maxLength: 12 }), { maxKeys: 4 }),
});

/**
 * Build an operation that fails `failures` times (as a returned `false` or a
 * thrown error, per `throwOnFail`) before succeeding, over a retained artifact.
 */
const scriptedOperation = (
  artifact: Artifact,
  failures: number,
  throwOnFail: boolean,
): RetainableOperation<Artifact> & { calls: number } => {
  let calls = 0;
  return {
    artifact,
    get calls() {
      return calls;
    },
    async attempt(): Promise<boolean> {
      calls += 1;
      if (calls > failures) {
        return true;
      }
      if (throwOnFail) {
        throw new Error(`transport failure on attempt ${calls}`);
      }
      return false;
    },
  };
};

describe('Property 50: bounded retry with data retention', () => {
  it('retains the artifact, bounds retries by the schedule, and presents a fallback only on exhaustion', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...SCHEDULES),
        artifactArb,
        // 0..maxRetries+3 spans "succeeds within schedule" and "always fails".
        fc.integer({ min: 0, max: 6 }),
        fc.boolean(),
        async (schedule, artifact, failures, throwOnFail) => {
          const snapshot = JSON.stringify(artifact);
          const op = scriptedOperation(artifact, failures, throwOnFail);
          const waited: number[] = [];

          const result = await executeWithRetry(op, schedule, {
            waitMinutes: async (m) => {
              waited.push(m);
            },
            errorCode: 'DELIVERY_FAILED',
            errorMessage: 'exhausted',
          });

          // --- Retention: the affected artifact is retained, unchanged. ---
          expect(result.retainedArtifact).toBe(artifact);
          expect(JSON.stringify(result.retainedArtifact)).toBe(snapshot);

          // --- Bounded: never more than maxRetries retries / maxRetries+1 attempts. ---
          expect(result.retries).toBeGreaterThanOrEqual(0);
          expect(result.retries).toBeLessThanOrEqual(schedule.maxRetries);
          expect(result.attempts).toBe(result.retries + 1);
          expect(result.attempts).toBeLessThanOrEqual(schedule.maxRetries + 1);
          expect(result.history.length).toBe(result.attempts);

          // --- Waits follow the schedule's backoff, one per retry, in order. ---
          const expectedWaits = schedule.intervalsMinutes.slice(0, result.retries);
          expect(waited).toEqual(expectedWaits);

          const willSucceed = failures <= schedule.maxRetries;
          if (willSucceed) {
            // Delivered within the schedule: exactly `failures` retries, no fallback.
            expect(result.delivered).toBe(true);
            expect(result.retries).toBe(failures);
            expect(result.fallbackPresented).toBe(false);
            expect(result.error).toBeUndefined();
          } else {
            // Schedule exhausted: the fallback is presented after the final failure.
            expect(result.delivered).toBe(false);
            expect(result.retries).toBe(schedule.maxRetries);
            expect(result.fallbackPresented).toBe(true);
            // Non-retryable, data-retaining error is the fallback signal (Property 50).
            expect(result.error).toEqual({
              code: 'DELIVERY_FAILED',
              message: 'exhausted',
              retryable: false,
              retainedState: true,
            });
          }

          // History integrity: attempt numbers are 1..attempts; only the last
          // may succeed, and it succeeds iff the run was delivered.
          result.history.forEach((record, index) => {
            expect(record.attemptNumber).toBe(index + 1);
            const isLast = index === result.history.length - 1;
            expect(record.succeeded).toBe(isLast && result.delivered);
          });
          // The waited minutes recorded on history match the schedule too
          // (0 for the initial attempt, then the schedule intervals).
          expect(result.history.map((r) => r.waitedMinutes)).toEqual([0, ...expectedWaits]);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('presents the fallback for every schedule when the operation always fails, walking the full backoff', async () => {
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(...SCHEDULES), artifactArb, async (schedule, artifact) => {
        const op = scriptedOperation(artifact, Number.POSITIVE_INFINITY, false);
        const waited: number[] = [];

        const result = await executeWithRetry(op, schedule, {
          waitMinutes: async (m) => {
            waited.push(m);
          },
        });

        expect(result.delivered).toBe(false);
        expect(result.fallbackPresented).toBe(true);
        expect(result.retries).toBe(schedule.maxRetries);
        expect(result.attempts).toBe(schedule.maxRetries + 1);
        // The complete, bounded backoff for the schedule was walked exactly once.
        expect(waited).toEqual([...schedule.intervalsMinutes]);
        expect(result.error?.retainedState).toBe(true);
        expect(result.error?.retryable).toBe(false);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
