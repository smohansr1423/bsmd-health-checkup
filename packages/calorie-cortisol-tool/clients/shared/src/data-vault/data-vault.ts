/**
 * On-device Data Vault storage layer (Task 2.4).
 *
 * Implements `vault.put/get/list/delete` over a storage-backend-agnostic
 * {@link StorageBackend}, with:
 *   - encryption at rest via an injectable {@link Encryptor} port (real AES-256
 *     per-user crypto is task 3.1),
 *   - sync-status fields on every record (local | pending | synced | conflict),
 *     aligned with the shared `Meal.syncStatus` contract, and
 *   - a 50 MB free-space precheck before storing a *new* record; below the
 *     minimum the write is rejected and previously stored records are left
 *     unchanged (Req 27.3).
 *
 * The consent-aware sync engine that consumes these records is task 14.16.
 *
 * Requirements: 17.1, 27.1, 27.3
 */

import { PassthroughEncryptor } from './passthrough-encryptor';
import {
  VAULT_MIN_FREE_BYTES,
  VaultErrorCode,
  type Encryptor,
  type StorageBackend,
  type StoredRow,
  type SyncStatus,
  type VaultError,
  type VaultListFilter,
  type VaultRecord,
  type VaultRecordInput,
  type VaultResult,
} from './types';

/** Construction options for {@link DataVault}. */
export interface DataVaultOptions {
  /**
   * Minimum free local storage (bytes) required to store a new record. Defaults
   * to {@link VAULT_MIN_FREE_BYTES} (50 MB, Req 27.3). Overridable for tests.
   */
  minFreeBytes?: number;
  /**
   * Clock used to stamp `createdAt` / `updatedAt`. Defaults to `Date.now`.
   * Injectable for deterministic tests.
   */
  now?: () => Date;
}

function ok<T>(value: T): VaultResult<T> {
  return { ok: true, value };
}

function fail<T = never>(error: VaultError): VaultResult<T> {
  return { ok: false, error };
}

/**
 * The local-first, encrypted record store shared by all three clients.
 *
 * Records are held decrypted in memory only transiently; at rest (in the
 * backend) the payload is always ciphertext produced by the injected
 * {@link Encryptor}.
 */
export class DataVault {
  private readonly backend: StorageBackend;

  private readonly encryptor: Encryptor;

  private readonly minFreeBytes: number;

  private readonly now: () => Date;

  constructor(
    backend: StorageBackend,
    encryptor: Encryptor = new PassthroughEncryptor(),
    options: DataVaultOptions = {},
  ) {
    this.backend = backend;
    this.encryptor = encryptor;
    this.minFreeBytes = options.minFreeBytes ?? VAULT_MIN_FREE_BYTES;
    this.now = options.now ?? (() => new Date());
  }

  /**
   * Store (insert or update) a record.
   *
   * For a *new* record (an id not already present) the 50 MB free-space
   * precheck is enforced: if available local storage is below the minimum, the
   * write is rejected with `vault/insufficient-storage`, and every previously
   * stored record is left unchanged (Req 27.3).
   *
   * Updating an existing record does not require additional free space and is
   * therefore not gated by the precheck.
   */
  put<T>(input: VaultRecordInput<T>): VaultResult<VaultRecord<T>> {
    const existing = this.backend.read(input.id);
    const isNew = existing === undefined;

    if (isNew && this.backend.freeBytes() < this.minFreeBytes) {
      // Reject the capture; retain all previously stored records unchanged.
      return fail({
        code: VaultErrorCode.InsufficientStorage,
        message: `Insufficient local storage: ${this.minFreeBytes} bytes required to store a new record.`,
        // The same write may succeed once space is freed.
        retryable: true,
        retainedState: true,
      });
    }

    const timestamp = this.now().toISOString();
    const createdAt = isNew
      ? (input.createdAt ?? timestamp)
      : (existing?.createdAt ?? input.createdAt ?? timestamp);
    const updatedAt = input.updatedAt ?? timestamp;
    const syncStatus: SyncStatus = input.syncStatus ?? 'local';

    const row: StoredRow = {
      id: input.id,
      userId: input.userId,
      kind: input.kind,
      syncStatus,
      createdAt,
      updatedAt,
      ciphertext: this.encryptor.encrypt(JSON.stringify(input.payload)),
    };

    this.backend.write(row);

    return ok({
      id: row.id,
      userId: row.userId,
      kind: row.kind,
      payload: input.payload,
      syncStatus: row.syncStatus,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  }

  /** Retrieve and decrypt a single record by id. */
  get<T>(id: string): VaultResult<VaultRecord<T>> {
    const row = this.backend.read(id);
    if (row === undefined) {
      return fail({
        code: VaultErrorCode.NotFound,
        message: `No record found for id "${id}".`,
        retryable: false,
        retainedState: true,
      });
    }
    return this.decodeRow<T>(row);
  }

  /**
   * List records, optionally filtered by user, kind, and/or sync status. Rows
   * that fail to decrypt are skipped rather than aborting the whole listing, so
   * a single corrupt record can't hide the rest of a user's history.
   */
  list<T>(filter: VaultListFilter = {}): VaultRecord<T>[] {
    return this.backend
      .readAll()
      .filter((row) => this.matches(row, filter))
      .map((row) => this.decodeRow<T>(row))
      .filter((result): result is { ok: true; value: VaultRecord<T> } => result.ok)
      .map((result) => result.value);
  }

  /**
   * Delete a record by id. Returns `true` if a record was removed, `false` if
   * no record existed. Other records are always left unchanged.
   */
  delete(id: string): VaultResult<boolean> {
    return ok(this.backend.remove(id));
  }

  /**
   * Update just the sync status of an existing record (used by the sync engine,
   * task 14.16). Returns `vault/not-found` if the record is absent.
   */
  setSyncStatus<T = unknown>(
    id: string,
    syncStatus: SyncStatus,
  ): VaultResult<VaultRecord<T>> {
    const row = this.backend.read(id);
    if (row === undefined) {
      return fail({
        code: VaultErrorCode.NotFound,
        message: `No record found for id "${id}".`,
        retryable: false,
        retainedState: true,
      });
    }
    const updated: StoredRow = {
      ...row,
      syncStatus,
      updatedAt: this.now().toISOString(),
    };
    this.backend.write(updated);
    return this.decodeRow<T>(updated);
  }

  private matches(row: StoredRow, filter: VaultListFilter): boolean {
    if (filter.userId !== undefined && row.userId !== filter.userId) {
      return false;
    }
    if (filter.kind !== undefined && row.kind !== filter.kind) {
      return false;
    }
    if (
      filter.syncStatus !== undefined &&
      row.syncStatus !== filter.syncStatus
    ) {
      return false;
    }
    return true;
  }

  private decodeRow<T>(row: StoredRow): VaultResult<VaultRecord<T>> {
    let payload: T;
    try {
      payload = JSON.parse(this.encryptor.decrypt(row.ciphertext)) as T;
    } catch {
      return fail({
        code: VaultErrorCode.DecryptionFailed,
        message: `Failed to decrypt/parse record "${row.id}".`,
        retryable: false,
        retainedState: true,
      });
    }
    return ok({
      id: row.id,
      userId: row.userId,
      kind: row.kind,
      payload,
      syncStatus: row.syncStatus,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  }
}
