/**
 * Reference {@link Encryptor} implementations for the Data Vault (Task 2.4).
 *
 * The production AES-256 per-user encryptor is task 3.1. To avoid coupling this
 * storage layer to that in-progress crypto module, the Data Vault is defined
 * against the injectable {@link Encryptor} port and ships with these trivial
 * reference encryptors suitable for local development and testing.
 *
 * Requirements: 17.1
 */

import type { Encryptor } from './types';

/**
 * A no-op encryptor: ciphertext === plaintext.
 *
 * This is a stand-in only; it performs NO cryptography and MUST NOT be used to
 * persist real health data. Swap in the AES-256 per-user encryptor (task 3.1)
 * in production.
 */
export class PassthroughEncryptor implements Encryptor {
  encrypt(plaintext: string): string {
    return plaintext;
  }

  decrypt(ciphertext: string): string {
    return ciphertext;
  }
}
