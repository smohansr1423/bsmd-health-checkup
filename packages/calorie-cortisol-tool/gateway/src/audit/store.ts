/**
 * In-memory append-only audit store (Task 16.2).
 *
 * A reference {@link AuditStore} implementation used as the gateway default and
 * in tests. It is strictly append-only: appended records are never mutated or
 * removed except through {@link InMemoryAuditStore.purgeExpired}, which honours
 * the 6-year retention floor and refuses to drop any entry still within its
 * retention window (Req 25.6). Production deployments swap this for a durable
 * WORM-backed store with the same contract.
 *
 * Requirements: 25.6, 25.7
 */

import type { AuditRecord, AuditStore } from './types';
import { isRetentionExpired } from './policy';

export class InMemoryAuditStore implements AuditStore {
  private readonly records: AuditRecord[] = [];

  /** Append a record. Never overwrites or reorders existing entries. */
  append(record: AuditRecord): void {
    this.records.push(record);
  }

  /** Number of retained entries. */
  get size(): number {
    return this.records.length;
  }

  /** A defensive snapshot of all retained entries in append order. */
  list(): readonly AuditRecord[] {
    return [...this.records];
  }

  /**
   * Remove only entries whose retention obligation has fully elapsed at `now`.
   * Entries still within their 6-year window are always kept. Returns the
   * purged entries.
   */
  purgeExpired(now: Date): readonly AuditRecord[] {
    const purged: AuditRecord[] = [];
    for (let i = this.records.length - 1; i >= 0; i -= 1) {
      const record = this.records[i];
      if (isRetentionExpired(record, now)) {
        purged.push(record);
        this.records.splice(i, 1);
      }
    }
    return purged.reverse();
  }
}
