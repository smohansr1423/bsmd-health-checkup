/**
 * Auth Assistant — AES-256-GCM Envelope CryptoProvider
 *
 * A production-grade `CryptoProvider` implementing envelope encryption:
 *   1. A fresh 256-bit data key (DEK) is generated per message and used to
 *      encrypt the plaintext with AES-256-GCM (authenticated encryption).
 *   2. The DEK is then wrapped (encrypted) with a long-lived key-encryption
 *      key (KEK) — also AES-256-GCM — so the KEK never touches the plaintext.
 *
 * The wrapped DEK travels inside the `Ciphertext.encryptedDataKey` field. In a
 * real deployment the KEK is managed by a KMS; here it is supplied to the
 * constructor. Credential values are therefore never readable in plaintext
 * through any storage artifact (Req 6.8).
 *
 * Validates: Requirements 6.8
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import type { Ciphertext, CryptoProvider } from '../api-copilot-shared';

const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32; // 256-bit
const IV_BYTES = 12; // 96-bit nonce recommended for GCM

export interface AesGcmCryptoProviderOptions {
  /** 32-byte (256-bit) key-encryption key used to wrap per-message data keys. */
  masterKey: Buffer;
  /** Identifier recorded on the ciphertext envelope for key rotation/auditing. */
  keyId?: string;
}

/**
 * Encode the wrapped-DEK envelope segment as `keyIv:keyAuthTag:wrappedKey`,
 * each component base64. Kept private so the encoding stays internal.
 */
function encodeWrappedKey(keyIv: Buffer, keyAuthTag: Buffer, wrappedKey: Buffer): string {
  return [
    keyIv.toString('base64'),
    keyAuthTag.toString('base64'),
    wrappedKey.toString('base64'),
  ].join(':');
}

function decodeWrappedKey(encoded: string): {
  keyIv: Buffer;
  keyAuthTag: Buffer;
  wrappedKey: Buffer;
} {
  const parts = encoded.split(':');
  if (parts.length !== 3) {
    throw new Error('Malformed wrapped data key envelope');
  }
  return {
    keyIv: Buffer.from(parts[0], 'base64'),
    keyAuthTag: Buffer.from(parts[1], 'base64'),
    wrappedKey: Buffer.from(parts[2], 'base64'),
  };
}

/**
 * AES-256-GCM envelope encryption provider. Suitable for production once the
 * KEK is sourced from a KMS; deterministic-free (random DEK + IV per call) so
 * identical plaintexts never produce identical ciphertexts.
 */
export class AesGcmCryptoProvider implements CryptoProvider {
  private readonly masterKey: Buffer;
  private readonly keyId: string;

  constructor(options: AesGcmCryptoProviderOptions) {
    if (options.masterKey.length !== KEY_BYTES) {
      throw new Error(
        `AesGcmCryptoProvider requires a ${KEY_BYTES}-byte master key (received ${options.masterKey.length} bytes)`
      );
    }
    this.masterKey = options.masterKey;
    this.keyId = options.keyId ?? 'aes-256-gcm-kek';
  }

  /** Generate a random 256-bit KEK. Useful for tests and local development. */
  static generateMasterKey(): Buffer {
    return randomBytes(KEY_BYTES);
  }

  async encrypt(plaintext: Buffer): Promise<Ciphertext> {
    // 1. Encrypt the plaintext under a fresh per-message data key.
    const dataKey = randomBytes(KEY_BYTES);
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, dataKey, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const authTag = cipher.getAuthTag();

    // 2. Wrap the data key with the KEK.
    const keyIv = randomBytes(IV_BYTES);
    const keyCipher = createCipheriv(ALGORITHM, this.masterKey, keyIv);
    const wrappedKey = Buffer.concat([keyCipher.update(dataKey), keyCipher.final()]);
    const keyAuthTag = keyCipher.getAuthTag();

    return {
      data: encrypted.toString('base64'),
      iv: iv.toString('base64'),
      authTag: authTag.toString('base64'),
      keyId: this.keyId,
      encryptedDataKey: encodeWrappedKey(keyIv, keyAuthTag, wrappedKey),
    };
  }

  async decrypt(ciphertext: Ciphertext): Promise<Buffer> {
    if (!ciphertext.encryptedDataKey) {
      throw new Error('Ciphertext is missing its wrapped data key');
    }

    // 1. Unwrap the data key with the KEK.
    const { keyIv, keyAuthTag, wrappedKey } = decodeWrappedKey(ciphertext.encryptedDataKey);
    const keyDecipher = createDecipheriv(ALGORITHM, this.masterKey, keyIv);
    keyDecipher.setAuthTag(keyAuthTag);
    const dataKey = Buffer.concat([keyDecipher.update(wrappedKey), keyDecipher.final()]);

    // 2. Decrypt the payload with the recovered data key.
    const decipher = createDecipheriv(ALGORITHM, dataKey, Buffer.from(ciphertext.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(ciphertext.authTag, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext.data, 'base64')),
      decipher.final(),
    ]);
  }
}
