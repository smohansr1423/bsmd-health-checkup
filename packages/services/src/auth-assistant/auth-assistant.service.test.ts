/**
 * Unit tests for the Auth Assistant: envelope crypto, credential storage,
 * scheme support, token reuse/refresh, and redacted authentication errors.
 */

import { InMemoryCredentialRepository } from '../api-copilot-shared';
import { AuthAssistant, FakeTokenAcquisition } from './auth-assistant.service';
import { AesGcmCryptoProvider } from './auth-assistant.crypto';
import {
  AuthError,
  AuthTimeoutError,
  NoRefreshMechanismError,
  RefreshFailedError,
} from './auth-assistant.errors';
import type { AuthAssistantDependencies } from './auth-assistant.types';

const SECRET_VALUE = 'super-secret-client-value-1234567890';

function makeAssistant(
  overrides: Partial<AuthAssistantDependencies> = {}
): {
  assistant: AuthAssistant;
  repo: InMemoryCredentialRepository;
  acquirer: FakeTokenAcquisition;
  crypto: AesGcmCryptoProvider;
  now: { value: Date };
} {
  const repo = new InMemoryCredentialRepository();
  const acquirer = new FakeTokenAcquisition();
  const crypto = new AesGcmCryptoProvider({ masterKey: AesGcmCryptoProvider.generateMasterKey() });
  const now = { value: new Date('2024-01-01T00:00:00.000Z') };
  const assistant = new AuthAssistant({
    repository: repo,
    cryptoProvider: crypto,
    tokenAcquisition: acquirer,
    dateProvider: () => now.value,
    idGenerator: (() => {
      let n = 0;
      return () => `cred-${(n += 1)}`;
    })(),
    acquisitionTimeoutMs: 50,
    ...overrides,
  });
  return { assistant, repo, acquirer, crypto, now };
}

describe('AesGcmCryptoProvider', () => {
  it('round-trips plaintext and does not store it readable', async () => {
    const crypto = new AesGcmCryptoProvider({
      masterKey: AesGcmCryptoProvider.generateMasterKey(),
    });
    const ct = await crypto.encrypt(Buffer.from(SECRET_VALUE));
    const serialized = JSON.stringify(ct);
    expect(serialized).not.toContain(SECRET_VALUE);
    expect(ct.encryptedDataKey).toBeDefined();
    const back = await crypto.decrypt(ct);
    expect(back.toString()).toBe(SECRET_VALUE);
  });

  it('produces distinct ciphertexts for identical plaintext', async () => {
    const crypto = new AesGcmCryptoProvider({
      masterKey: AesGcmCryptoProvider.generateMasterKey(),
    });
    const a = await crypto.encrypt(Buffer.from(SECRET_VALUE));
    const b = await crypto.encrypt(Buffer.from(SECRET_VALUE));
    expect(a.data).not.toBe(b.data);
  });

  it('rejects a non-32-byte master key', () => {
    expect(() => new AesGcmCryptoProvider({ masterKey: Buffer.alloc(16) })).toThrow();
  });
});

describe('AuthAssistant.supportedSchemes', () => {
  it('reports all seven supported schemes (Req 6.1)', () => {
    const { assistant } = makeAssistant();
    expect(assistant.supportedSchemes().sort()).toEqual(
      ['apiKey', 'basic', 'bearer', 'clientCredentials', 'jwt', 'oauth2', 'pkce'].sort()
    );
  });
});

describe('AuthAssistant.registerCredential (Req 6.8)', () => {
  it('stores credentials encrypted with no plaintext in the artifact', async () => {
    const { assistant, repo } = makeAssistant();
    await assistant.registerCredential({
      targetApiRef: 'api-x',
      scheme: 'bearer',
      secret: { scheme: 'bearer', bearerToken: SECRET_VALUE },
    });
    const stored = await repo.findByTarget('api-x');
    expect(stored).not.toBeNull();
    expect(JSON.stringify(stored)).not.toContain(SECRET_VALUE);
  });
});

describe('AuthAssistant.ensureToken static schemes', () => {
  it('builds a Basic header from stored credentials', async () => {
    const { assistant } = makeAssistant();
    await assistant.registerCredential({
      targetApiRef: 'api-x',
      scheme: 'basic',
      secret: { scheme: 'basic', basic: { username: 'u', password: 'p' } },
    });
    const material = await assistant.ensureToken({ targetApiRef: 'api-x' });
    expect(material.headers.Authorization).toBe(
      `Basic ${Buffer.from('u:p').toString('base64')}`
    );
  });

  it('rejects an expired JWT with a no-refresh error (Req 6.6)', async () => {
    const { assistant } = makeAssistant();
    await assistant.registerCredential({
      targetApiRef: 'api-jwt',
      scheme: 'jwt',
      secret: {
        scheme: 'jwt',
        jwt: { token: SECRET_VALUE, expiresAt: '2023-01-01T00:00:00.000Z' },
      },
    });
    await expect(assistant.ensureToken({ targetApiRef: 'api-jwt' })).rejects.toBeInstanceOf(
      NoRefreshMechanismError
    );
  });
});

describe('AuthAssistant.ensureToken token schemes', () => {
  it('acquires then reuses a still-valid token (Req 6.2, 6.4)', async () => {
    const { assistant, acquirer, now } = makeAssistant();
    await assistant.registerCredential({
      targetApiRef: 'api-oauth',
      scheme: 'oauth2',
      secret: {
        scheme: 'oauth2',
        oauth: { tokenEndpoint: 'https://t/token', clientId: 'c' },
      },
    });
    acquirer.onAcquire({
      accessToken: 'tok-1',
      expiresAt: new Date(now.value.getTime() + 60_000),
    });

    const first = await assistant.ensureToken({ targetApiRef: 'api-oauth' });
    expect(first.headers.Authorization).toBe('Bearer tok-1');

    // No second acquire queued: reuse must not call the acquirer again.
    const second = await assistant.ensureToken({ targetApiRef: 'api-oauth' });
    expect(second.headers.Authorization).toBe('Bearer tok-1');
  });

  it('auto-refreshes an expired token when a refresh token exists (Req 6.5)', async () => {
    const { assistant, acquirer, now } = makeAssistant();
    await assistant.registerCredential({
      targetApiRef: 'api-oauth',
      scheme: 'oauth2',
      secret: {
        scheme: 'oauth2',
        oauth: { tokenEndpoint: 'https://t/token', clientId: 'c', refreshToken: 'r' },
      },
    });
    acquirer.onAcquire({
      accessToken: 'tok-1',
      expiresAt: new Date(now.value.getTime() + 1_000),
    });
    acquirer.onRefresh({
      accessToken: 'tok-2',
      expiresAt: new Date(now.value.getTime() + 60_000),
    });

    const first = await assistant.ensureToken({ targetApiRef: 'api-oauth' });
    expect(first.headers.Authorization).toBe('Bearer tok-1');

    // Advance past expiry -> auto-refresh.
    now.value = new Date(now.value.getTime() + 5_000);
    const refreshed = await assistant.ensureToken({ targetApiRef: 'api-oauth' });
    expect(refreshed.headers.Authorization).toBe('Bearer tok-2');
  });

  it('errors when an expired token has no refresh mechanism (Req 6.6)', async () => {
    const { assistant, acquirer, now } = makeAssistant();
    await assistant.registerCredential({
      targetApiRef: 'api-oauth',
      scheme: 'oauth2',
      secret: {
        scheme: 'oauth2',
        oauth: { tokenEndpoint: 'https://t/token', clientId: 'c' },
      },
    });
    acquirer.onAcquire({
      accessToken: 'tok-1',
      expiresAt: new Date(now.value.getTime() + 1_000),
    });
    await assistant.ensureToken({ targetApiRef: 'api-oauth' });
    now.value = new Date(now.value.getTime() + 5_000);
    await expect(assistant.ensureToken({ targetApiRef: 'api-oauth' })).rejects.toBeInstanceOf(
      NoRefreshMechanismError
    );
  });

  it('aborts acquisition after the timeout cap (Req 6.3)', async () => {
    const { assistant, acquirer } = makeAssistant();
    await assistant.registerCredential({
      targetApiRef: 'api-slow',
      scheme: 'clientCredentials',
      secret: {
        scheme: 'clientCredentials',
        oauth: { tokenEndpoint: 'https://t/token', clientId: 'c', clientSecret: SECRET_VALUE },
      },
    });
    acquirer.onAcquire(() => new Promise<never>(() => {})); // never resolves
    await expect(assistant.ensureToken({ targetApiRef: 'api-slow' })).rejects.toBeInstanceOf(
      AuthTimeoutError
    );
  });

  it('classifies a rejected refresh as a refresh failure (Req 6.7)', async () => {
    const { assistant, acquirer, now } = makeAssistant();
    await assistant.registerCredential({
      targetApiRef: 'api-oauth',
      scheme: 'oauth2',
      secret: {
        scheme: 'oauth2',
        oauth: {
          tokenEndpoint: 'https://t/token',
          clientId: 'c',
          refreshToken: SECRET_VALUE,
        },
      },
    });
    acquirer.onAcquire({
      accessToken: 'tok-1',
      expiresAt: new Date(now.value.getTime() + 1_000),
    });
    acquirer.onRefresh(() => Promise.reject(new Error(`endpoint said: ${SECRET_VALUE}`)));

    await assistant.ensureToken({ targetApiRef: 'api-oauth' });
    now.value = new Date(now.value.getTime() + 5_000);

    const error = await assistant
      .ensureToken({ targetApiRef: 'api-oauth' })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RefreshFailedError);
  });
});

describe('AuthError redaction (Req 6.3, 6.6, 6.7, 6.9)', () => {
  it('never leaks credential values through message, fields, or JSON', async () => {
    const { assistant, acquirer } = makeAssistant();
    await assistant.registerCredential({
      targetApiRef: 'api-bad',
      scheme: 'oauth2',
      secret: {
        scheme: 'oauth2',
        oauth: {
          tokenEndpoint: 'https://t/token',
          clientId: 'c',
          clientSecret: SECRET_VALUE,
        },
      },
    });
    acquirer.onAcquire(() => Promise.reject(new Error(`bad creds: ${SECRET_VALUE}`)));

    const error = (await assistant
      .ensureToken({ targetApiRef: 'api-bad' })
      .catch((e: unknown) => e)) as AuthError;

    expect(error).toBeInstanceOf(AuthError);
    expect(error.message).not.toContain(SECRET_VALUE);
    expect(JSON.stringify(error.toJSON())).not.toContain(SECRET_VALUE);
    // Error still identifies target + scheme + reason.
    expect(error.targetApiRef).toBe('api-bad');
    expect(error.scheme).toBe('oauth2');
    expect(error.reason).toBe('invalid_credentials');
  });
});
