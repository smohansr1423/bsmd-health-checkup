/**
 * In-memory reference {@link StorageBackend} for the Data Vault (Task 2.4).
 *
 * This is the concrete backend used by unit/property tests and local tooling.
 * It stands in for the platform stores (SQLite / Core Data / Room / IndexedDB)
 * behind the same storage-backend-agnostic interface, so the {@link DataVault}
 * logic is validated once and reused across all three clients.
 *
 * Free-space is modeled explicitly so the 50 MB precheck (Req 27.3) can be
 * exercised deterministically in tests.
 *
 * Requirements: 17.1, 27.1, 27.3
 */

import type { StorageBackend, StoredRow } from './types';

/** Construction options for {@link InMemoryStorageBackend}. */
export interface InMemoryStorageBackendOptions {
  /**
   * Free local storage to report, in bytes. Defaults to a large value so tests
   * that don't care about storage pressure are unaffected. Set a small value to
   * exercise the 50 MB insufficient-storage path.
   */
  freeBytes?: number;
}

/** A simple `Map`-backed {@link StorageBackend}. */
export class InMemoryStorageBackend implements StorageBackend {
  private readonly rows = new Map<string, StoredRow>();

  private freeSpaceBytes: number;

  constructor(options: InMemoryStorageBackendOptions = {}) {
    // Default: 1 GiB of headroom.
    this.freeSpaceBytes = options.freeBytes ?? 1024 * 1024 * 1024;
  }

  read(id: string): StoredRow | undefined {
    return this.rows.get(id);
  }

  readAll(): StoredRow[] {
    return Array.from(this.rows.values());
  }

  write(row: StoredRow): void {
    // Store a shallow copy so external mutation of the argument can't corrupt
    // persisted state.
    this.rows.set(row.id, { ...row });
  }

  remove(id: string): boolean {
    return this.rows.delete(id);
  }

  freeBytes(): number {
    return this.freeSpaceBytes;
  }

  // --- Test/helper affordances (not part of the StorageBackend port) --------

  /** Override the reported free space (bytes) to exercise storage pressure. */
  setFreeBytes(bytes: number): void {
    this.freeSpaceBytes = bytes;
  }

  /** Number of rows currently persisted. */
  get size(): number {
    return this.rows.size;
  }
}
