import fc from 'fast-check';

import { ok, err, type Result } from '@calorie-cortisol/shared/result';
import type { FoodItem } from '@calorie-cortisol/shared';

import {
  DataVault,
  InMemoryStorageBackend,
  VAULT_MIN_FREE_BYTES,
  VaultErrorCode,
} from '../data-vault';

import {
  OfflineCapture,
  type DetectionResult,
  type OfflineCaptureRecord,
  type OnDeviceInference,
  type TimeoutScheduler,
} from './index';

/**
 * Property-based test for offline capture storage and pending status
 * (Task 14.17).
 *
 * Feature: calorie-cortisol-tool, Property 51
 * Property 51: Offline capture storage and pending status.
 *   For any offline capture, the record is stored in the local Data Vault; if
 *   on-device inference does not complete within 10 s (a timeout, or a hard
 *   inference failure) the photo is stored with "inference pending" status; and
 *   if free storage is below the 50 MB minimum the capture is rejected with
 *   existing records retained.
 *
 * Validates: Requirements 27.1, 27.2, 27.3
 */

// ---------------------------------------------------------------------------
// Test doubles (mirror the deterministic pairings used by the unit tests so
// the 10 s guard race has an unambiguous winner per scenario).
// ---------------------------------------------------------------------------

/** Fires the timeout synchronously — drives the pending branch. */
class ImmediateTimeoutScheduler implements TimeoutScheduler {
  schedule(_ms: number, onTimeout: () => void): () => void {
    onTimeout();
    return () => undefined;
  }
}

/** Never fires — on-device inference always wins the race. */
class NeverTimeoutScheduler implements TimeoutScheduler {
  schedule(_ms: number, _onTimeout: () => void): () => void {
    return () => undefined;
  }
}

/** Resolves immediately with a scripted structured result. */
class StubInference implements OnDeviceInference {
  constructor(private readonly result: Result<DetectionResult>) {}

  infer(): Promise<Result<DetectionResult>> {
    return Promise.resolve(this.result);
  }
}

/** Never resolves — only the guard timer can settle the race. */
class HangingInference implements OnDeviceInference {
  infer(): Promise<Result<DetectionResult>> {
    return new Promise<Result<DetectionResult>>(() => undefined);
  }
}

const detection = (label: string): DetectionResult => ({
  items: [{ id: `${label}-1`, label, confidence: 90 } as FoodItem],
});

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/**
 * The three deterministic inference scenarios. `success` yields a completed
 * detection within budget; `timeout` and `failure` both drive the
 * "inference pending" branch (Req 27.2).
 */
type InferenceScenario = 'success' | 'timeout' | 'failure';

const inferenceScenarioArb = fc.constantFrom<InferenceScenario>(
  'success',
  'timeout',
  'failure',
);

/**
 * Free-storage generator that straddles the 50 MB boundary: sometimes below
 * the minimum (capture must be rejected, Req 27.3), sometimes at/above it
 * (capture must be stored).
 */
const freeBytesArb = fc.oneof(
  // Below the 50 MB minimum -> rejection expected.
  fc.integer({ min: 0, max: VAULT_MIN_FREE_BYTES - 1 }),
  // At or above the minimum -> storage expected (boundary included).
  fc.integer({ min: VAULT_MIN_FREE_BYTES, max: VAULT_MIN_FREE_BYTES * 4 }),
);

const idArb = fc.string({ minLength: 1, maxLength: 16 });
const refArb = fc.string({ minLength: 1, maxLength: 24 });

/**
 * Build an OfflineCapture wired for a given inference scenario over a vault
 * whose backend reports `freeBytes` free storage.
 */
function makeCapture(
  scenario: InferenceScenario,
  freeBytes: number,
): { engine: OfflineCapture; vault: DataVault; backend: InMemoryStorageBackend } {
  const backend = new InMemoryStorageBackend({ freeBytes });
  const vault = new DataVault(backend);

  const inference: OnDeviceInference =
    scenario === 'success'
      ? new StubInference(ok(detection('apple')))
      : scenario === 'failure'
        ? new StubInference(
            err({
              code: 'inference/failed',
              message: 'model error',
              retryable: true,
              retainedState: true,
            }),
          )
        : new HangingInference();

  const scheduler: TimeoutScheduler =
    scenario === 'timeout'
      ? new ImmediateTimeoutScheduler()
      : new NeverTimeoutScheduler();

  const engine = new OfflineCapture({ inference, vault, scheduler });
  return { engine, vault, backend };
}

describe('Property 51: offline capture storage and pending status [Feature: calorie-cortisol-tool, Property 51]', () => {
  it('stores locally (complete or pending) with ample space, rejecting below 50 MB and retaining prior records (Req 27.1, 27.2, 27.3)', async () => {
    await fc.assert(
      fc.asyncProperty(
        inferenceScenarioArb,
        freeBytesArb,
        idArb,
        refArb,
        async (scenario, freeBytes, recordId, ref) => {
          const { engine, vault, backend } = makeCapture(scenario, freeBytes);

          const belowMinimum = freeBytes < VAULT_MIN_FREE_BYTES;

          const res = await engine.inferLocal({
            recordId,
            userId: 'u1',
            image: { ref },
          });

          if (belowMinimum) {
            // Req 27.3: capture rejected below the 50 MB minimum, existing
            // records retained (there are none here), nothing persisted.
            expect(res.ok).toBe(false);
            if (!res.ok) {
              expect(res.error.code).toBe(VaultErrorCode.InsufficientStorage);
              expect(res.error.retainedState).toBe(true);
            }
            expect(vault.get(recordId).ok).toBe(false);
            expect(backend.size).toBe(0);
            return;
          }

          // Req 27.1: with adequate space the record is always stored locally.
          expect(res.ok).toBe(true);
          const stored = vault.get<OfflineCaptureRecord>(recordId);
          expect(stored.ok).toBe(true);
          if (!res.ok || !stored.ok) {
            return;
          }
          expect(stored.value.syncStatus).toBe('local');

          if (scenario === 'success') {
            // Inference completed in time -> complete with detection (Req 27.1).
            expect(res.value.kind).toBe('inferred');
            expect(res.value.record.payload.inferenceStatus).toBe('complete');
            expect(stored.value.payload.inferenceStatus).toBe('complete');
            expect(stored.value.payload.detection).toBeDefined();
          } else {
            // Timeout or hard failure -> "inference pending" (Req 27.2).
            expect(res.value.kind).toBe('pending');
            expect(res.value.record.payload.inferenceStatus).toBe('pending');
            expect(stored.value.payload.inferenceStatus).toBe('pending');
            expect(stored.value.payload.detection).toBeUndefined();
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('rejects a new capture below the minimum while leaving a previously stored record unchanged (Req 27.3)', async () => {
    await fc.assert(
      fc.asyncProperty(
        inferenceScenarioArb,
        fc.integer({ min: 0, max: VAULT_MIN_FREE_BYTES - 1 }),
        idArb,
        idArb,
        async (scenario, lowFreeBytes, firstId, secondId) => {
          fc.pre(firstId !== secondId);

          // Start with ample space and store a prior record successfully.
          const { engine, vault, backend } = makeCapture(
            scenario,
            VAULT_MIN_FREE_BYTES * 4,
          );
          const first = await engine.inferLocal({
            recordId: firstId,
            userId: 'u1',
            image: { ref: 'first' },
          });
          expect(first.ok).toBe(true);
          const priorBefore = vault.get<OfflineCaptureRecord>(firstId);
          expect(priorBefore.ok).toBe(true);

          // Drop below the 50 MB minimum, then attempt a NEW capture.
          backend.setFreeBytes(lowFreeBytes);
          const rejected = await engine.inferLocal({
            recordId: secondId,
            userId: 'u1',
            image: { ref: 'second' },
          });

          // Req 27.3: rejected, retained-state flagged, new record not stored.
          expect(rejected.ok).toBe(false);
          if (!rejected.ok) {
            expect(rejected.error.code).toBe(
              VaultErrorCode.InsufficientStorage,
            );
            expect(rejected.error.retainedState).toBe(true);
          }
          expect(vault.get(secondId).ok).toBe(false);

          // Prior record left completely unchanged.
          const priorAfter = vault.get<OfflineCaptureRecord>(firstId);
          expect(priorAfter.ok).toBe(true);
          if (priorBefore.ok && priorAfter.ok) {
            expect(priorAfter.value).toEqual(priorBefore.value);
          }
          expect(backend.size).toBe(1);
        },
      ),
      { numRuns: 100 },
    );
  });
});
