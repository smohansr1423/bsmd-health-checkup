import fc from 'fast-check';

import type { ConsentState } from '@calorie-cortisol/shared';

import { DataVault, InMemoryStorageBackend, type VaultRecord } from '../data-vault';
import {
  REMOTE_CONFLICT_SUFFIX,
  SyncEngine,
  type ConflictResolution,
  type OfflineCaptureRecord,
  type SyncSettings,
  type SyncTransport,
  type SyncTransportOutcome,
} from './index';

/**
 * Property 52: Reconnect sync completeness and conflict handling
 * Validates: Requirements 27.4, 27.6
 * Feature: calorie-cortisol-tool, Property 52
 *
 * For any set of locally stored unsynced records after connectivity is
 * restored, `SyncEngine.push` synchronizes *exactly* the records the user's
 * sync settings permit — a record whose consent category is not opted in is
 * never transmitted and is reported `blocked`, while every consented record is
 * attempted and lands in exactly one of `synced` / `unsynced` / `conflicts`
 * (Req 27.4). On a conflict, *both* versions are retained (the local record is
 * marked `conflict`; the server version is persisted under a `#remote`-suffixed
 * id) and the settings-defined resolution deterministically decides the current
 * winner (Req 27.6). Across the whole pass the four groups partition the input
 * with no record lost or double-counted, and the outcome is deterministic:
 * re-running the identical pass yields the identical report.
 */

// --- Fixed consent categories (a record kind is its consent category) -------

const CATEGORIES = ['meal', 'photo', 'cortisolReading'] as const;
type Category = (typeof CATEGORIES)[number];

// A small pool of timestamps so latest-wins comparisons (and ties) occur often.
const TIMESTAMPS = [
  '2024-01-01T00:00:00Z',
  '2024-02-01T00:00:00Z',
  '2024-03-01T00:00:00Z',
] as const;

/** How the (fake) cloud transport responds for a given record. */
type OutcomeKind =
  | 'synced'
  | 'conflict'
  | 'failed-retryable'
  | 'failed-nonretryable';

interface RecordSpec {
  category: Category;
  updatedAt: string;
  /** Server-side `updatedAt` used only when the outcome is a conflict. */
  serverUpdatedAt: string;
  outcome: OutcomeKind;
}

// --- Test doubles -----------------------------------------------------------

/**
 * A transport whose response for each record id is fixed up front. Failures are
 * returned on every attempt (so retryable failures exhaust the bound and are
 * retained unsynced). Records the ids it was actually asked to push so the test
 * can assert blocked records never crossed the boundary.
 */
class ScriptedTransport implements SyncTransport {
  public readonly attempts: string[] = [];

  constructor(private readonly script: Map<string, SyncTransportOutcome>) {}

  push<T>(record: VaultRecord<T>): Promise<SyncTransportOutcome<T>> {
    this.attempts.push(record.id);
    const outcome = this.script.get(record.id) ?? { kind: 'synced' };
    return Promise.resolve(outcome as SyncTransportOutcome<T>);
  }
}

function toOutcome(
  spec: RecordSpec,
  id: string,
): SyncTransportOutcome<OfflineCaptureRecord> {
  switch (spec.outcome) {
    case 'synced':
      return { kind: 'synced' };
    case 'conflict':
      return {
        kind: 'conflict',
        serverRecord: makeRecord(id, spec.category, spec.serverUpdatedAt),
      };
    case 'failed-retryable':
      return { kind: 'failed', retryable: true };
    case 'failed-nonretryable':
      return { kind: 'failed', retryable: false };
    default: {
      const _never: never = spec.outcome;
      return _never;
    }
  }
}

function makeRecord(
  id: string,
  kind: Category,
  updatedAt: string,
): VaultRecord<OfflineCaptureRecord> {
  return {
    id,
    userId: 'u1',
    kind,
    payload: { image: { ref: `img-${id}` }, inferenceStatus: 'complete' },
    syncStatus: 'local',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt,
  };
}

const consentOf = (allowed: Record<Category, boolean>): ConsentState => ({
  userId: 'u1',
  categories: { ...allowed },
  healthDataConsent: true,
  updatedAt: '2024-01-01T00:00:00Z',
});

// --- Arbitraries ------------------------------------------------------------

const specArb: fc.Arbitrary<RecordSpec> = fc.record({
  category: fc.constantFrom(...CATEGORIES),
  updatedAt: fc.constantFrom(...TIMESTAMPS),
  serverUpdatedAt: fc.constantFrom(...TIMESTAMPS),
  outcome: fc.constantFrom<OutcomeKind>(
    'synced',
    'conflict',
    'failed-retryable',
    'failed-nonretryable',
  ),
});

const specsArb = fc.array(specArb, { minLength: 0, maxLength: 25 });

const consentArb: fc.Arbitrary<Record<Category, boolean>> = fc.record({
  meal: fc.boolean(),
  photo: fc.boolean(),
  cortisolReading: fc.boolean(),
});

const strategyArb = fc.constantFrom<ConflictResolution>(
  'local-wins',
  'remote-wins',
  'latest-wins',
);

// --- Harness ----------------------------------------------------------------

interface Built {
  records: VaultRecord<OfflineCaptureRecord>[];
  specById: Map<string, RecordSpec>;
  transport: ScriptedTransport;
  engine: SyncEngine;
  vault: DataVault;
}

/** Build records with unique ids (assigned by index), seed the vault, and wire an engine. */
function build(
  specs: readonly RecordSpec[],
  strategy: ConflictResolution,
): Built {
  const vault = new DataVault(new InMemoryStorageBackend());
  const script = new Map<string, SyncTransportOutcome>();
  const specById = new Map<string, RecordSpec>();

  const records = specs.map((spec, i) => {
    const id = `r${i}`;
    const record = makeRecord(id, spec.category, spec.updatedAt);
    specById.set(id, spec);
    script.set(id, toOutcome(spec, id));
    vault.put(record); // seed so status transitions have a row to update
    return record;
  });

  const transport = new ScriptedTransport(script);
  const settings: SyncSettings = { conflictResolution: strategy };
  const engine = new SyncEngine({ vault, transport, settings });
  return { records, specById, transport, engine, vault };
}

/** Independent oracle for the deterministic winner of a conflict. */
function expectedWinner(
  strategy: ConflictResolution,
  localUpdatedAt: string,
  remoteUpdatedAt: string,
): 'local' | 'remote' {
  switch (strategy) {
    case 'local-wins':
      return 'local';
    case 'remote-wins':
      return 'remote';
    case 'latest-wins':
      return remoteUpdatedAt > localUpdatedAt ? 'remote' : 'local';
    default: {
      const _never: never = strategy;
      return _never;
    }
  }
}

const sorted = (xs: readonly string[]): string[] => [...xs].sort();

describe('Property 52: Reconnect sync completeness and conflict handling [Feature: calorie-cortisol-tool, Property 52]', () => {
  it('syncs exactly the consent-permitted records; the four outcome groups partition the input (Req 27.4)', async () => {
    await fc.assert(
      fc.asyncProperty(
        specsArb,
        consentArb,
        strategyArb,
        async (specs, allowed, strategy) => {
          const { records, specById, transport, engine } = build(
            specs,
            strategy,
          );

          const report = await engine.push(records, consentOf(allowed));

          const allIds = records.map((r) => r.id);
          const conflictIds = report.conflicts.map((c) => c.recordId);

          // Consent gate: blocked === exactly the records whose category is not
          // opted in, and those were never transmitted (Req 27.4 / consent).
          const expectedBlocked = allIds.filter(
            (id) => !allowed[specById.get(id)!.category],
          );
          expect(sorted(report.blocked)).toEqual(sorted(expectedBlocked));
          // A blocked record never crossed the transport boundary...
          for (const id of report.blocked) {
            expect(transport.attempts).not.toContain(id);
          }
          // ...and every consented record was attempted at least once.
          const consentedIds = allIds.filter(
            (id) => allowed[specById.get(id)!.category],
          );
          for (const id of consentedIds) {
            expect(transport.attempts).toContain(id);
          }

          // Completeness: the four groups partition the input exactly once each.
          const union = sorted([
            ...report.synced,
            ...report.blocked,
            ...report.unsynced,
            ...conflictIds,
          ]);
          expect(union).toEqual(sorted(allIds));
          expect(union).toHaveLength(allIds.length); // no duplicates / no loss

          // Every synced/unsynced/conflict id is a consented one.
          for (const id of [
            ...report.synced,
            ...report.unsynced,
            ...conflictIds,
          ]) {
            expect(allowed[specById.get(id)!.category]).toBe(true);
          }

          // Each consented record lands in the group its scripted outcome dictates.
          for (const id of consentedIds) {
            const kind = specById.get(id)!.outcome;
            if (kind === 'synced') {
              expect(report.synced).toContain(id);
            } else if (kind === 'conflict') {
              expect(conflictIds).toContain(id);
            } else {
              expect(report.unsynced).toContain(id);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('on a conflict retains both versions and applies the deterministic settings resolution (Req 27.6)', async () => {
    await fc.assert(
      fc.asyncProperty(
        specsArb,
        consentArb,
        strategyArb,
        async (specs, allowed, strategy) => {
          const { records, specById, engine, vault } = build(specs, strategy);

          const report = await engine.push(records, consentOf(allowed));

          for (const conflict of report.conflicts) {
            const spec = specById.get(conflict.recordId)!;

            // Resolution reported is the configured strategy, applied deterministically.
            expect(conflict.resolution).toBe(strategy);
            expect(conflict.winner).toBe(
              expectedWinner(strategy, spec.updatedAt, spec.serverUpdatedAt),
            );

            // Both versions retained: local marked `conflict`; server persisted
            // under the `#remote`-suffixed id.
            const local = vault.get<OfflineCaptureRecord>(conflict.recordId);
            expect(local.ok && local.value.syncStatus).toBe('conflict');

            const remoteId = `${conflict.recordId}${REMOTE_CONFLICT_SUFFIX}`;
            expect(conflict.remoteRecordId).toBe(remoteId);
            expect(conflict.localRecordId).toBe(conflict.recordId);
            const remote = vault.get<OfflineCaptureRecord>(remoteId);
            expect(remote.ok).toBe(true);
            if (remote.ok) {
              expect(remote.value.updatedAt).toBe(spec.serverUpdatedAt);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('is deterministic: an identical reconnect pass yields an identical report (Req 27.4, 27.6)', async () => {
    await fc.assert(
      fc.asyncProperty(
        specsArb,
        consentArb,
        strategyArb,
        async (specs, allowed, strategy) => {
          const first = build(specs, strategy);
          const reportA = await first.engine.push(
            first.records,
            consentOf(allowed),
          );

          const second = build(specs, strategy);
          const reportB = await second.engine.push(
            second.records,
            consentOf(allowed),
          );

          expect(sorted(reportA.synced)).toEqual(sorted(reportB.synced));
          expect(sorted(reportA.blocked)).toEqual(sorted(reportB.blocked));
          expect(sorted(reportA.unsynced)).toEqual(sorted(reportB.unsynced));
          expect(
            reportA.conflicts.map((c) => `${c.recordId}:${c.winner}`).sort(),
          ).toEqual(
            reportB.conflicts.map((c) => `${c.recordId}:${c.winner}`).sort(),
          );
        },
      ),
      { numRuns: 100 },
    );
  });

  it('reports completion within the 60s reconnect deadline under a bounded clock (Req 27.4)', async () => {
    await fc.assert(
      fc.asyncProperty(
        specsArb,
        consentArb,
        strategyArb,
        fc.integer({ min: 0, max: 60_000 }),
        async (specs, allowed, strategy, elapsed) => {
          const vault = new DataVault(new InMemoryStorageBackend());
          const script = new Map<string, SyncTransportOutcome>();
          const records = specs.map((spec, i) => {
            const id = `r${i}`;
            const record = makeRecord(id, spec.category, spec.updatedAt);
            script.set(id, toOutcome(spec, id));
            vault.put(record);
            return record;
          });

          // Clock advances by exactly `elapsed` ms between start and end.
          const times = [0, elapsed];
          let last = 0;
          const engine = new SyncEngine({
            vault,
            transport: new ScriptedTransport(script),
            settings: { conflictResolution: strategy },
            now: () => (times.length ? (last = times.shift()!) : last),
          });

          const report = await engine.push(records, consentOf(allowed));
          expect(report.elapsedMs).toBe(elapsed);
          expect(report.withinDeadline).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });
});
