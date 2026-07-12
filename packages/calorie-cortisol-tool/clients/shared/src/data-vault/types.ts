/**
 * On-device Data Vault — storage-backend-agnostic types (Task 2.4).
 *
 * The Data Vault is the privacy-first, local-first store that holds all user
 * health data on-device by default (Req 17.1). Photo/meal/cortisol records are
 * captured and stored locally, tagged with a sync-status, and only later
 * synchronized to the cloud for consent-permitted categories (the sync engine
 * itself is task 14.16).
 *
 * This module defines the abstraction so the same logic can run over any
 * concrete platform store — SQLite (iOS bridge), Core Data, Room (Android), or
 * IndexedDB (PWA). At least one concrete reference backend
 * ({@link InMemoryStorageBackend}) is provided for unit/property testing.
 *
 * Encryption at rest is expressed against an injectable {@link Encryptor} port.
 * The real AES-256 per-user primitive is implemented separately (task 3.1); the
 * Vault never implements crypto itself, it just delegates to whatever encryptor
 * it is constructed with.
 *
 * Requirements: 17.1, 27.1, 27.3
 */

import type { SyncStatus } from '@calorie-cortisol/shared';

// Re-export for convenience so consumers of the vault can refer to the shared
// sync lifecycle type without a second import.
export type { SyncStatus };

/**
 * Minimum free local storage (in bytes) required before a *new* record may be
 * stored. Below this threshold the capture is rejected and previously stored
 * records are left unchanged (Req 27.3).
 *
 * 50 MB using the binary megabyte (1 MB = 1024 * 1024 bytes).
 */
export const VAULT_MIN_FREE_BYTES = 50 * 1024 * 1024;

/** Stable, machine-readable error codes surfaced by the Data Vault. */
export const VaultErrorCode = {
  /** Free local storage is below the 50 MB minimum for a new record (Req 27.3). */
  InsufficientStorage: 'vault/insufficient-storage',
  /** A record with the requested id does not exist. */
  NotFound: 'vault/not-found',
  /** A stored record could not be decrypted (corrupt ciphertext / wrong key). */
  DecryptionFailed: 'vault/decryption-failed',
} as const;

export type VaultErrorCode =
  (typeof VaultErrorCode)[keyof typeof VaultErrorCode];

/**
 * Structured failure shape. Mirrors the shared `ErrorContract`
 * (`{ code, message, retryable, retainedState }`) so Data Vault failures compose
 * with the rest of the system's degraded-outcome handling.
 */
export interface VaultError {
  readonly code: VaultErrorCode;
  readonly message: string;
  readonly retryable: boolean;
  /** Whether previously stored records were left unchanged (Req 27.3). */
  readonly retainedState: boolean;
}

/** A success-or-failure result returned by fallible Data Vault operations. */
export type VaultResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: VaultError };

/**
 * Category of payload held by a vault record. The listed literals are the
 * well-known kinds; any other string is also accepted so new record categories
 * can be added without changing this type.
 */
export type VaultRecordKind =
  | 'meal'
  | 'photo'
  | 'cortisolReading'
  | 'questionnaireResult'
  | 'carMeasurement'
  | string;

/**
 * A decrypted Data Vault record. The `payload` is the domain object (e.g. a
 * `Meal` or `CortisolReading` from the shared contracts); the vault is generic
 * over payload type so it can hold any health record.
 */
export interface VaultRecord<T = unknown> {
  /** Stable, caller-provided unique identifier. */
  id: string;
  /** Owning user (family accounts hold multiple users' records — Req 19). */
  userId: string;
  /** Discriminator for the payload category. */
  kind: VaultRecordKind;
  /** The domain payload, stored encrypted at rest. */
  payload: T;
  /** Local-first sync lifecycle (Req 17/27). */
  syncStatus: SyncStatus;
  /** ISO timestamp when the record was first stored. */
  createdAt: string;
  /** ISO timestamp of the most recent write. */
  updatedAt: string;
}

/** Input accepted by {@link DataVault.put}. Timestamps/status are optional. */
export interface VaultRecordInput<T = unknown> {
  id: string;
  userId: string;
  kind: VaultRecordKind;
  payload: T;
  /** Defaults to `'local'` for a new record (Req 27.1 stores locally first). */
  syncStatus?: SyncStatus;
  createdAt?: string;
  updatedAt?: string;
}

/** Optional filter for {@link DataVault.list}. All provided fields must match. */
export interface VaultListFilter {
  userId?: string;
  kind?: VaultRecordKind;
  syncStatus?: SyncStatus;
}

/**
 * Injectable encryption port. Implementations encrypt/decrypt the serialized
 * payload so ciphertext (never plaintext) is what the backend persists.
 *
 * The production AES-256 per-user implementation is task 3.1; the Vault only
 * ever talks to this interface.
 */
export interface Encryptor {
  /** Encrypt a UTF-8 plaintext string, returning ciphertext. */
  encrypt(plaintext: string): string;
  /** Decrypt ciphertext produced by {@link encrypt}, returning the plaintext. */
  decrypt(ciphertext: string): string;
}

/**
 * A persisted, encrypted row as seen by a {@link StorageBackend}. Metadata used
 * for filtering/listing is kept in the clear; only the payload is encrypted.
 */
export interface StoredRow {
  id: string;
  userId: string;
  kind: VaultRecordKind;
  syncStatus: SyncStatus;
  createdAt: string;
  updatedAt: string;
  /** Encrypted, serialized payload. */
  ciphertext: string;
}

/**
 * Storage-backend-agnostic persistence port. Concrete implementations wrap
 * SQLite / Core Data / Room / IndexedDB; {@link InMemoryStorageBackend} is the
 * reference backend used for testing.
 *
 * Backends deal only in already-encrypted {@link StoredRow}s; encryption and
 * domain (de)serialization live in the {@link DataVault}.
 */
export interface StorageBackend {
  /** Return the row with the given id, or `undefined` if absent. */
  read(id: string): StoredRow | undefined;
  /** Return all stored rows (order is not guaranteed). */
  readAll(): StoredRow[];
  /** Insert or replace a row. */
  write(row: StoredRow): void;
  /** Remove the row with the given id; returns whether a row was removed. */
  remove(id: string): boolean;
  /**
   * Report the currently available free local storage, in bytes. Used for the
   * 50 MB precheck before storing a new record (Req 27.3).
   */
  freeBytes(): number;
}
