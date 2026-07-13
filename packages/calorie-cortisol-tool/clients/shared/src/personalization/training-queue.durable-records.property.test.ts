import fc from 'fast-check';

import { err, ok, type Result } from '@calorie-cortisol/shared/result';

import {
  InMemoryTrainingQueueBackend,
  PersonalizationErrorCode,
  PersonalizationTrainingQueue,
  type Correction,
  type CorrectionOp,
  type TrainingSink,
} from './index';

/**
 * Property-based test for durable training records (Task 14.11).
 *
 * Feature: calorie-cortisol-tool, Property 15
 * Property 15: Every correction produces a durable training record.
 *   For any applied meal correction, recording it as a Personalization_Model
 *   training input never loses the correction: the outcome is *exactly one* of
 *     - delivered to the backend (and no stale local copy retained), or
 *     - retained locally and queued for retry (Req 5.8),
 *   so the correction remains applied in the food log and a durable training
 *   record always exists. Across many corrections, delivered + pending accounts
 *   for every correction (nothing is dropped), and once the backend recovers a
 *   retry pass drains the queue.
 *
 * Validates: Requirements 5.5, 5.8
 */

// --- Injectable TrainingSink whose per-attempt behaviour is scripted --------

/**
 * A sink driven by a list of per-attempt outcomes. `true` delivers
 * successfully; `false` fails — either by returning a structured retryable
 * failure or (when `mode === 'throw'`) by throwing, to exercise crash-safety.
 * Attempts beyond the script default to failure.
 */
class ScriptedSink implements TrainingSink {
  private index = 0;

  public attempts = 0;

  constructor(
    private readonly succeeds: readonly boolean[],
    private readonly mode: 'return' | 'throw' = 'return',
  ) {}

  deliver(): Result<void> {
    this.attempts += 1;
    const succeed = this.succeeds[this.index] ?? false;
    this.index += 1;
    if (succeed) {
      return ok(undefined);
    }
    if (this.mode === 'throw') {
      throw new Error('sink threw');
    }
    return err({
      code: 'backend/unavailable',
      message: 'backend unavailable',
      retryable: true,
      retainedState: true,
    });
  }
}

// --- Generators ------------------------------------------------------------

const itemIdArb = fc.string({ minLength: 1, maxLength: 16 });
const queryArb = fc.string({ minLength: 1, maxLength: 40 });

const portionMultiplierArb = fc.constantFrom(
  0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 2.75, 3,
);

const correctionOpArb: fc.Arbitrary<CorrectionOp> = fc.oneof(
  fc.record({
    kind: fc.constant('setPortion' as const),
    itemId: itemIdArb,
    multiplier: portionMultiplierArb,
  }),
  fc.record({ kind: fc.constant('swap' as const), itemId: itemIdArb, query: queryArb }),
  fc.record({ kind: fc.constant('add' as const), query: queryArb }),
  fc.record({
    kind: fc.constant('addByBarcode' as const),
    barcode: fc.string({ minLength: 6, maxLength: 14 }),
  }),
  fc.record({ kind: fc.constant('delete' as const), itemId: itemIdArb }),
);

const correctionArb: fc.Arbitrary<Correction> = fc.record({
  mealId: fc.string({ minLength: 1, maxLength: 20 }),
  op: correctionOpArb,
  trainingQueued: fc.constant(false),
});

const sinkModeArb = fc.constantFrom<'return' | 'throw'>('return', 'throw');

/** Build a queue with a deterministic, collision-free id factory. */
function makeQueue(sink: TrainingSink): {
  queue: PersonalizationTrainingQueue;
  backend: InMemoryTrainingQueueBackend;
} {
  const backend = new InMemoryTrainingQueueBackend();
  let seq = 0;
  const queue = new PersonalizationTrainingQueue(sink, backend, {
    now: () => new Date('2024-01-01T00:00:00.000Z'),
    idFactory: () => {
      seq += 1;
      return `train-${seq}`;
    },
  });
  return { queue, backend };
}

describe('Property 15: every correction produces a durable training record [Feature: calorie-cortisol-tool, Property 15]', () => {
  it('captures a single correction as delivered XOR queued-for-retry, never lost (Req 5.5, 5.8)', () => {
    fc.assert(
      fc.property(
        correctionArb,
        fc.boolean(),
        sinkModeArb,
        (correction, willSucceed, mode) => {
          const sink = new ScriptedSink([willSucceed], mode);
          const { queue, backend } = makeQueue(sink);

          const outcome = queue.record(correction);

          // Recording never throws and always produces a training record for
          // the same meal — the correction is always captured (Req 5.5).
          expect(outcome.record.mealId).toBe(correction.mealId);
          expect(outcome.record.op).toEqual(correction.op);
          expect(outcome.record.attempts).toBe(1);

          // Durability core: the outcome is *exactly one* of delivered or
          // queued-for-retry — never both, never neither (no correction lost).
          expect(outcome.delivered).toBe(!outcome.queuedForRetry);

          if (willSucceed) {
            // Delivered: record marked delivered and no stale local copy kept.
            expect(outcome.delivered).toBe(true);
            expect(outcome.error).toBeUndefined();
            expect(outcome.record.status).toBe('delivered');
            expect(backend.size).toBe(0);
            expect(queue.pending()).toHaveLength(0);
          } else {
            // Failed delivery: correction remains applied and is durably queued
            // for retry with retained state signalled (Req 5.8).
            expect(outcome.queuedForRetry).toBe(true);
            expect(outcome.record.status).toBe('pending');
            expect(outcome.error?.retainedState).toBe(true);
            if (mode === 'throw') {
              expect(outcome.error?.code).toBe(
                PersonalizationErrorCode.DeliveryFailed,
              );
            }
            const pending = queue.pending();
            expect(pending).toHaveLength(1);
            expect(pending[0].id).toBe(outcome.record.id);
            expect(pending[0].mealId).toBe(correction.mealId);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('accounts for every correction across a batch: delivered + pending = total (Req 5.5, 5.8)', () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(correctionArb, fc.boolean()), {
          minLength: 1,
          maxLength: 40,
        }),
        sinkModeArb,
        (pairs, mode) => {
          const succeeds = pairs.map(([, s]) => s);
          const sink = new ScriptedSink(succeeds, mode);
          const { queue, backend } = makeQueue(sink);

          let delivered = 0;
          let queued = 0;
          for (const [correction] of pairs) {
            const outcome = queue.record(correction);
            if (outcome.delivered) {
              delivered += 1;
            }
            if (outcome.queuedForRetry) {
              queued += 1;
            }
          }

          // No correction is ever dropped: each is either delivered or pending.
          expect(delivered + queued).toBe(pairs.length);
          // Every queued correction is durably persisted for retry (Req 5.8);
          // delivered ones leave no local copy behind.
          expect(backend.size).toBe(queued);
          expect(queue.pending()).toHaveLength(queued);
          expect(delivered).toBe(succeeds.filter(Boolean).length);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('drains the durable queue once the backend recovers (Req 5.8)', () => {
    fc.assert(
      fc.property(
        fc.array(correctionArb, { minLength: 1, maxLength: 30 }),
        (corrections) => {
          // Sink fails for every initial record, then succeeds for all retries.
          const initialFailures = corrections.map(() => false);
          const retrySuccesses = corrections.map(() => true);
          const sink = new ScriptedSink(
            [...initialFailures, ...retrySuccesses],
            'return',
          );
          const { queue, backend } = makeQueue(sink);

          for (const correction of corrections) {
            const outcome = queue.record(correction);
            expect(outcome.queuedForRetry).toBe(true);
          }
          // Everything is durably retained while the backend is unavailable.
          expect(backend.size).toBe(corrections.length);

          const report = queue.retryPending();

          // A single recovery pass delivers every retained correction and
          // empties the queue — nothing is lost in the interim (Req 5.8).
          expect(report.attempted).toBe(corrections.length);
          expect(report.delivered).toBe(corrections.length);
          expect(report.stillPending).toBe(0);
          expect(backend.size).toBe(0);
          expect(queue.pending()).toHaveLength(0);
        },
      ),
      { numRuns: 100 },
    );
  });
});
