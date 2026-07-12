/**
 * Auth Assistant — Types
 *
 * The Auth Assistant manages target-API credentials and tokens for the
 * API Copilot AI product. It is the *only* component able to decrypt stored
 * credentials; every other component and every serialized artifact sees only
 * ciphertext or redacted references (Req 6.8).
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
} from '../api-copilot-shared';

// ---------------------------------------------------------------------------
// Target reference
// ---------------------------------------------------------------------------

/**
 * A reference to the target API whose credentials/tokens are being managed.
 * `targetApiRef` matches `StoredCredential.targetApiRef`.
 */
export interface TargetApiRef {
  targetApiRef: string;
}

// ---------------------------------------------------------------------------
// Decrypted credential material
// ---------------------------------------------------------------------------

/** API-key credential: a value applied under a named header. */
export interface ApiKeySecret {
  headerName: string;
  value: string;
}

/** HTTP Basic credential. */
export interface BasicSecret {
  username: string;
  password: string;
}

/** A pre-issued JWT, optionally carrying its own expiry. */
export interface JwtSecret {
  /** The signed token value. */
  token: string;
  /** ISO-8601 expiry, if the token carries one. */
  expiresAt?: string;
}

/**
 * OAuth2-family credential (oauth2, clientCredentials, pkce). The presence of a
 * `refreshToken` constitutes a configured refresh mechanism for `oauth2`/`pkce`
 * (Req 6.5, 6.6). `clientCredentials` can always re-acquire, so it is always
 * considered to have a refresh mechanism.
 */
export interface OAuthSecret {
  tokenEndpoint: string;
  clientId: string;
  clientSecret?: string;
  scopes?: string[];
  /** PKCE code verifier used to redeem an authorization code. */
  codeVerifier?: string;
  /** Presence indicates a configured refresh mechanism (Req 6.5). */
  refreshToken?: string;
}

/**
 * The decrypted, scheme-tagged secret persisted (encrypted) at rest. Only the
 * field matching `scheme` is expected to be populated.
 */
export interface CredentialSecret {
  scheme: AuthScheme;
  apiKey?: ApiKeySecret;
  bearerToken?: string;
  basic?: BasicSecret;
  jwt?: JwtSecret;
  oauth?: OAuthSecret;
}

// ---------------------------------------------------------------------------
// Token acquisition port
// ---------------------------------------------------------------------------

/** Request to acquire a fresh token from a target API's token endpoint. */
export interface TokenAcquisitionRequest {
  scheme: AuthScheme;
  tokenEndpoint: string;
  clientId?: string;
  clientSecret?: string;
  scopes?: string[];
  /** PKCE code verifier. */
  codeVerifier?: string;
}

/** Request to refresh an access token using a refresh token. */
export interface TokenRefreshRequest {
  scheme: AuthScheme;
  tokenEndpoint: string;
  refreshToken: string;
  clientId?: string;
  clientSecret?: string;
}

/** The result of acquiring or refreshing a token. */
export interface TokenResult {
  accessToken: string;
  /** Token type used to build the Authorization header; defaults to "Bearer". */
  tokenType?: string;
  /** When the acquired token expires; absent means it does not expire. */
  expiresAt?: Date;
  /** A refresh token returned by the target, if any. */
  refreshToken?: string;
}

/**
 * Port that performs the actual network exchange with a target API's token
 * endpoint. It is injected so the Auth Assistant's orchestration (reuse,
 * refresh, timeout, error redaction) stays unit- and property-testable without
 * real network I/O.
 */
export interface TokenAcquisition {
  acquire(request: TokenAcquisitionRequest): Promise<TokenResult>;
  refresh(request: TokenRefreshRequest): Promise<TokenResult>;
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/** Input to store a target-API credential, encrypted at rest (Req 6.8). */
export interface RegisterCredentialInput {
  targetApiRef: string;
  scheme: AuthScheme;
  secret: CredentialSecret;
}

// ---------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------

/**
 * Dependencies injected into the Auth Assistant. All side-effecting
 * collaborators are injected so the orchestration logic is testable with fakes.
 */
export interface AuthAssistantDependencies {
  idGenerator: IdGenerator;
  dateProvider: DateProvider;
  /** Encrypted credential storage. */
  repository: CredentialRepository;
  /** The sole crypto provider used to encrypt/decrypt credentials. */
  cryptoProvider: CryptoProvider;
  /** Performs token-endpoint exchanges. */
  tokenAcquisition: TokenAcquisition;
  /** Hard cap for a single acquisition/refresh attempt (Req 6.3, 6.7). */
  acquisitionTimeoutMs: number;
}

/** A cached token entry keyed by target API ref (drives reuse — Req 6.4). */
export interface CachedToken {
  material: AuthMaterial;
}

// Re-export commonly used shared type for consumers of this module.
export type { AuthMaterial } from '../api-copilot-shared';
