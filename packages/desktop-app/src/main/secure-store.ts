/**
 * Secure Store (main process) — Req 4.
 *
 * Holds the Session_Token on the user's device without ever writing it in
 * plaintext. The token is encrypted with Electron's `safeStorage`
 * (OS-backed: DPAPI on Windows, Keychain on macOS, libsecret on Linux) and
 * only the ciphertext is persisted to the user-data directory. When
 * `safeStorage` reports that encryption is unavailable, the store falls back
 * to `keytar`, which writes directly to the OS credential vault.
 *
 * Security rules enforced here (Req 4.1, 4.3):
 *  - Only ciphertext is written to disk; the plaintext token never touches a
 *    file or a log line.
 *  - Nothing in this module logs the token or embeds it in an error message.
 *  - The renderer never calls this module directly; it triggers save/clear
 *    through the typed preload bridge and never reads the raw token.
 *
 * Testability: every OS-facing dependency (encryption, ciphertext file,
 * keytar) is expressed as a small interface and injected through
 * {@link createSecureStore}. Tests supply in-memory fakes; production wiring
 * uses {@link createDefaultSecureStore}, which lazily loads Electron and
 * keytar so this module carries no static dependency on either.
 */

/** Public surface used by startup routing and the request broker. */
export interface SecureStore {
  /** Encrypt and persist the Session_Token as ciphertext (Req 4.1). */
  saveToken(token: string): Promise<void>;
  /** Return the stored Session_Token, or null when none is stored (Req 4.2). */
  loadToken(): Promise<string | null>;
  /** Remove the stored Session_Token (sign-out / expiry — Req 4.3, 4.4). */
  clearToken(): Promise<void>;
  /** True iff a Session_Token is currently stored (startup routing — Req 1.4, 1.5). */
  hasToken(): Promise<boolean>;
}

/**
 * Minimal shape of Electron's `safeStorage`. Declared locally so this module
 * does not statically depend on the `electron` types.
 */
export interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(plainText: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

/**
 * Minimal shape of the `keytar` module used as an encryption fallback.
 * Declared locally so this module does not statically depend on `keytar`.
 */
export interface KeytarLike {
  getPassword(service: string, account: string): Promise<string | null>;
  setPassword(service: string, account: string, password: string): Promise<void>;
  deletePassword(service: string, account: string): Promise<boolean>;
}

/**
 * Persistence for the encrypted token bytes. The default implementation
 * writes a single file in the user-data directory; tests use an in-memory
 * fake. Implementations must store only the ciphertext handed to them.
 */
export interface CiphertextStore {
  read(): Promise<Buffer | null>;
  write(ciphertext: Buffer): Promise<void>;
  clear(): Promise<void>;
  exists(): Promise<boolean>;
}

/** Dependencies injected into {@link createSecureStore}. */
export interface SecureStoreDeps {
  /** OS-backed encryption. Optional so a keytar-only environment is supported. */
  safeStorage?: SafeStorageLike;
  /** Ciphertext persistence used when `safeStorage` encryption is available. */
  ciphertextStore: CiphertextStore;
  /** Credential-vault fallback used when encryption is unavailable. */
  keytar?: KeytarLike;
  /** keytar service name; defaults to the app identifier. */
  serviceName?: string;
  /** keytar account name; defaults to the token key. */
  accountName?: string;
}

/** Default keytar identifiers. */
const DEFAULT_SERVICE_NAME = 'api-copilot-desktop';
const DEFAULT_ACCOUNT_NAME = 'session-token';

/**
 * Create a {@link SecureStore} from injected backends.
 *
 * Backend selection at save time:
 *  - If `safeStorage` exists and reports encryption available, encrypt the
 *    token and persist the ciphertext; any stale keytar entry is removed.
 *  - Otherwise, if `keytar` is available, store via keytar; any stale
 *    ciphertext file is removed.
 *  - If neither backend can store a secret securely, throw — we never write
 *    the token in plaintext (Req 4.1).
 */
export function createSecureStore(deps: SecureStoreDeps): SecureStore {
  const service = deps.serviceName ?? DEFAULT_SERVICE_NAME;
  const account = deps.accountName ?? DEFAULT_ACCOUNT_NAME;

  const encryptionAvailable = (): boolean =>
    deps.safeStorage !== undefined && deps.safeStorage.isEncryptionAvailable();

  return {
    async saveToken(token: string): Promise<void> {
      if (encryptionAvailable()) {
        // safeStorage is guaranteed defined by encryptionAvailable().
        const ciphertext = deps.safeStorage!.encryptString(token);
        await deps.ciphertextStore.write(ciphertext);
        // Remove any secret previously written to the fallback backend.
        if (deps.keytar) {
          await deps.keytar.deletePassword(service, account);
        }
        return;
      }

      if (deps.keytar) {
        await deps.keytar.setPassword(service, account, token);
        // Remove any stale ciphertext so both backends never disagree.
        await deps.ciphertextStore.clear();
        return;
      }

      // No secure backend available: refuse rather than persist plaintext.
      throw new Error('Secure storage is unavailable: cannot persist session token securely.');
    },

    async loadToken(): Promise<string | null> {
      // Prefer the encrypted-file backend when it holds a value.
      if (deps.safeStorage && (await deps.ciphertextStore.exists())) {
        const ciphertext = await deps.ciphertextStore.read();
        if (ciphertext && ciphertext.length > 0) {
          return deps.safeStorage.decryptString(ciphertext);
        }
      }

      // Fall back to the credential vault.
      if (deps.keytar) {
        return deps.keytar.getPassword(service, account);
      }

      return null;
    },

    async clearToken(): Promise<void> {
      // Clear both backends so no residual secret remains anywhere.
      await deps.ciphertextStore.clear();
      if (deps.keytar) {
        await deps.keytar.deletePassword(service, account);
      }
    },

    async hasToken(): Promise<boolean> {
      if (deps.safeStorage && (await deps.ciphertextStore.exists())) {
        const ciphertext = await deps.ciphertextStore.read();
        if (ciphertext && ciphertext.length > 0) {
          return true;
        }
      }

      if (deps.keytar) {
        const stored = await deps.keytar.getPassword(service, account);
        return stored !== null;
      }

      return false;
    },
  };
}

/**
 * File-backed {@link CiphertextStore} that persists encrypted bytes to a
 * single file. It stores only the ciphertext handed to it and never inspects
 * or logs the plaintext.
 */
export function createFileCiphertextStore(filePath: string): CiphertextStore {
  // Loaded lazily so this module has no static Node import beyond `require`.
  const fs = require('fs') as typeof import('fs');
  const fsp = fs.promises;

  return {
    async read(): Promise<Buffer | null> {
      try {
        return await fsp.readFile(filePath);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          return null;
        }
        throw err;
      }
    },
    async write(ciphertext: Buffer): Promise<void> {
      const path = require('path') as typeof import('path');
      await fsp.mkdir(path.dirname(filePath), { recursive: true });
      // Restrict to owner read/write where the OS honors POSIX permissions.
      await fsp.writeFile(filePath, ciphertext, { mode: 0o600 });
    },
    async clear(): Promise<void> {
      try {
        await fsp.unlink(filePath);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw err;
        }
      }
    },
    async exists(): Promise<boolean> {
      try {
        await fsp.access(filePath);
        return true;
      } catch {
        return false;
      }
    },
  };
}

/**
 * Production wiring: build a {@link SecureStore} backed by Electron's
 * `safeStorage` (encrypting to a file in the user-data directory) with a
 * `keytar` fallback when OS encryption is unavailable.
 *
 * Electron and keytar are loaded lazily via `require` so this module can be
 * imported and unit-tested without either package installed. Call this only
 * from the Electron main process after the app is ready.
 */
export function createDefaultSecureStore(): SecureStore {
  const path = require('path') as typeof import('path');
  // Electron's app + safeStorage. Typed as `any` because the package is not a
  // static dependency of this module.
  const electron = require('electron') as {
    app: { getPath(name: 'userData'): string };
    safeStorage: SafeStorageLike;
  };

  const userDataDir = electron.app.getPath('userData');
  const ciphertextStore = createFileCiphertextStore(
    path.join(userDataDir, 'session-token.enc'),
  );

  let keytar: KeytarLike | undefined;
  try {
    keytar = require('keytar') as KeytarLike;
  } catch {
    // keytar is optional; when absent the store relies on safeStorage only.
    keytar = undefined;
  }

  return createSecureStore({
    safeStorage: electron.safeStorage,
    ciphertextStore,
    keytar,
  });
}
