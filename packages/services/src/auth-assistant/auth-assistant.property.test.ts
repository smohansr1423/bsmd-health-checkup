/**
 * Auth Assistant — Property-Based Tests
 *
 * Uses fast-check to validate the universal token-lifecycle and credential
 * confidentiality properties from the design document:
 *   - Property 24: Valid tokens are reused (Req 6.4)
 *   - Property 25: Expired tokens auto-refresh when a refresh mechanism exists (Req 6.5)
 *   - Property 26: Credentials are never exposed in plaintext (Req 6.3, 6.6, 6.7, 6.8, 6.9)
 *
 * These complement (do not duplicate) the example-based unit tests in
 * auth-assistant.service.test.ts. Every collaborator is injected: a
 * deterministic idGenerator, a controllable dateProvider clock (used to drive
 * token expiry, reuse, and refresh decisions), the real AesGcmCryptoProvider,
 * an InMemoryCredentialRepository, and the FakeTokenAcquisition port. The
 * global fast-check run count (25) is configured in jest.setup.fast-check.ts;
 * no inline numRuns overrides are used.
 *
 * Feature: api-copilot-ai
 * Validates: Requirements 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9
 */

import * as fc from 'fast-check';

import { InMemoryCredentialRepository } from '../api-copilot-shared';
import type { AuthScheme } from '../api-copilot-shared';
import { AuthAssistant, FakeTokenAcquisition } from './auth-assistant.service';
import { AesGcmCryptoProvider } from './auth-assistant.crypto';
import {
  AuthError,
  AuthTimeoutError,
  InvalidCredentialsError,
  NoRefreshMechanismError,
  RefreshFailedError,
} from './auth-assistant.errors';
import type { AuthErrorReason } from './auth-assistant.errors';
import type { CredentialSecret } from './auth-assistant.types';

// ---------------------------------------------------------------------------
// Test harness: deterministic id generator + controllable clock + fakes.
// ---------------------------------------------------------------------------

const BASE_TIME = new Date('2024-01-01T00:00:00.000Z');

interface Harness {
  assistant: AuthAssistant;
  repo: InMemoryCredentialRepository;
  acquirer: FakeTokenAcquisition;
  clock: { value: Date };
}

function makeHarness(timeoutMs = 20): Harness {
  const repo = new InMemoryCredentialRepository();
  const acquirer = new FakeTokenAcquisition();
  const crypto = new AesGcmCryptoProvider({
    masterKey: AesGcmCryptoProvider.generateMasterKey(),
  });
  const clock = { value: new Date(BASE_TIME) };
  let seq = 0;
  const assistant = new AuthAssistant({
    repository: repo,
    cryptoProvider: crypto,
    tokenAcquisition: acquirer,
    dateProvider: () => clock.value,
    idGenerator: () => `cred-${(seq += 1)}`,
    acquisitionTimeoutMs: timeoutMs,
  });
  return { assistant, repo, acquirer, clock };
}

/** OAuth-family secret with the sensitive value carried in the client secret
 *  (and, optionally, a refresh token). */
function oauthSecret(
  scheme: AuthScheme,
  secretValue: string,
  withRefresh: boolean
): CredentialSecret {
  return {
    scheme,
    oauth: {
      tokenEndpoint: 'https://token.example/oauth/token',
      clientId: 'client',
      clientSecret: secretValue,
      ...(withRefresh ? { refreshToken: secretValue } : {}),
    },
  };
}

/** Build a scheme-appropriate secret embedding `v` for the storage property. */
function anySchemeSecret(scheme: AuthScheme, v: string): CredentialSecret {
  switch (scheme) {
    case 'apiKey':
      return { scheme, apiKey: { headerName: 'X-Api-Key', value: v } };
    case 'bearer':
      return { scheme, bearerToken: v };
    case 'basic':
      return { scheme, basic: { username: 'user', password: v } };
    case 'jwt':
      return { scheme, jwt: { token: v } };
    default:
      return oauthSecret(scheme, v, true);
  }
}

// ---------------------------------------------------------------------------
// Generators (smart, constrained to the meaningful input space).
// ---------------------------------------------------------------------------

/** A target reference; disjoint from generated secret values by construction. */
const targetArb = fc.hexaString({ minLength: 4, maxLength: 12 }).map((s) => `api-${s}`);

/**
 * A high-entropy credential value. The `S3CRET-` prefix (and uppercase letters)
 * guarantees the value is disjoint from every fixed string used by the harness
 * (scheme names, target refs, endpoints, "Bearer", header names), so a
 * substring match is a genuine leak rather than an accidental collision.
 */
const secretArb = fc
  .hexaString({ minLength: 8, maxLength: 40 })
  .map((s) => `S3CRET-${s}-END`);

const tokenSchemeArb = fc.constantFrom<AuthScheme>('oauth2', 'clientCredentials', 'pkce');
const allSchemeArb = fc.constantFrom<AuthScheme>(
  'oauth2',
  'jwt',
  'apiKey',
  'bearer',
  'basic',
  'clientCredentials',
  'pkce'
);

// ===========================================================================
// Property 24: Valid tokens are reused
// ===========================================================================

describe('Property 24: Valid tokens are reused', () => {
  // Feature: api-copilot-ai, Property 24: For any sequence of requests to the
  // same target API while an obtained token remains valid, the Auth_Assistant
  // performs exactly one token acquisition and reuses the token for the
  // remaining requests.
  // Validates: Requirements 6.4
  it('acquires exactly once and reuses the token for every subsequent request while valid', async () => {
    await fc.assert(
      fc.asyncProperty(
        targetArb,
        tokenSchemeArb,
        secretArb,
        fc.integer({ min: 1, max: 12 }),
        fc.integer({ min: 1_000, max: 1_000_000 }),
        async (target, scheme, secretValue, requestCount, validForMs) => {
          const { assistant, acquirer, clock } = makeHarness();
          await assistant.registerCredential({
            targetApiRef: target,
            scheme,
            secret: oauthSecret(scheme, secretValue, false),
          });

          // Exactly one acquisition response is queued. If reuse were violated
          // a second acquisition would be attempted and would fail closed.
          let acquireCount = 0;
          const accessToken = `tok-${secretValue}`;
          acquirer.onAcquire(() => {
            acquireCount += 1;
            return Promise.resolve({
              accessToken,
              expiresAt: new Date(clock.value.getTime() + validForMs),
            });
          });

          const headers: string[] = [];
          for (let i = 0; i < requestCount; i += 1) {
            const material = await assistant.ensureToken({ targetApiRef: target });
            headers.push(material.headers.Authorization);
          }

          // Exactly one acquisition, and every request saw the same token.
          expect(acquireCount).toBe(1);
          expect(headers).toHaveLength(requestCount);
          expect(headers.every((h) => h === `Bearer ${accessToken}`)).toBe(true);
        }
      )
    );
  });
});

// ===========================================================================
// Property 25: Expired tokens auto-refresh when a refresh mechanism exists
// ===========================================================================

describe('Property 25: Expired tokens auto-refresh when a refresh mechanism exists', () => {
  // Feature: api-copilot-ai, Property 25: For any target API with an expired
  // token and a configured refresh mechanism, the Auth_Assistant obtains a new
  // token before the next request is sent.
  // Validates: Requirements 6.5
  it('obtains a new, distinct token before the next request once the current token expires', async () => {
    await fc.assert(
      fc.asyncProperty(
        targetArb,
        tokenSchemeArb,
        secretArb,
        fc.integer({ min: 1_000, max: 60_000 }),
        fc.integer({ min: 1, max: 120_000 }),
        async (target, scheme, secretValue, validForMs, advanceExtraMs) => {
          const { assistant, acquirer, clock } = makeHarness();
          // clientCredentials always has an implicit refresh mechanism;
          // oauth2/pkce require a stored refresh token.
          const withRefresh = scheme !== 'clientCredentials';
          await assistant.registerCredential({
            targetApiRef: target,
            scheme,
            secret: oauthSecret(scheme, secretValue, withRefresh),
          });

          const firstToken = `A-${secretValue}`;
          const secondToken = `B-${secretValue}`;

          // First acquisition yields a token that expires after validForMs.
          acquirer.onAcquire(() =>
            Promise.resolve({
              accessToken: firstToken,
              expiresAt: new Date(clock.value.getTime() + validForMs),
            })
          );
          // The refresh mechanism yields a new token. clientCredentials
          // re-acquires via acquire(); oauth2/pkce use refresh().
          const nextTokenResult = {
            accessToken: secondToken,
            expiresAt: new Date(clock.value.getTime() + validForMs + 1_000_000),
          };
          if (scheme === 'clientCredentials') {
            acquirer.onAcquire(() => Promise.resolve(nextTokenResult));
          } else {
            acquirer.onRefresh(() => Promise.resolve(nextTokenResult));
          }

          const first = await assistant.ensureToken({ targetApiRef: target });
          expect(first.headers.Authorization).toBe(`Bearer ${firstToken}`);

          // Advance the clock strictly past the token's expiry.
          clock.value = new Date(clock.value.getTime() + validForMs + advanceExtraMs);

          const refreshed = await assistant.ensureToken({ targetApiRef: target });
          // A new token was obtained automatically before this request.
          expect(refreshed.headers.Authorization).toBe(`Bearer ${secondToken}`);
          expect(refreshed.headers.Authorization).not.toBe(first.headers.Authorization);
        }
      )
    );
  });
});

// ===========================================================================
// Property 26: Credentials are never exposed in plaintext
// ===========================================================================

/** The failure paths that must all yield a redacted, identifying AuthError. */
type FailureKind = 'timeout' | 'no_refresh' | 'refresh_failed' | 'invalid_credentials';

describe('Property 26: Credentials are never exposed in plaintext', () => {
  // Feature: api-copilot-ai, Property 26: For any stored target-API credential,
  // its value does not appear in plaintext in any storage artifact. (Req 6.8)
  // Validates: Requirements 6.8
  it('never persists a credential value in plaintext in any storage artifact', async () => {
    await fc.assert(
      fc.asyncProperty(targetArb, allSchemeArb, secretArb, async (target, scheme, secretValue) => {
        const { assistant, repo } = makeHarness();
        const stored = await assistant.registerCredential({
          targetApiRef: target,
          scheme,
          secret: anySchemeSecret(scheme, secretValue),
        });

        // Neither the returned record nor the persisted record exposes the value.
        expect(JSON.stringify(stored)).not.toContain(secretValue);
        const persisted = await repo.findByTarget(target);
        expect(persisted).not.toBeNull();
        expect(JSON.stringify(persisted)).not.toContain(secretValue);
      })
    );
  });

  // Feature: api-copilot-ai, Property 26: Every authentication failure
  // (acquisition timeout, missing refresh, refresh failure, invalid
  // credentials) yields an error that identifies the target API, the scheme,
  // and the reason while containing no credential value.
  // Validates: Requirements 6.3, 6.6, 6.7, 6.9
  it('surfaces redacted errors that identify target/scheme/reason without leaking the credential value', async () => {
    // Pick a scheme valid for the chosen failure kind (no_refresh excludes
    // clientCredentials, which always has a refresh mechanism).
    const scenarioArb = fc
      .constantFrom<FailureKind>('timeout', 'no_refresh', 'refresh_failed', 'invalid_credentials')
      .chain((kind) => {
        const schemeArb =
          kind === 'no_refresh'
            ? fc.constantFrom<AuthScheme>('oauth2', 'pkce')
            : tokenSchemeArb;
        return fc.record({
          kind: fc.constant(kind),
          scheme: schemeArb,
          target: targetArb,
          secretValue: secretArb,
          validForMs: fc.integer({ min: 1_000, max: 30_000 }),
        });
      });

    await fc.assert(
      fc.asyncProperty(scenarioArb, async ({ kind, scheme, target, secretValue, validForMs }) => {
        const { assistant, acquirer, repo, clock } = makeHarness();
        const needsRefreshToken = kind === 'refresh_failed';
        await assistant.registerCredential({
          targetApiRef: target,
          scheme,
          secret: oauthSecret(scheme, secretValue, needsRefreshToken),
        });

        let expectedCtor:
          | typeof AuthTimeoutError
          | typeof NoRefreshMechanismError
          | typeof RefreshFailedError
          | typeof InvalidCredentialsError;
        let expectedReason: AuthErrorReason;

        switch (kind) {
          case 'timeout': {
            // Acquisition hangs past the injected hard cap.
            acquirer.onAcquire(() => new Promise<never>(() => {}));
            expectedCtor = AuthTimeoutError;
            expectedReason = 'timeout';
            break;
          }
          case 'invalid_credentials': {
            // Acquirer rejects, echoing the secret in its raw error message.
            acquirer.onAcquire(() =>
              Promise.reject(new Error(`upstream rejected credentials: ${secretValue}`))
            );
            expectedCtor = InvalidCredentialsError;
            expectedReason = 'invalid_credentials';
            break;
          }
          case 'no_refresh': {
            // Acquire a short-lived token, then let it expire with no refresh.
            acquirer.onAcquire(() =>
              Promise.resolve({
                accessToken: `tok-${secretValue}`,
                expiresAt: new Date(clock.value.getTime() + validForMs),
              })
            );
            await assistant.ensureToken({ targetApiRef: target });
            clock.value = new Date(clock.value.getTime() + validForMs + 1_000);
            expectedCtor = NoRefreshMechanismError;
            expectedReason = 'no_refresh_mechanism';
            break;
          }
          case 'refresh_failed':
          default: {
            acquirer.onAcquire(() =>
              Promise.resolve({
                accessToken: `tok-${secretValue}`,
                expiresAt: new Date(clock.value.getTime() + validForMs),
              })
            );
            // The refresh mechanism rejects, echoing the secret.
            acquirer.onRefresh(() =>
              Promise.reject(new Error(`refresh endpoint said: ${secretValue}`))
            );
            await assistant.ensureToken({ targetApiRef: target });
            clock.value = new Date(clock.value.getTime() + validForMs + 1_000);
            expectedCtor = RefreshFailedError;
            expectedReason = 'refresh_failed';
            break;
          }
        }

        const error = (await assistant
          .ensureToken({ targetApiRef: target })
          .then(() => {
            throw new Error('expected ensureToken to reject');
          })
          .catch((e: unknown) => e)) as AuthError;

        // The error is the redacted AuthError for this failure path.
        expect(error).toBeInstanceOf(AuthError);
        expect(error).toBeInstanceOf(expectedCtor);

        // It identifies the target, the scheme, and the reason.
        expect(error.targetApiRef).toBe(target);
        expect(error.scheme).toBe(scheme);
        expect(error.reason).toBe(expectedReason);

        // No credential value leaks through message, fields, or serialized form.
        expect(error.message).not.toContain(secretValue);
        expect(JSON.stringify(error.toJSON())).not.toContain(secretValue);
        expect(JSON.stringify(error)).not.toContain(secretValue);

        // Stored credentials remain redacted after the failure (Req 6.7/6.8).
        const persisted = await repo.findByTarget(target);
        expect(JSON.stringify(persisted)).not.toContain(secretValue);
      })
    );
  });
});
