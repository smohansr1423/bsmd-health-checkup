/**
 * Password hashing utility using Node's built-in scrypt (no external deps).
 *
 * Hash format (single string, safe to store):
 *   scrypt$N$r$p$<saltBase64>$<derivedKeyBase64>
 *
 * Verification is constant-time. Used to replace the insecure plaintext
 * password comparison that the in-memory AuthService defaults to.
 *
 * Validates: Requirement 18.2
 */

import crypto from 'crypto';

/** scrypt cost parameters. N must be a power of two. */
const SCRYPT_N = 16384; // CPU/memory cost
const SCRYPT_R = 8; // block size
const SCRYPT_P = 1; // parallelization
const KEY_LEN = 32; // derived key length in bytes
const SALT_LEN = 16; // salt length in bytes

const PREFIX = 'scrypt';

function derive(password: string, salt: Buffer): Buffer {
  return crypto.scryptSync(password, salt, KEY_LEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    // scrypt needs a higher maxmem for these params on some Node versions.
    maxmem: 128 * SCRYPT_N * SCRYPT_R * 2,
  });
}

/** Produce a salted scrypt hash string for the given plaintext password. */
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(SALT_LEN);
  const derivedKey = derive(password, salt);
  return [
    PREFIX,
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString('base64'),
    derivedKey.toString('base64'),
  ].join('$');
}

/**
 * Verify a plaintext password against a stored scrypt hash string.
 * Returns false (never throws) for malformed hashes or mismatches.
 */
export function verifyPassword(password: string, stored: string): boolean {
  if (!stored || typeof stored !== 'string') {
    return false;
  }
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== PREFIX) {
    return false;
  }

  const [, nStr, rStr, pStr, saltB64, keyB64] = parts;
  const N = Number(nStr);
  const r = Number(rStr);
  const p = Number(pStr);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) {
    return false;
  }

  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(saltB64, 'base64');
    expected = Buffer.from(keyB64, 'base64');
  } catch {
    return false;
  }

  let actual: Buffer;
  try {
    actual = crypto.scryptSync(password, salt, expected.length, {
      N,
      r,
      p,
      maxmem: 128 * N * r * 2,
    });
  } catch {
    return false;
  }

  if (actual.length !== expected.length) {
    return false;
  }
  return crypto.timingSafeEqual(actual, expected);
}
