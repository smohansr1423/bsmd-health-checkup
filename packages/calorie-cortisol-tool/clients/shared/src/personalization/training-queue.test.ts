import { err, ok, type Result } from '@calorie-cortisol/shared/result';
import {
  InMemoryTrainingQueueBackend,
  PersonalizationErrorCode,
  PersonalizationTrainingQueue,
  type Correction,
  type TrainingRecord,
  type TrainingSink,
} from './index';

/**
 * Unit tests for the personalization training-record queue (Task 14.10).
 *
 * Covers recording an applied correction as a training input (Req 5.5) and the
 * retain-and-queue-for-retry behaviour on delivery failure (Req 5.8).
 */

// --- Test doubles for the injectable TrainingSink port ---------------------

/** Always delivers successfully; records what it received. */
class DeliveringSink implements TrainingSink {
  public delivered: TrainingRecord[] = [];

  deliver(record: TrainingRecord): Result<void> {
    this.delivered.push(record);
    return ok(undefined);
  }
}

/** Always fails delivery with a structured error. */
class FailingSink implements TrainingSink {
  public calls = 0;

  deliver(): Result<void> {
    this.calls += 1;
    return err({
      code: 'backend/unavailable',
      message: 'backend unavailable',
      retryable: true,
      retainedState: true,
    });
  }
}

/** Throws on delivery to exercise the crash-safety path. */
class ThrowingSink implements TrainingSink {
  deliver(): Result<void> {
    throw new Error('socket hangup');
  }
}

/** Fails for the first `failures` attempts, then delivers. */
class FlakySink implements TrainingSink {
  public calls = 0;

  constructor(private failures: number) {}

  deliver(): Result<void> {
    this.calls += 1;
    if (this.calls <= this.failures) {
      return err({
        code: 'backend/unavailable',
        message: 'temporary failure',
        retryable: true,
        retainedState: true,
      });
    }
    return ok(undefined);
  }
}

// --- Fixtures --------------------------------------------------------------

let idSeq = 0;
const fixedIds = (): string => {
  idSeq += 1;
  return `train-${idSeq}`;
};

function makeQueue(sink: TrainingSink): {
  queue: PersonalizationTrainingQueue;
  backend: InMemoryTrainingQueueBackend;
} {
  const backend = new InMemoryTrainingQueueBackend();
  const queue = new PersonalizationTrainingQueue(sink, backend, {
    now: () => new Date('2024-01-01T00:00:00.000Z'),
    idFactory: fixedIds,
  });
  return { queue, backend };
}

const correction = (over: Partial<Correction> = {}): Correction => ({
  mealId: 'meal-1',
  op: { kind: 'setPortion', itemId: 'item-1', multiplier: 1.5 },
  trainingQueued: false,
  ...over,
});

beforeEach(() => {
  idSeq = 0;
});

// --- Successful recording (Req 5.5) ----------------------------------------

describe('recording a correction as training input (Req 5.5)', () => {
  it('delivers the record and retains no local copy on success', () => {
    const sink = new DeliveringSink();
    const { queue, backend } = makeQueue(sink);

    const outcome = queue.record(correction());

    expect(outcome.delivered).toBe(true);
    expect(outcome.queuedForRetry).toBe(false);
    expect(outcome.error).toBeUndefined();
    expect(outcome.record.status).toBe('delivered');
    expect(outcome.record.attempts).toBe(1);
    expect(sink.delivered).toHaveLength(1);
    // No pending copy retained when delivery succeeds.
    expect(backend.size).toBe(0);
    expect(queue.pending()).toHaveLength(0);
  });

  it('carries the correction op and optional user id onto the record', () => {
    const { queue } = makeQueue(new DeliveringSink());
    const op = { kind: 'delete', itemId: 'item-9' } as const;

    const outcome = queue.record(correction({ mealId: 'meal-42', op }), {
      userId: 'user-7',
    });

    expect(outcome.record.mealId).toBe('meal-42');
    expect(outcome.record.op).toEqual(op);
    expect(outcome.record.userId).toBe('user-7');
  });
});

// --- Delivery failure → retain & queue for retry (Req 5.8) ------------------

describe('delivery failure retains and queues for retry (Req 5.8)', () => {
  it('persists the record locally when delivery returns a failure', () => {
    const sink = new FailingSink();
    const { queue, backend } = makeQueue(sink);

    const outcome = queue.record(correction());

    expect(outcome.delivered).toBe(false);
    expect(outcome.queuedForRetry).toBe(true);
    expect(outcome.record.status).toBe('pending');
    expect(outcome.record.attempts).toBe(1);
    expect(outcome.record.lastError).toBe('backend unavailable');
    expect(outcome.error?.retainedState).toBe(true);
    // The correction is durably queued for retry.
    expect(backend.size).toBe(1);
    expect(queue.pending()).toHaveLength(1);
    expect(queue.pending()[0].mealId).toBe('meal-1');
  });

  it('treats a thrown sink error as a retryable delivery failure', () => {
    const { queue, backend } = makeQueue(new ThrowingSink());

    const outcome = queue.record(correction());

    expect(outcome.delivered).toBe(false);
    expect(outcome.queuedForRetry).toBe(true);
    expect(outcome.error?.code).toBe(PersonalizationErrorCode.DeliveryFailed);
    expect(outcome.error?.retainedState).toBe(true);
    expect(backend.size).toBe(1);
  });
});

// --- Retry pass -------------------------------------------------------------

describe('retryPending', () => {
  it('delivers previously-failed records and clears them from the queue', () => {
    const sink = new FlakySink(1); // first attempt fails, next succeeds
    const { queue, backend } = makeQueue(sink);

    const first = queue.record(correction());
    expect(first.queuedForRetry).toBe(true);
    expect(backend.size).toBe(1);

    const report = queue.retryPending();

    expect(report.attempted).toBe(1);
    expect(report.delivered).toBe(1);
    expect(report.stillPending).toBe(0);
    expect(backend.size).toBe(0);
    expect(queue.pending()).toHaveLength(0);
  });

  it('keeps still-failing records queued and increments their attempt count', () => {
    const sink = new FailingSink();
    const { queue, backend } = makeQueue(sink);

    queue.record(correction());
    expect(queue.pending()[0].attempts).toBe(1);

    const report = queue.retryPending();

    expect(report.attempted).toBe(1);
    expect(report.delivered).toBe(0);
    expect(report.stillPending).toBe(1);
    expect(backend.size).toBe(1);
    expect(queue.pending()[0].attempts).toBe(2);
  });

  it('does nothing when there are no pending records', () => {
    const { queue } = makeQueue(new DeliveringSink());
    const report = queue.retryPending();
    expect(report).toEqual({ attempted: 0, delivered: 0, stillPending: 0 });
  });
});
