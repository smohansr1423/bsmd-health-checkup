/**
 * Auth Assistant — Service
 *
 * Manages target-API credentials and tokens. Responsibilities:
 *  - `supportedSchemes()` reports the schemes handled (Req 6.1).
 *  - `registerCredential()` stores credentials encrypted at rest (Req 6.8).
 *  - `ensureToken()` obtains auth material before a request is sent (Req 6.2),
 *    reusing valid tokens (Req 6.4), auto-refreshing expired tokens when a
 *    refresh mechanism exists (Req 6.5), and capping every acquisition/refresh
 *    at a hard timeout (Req 6.3, 6.7). All failures surface a redacted
 *    `AuthError` (Req 6.3, 6.6, 6.7, 6.9).
 *
 * The Auth Assistant is the sole holder of the `CryptoProvider` and the only
 * component that decrypts stored credentials; no plaintext credential value
 * leaves this class (Req 6.8).
 *
 * Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9
 */

import type {
  AuthScheme,
  AuthMaterial,
  CryptoProvider,
  CredentialRepository,
  IdGenerator,
  DateProvider,
  StoredCredential,
} from '../api-copilot-shared';
import {
  InMemoryCredentialRepository,
  InMemoryCryptoProvider,
  defaultIdGenerator,
  defaultDateProvider,
} from '../api-copilot-shared';
import type {
  AuthAssistantDependencies,
  CredentialSecret,
  RegisterCredentialInput,
  TargetApiRef,
  TokenAcquisition,
  TokenAcquisitionRequest,
  TokenRefreshRequest,
  TokenResult,
} from './auth-assistant.types';
import {
  AuthTimeoutError,
  CredentialNotFoundError,
  InvalidCredentialsError,
  NoRefreshMechanismError,
  RefreshFailedError,
  UnsupportedSchemeError,
} from './auth-assistant.errors';
import {
  SUPPORTED_SCHEMES,
  hasRefreshMechanism,
  isStaticScheme,
  isSupportedScheme,
} from './auth-assistant.validators';

/** Hard cap for a single token acquisition/refresh attempt (Req 6.3, 6.7). */
const DEFAULT_ACQUISITION_TIMEOUT_MS = 30_000;

/** Internal sentinel used to distinguish a timeout from an acquirer rejection. */
class TimeoutSignal extends Error {
  constructor() {
    super('timeout');
    this.name = 'TimeoutSignal';
  }
}

/**
 * Default token acquisition port. It performs no network I/O and rejects all
 * requests, so that token-based schemes fail closed until a real acquisition
 * adapter (or a test fake) is injected. Never returns credential material.
 */
export class UnconfiguredTokenAcquisition implements TokenAcquisition {
  async acquire(): Promise<TokenResult> {
    throw new Error('No token acquisition adapter configured');
  }

  async refresh(): Promise<TokenResult> {
    throw new Error('No token acquisition adapter configured');
  }
}

/**
 * Programmable fake token acquisition for development and tests. Responses (or
 * thrown errors / hangs) are registered per target scheme so acquisition,
 * refresh, timeout, and rejection paths can be exercised without network I/O.
 */
export class FakeTokenAcquisition implements TokenAcquisition {
  private acquireResponses: Array<TokenResult | (() => Promise<TokenResult>)> = [];
  private refreshResponses: Array<TokenResult | (() => Promise<TokenResult>)> = [];

  /** Queue a response (or async factory) for the next acquire() call. */
  onAcquire(response: TokenResult | (() => Promise<TokenResult>)): this {
    this.acquireResponses.push(response);
    return this;
  }

  /** Queue a response (or async factory) for the next refresh() call. */
  onRefresh(response: TokenResult | (() => Promise<TokenResult>)): this {
    this.refreshResponses.push(response);
    return this;
  }

  async acquire(_request: TokenAcquisitionRequest): Promise<TokenResult> {
    return this.next(this.acquireResponses, 'acquire');
  }

  async refresh(_request: TokenRefreshRequest): Promise<TokenResult> {
    return this.next(this.refreshResponses, 'refresh');
  }

  private next(
    queue: Array<TokenResult | (() => Promise<TokenResult>)>,
    label: string
  ): Promise<TokenResult> {
    const entry = queue.shift();
    if (entry === undefined) {
      return Promise.reject(new Error(`No ${label} response queued`));
    }
    return typeof entry === 'function' ? entry() : Promise.resolve(entry);
  }
}

export class AuthAssistant {
  private readonly idGenerator: IdGenerator;
  private readonly dateProvider: DateProvider;
  private readonly repository: CredentialRepository;
  private readonly crypto: CryptoProvider;
  private readonly tokenAcquisition: TokenAcquisition;
  private readonly acquisitionTimeoutMs: number;

  /** In-memory token cache keyed by targetApiRef; drives reuse (Req 6.4). */
  private readonly tokenCache: Map<string, AuthMaterial> = new Map();

  constructor(deps: Partial<AuthAssistantDependencies> = {}) {
    this.idGenerator = deps.idGenerator ?? defaultIdGenerator;
    this.dateProvider = deps.dateProvider ?? defaultDateProvider;
    this.repository = deps.repository ?? new InMemoryCredentialRepository();
    this.crypto = deps.cryptoProvider ?? new InMemoryCryptoProvider();
    this.tokenAcquisition = deps.tokenAcquisition ?? new UnconfiguredTokenAcquisition();
    this.acquisitionTimeoutMs = deps.acquisitionTimeoutMs ?? DEFAULT_ACQUISITION_TIMEOUT_MS;
  }

  /** Req 6.1: the authentication schemes supported for target APIs. */
  supportedSchemes(): AuthScheme[] {
    return [...SUPPORTED_SCHEMES];
  }

  /**
   * Store a target-API credential encrypted at rest (Req 6.8). The plaintext
   * secret is serialized, encrypted, and only the resulting ciphertext is
   * persisted; the plaintext never leaves this method.
   */
  async registerCredential(input: RegisterCredentialInput): Promise<StoredCredential> {
    if (!isSupportedScheme(input.scheme)) {
      throw new UnsupportedSchemeError(input.targetApiRef, input.scheme);
    }
    const plaintext = Buffer.from(JSON.stringify(input.secret), 'utf8');
    const ciphertext = await this.crypto.encrypt(plaintext);
    const stored: StoredCredential = {
      credentialId: this.idGenerator(),
      targetApiRef: input.targetApiRef,
      scheme: input.scheme,
      ciphertext,
    };
    // Invalidate any cached token for this target so the new credential is used.
    this.tokenCache.delete(input.targetApiRef);
    return this.repository.save(stored);
  }

  /**
   * Ensure valid authentication material exists for the target API before a
   * request is sent (Req 6.2). Reuses a still-valid cached token (Req 6.4);
   * otherwise acquires or refreshes as appropriate.
   */
  async ensureToken(target: TargetApiRef): Promise<AuthMaterial> {
    const stored = await this.repository.findByTarget(target.targetApiRef);
    if (stored === null) {
      throw new CredentialNotFoundError(target.targetApiRef);
    }

    const scheme = stored.scheme;
    if (!isSupportedScheme(scheme)) {
      throw new UnsupportedSchemeError(target.targetApiRef, scheme);
    }

    // Req 6.4: reuse a still-valid token without re-acquiring.
    const cached = this.tokenCache.get(target.targetApiRef);
    const cachedIsValid = cached !== undefined && this.isValid(cached);
    if (cachedIsValid) {
      return cached as AuthMaterial;
    }

    // Decryption happens only here, inside the Auth Assistant (Req 6.8).
    const secret = await this.decryptSecret(stored);

    if (isStaticScheme(scheme)) {
      return this.resolveStaticMaterial(target, scheme, secret);
    }

    // Token-based scheme (oauth2 / clientCredentials / pkce).
    if (cached !== undefined) {
      // A previously acquired token has expired.
      if (hasRefreshMechanism(scheme, secret)) {
        return this.refreshToken(target, scheme, secret); // Req 6.5
      }
      throw new NoRefreshMechanismError(target.targetApiRef, scheme); // Req 6.6
    }

    // First acquisition for this target (Req 6.2).
    return this.acquireToken(target, scheme, secret);
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  private isValid(material: AuthMaterial): boolean {
    if (material.expiresAt === undefined) {
      return true;
    }
    return material.expiresAt.getTime() > this.dateProvider().getTime();
  }

  /** Decrypt and parse a stored credential. Never exposes the plaintext. */
  private async decryptSecret(stored: StoredCredential): Promise<CredentialSecret> {
    const plaintext = await this.crypto.decrypt(stored.ciphertext);
    return JSON.parse(plaintext.toString('utf8')) as CredentialSecret;
  }

  /** Build material for static schemes (apiKey, bearer, basic, jwt). */
  private resolveStaticMaterial(
    target: TargetApiRef,
    scheme: AuthScheme,
    secret: CredentialSecret
  ): AuthMaterial {
    let material: AuthMaterial;

    switch (scheme) {
      case 'apiKey': {
        const apiKey = secret.apiKey;
        if (apiKey === undefined) {
          throw new InvalidCredentialsError(target.targetApiRef, scheme);
        }
        material = { headers: { [apiKey.headerName]: apiKey.value } };
        break;
      }
      case 'bearer': {
        if (secret.bearerToken === undefined) {
          throw new InvalidCredentialsError(target.targetApiRef, scheme);
        }
        material = { headers: { Authorization: `Bearer ${secret.bearerToken}` } };
        break;
      }
      case 'basic': {
        const basic = secret.basic;
        if (basic === undefined) {
          throw new InvalidCredentialsError(target.targetApiRef, scheme);
        }
        const encoded = Buffer.from(`${basic.username}:${basic.password}`, 'utf8').toString(
          'base64'
        );
        material = { headers: { Authorization: `Basic ${encoded}` } };
        break;
      }
      case 'jwt': {
        const jwt = secret.jwt;
        if (jwt === undefined) {
          throw new InvalidCredentialsError(target.targetApiRef, scheme);
        }
        material = {
          headers: { Authorization: `Bearer ${jwt.token}` },
          expiresAt: jwt.expiresAt !== undefined ? new Date(jwt.expiresAt) : undefined,
        };
        break;
      }
      default:
        throw new UnsupportedSchemeError(target.targetApiRef, scheme);
    }

    // A static token that is already expired cannot be refreshed (Req 6.6).
    if (!this.isValid(material)) {
      throw new NoRefreshMechanismError(target.targetApiRef, scheme);
    }

    this.tokenCache.set(target.targetApiRef, material);
    return material;
  }

  /** Acquire a fresh token for a token-based scheme (Req 6.2, 6.3, 6.9). */
  private async acquireToken(
    target: TargetApiRef,
    scheme: AuthScheme,
    secret: CredentialSecret
  ): Promise<AuthMaterial> {
    const oauth = secret.oauth;
    if (oauth === undefined) {
      throw new InvalidCredentialsError(target.targetApiRef, scheme);
    }

    const request: TokenAcquisitionRequest = {
      scheme,
      tokenEndpoint: oauth.tokenEndpoint,
      clientId: oauth.clientId,
      clientSecret: oauth.clientSecret,
      scopes: oauth.scopes,
      codeVerifier: oauth.codeVerifier,
    };

    let result: TokenResult;
    try {
      result = await this.withTimeout(this.tokenAcquisition.acquire(request));
    } catch (err) {
      if (err instanceof TimeoutSignal) {
        throw new AuthTimeoutError(target.targetApiRef, scheme); // Req 6.3
      }
      throw new InvalidCredentialsError(target.targetApiRef, scheme); // Req 6.9
    }

    return this.cacheTokenResult(target, result);
  }

  /** Refresh an expired token (Req 6.5, 6.7). On failure, stored credentials
   *  are left unchanged (we never mutate the repository here). */
  private async refreshToken(
    target: TargetApiRef,
    scheme: AuthScheme,
    secret: CredentialSecret
  ): Promise<AuthMaterial> {
    const oauth = secret.oauth;
    if (oauth === undefined) {
      throw new InvalidCredentialsError(target.targetApiRef, scheme);
    }

    let result: TokenResult;
    try {
      if (scheme === 'clientCredentials') {
        // Re-acquisition via client credentials is the refresh mechanism.
        const request: TokenAcquisitionRequest = {
          scheme,
          tokenEndpoint: oauth.tokenEndpoint,
          clientId: oauth.clientId,
          clientSecret: oauth.clientSecret,
          scopes: oauth.scopes,
        };
        result = await this.withTimeout(this.tokenAcquisition.acquire(request));
      } else {
        const request: TokenRefreshRequest = {
          scheme,
          tokenEndpoint: oauth.tokenEndpoint,
          refreshToken: oauth.refreshToken as string,
          clientId: oauth.clientId,
          clientSecret: oauth.clientSecret,
        };
        result = await this.withTimeout(this.tokenAcquisition.refresh(request));
      }
    } catch {
      // Both timeout and rejection are refresh failures (Req 6.7).
      throw new RefreshFailedError(target.targetApiRef, scheme);
    }

    return this.cacheTokenResult(target, result);
  }

  /** Build and cache auth material from an acquired/refreshed token. */
  private cacheTokenResult(target: TargetApiRef, result: TokenResult): AuthMaterial {
    const tokenType = result.tokenType ?? 'Bearer';
    const material: AuthMaterial = {
      headers: { Authorization: `${tokenType} ${result.accessToken}` },
      expiresAt: result.expiresAt,
    };
    this.tokenCache.set(target.targetApiRef, material);
    return material;
  }

  /**
   * Race an acquisition/refresh operation against the hard timeout. Rejects
   * with a `TimeoutSignal` when the cap is exceeded (Req 6.3, 6.7).
   */
  private withTimeout<T>(operation: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new TimeoutSignal()), this.acquisitionTimeoutMs);
    });
    return Promise.race([operation, timeout]).finally(() => {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    });
  }
}
