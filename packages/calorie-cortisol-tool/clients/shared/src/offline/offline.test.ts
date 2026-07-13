import {
  DataVault,
  InMemoryStorageBackend,
  VAULT_MIN_FREE_BYTES,
  VaultErrorCode,
  type VaultRecord,
} from '../data-vault';
import type { ConsentState, FoodItem } from '@calorie-cortisol/shared';
import { err, ok, type Result } from '@calorie-cortisol/shared/result';

import {
  OfflineCapture,
  REMOTE_CONFLICT_SUFFIX,
  SyncEngine,
  isConsented,
  type ConflictResolution,
  type DetectionResult,
  type OfflineCaptureRecord,
  type OnDeviceInference,
  type SyncSettings,
  type SyncTransport,
  type SyncTransportOutcome,
  type TimeoutScheduler,
} from './index';

/**
 * Unit tests for offline inference, pending status, and the consent-aware sync
 * engine (Task 14.16). Covers Req 27.1–27.6 and 17.2. (The named property tests
 * are the optional tasks 14.17 / 14.18.)
 */

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

/** A scheduler that fires the timeout immediately (drives the pending branch). */
class ImmediateTimeoutScheduler implements TimeoutScheduler {
  schedule(_ms: number, onTimeout: () => void): () => void {
    onTimeout();
    return () => undefined;
  }
}

/** A scheduler that never fires (inference always wins the race). */
class NeverTimeoutScheduler implements TimeoutScheduler {
  schedule(_ms: number, _onTimeout: () => void): () => void {
    return () => undefined;
  }
}

const detection = (label: string): DetectionResult => ({
  items: [{ id: `${label}-1`, label, confidence: 90 } as FoodItem],
});

class StubInference implements OnDeviceInference {
  constructor(private readonly result: Result<DetectionResult>) {}

  infer(): Promise<Result<DetectionResult>> {
    return Promise.resolve(this.result);
  }
}

/** Inference that never resolves — the 10s guard must win the race. */
class HangingInference implements OnDeviceInference {
  infer(): Promise<Result<DetectionResult>> {
    return new Promise<Result<DetectionResult>>(() => undefined);
  }
}

function makeVault(freeBytes?: number): {
  vault: DataVault;
  backend: InMemoryStorageBackend;
} {
  const backend = new InMemoryStorageBackend(
    freeBytes === undefined ? {} : { freeBytes },
  );
  return { vault: new DataVault(backend), backend };
}

const consent = (categories: Record<string, boolean>): ConsentState => ({
  userId: 'u1',
  categories,
  healthDataConsent: true,
  updatedAt: '2024-01-01T00:00:00Z',
});

const captureRecord = (
  id: string,
  updatedAt = '2024-01-01T00:00:00Z',
): VaultRecord<OfflineCaptureRecord> => ({
  id,
  userId: 'u1',
  kind: 'photo',
  payload: { image: { ref: `img-${id}` }, inferenceStatus: 'complete' },
  syncStatus: 'local',
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt,
});

// ---------------------------------------------------------------------------
// inferLocal — Req 27.1, 27.2, 27.3
// ---------------------------------------------------------------------------

describe('OfflineCapture.inferLocal', () => {
  it('stores a completed detection when inference finishes in time (Req 27.1)', async () => {
    const { vault } = makeVault();
    const engine = new OfflineCapture({
      inference: new StubInference(ok(detection('apple'))),
      vault,
      scheduler: new NeverTimeoutScheduler(),
    });

    const res = await engine.inferLocal({
      recordId: 'c1',
      userId: 'u1',
      image: { ref: 'img-1' },
    });

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.kind).toBe('inferred');
      expect(res.value.record.payload.inferenceStatus).toBe('complete');
      expect(res.value.record.syncStatus).toBe('local');
    }
    const stored = vault.get<OfflineCaptureRecord>('c1');
    expect(stored.ok && stored.value.payload.inferenceStatus).toBe('complete');
  });

  it('stores "inference pending" when the 10s budget is exceeded (Req 27.2)', async () => {
    const { vault } = makeVault();
    // Inference is still running when the guard fires first.
    const engine = new OfflineCapture({
      inference: new HangingInference(),
      vault,
      scheduler: new ImmediateTimeoutScheduler(),
    });

    const res = await engine.inferLocal({
      recordId: 'c1',
      userId: 'u1',
      image: { ref: 'img-1' },
    });

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.kind).toBe('pending');
      expect(res.value.record.payload.inferenceStatus).toBe('pending');
      expect(res.value.record.payload.detection).toBeUndefined();
    }
  });

  it('stores "inference pending" when inference fails to produce a result (Req 27.2)', async () => {
    const { vault } = makeVault();
    const engine = new OfflineCapture({
      inference: new StubInference(
        err({
          code: 'inference/failed',
          message: 'model error',
          retryable: true,
          retainedState: true,
        }),
      ),
      vault,
      scheduler: new NeverTimeoutScheduler(),
    });

    const res = await engine.inferLocal({
      recordId: 'c1',
      userId: 'u1',
      image: { ref: 'img-1' },
    });

    expect(res.ok && res.value.kind).toBe('pending');
  });

  it('rejects the capture and retains prior records below the 50 MB minimum (Req 27.3)', async () => {
    const { vault, backend } = makeVault();
    const engine = new OfflineCapture({
      inference: new StubInference(ok(detection('apple'))),
      vault,
      scheduler: new NeverTimeoutScheduler(),
    });

    // Store a prior record with ample space.
    expect(
      (
        await engine.inferLocal({
          recordId: 'c1',
          userId: 'u1',
          image: { ref: 'img-1' },
        })
      ).ok,
    ).toBe(true);

    // Now drop below the minimum and attempt a NEW capture.
    backend.setFreeBytes(VAULT_MIN_FREE_BYTES - 1);
    const rejected = await engine.inferLocal({
      recordId: 'c2',
      userId: 'u1',
      image: { ref: 'img-2' },
    });

    expect(rejected.ok).toBe(false);
    if (!rejected.ok) {
      expect(rejected.error.code).toBe(VaultErrorCode.InsufficientStorage);
      expect(rejected.error.retainedState).toBe(true);
    }
    // Prior record unchanged; rejected capture not stored.
    expect(vault.get('c1').ok).toBe(true);
    expect(vault.get('c2').ok).toBe(false);
    expect(backend.size).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// SyncEngine.push — Req 27.4, 27.5, 27.6, 17.2
// ---------------------------------------------------------------------------

/** A transport that returns a scripted outcome per record id. */
class ScriptedTransport implements SyncTransport {
  public readonly attempts: string[] = [];

  constructor(
    private readonly script: (
      id: string,
      attempt: number,
    ) => SyncTransportOutcome,
  ) {}

  private counts = new Map<string, number>();

  push<T>(record: VaultRecord<T>): Promise<SyncTransportOutcome<T>> {
    const n = (this.counts.get(record.id) ?? 0) + 1;
    this.counts.set(record.id, n);
    this.attempts.push(record.id);
    return Promise.resolve(this.script(record.id, n) as SyncTransportOutcome<T>);
  }
}

function makeEngine(
  transport: SyncTransport,
  conflictResolution: ConflictResolution = 'local-wins',
  extra: Partial<SyncSettings> = {},
): { engine: SyncEngine; vault: DataVault } {
  const { vault } = makeVault();
  const settings: SyncSettings = { conflictResolution, ...extra };
  const engine = new SyncEngine({ vault, transport, settings });
  return { engine, vault };
}

describe('SyncEngine.push — consent gate (Req 17.2 / 27.4)', () => {
  it('syncs exactly the consent-permitted records and blocks the rest', async () => {
    const transport = new ScriptedTransport(() => ({ kind: 'synced' }));
    const { engine, vault } = makeEngine(transport);
    // Seed the vault so status transitions have a row to update.
    const meal = { ...captureRecord('m1'), kind: 'meal' };
    const photo = captureRecord('p1');
    vault.put(meal);
    vault.put(photo);

    const report = await engine.push(
      [meal, photo],
      consent({ meal: true, photo: false }),
    );

    expect(report.synced).toEqual(['m1']);
    expect(report.blocked).toEqual(['p1']);
    // Blocked record was never transmitted.
    expect(transport.attempts).toEqual(['m1']);
    // Synced record status updated; blocked stays local.
    expect(vault.get('m1').ok && vault.get('m1')).toMatchObject({
      value: { syncStatus: 'synced' },
    });
    expect(vault.get('p1').ok && vault.get('p1')).toMatchObject({
      value: { syncStatus: 'local' },
    });
  });
});

describe('SyncEngine.push — bounded retries (Req 27.5)', () => {
  it('retries a retryable failure up to 3 times then retains it unsynced', async () => {
    const transport = new ScriptedTransport(() => ({
      kind: 'failed',
      retryable: true,
    }));
    const { engine, vault } = makeEngine(transport);
    const rec = captureRecord('p1');
    vault.put(rec);

    const report = await engine.push([rec], consent({ photo: true }));

    // 1 initial attempt + 3 retries = 4 total attempts.
    expect(transport.attempts.filter((id) => id === 'p1')).toHaveLength(4);
    expect(report.unsynced).toEqual(['p1']);
    expect(report.synced).toEqual([]);
    // Retained unsynced with local data unchanged.
    expect(vault.get('p1').ok && vault.get('p1')).toMatchObject({
      value: { syncStatus: 'local' },
    });
  });

  it('does not retry a non-retryable failure', async () => {
    const transport = new ScriptedTransport(() => ({
      kind: 'failed',
      retryable: false,
    }));
    const { engine, vault } = makeEngine(transport);
    const rec = captureRecord('p1');
    vault.put(rec);

    const report = await engine.push([rec], consent({ photo: true }));

    expect(transport.attempts).toHaveLength(1);
    expect(report.unsynced).toEqual(['p1']);
  });

  it('succeeds on a later retry within the bound', async () => {
    const transport = new ScriptedTransport((_id, attempt) =>
      attempt < 3 ? { kind: 'failed', retryable: true } : { kind: 'synced' },
    );
    const { engine, vault } = makeEngine(transport);
    const rec = captureRecord('p1');
    vault.put(rec);

    const report = await engine.push([rec], consent({ photo: true }));

    expect(report.synced).toEqual(['p1']);
    expect(transport.attempts).toHaveLength(3);
  });
});

describe('SyncEngine.push — conflict handling (Req 27.6)', () => {
  it('retains both versions and applies the deterministic resolution', async () => {
    const server = captureRecord('p1', '2024-02-01T00:00:00Z');
    const transport = new ScriptedTransport(() => ({
      kind: 'conflict',
      serverRecord: server,
    }));
    const { engine, vault } = makeEngine(transport, 'latest-wins');
    const local = captureRecord('p1', '2024-01-01T00:00:00Z');
    vault.put(local);

    const report = await engine.push([local], consent({ photo: true }));

    expect(report.conflicts).toHaveLength(1);
    const c = report.conflicts[0];
    expect(c.recordId).toBe('p1');
    expect(c.resolution).toBe('latest-wins');
    // Server version is newer → remote wins.
    expect(c.winner).toBe('remote');

    // Both versions retained: local marked conflict, remote persisted.
    expect(vault.get('p1').ok && vault.get('p1')).toMatchObject({
      value: { syncStatus: 'conflict' },
    });
    const remoteId = `p1${REMOTE_CONFLICT_SUFFIX}`;
    expect(vault.get(remoteId).ok).toBe(true);
    expect(c.remoteRecordId).toBe(remoteId);
  });

  it('resolution is deterministic per configured strategy', async () => {
    const server = captureRecord('p1', '2024-02-01T00:00:00Z');
    const build = (strategy: ConflictResolution) => {
      const transport = new ScriptedTransport(() => ({
        kind: 'conflict',
        serverRecord: server,
      }));
      const { engine, vault } = makeEngine(transport, strategy);
      vault.put(captureRecord('p1', '2024-01-01T00:00:00Z'));
      return engine.push(
        [captureRecord('p1', '2024-01-01T00:00:00Z')],
        consent({ photo: true }),
      );
    };

    expect((await build('local-wins')).conflicts[0].winner).toBe('local');
    expect((await build('remote-wins')).conflicts[0].winner).toBe('remote');
    expect((await build('latest-wins')).conflicts[0].winner).toBe('remote');
  });
});

describe('SyncEngine.push — reconnect deadline (Req 27.4)', () => {
  it('reports withinDeadline against the injected clock', async () => {
    const transport = new ScriptedTransport(() => ({ kind: 'synced' }));
    const { vault } = makeVault();
    const rec = captureRecord('p1');
    vault.put(rec);

    // Clock jumps 70s between start and end → over the 60s deadline.
    let t = 0;
    const times = [0, 70_000];
    const engine = new SyncEngine({
      vault,
      transport,
      settings: { conflictResolution: 'local-wins' },
      now: () => (times.length ? (t = times.shift() as number) : t),
    });

    const report = await engine.push([rec], consent({ photo: true }));
    expect(report.elapsedMs).toBe(70_000);
    expect(report.withinDeadline).toBe(false);
  });
});

describe('isConsented', () => {
  it('only true for an explicitly enabled category', () => {
    const state = consent({ meal: true, photo: false });
    expect(isConsented(state, 'meal')).toBe(true);
    expect(isConsented(state, 'photo')).toBe(false);
    expect(isConsented(state, 'unknown')).toBe(false);
  });
});
