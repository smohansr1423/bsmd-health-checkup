import {
  AesGcmEncryptor,
  createAesEncryptor,
  ENCRYPTION_ALGORITHM,
  GCM_IV_BYTES,
  CRYPTO_ERROR,
  type EncryptedRecord,
} from './encryptor';
import {
  InMemoryKeyStore,
  generateAesKey,
  AES_256_KEY_BYTES,
} from './key-store';
import { isOk, isErr } from '../result';

/**
 * Focused unit tests for AES-256 per-user encryption with a separated key
 * store (Task 3.1). Covers the crypto round-trip and the key-separation
 * invariant. The exhaustive property-based test (Property 53) is the separate
 * optional sub-task 3.2.
 *
 * Requirements: 25.1
 */

interface HealthRecord {
  userId: string;
  cortisol: number;
  takenAt: string;
  notes: string;
}

const sampleRecord: HealthRecord = {
  userId: 'user-1',
  cortisol: 12.7,
  takenAt: '2024-06-01T07:30:00Z',
  notes: 'morning sample',
};

describe('key-store', () => {
  it('generateAesKey produces a 256-bit key', () => {
    expect(generateAesKey().length).toBe(AES_256_KEY_BYTES);
    expect(AES_256_KEY_BYTES).toBe(32);
  });

  it('getOrCreateKey is stable per keyId and distinct across users', () => {
    const store = new InMemoryKeyStore();
    const a1 = store.getOrCreateKey('user-a');
    const a2 = store.getOrCreateKey('user-a');
    const b1 = store.getOrCreateKey('user-b');

    expect(a1.equals(a2)).toBe(true); // same user -> same key
    expect(a1.equals(b1)).toBe(false); // per-user keys differ
    expect(store.hasKey('user-a')).toBe(true);
    expect(store.hasKey('user-c')).toBe(false);
  });

  it('returns defensive copies so callers cannot mutate stored key material', () => {
    const store = new InMemoryKeyStore();
    const key = store.getOrCreateKey('user-a');
    key.fill(0);
    expect(store.getKey('user-a')?.equals(key)).toBe(false);
  });

  it('deleteKey removes provisioned key material', () => {
    const store = new InMemoryKeyStore();
    store.getOrCreateKey('user-a');
    expect(store.deleteKey('user-a')).toBe(true);
    expect(store.hasKey('user-a')).toBe(false);
    expect(store.deleteKey('user-a')).toBe(false);
  });

  it('rejects seeded keys that are not AES-256 length', () => {
    expect(() => new InMemoryKeyStore({ bad: Buffer.alloc(16) })).toThrow(
      RangeError,
    );
  });
});

describe('AesGcmEncryptor round-trip', () => {
  it('decrypting the encrypted form with the user key yields the original record', () => {
    const enc = createAesEncryptor(new InMemoryKeyStore());
    const encrypted = enc.encrypt('user-1', sampleRecord);
    expect(isOk(encrypted)).toBe(true);
    if (!isOk(encrypted)) return;

    const decrypted = enc.decrypt<HealthRecord>(encrypted.value);
    expect(isOk(decrypted)).toBe(true);
    if (!isOk(decrypted)) return;

    expect(decrypted.value).toEqual(sampleRecord);
  });

  it('produces AES-256-GCM stored form with a fresh IV each time', () => {
    const enc = createAesEncryptor(new InMemoryKeyStore());
    const r1 = enc.encrypt('user-1', sampleRecord);
    const r2 = enc.encrypt('user-1', sampleRecord);
    expect(isOk(r1) && isOk(r2)).toBe(true);
    if (!isOk(r1) || !isOk(r2)) return;

    expect(r1.value.algorithm).toBe(ENCRYPTION_ALGORITHM);
    expect(Buffer.from(r1.value.iv, 'base64').length).toBe(GCM_IV_BYTES);
    // Unique IV -> identical plaintext yields different ciphertext.
    expect(r1.value.iv).not.toBe(r2.value.iv);
    expect(r1.value.ciphertext).not.toBe(r2.value.ciphertext);
  });

  it('round-trips a variety of record shapes', () => {
    const enc = createAesEncryptor(new InMemoryKeyStore());
    const records: unknown[] = [
      {},
      { nested: { a: [1, 2, 3], b: null } },
      [1, 'two', { three: 3 }],
      'a plain string record',
      { unicode: 'café — 🧪 — Ω' },
    ];
    for (const record of records) {
      const encrypted = enc.encrypt('user-x', record);
      expect(isOk(encrypted)).toBe(true);
      if (!isOk(encrypted)) continue;
      const decrypted = enc.decrypt(encrypted.value);
      expect(isOk(decrypted)).toBe(true);
      if (!isOk(decrypted)) continue;
      expect(decrypted.value).toEqual(record);
    }
  });
});

describe('key separation invariant (Req 25.1)', () => {
  it('the encrypted stored form contains no raw key material', () => {
    const store = new InMemoryKeyStore();
    const enc = new AesGcmEncryptor(store);
    const encrypted = enc.encrypt('user-1', sampleRecord);
    expect(isOk(encrypted)).toBe(true);
    if (!isOk(encrypted)) return;

    const key = store.getKey('user-1');
    expect(key).toBeDefined();
    if (!key) return;

    // The stored form only references the key by id; the bytes never appear.
    expect(encrypted.value.keyId).toBe('user-1');
    const serialized = JSON.stringify(encrypted.value);
    expect(serialized.includes(key.toString('base64'))).toBe(false);
    expect(serialized.includes(key.toString('hex'))).toBe(false);
    expect(Object.keys(encrypted.value)).not.toContain('key');
  });

  it('ciphertext cannot be decrypted once its key is removed from the store', () => {
    const store = new InMemoryKeyStore();
    const enc = new AesGcmEncryptor(store);
    const encrypted = enc.encrypt('user-1', sampleRecord);
    if (!isOk(encrypted)) throw new Error('encrypt failed');

    store.deleteKey('user-1');
    const decrypted = enc.decrypt(encrypted.value);
    expect(isErr(decrypted)).toBe(true);
    if (isErr(decrypted)) {
      expect(decrypted.error.code).toBe(CRYPTO_ERROR.KEY_UNAVAILABLE);
    }
  });

  it("another user's key cannot decrypt a record (authentication fails)", () => {
    const store = new InMemoryKeyStore();
    const enc = new AesGcmEncryptor(store);
    const encrypted = enc.encrypt('user-1', sampleRecord);
    if (!isOk(encrypted)) throw new Error('encrypt failed');

    // Re-point the stored form at a different user's (different) key.
    store.getOrCreateKey('user-2');
    const tampered: EncryptedRecord = { ...encrypted.value, keyId: 'user-2' };
    const decrypted = enc.decrypt(tampered);
    expect(isErr(decrypted)).toBe(true);
    if (isErr(decrypted)) {
      expect(decrypted.error.code).toBe(CRYPTO_ERROR.DECRYPTION_FAILED);
    }
  });
});

describe('AesGcmEncryptor error handling', () => {
  const enc = createAesEncryptor(new InMemoryKeyStore());

  it('rejects an empty keyId on encrypt', () => {
    const r = enc.encrypt('', sampleRecord);
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error.code).toBe(CRYPTO_ERROR.MALFORMED_RECORD);
  });

  it('rejects a record encrypted under an unsupported algorithm', () => {
    const bogus = {
      algorithm: 'des' as unknown as EncryptedRecord['algorithm'],
      keyId: 'user-1',
      iv: '',
      authTag: '',
      ciphertext: '',
    };
    const r = enc.decrypt(bogus);
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error.code).toBe(CRYPTO_ERROR.UNSUPPORTED_ALGORITHM);
  });

  it('rejects tampered ciphertext (GCM auth tag mismatch)', () => {
    const encrypted = enc.encrypt('user-9', sampleRecord);
    if (!isOk(encrypted)) throw new Error('encrypt failed');
    const flipped = Buffer.from(encrypted.value.ciphertext, 'base64');
    flipped[0] ^= 0xff;
    const tampered: EncryptedRecord = {
      ...encrypted.value,
      ciphertext: flipped.toString('base64'),
    };
    const r = enc.decrypt(tampered);
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error.code).toBe(CRYPTO_ERROR.DECRYPTION_FAILED);
  });
});
