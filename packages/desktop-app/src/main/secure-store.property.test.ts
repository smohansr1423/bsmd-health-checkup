/**
 * Property test for the Secure Store (main process) — Req 4.
 *
 * Property 5: Session_Token storage round-trips.
 *   For any token string, saving it to the Secure_Store and then loading it
 *   returns an equal token; after clearToken, loading returns null.
 *
 * The store's OS-facing dependencies are backed by in-memory fakes so the
 * round-trip can be exercised deterministically across many inputs, covering
 * both the safeStorage path and the keytar fallback path.
 *
 * Validates: Requirements 3.2, 4.3
 */
import * as fc from 'fast-check';
import {
  createSecureStore,
  type CiphertextStore,
  type KeytarLike,
  type SafeStorageLike,
} from './secure-store';

/**
 * In-memory {@link CiphertextStore}. Holds a copy of whatever ciphertext bytes
 * are written; mirrors the real file-backed store's observable behavior.
 */
function makeInMemoryCiphertextStore(): CiphertextStore {
  let buf: Buffer | null = null;
  return {
    async read(): Promise<Buffer | null> {
      return buf;
    },
    async write(ciphertext: Buffer): Promise<void> {
      buf = Buffer.from(ciphertext);
    },
    async clear(): Promise<void> {
      buf = null;
    },
    async exists(): Promise<boolean> {
      return buf !== null;
    },
  };
}

/**
 * In-memory {@link SafeStorageLike}. "Encrypts" by wrapping the UTF-8 bytes
 * behind a fixed prefix and "decrypts" by unwrapping it. This keeps the fake
 * reversible (so the round-trip is meaningful) while proving the store never
 * relies on the plaintext being written verbatim.
 */
function makeFakeSafeStorage(available: boolean): SafeStorageLike {
  const PREFIX = Buffer.from('enc:');
  return {
    isEncryptionAvailable(): boolean {
      return available;
    },
    encryptString(plainText: string): Buffer {
      return Buffer.concat([PREFIX, Buffer.from(plainText, 'utf8')]);
    },
    decryptString(encrypted: Buffer): string {
      return encrypted.subarray(PREFIX.length).toString('utf8');
    },
  };
}

/** In-memory {@link KeytarLike} backed by a Map keyed by service+account. */
function makeInMemoryKeytar(): KeytarLike {
  const vault = new Map<string, string>();
  const key = (service: string, account: string): string => `${service}\u0000${account}`;
  return {
    async getPassword(service: string, account: string): Promise<string | null> {
      const v = vault.get(key(service, account));
      return v === undefined ? null : v;
    },
    async setPassword(service: string, account: string, password: string): Promise<void> {
      vault.set(key(service, account), password);
    },
    async deletePassword(service: string, account: string): Promise<boolean> {
      return vault.delete(key(service, account));
    },
  };
}

describe('SecureStore — Property 5: Session_Token storage round-trips', () => {
  it('save→load returns an equal token, and clear→load returns null (safeStorage path)', async () => {
    await fc.assert(
      fc.asyncProperty(fc.string(), async (token) => {
        const store = createSecureStore({
          safeStorage: makeFakeSafeStorage(true),
          ciphertextStore: makeInMemoryCiphertextStore(),
          keytar: makeInMemoryKeytar(),
        });

        await store.saveToken(token);
        expect(await store.loadToken()).toBe(token);
        expect(await store.hasToken()).toBe(true);

        await store.clearToken();
        expect(await store.loadToken()).toBeNull();
        expect(await store.hasToken()).toBe(false);
      })
    );
  });

  it('save→load returns an equal token, and clear→load returns null (keytar fallback path)', async () => {
    await fc.assert(
      fc.asyncProperty(fc.string(), async (token) => {
        const store = createSecureStore({
          // Encryption reported unavailable → store falls back to keytar.
          safeStorage: makeFakeSafeStorage(false),
          ciphertextStore: makeInMemoryCiphertextStore(),
          keytar: makeInMemoryKeytar(),
        });

        await store.saveToken(token);
        expect(await store.loadToken()).toBe(token);
        expect(await store.hasToken()).toBe(true);

        await store.clearToken();
        expect(await store.loadToken()).toBeNull();
        expect(await store.hasToken()).toBe(false);
      })
    );
  });

  it('keytar-only environment (no safeStorage) round-trips', async () => {
    await fc.assert(
      fc.asyncProperty(fc.string(), async (token) => {
        const store = createSecureStore({
          ciphertextStore: makeInMemoryCiphertextStore(),
          keytar: makeInMemoryKeytar(),
        });

        await store.saveToken(token);
        expect(await store.loadToken()).toBe(token);
        expect(await store.hasToken()).toBe(true);

        await store.clearToken();
        expect(await store.loadToken()).toBeNull();
        expect(await store.hasToken()).toBe(false);
      })
    );
  });

  it('re-saving overwrites the prior token (idempotent latest-write-wins)', async () => {
    await fc.assert(
      fc.asyncProperty(fc.string(), fc.string(), async (first, second) => {
        const store = createSecureStore({
          safeStorage: makeFakeSafeStorage(true),
          ciphertextStore: makeInMemoryCiphertextStore(),
          keytar: makeInMemoryKeytar(),
        });

        await store.saveToken(first);
        await store.saveToken(second);
        expect(await store.loadToken()).toBe(second);
      })
    );
  });
});
