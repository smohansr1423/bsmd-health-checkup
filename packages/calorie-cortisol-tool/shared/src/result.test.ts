import fc from 'fast-check';
import {
  ok,
  err,
  isOk,
  isErr,
  atomicFailure,
  validationRejection,
  retainAndRetry,
  timeoutOutcome,
  capacityExceeded,
  shouldRetry,
  nextRetryDelayMinutes,
  WEARABLE_SYNC_SCHEDULE,
  CONSENT_SYNC_SCHEDULE,
  DIGEST_DELIVERY_SCHEDULE,
  type ErrorContract,
  type RetrySchedule,
} from './result';

/**
 * Unit + invariant tests for the structured error/result contract (Task 1.3).
 * Requirements: 1.2, 3.5, 21.6, 23.3
 */

const hasContractShape = (e: ErrorContract): boolean =>
  typeof e.code === 'string' &&
  typeof e.message === 'string' &&
  typeof e.retryable === 'boolean' &&
  typeof e.retainedState === 'boolean';

describe('Result wrappers', () => {
  it('ok() carries the value and narrows via isOk', () => {
    const r = ok(42);
    expect(isOk(r)).toBe(true);
    expect(isErr(r)).toBe(false);
    if (isOk(r)) {
      expect(r.value).toBe(42);
    }
  });

  it('err() carries the error and narrows via isErr', () => {
    const contract = validationRejection('BAD_INPUT', 'nope');
    const r = err<number>(contract);
    expect(isErr(r)).toBe(true);
    expect(isOk(r)).toBe(false);
    if (isErr(r)) {
      expect(r.error).toEqual(contract);
    }
  });
});

describe('Pattern 1: atomicFailure', () => {
  it('preserves prior state and defaults to retryable', () => {
    const e = atomicFailure('EXPORT_FAILED', 'export could not be written');
    expect(e).toEqual({
      code: 'EXPORT_FAILED',
      message: 'export could not be written',
      retryable: true,
      retainedState: true,
    });
  });

  it('supports terminal (non-retryable) atomic failures', () => {
    const e = atomicFailure('DELETE_FAILED', 'blocked', { retryable: false });
    expect(e.retryable).toBe(false);
    expect(e.retainedState).toBe(true);
  });
});

describe('Pattern 2: validationRejection', () => {
  it('preserves prior state and is not retryable as-is', () => {
    const e = validationRejection('RESOLUTION_TOO_LOW', 'below 640x480');
    expect(e).toEqual({
      code: 'RESOLUTION_TOO_LOW',
      message: 'below 640x480',
      retryable: false,
      retainedState: true,
    });
  });
});

describe('Pattern 3: retainAndRetry with bounded backoff', () => {
  it('follows the wearable schedule (1, 5, 15 min) then exhausts', () => {
    const s = WEARABLE_SYNC_SCHEDULE;
    expect(retainAndRetry('SYNC_FAILED', 'net down', s, 0)).toEqual({
      error: { code: 'SYNC_FAILED', message: 'net down', retryable: true, retainedState: true },
      willRetry: true,
      nextDelayMinutes: 1,
    });
    expect(retainAndRetry('SYNC_FAILED', 'net down', s, 1).nextDelayMinutes).toBe(5);
    expect(retainAndRetry('SYNC_FAILED', 'net down', s, 2).nextDelayMinutes).toBe(15);

    const exhausted = retainAndRetry('SYNC_FAILED', 'net down', s, 3);
    expect(exhausted.willRetry).toBe(false);
    expect(exhausted.nextDelayMinutes).toBeNull();
    // After the final failed attempt the error becomes non-retryable so the
    // caller surfaces the notification / in-app fallback.
    expect(exhausted.error.retryable).toBe(false);
    expect(exhausted.error.retainedState).toBe(true);
  });

  it('digest schedule retries at 30-minute intervals', () => {
    expect(nextRetryDelayMinutes(DIGEST_DELIVERY_SCHEDULE, 0)).toBe(30);
    expect(nextRetryDelayMinutes(DIGEST_DELIVERY_SCHEDULE, 2)).toBe(30);
    expect(nextRetryDelayMinutes(DIGEST_DELIVERY_SCHEDULE, 3)).toBeNull();
  });

  it('consent-sync schedule uses exponential backoff', () => {
    expect(CONSENT_SYNC_SCHEDULE.intervalsMinutes).toEqual([1, 2, 4]);
    expect(shouldRetry(CONSENT_SYNC_SCHEDULE, 3)).toBe(false);
  });
});

describe('Pattern 4: timeout & capacity', () => {
  it('timeoutOutcome retains input and offers retry', () => {
    const e = timeoutOutcome('ANALYSIS_TIMEOUT', 'exceeded 10s');
    expect(e).toEqual({
      code: 'ANALYSIS_TIMEOUT',
      message: 'exceeded 10s',
      retryable: true,
      retainedState: true,
    });
  });

  it('capacityExceeded preserves accepted work and offers retry', () => {
    const e = capacityExceeded('CAPACITY_EXCEEDED', 'shedding load');
    expect(e.retryable).toBe(true);
    expect(e.retainedState).toBe(true);
  });
});

describe('contract-shape invariants (fast-check, min 100 iterations)', () => {
  const codeArb = fc.string({ minLength: 1, maxLength: 40 });
  const msgArb = fc.string({ maxLength: 120 });

  it('every pattern factory yields a well-formed { code, message, retryable, retainedState }', () => {
    fc.assert(
      fc.property(codeArb, msgArb, fc.boolean(), (code, message, retryable) => {
        const contracts: ErrorContract[] = [
          atomicFailure(code, message, { retryable }),
          validationRejection(code, message),
          timeoutOutcome(code, message),
          capacityExceeded(code, message),
        ];
        return contracts.every(hasContractShape);
      })
    );
  });

  it('validation rejections and atomic failures always retain prior state', () => {
    fc.assert(
      fc.property(codeArb, msgArb, (code, message) => {
        return (
          validationRejection(code, message).retainedState &&
          atomicFailure(code, message).retainedState
        );
      })
    );
  });

  it('retain-and-retry always retains data and is retryable iff attempts remain', () => {
    const scheduleArb: fc.Arbitrary<RetrySchedule> = fc
      .array(fc.integer({ min: 1, max: 60 }), { minLength: 1, maxLength: 5 })
      .map((intervalsMinutes) => ({
        maxRetries: intervalsMinutes.length,
        intervalsMinutes,
      }));

    fc.assert(
      fc.property(
        codeArb,
        msgArb,
        scheduleArb,
        fc.integer({ min: 0, max: 10 }),
        (code, message, schedule, attemptsMade) => {
          const outcome = retainAndRetry(code, message, schedule, attemptsMade);
          const remaining = attemptsMade < schedule.maxRetries;
          return (
            outcome.error.retainedState === true &&
            outcome.error.retryable === remaining &&
            outcome.willRetry === remaining &&
            (remaining
              ? outcome.nextDelayMinutes !== null
              : outcome.nextDelayMinutes === null)
          );
        },
      )
    );
  });
});
