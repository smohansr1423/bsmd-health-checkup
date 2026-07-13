/**
 * Consent-aware reconnect sync engine (Task 14.16, design "Local-first, opt-in
 * cloud" + "Retain-and-Retry with bounded backoff").
 *
 * When connectivity is restored, `push` walks the locally stored unsynced
 * records and, for each one:
 *
 *   1. Consent gate (Req 17.2 / 27.4 / 27.6) — if the record's consent category
 *      is not explicitly opted in, the record is *not* transmitted; it is left
 *      local and reported as `blocked` so the client can indicate consent is
 *      required.
 *   2. Push with bounded retries (Req 27.5 / 17.5) — the record is pushed via
 *      the transport; a retryable failure is retried up to
 *      {@link MAX_SYNC_RETRIES} times. If every attempt fails, the record is
 *      retained in the Data Vault unsynced (its local data unchanged) and
 *      reported as `unsynced`.
 *   3. Conflict handling (Req 27.6) — if the server holds a divergent version
 *      of the same item, *both* versions are retained (the local record is
 *      marked `conflict` and the server version is persisted alongside it) and
 *      the settings-defined resolution is applied deterministically to pick the
 *      current version.
 *
 * The whole pass is expected to complete within the 60 s reconnect deadline
 * (Req 27.4); the returned report records the elapsed time and whether the
 * deadline was met.
 *
 * The engine reuses the shared `CONSENT_SYNC_SCHEDULE` (3 retries) so the retry
 * bound is defined once for all consent-category cloud sync.
 *
 * Requirements: 27.4, 27.5, 27.6, 17.2
 */

import type { ConsentState } from '@calorie-cortisol/shared';
import { CONSENT_SYNC_SCHEDULE, shouldRetry } from '@calorie-cortisol/shared/result';

import type { DataVault, VaultRecord } from '../data-vault';

import {
  MAX_SYNC_RETRIES,
  RECONNECT_SYNC_DEADLINE_MS,
  type ConflictOutcome,
  type SyncPushReport,
  type SyncSettings,
  type SyncTransport,
  type SyncTransportOutcome,
} from './types';

/** Suffix used for the retained server version of a conflicted record. */
export const REMOTE_CONFLICT_SUFFIX = '#remote';

/** Collaborators the {@link SyncEngine} composes. */
export interface SyncEngineDeps {
  /** Local-first encrypted record store (Req 27.4/27.5/27.6). */
  vault: DataVault;
  /** Cloud transport reached only after the consent gate permits egress. */
  transport: SyncTransport;
  /** The user's sync settings (conflict resolution + category mapping). */
  settings: SyncSettings;
  /** Wall clock for deadline accounting; defaults to `Date.now`. */
  now?: () => number;
  /** Reconnect deadline in ms (defaults to 60 s). */
  deadlineMs?: number;
}

/**
 * Consent-aware sync engine. Deterministic given its injected transport, clock,
 * and settings, so a reconnect pass can be property-tested end to end.
 */
export class SyncEngine {
  private readonly now: () => number;

  private readonly deadlineMs: number;

  constructor(private readonly deps: SyncEngineDeps) {
    this.now = deps.now ?? (() => Date.now());
    this.deadlineMs = deps.deadlineMs ?? RECONNECT_SYNC_DEADLINE_MS;
  }

  /**
   * Synchronize a set of locally stored unsynced records on reconnect, honoring
   * the user's consent state and sync settings. Returns a report partitioning
   * the records by outcome (Req 27.4–27.6, 17.2).
   */
  async push<T>(
    records: readonly VaultRecord<T>[],
    consentState: ConsentState,
  ): Promise<SyncPushReport> {
    const start = this.now();

    const report: SyncPushReport = {
      synced: [],
      blocked: [],
      unsynced: [],
      conflicts: [],
      elapsedMs: 0,
      withinDeadline: true,
    };

    for (const record of records) {
      const category = this.categoryForKind(record.kind);

      // (1) Consent gate: never transmit a category the user has not opted into
      // (Req 17.2 / 27.4). The record stays local and unchanged.
      if (!isConsented(consentState, category)) {
        report.blocked.push(record.id);
        continue;
      }

      // Mark in-flight so a crash mid-sync leaves an accurate lifecycle status.
      this.deps.vault.setSyncStatus(record.id, 'pending');

      const outcome = await this.attemptWithRetries(record);

      switch (outcome.kind) {
        case 'synced':
          this.deps.vault.setSyncStatus(record.id, 'synced');
          report.synced.push(record.id);
          break;
        case 'conflict':
          report.conflicts.push(
            this.resolveConflict(record, outcome.serverRecord),
          );
          break;
        case 'failed':
          // (2) Retries exhausted: retain the record unsynced with its local
          // data unchanged (Req 27.5). `local` is the retained/unsynced state.
          this.deps.vault.setSyncStatus(record.id, 'local');
          report.unsynced.push(record.id);
          break;
        default: {
          const _never: never = outcome;
          return _never;
        }
      }
    }

    report.elapsedMs = this.now() - start;
    report.withinDeadline = report.elapsedMs <= this.deadlineMs;
    return report;
  }

  /**
   * Push a record, retrying a *retryable* failure up to {@link MAX_SYNC_RETRIES}
   * times (Req 27.5). A non-retryable failure or a conflict stops immediately.
   */
  private async attemptWithRetries<T>(
    record: VaultRecord<T>,
  ): Promise<SyncTransportOutcome<T>> {
    let outcome = await this.deps.transport.push<T>(record);
    let retriesMade = 0;

    while (
      outcome.kind === 'failed' &&
      outcome.retryable &&
      shouldRetry(CONSENT_SYNC_SCHEDULE, retriesMade)
    ) {
      retriesMade += 1;
      outcome = await this.deps.transport.push<T>(record);
    }

    return outcome;
  }

  /**
   * Retain both versions of a conflicted item and apply the settings-defined
   * deterministic resolution (Req 27.6). The local record is marked `conflict`
   * and the server version is persisted under a `#remote`-suffixed id so both
   * survive; the resolution only decides which is treated as current.
   */
  private resolveConflict<T>(
    local: VaultRecord<T>,
    remote: VaultRecord<T>,
  ): ConflictOutcome {
    const remoteRecordId = `${local.id}${REMOTE_CONFLICT_SUFFIX}`;

    // Retain the local version, marked conflict.
    this.deps.vault.setSyncStatus(local.id, 'conflict');

    // Retain the server version alongside it.
    this.deps.vault.put<T>({
      id: remoteRecordId,
      userId: remote.userId,
      kind: remote.kind,
      payload: remote.payload,
      syncStatus: 'conflict',
      createdAt: remote.createdAt,
      updatedAt: remote.updatedAt,
    });

    return {
      recordId: local.id,
      resolution: this.deps.settings.conflictResolution,
      winner: this.pickWinner(local, remote),
      localRecordId: local.id,
      remoteRecordId,
    };
  }

  /** Deterministically select the current version per the configured strategy. */
  private pickWinner<T>(
    local: VaultRecord<T>,
    remote: VaultRecord<T>,
  ): 'local' | 'remote' {
    switch (this.deps.settings.conflictResolution) {
      case 'local-wins':
        return 'local';
      case 'remote-wins':
        return 'remote';
      case 'latest-wins':
        // Later updatedAt wins; ties resolve to local (deterministic).
        return remote.updatedAt > local.updatedAt ? 'remote' : 'local';
      default: {
        const _never: never = this.deps.settings.conflictResolution;
        return _never;
      }
    }
  }

  private categoryForKind(kind: VaultRecord<unknown>['kind']): string {
    return this.deps.settings.categoryForKind
      ? this.deps.settings.categoryForKind(kind)
      : kind;
  }
}

/**
 * Whether the user has explicitly opted the given consent category in. Absent
 * or `false` entries block egress — health data is private by default (Req
 * 17.1 / 17.2).
 */
export function isConsented(
  consentState: ConsentState,
  category: string,
): boolean {
  return consentState.categories[category] === true;
}

// Re-exported for callers that want the bound without importing the constant
// separately.
export { MAX_SYNC_RETRIES };
