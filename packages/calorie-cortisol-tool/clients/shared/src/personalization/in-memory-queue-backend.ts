/**
 * In-memory reference {@link TrainingQueueBackend} for the personalization
 * training-record queue (Task 14.10).
 *
 * Stands in for the on-device durable store (Data Vault / SQLite / Room /
 * IndexedDB) behind the same backend-agnostic interface, so the
 * {@link PersonalizationTrainingQueue} logic is validated once and reused across
 * all three clients.
 *
 * Requirements: 5.5, 5.8
 */

import type { TrainingQueueBackend, TrainingRecord } from './types';

/** A simple `Map`-backed {@link TrainingQueueBackend}. */
export class InMemoryTrainingQueueBackend implements TrainingQueueBackend {
  private readonly records = new Map<string, TrainingRecord>();

  save(record: TrainingRecord): void {
    // Store a shallow copy so external mutation of the argument can't corrupt
    // persisted state.
    this.records.set(record.id, { ...record });
  }

  read(id: string): TrainingRecord | undefined {
    const record = this.records.get(id);
    return record ? { ...record } : undefined;
  }

  readAll(): TrainingRecord[] {
    return Array.from(this.records.values()).map((r) => ({ ...r }));
  }

  remove(id: string): boolean {
    return this.records.delete(id);
  }

  /** Number of pending records currently persisted (test/helper affordance). */
  get size(): number {
    return this.records.size;
  }
}
