/**
 * Per-user key material store (Task 3.1).
 *
 * The design's security model ("Compliance by construction") requires that
 * stored health data is encrypted with **per-user** AES-256 keys and that the
 * key material is held **separately from the ciphertext** (Requirement 25.1,
 * Property 53).
 *
 * This module defines the {@link KeyStore} port — the separated key store —
 * plus an in-memory reference implementation used by tests and local
 * development. Production deployments substitute a KMS/HSM-backed
 * implementation (e.g. AWS KMS, per the design's key-management posture)
 * behind the same interface.
 *
 * The store never lives inside an {@link EncryptedRecord}; ciphertext only ever
 * carries a `keyId` *reference*, which is what "stored separately" means here.
 *
 * Requirements: 25.1
 */

import { randomBytes } from 'node:crypto';

/** AES-256 key length in bytes (256 bits). */
export const AES_256_KEY_BYTES = 32;

/**
 * The separated key store: maps a stable key identifier (typically the user id)
 * to that user's raw AES-256 key material.
 *
 * Implementations MUST keep key material outside of any ciphertext container
 * and MUST return keys of exactly {@link AES_256_KEY_BYTES} bytes.
 */
export interface KeyStore {
  /**
   * Return the raw key for `keyId`, or `undefined` if no key has been
   * provisioned for it. Callers that require a key should use
   * {@link getOrCreateKey}.
   */
  getKey(keyId: string): Buffer | undefined;

  /** Whether a key has been provisioned for `keyId`. */
  hasKey(keyId: string): boolean;

  /**
   * Return the existing key for `keyId`, generating and persisting a fresh
   * cryptographically-random AES-256 key on first use. This is the primary
   * entry point for per-user encryption.
   */
  getOrCreateKey(keyId: string): Buffer;

  /**
   * Remove the key for `keyId` (e.g. on account deletion). Returns whether a
   * key was present and removed.
   */
  deleteKey(keyId: string): boolean;
}

/** Generate a fresh cryptographically-random AES-256 key. */
export function generateAesKey(): Buffer {
  return randomBytes(AES_256_KEY_BYTES);
}

/**
 * In-memory {@link KeyStore} reference implementation.
 *
 * Keys are generated lazily per `keyId` and never leave this object other than
 * through {@link getKey}/{@link getOrCreateKey}. It is intentionally decoupled
 * from any ciphertext container so the "keys stored separately from the
 * encrypted data" invariant (Req 25.1, Property 53) holds structurally.
 */
export class InMemoryKeyStore implements KeyStore {
  private readonly keys = new Map<string, Buffer>();

  /**
   * @param seed Optional pre-provisioned keys, keyed by `keyId`. Every seeded
   *   key must be exactly {@link AES_256_KEY_BYTES} bytes.
   */
  constructor(seed?: Readonly<Record<string, Buffer>>) {
    if (seed) {
      for (const [keyId, key] of Object.entries(seed)) {
        this.assertKeyLength(key);
        // Defensive copy so external mutation cannot corrupt stored material.
        this.keys.set(keyId, Buffer.from(key));
      }
    }
  }

  getKey(keyId: string): Buffer | undefined {
    const key = this.keys.get(keyId);
    return key === undefined ? undefined : Buffer.from(key);
  }

  hasKey(keyId: string): boolean {
    return this.keys.has(keyId);
  }

  getOrCreateKey(keyId: string): Buffer {
    let key = this.keys.get(keyId);
    if (key === undefined) {
      key = generateAesKey();
      this.keys.set(keyId, key);
    }
    return Buffer.from(key);
  }

  deleteKey(keyId: string): boolean {
    return this.keys.delete(keyId);
  }

  private assertKeyLength(key: Buffer): void {
    if (key.length !== AES_256_KEY_BYTES) {
      throw new RangeError(
        `KeyStore keys must be ${AES_256_KEY_BYTES} bytes for AES-256; got ${key.length}`,
      );
    }
  }
}
