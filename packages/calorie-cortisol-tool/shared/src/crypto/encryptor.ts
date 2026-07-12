/**
 * AES-256 per-user encryption over health-data records (Task 3.1).
 *
 * Implements the design's at-rest encryption posture — "AES-256 at rest
 * (per-user keys, stored separately)" — as a clean, injectable port so other
 * components (e.g. the on-device Data Vault, task 2.4) can depend on encryption
 * without importing crypto internals.
 *
 * Property 53 (Requirement 25.1): *for any* health-data record, decrypting the
 * AES-256-encrypted stored form with the user's key yields the original record,
 * and the key material is stored separately from the ciphertext.
 *
 * We use AES-256-GCM (authenticated encryption): each record is encrypted with
 * the user's key and a fresh random IV, and the resulting {@link EncryptedRecord}
 * carries only the algorithm, a `keyId` *reference*, the IV, the auth tag, and
 * the ciphertext — never the key itself. Keys live in a separate {@link KeyStore}.
 *
 * Requirements: 25.1
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import {
  atomicFailure,
  err,
  ok,
  validationRejection,
  type Result,
} from '../result';
import { AES_256_KEY_BYTES, type KeyStore } from './key-store';

/** The AES mode used for at-rest health-data encryption. */
export const ENCRYPTION_ALGORITHM = 'aes-256-gcm' as const;

/** GCM initialization-vector length in bytes (96-bit IV is the GCM standard). */
export const GCM_IV_BYTES = 12;

/** GCM authentication-tag length in bytes (128-bit tag). */
export const GCM_AUTH_TAG_BYTES = 16;

/**
 * The persisted, encrypted form of a health-data record.
 *
 * This is the "stored form" referenced by Property 53. It deliberately contains
 * **no key material** — only a `keyId` reference into the separated
 * {@link KeyStore}. All binary fields are base64-encoded so the record is safe
 * to store as JSON/text (SQLite, IndexedDB, Room, Core Data, S3, ...).
 */
export interface EncryptedRecord {
  /** Encryption algorithm identifier. */
  readonly algorithm: typeof ENCRYPTION_ALGORITHM;
  /** Reference to the per-user key in the separated key store (never the key). */
  readonly keyId: string;
  /** Base64-encoded random initialization vector (unique per record). */
  readonly iv: string;
  /** Base64-encoded GCM authentication tag (detects tampering). */
  readonly authTag: string;
  /** Base64-encoded ciphertext of the JSON-serialized record. */
  readonly ciphertext: string;
}

/**
 * Encryptor port: encrypts/decrypts health-data records under a per-user key.
 *
 * Components depend on this interface (not the concrete implementation) so the
 * crypto backend can be swapped (in-memory, KMS, HSM) without changing callers.
 */
export interface Encryptor {
  /**
   * Encrypt `record` under the key for `keyId` (typically the user id),
   * provisioning a key on first use. Returns the {@link EncryptedRecord} stored
   * form on success.
   */
  encrypt<T>(keyId: string, record: T): Result<EncryptedRecord>;

  /**
   * Decrypt a previously produced {@link EncryptedRecord} back into the original
   * record value. Fails if the key is missing or the ciphertext/tag is invalid.
   */
  decrypt<T>(encrypted: EncryptedRecord): Result<T>;
}

/** Error codes surfaced by the encryptor (stable, machine-readable). */
export const CRYPTO_ERROR = {
  KEY_UNAVAILABLE: 'crypto.key_unavailable',
  UNSUPPORTED_ALGORITHM: 'crypto.unsupported_algorithm',
  MALFORMED_RECORD: 'crypto.malformed_record',
  DECRYPTION_FAILED: 'crypto.decryption_failed',
  SERIALIZATION_FAILED: 'crypto.serialization_failed',
} as const;

/**
 * AES-256-GCM {@link Encryptor} backed by a separated {@link KeyStore}.
 *
 * The store is injected, keeping key material outside this object and outside
 * every {@link EncryptedRecord} it produces (Req 25.1, Property 53).
 */
export class AesGcmEncryptor implements Encryptor {
  constructor(private readonly keyStore: KeyStore) {}

  encrypt<T>(keyId: string, record: T): Result<EncryptedRecord> {
    if (typeof keyId !== 'string' || keyId.length === 0) {
      return err(
        validationRejection(
          CRYPTO_ERROR.MALFORMED_RECORD,
          'A non-empty keyId is required to encrypt a record.',
        ),
      );
    }

    let plaintext: Buffer;
    try {
      // JSON is the language-neutral wire form for a health-data record.
      plaintext = Buffer.from(JSON.stringify(record), 'utf8');
    } catch {
      return err(
        validationRejection(
          CRYPTO_ERROR.SERIALIZATION_FAILED,
          'Record could not be serialized for encryption.',
        ),
      );
    }

    const key = this.keyStore.getOrCreateKey(keyId);
    if (key.length !== AES_256_KEY_BYTES) {
      return err(
        atomicFailure(
          CRYPTO_ERROR.KEY_UNAVAILABLE,
          `Key for "${keyId}" is not a valid AES-256 key.`,
          { retryable: false },
        ),
      );
    }

    const iv = randomBytes(GCM_IV_BYTES);
    const cipher = createCipheriv(ENCRYPTION_ALGORITHM, key, iv, {
      authTagLength: GCM_AUTH_TAG_BYTES,
    });
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return ok({
      algorithm: ENCRYPTION_ALGORITHM,
      keyId,
      iv: iv.toString('base64'),
      authTag: authTag.toString('base64'),
      ciphertext: ciphertext.toString('base64'),
    });
  }

  decrypt<T>(encrypted: EncryptedRecord): Result<T> {
    if (encrypted === null || typeof encrypted !== 'object') {
      return err(
        validationRejection(
          CRYPTO_ERROR.MALFORMED_RECORD,
          'Encrypted record is missing or not an object.',
        ),
      );
    }
    if (encrypted.algorithm !== ENCRYPTION_ALGORITHM) {
      return err(
        validationRejection(
          CRYPTO_ERROR.UNSUPPORTED_ALGORITHM,
          `Unsupported algorithm "${String(encrypted.algorithm)}".`,
        ),
      );
    }

    const key = this.keyStore.getKey(encrypted.keyId);
    if (key === undefined) {
      // Without the separately-stored key, ciphertext cannot be read back.
      return err(
        atomicFailure(
          CRYPTO_ERROR.KEY_UNAVAILABLE,
          `No key available for "${encrypted.keyId}".`,
          { retryable: false },
        ),
      );
    }

    let plaintext: Buffer;
    try {
      const iv = Buffer.from(encrypted.iv, 'base64');
      const authTag = Buffer.from(encrypted.authTag, 'base64');
      const ciphertext = Buffer.from(encrypted.ciphertext, 'base64');
      const decipher = createDecipheriv(ENCRYPTION_ALGORITHM, key, iv, {
        authTagLength: GCM_AUTH_TAG_BYTES,
      });
      decipher.setAuthTag(authTag);
      plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    } catch {
      // Wrong key, tampered ciphertext, or corrupt tag all land here.
      return err(
        atomicFailure(
          CRYPTO_ERROR.DECRYPTION_FAILED,
          'Ciphertext could not be decrypted or failed authentication.',
          { retryable: false },
        ),
      );
    }

    try {
      return ok(JSON.parse(plaintext.toString('utf8')) as T);
    } catch {
      return err(
        atomicFailure(
          CRYPTO_ERROR.DECRYPTION_FAILED,
          'Decrypted payload was not valid JSON.',
          { retryable: false },
        ),
      );
    }
  }
}

/**
 * Convenience factory: build an {@link Encryptor} over the given separated key
 * store. Components that just need "an encryptor" depend on this rather than
 * the concrete class.
 */
export function createAesEncryptor(keyStore: KeyStore): Encryptor {
  return new AesGcmEncryptor(keyStore);
}
