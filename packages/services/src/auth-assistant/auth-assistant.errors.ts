/**
 * Auth Assistant — Errors
 *
 * Every authentication error identifies the target API, the authentication
 * scheme, and the reason for failure, and NEVER exposes any stored credential
 * value in its message, its structured details, or its serialized form
 * (Req 6.3, 6.6, 6.7, 6.9). Error objects are constructed exclusively from
 * non-secret identifiers (target ref, scheme) plus a fixed human-readable
 * reason string; no credential-derived value is ever passed in.
 *
 * Validates: Requirements 6.3, 6.6, 6.7, 6.9
 */

import type { AuthScheme } from '../api-copilot-shared';

/** Machine-readable reason codes for an authentication failure. */
export type AuthErrorReason =
  | 'timeout'
  | 'no_refresh_mechanism'
  | 'refresh_failed'
  | 'invalid_credentials'
  | 'unsupported_scheme';

/** Shape of the redacted, serializable representation of an AuthError. */
export interface AuthErrorDetails {
  name: string;
  targetApiRef: string;
  scheme: AuthScheme;
  reason: AuthErrorReason;
  message: string;
}

/**
 * Base authentication error. Its message is composed only from the target ref,
 * the scheme, and a fixed reason phrase — guaranteeing no credential value can
 * leak through the message or through JSON serialization.
 */
export class AuthError extends Error {
  public readonly targetApiRef: string;
  public readonly scheme: AuthScheme;
  public readonly reason: AuthErrorReason;

  constructor(
    targetApiRef: string,
    scheme: AuthScheme,
    reason: AuthErrorReason,
    reasonPhrase: string
  ) {
    super(
      `Authentication failed for target API "${targetApiRef}" using the ${scheme} scheme: ${reasonPhrase}.`
    );
    this.name = 'AuthError';
    this.targetApiRef = targetApiRef;
    this.scheme = scheme;
    this.reason = reason;
  }

  /**
   * Redacted, serializable view. Only non-secret identifiers plus the reason
   * are exposed — never credential values (Req 6.8, 6.9).
   */
  toJSON(): AuthErrorDetails {
    return {
      name: this.name,
      targetApiRef: this.targetApiRef,
      scheme: this.scheme,
      reason: this.reason,
      message: this.message,
    };
  }
}

/** Req 6.3: token acquisition exceeded the allowed time. */
export class AuthTimeoutError extends AuthError {
  constructor(targetApiRef: string, scheme: AuthScheme) {
    super(
      targetApiRef,
      scheme,
      'timeout',
      'token acquisition did not complete within the allowed time'
    );
    this.name = 'AuthTimeoutError';
  }
}

/** Req 6.6: token expired and no refresh mechanism is configured. */
export class NoRefreshMechanismError extends AuthError {
  constructor(targetApiRef: string, scheme: AuthScheme) {
    super(
      targetApiRef,
      scheme,
      'no_refresh_mechanism',
      'the access token has expired and no refresh mechanism is configured'
    );
    this.name = 'NoRefreshMechanismError';
  }
}

/** Req 6.7: token refresh was rejected or timed out. */
export class RefreshFailedError extends AuthError {
  constructor(targetApiRef: string, scheme: AuthScheme) {
    super(
      targetApiRef,
      scheme,
      'refresh_failed',
      'the token refresh attempt was rejected or did not complete in time'
    );
    this.name = 'RefreshFailedError';
  }
}

/** Req 6.9: credentials were invalid or the authorization request was rejected. */
export class InvalidCredentialsError extends AuthError {
  constructor(targetApiRef: string, scheme: AuthScheme) {
    super(
      targetApiRef,
      scheme,
      'invalid_credentials',
      'the credentials were invalid or the authorization request was rejected by the target API'
    );
    this.name = 'InvalidCredentialsError';
  }
}

/** Req 6.1: the requested authentication scheme is not supported. */
export class UnsupportedSchemeError extends AuthError {
  constructor(targetApiRef: string, scheme: AuthScheme) {
    super(
      targetApiRef,
      scheme,
      'unsupported_scheme',
      'the authentication scheme is not supported'
    );
    this.name = 'UnsupportedSchemeError';
  }
}

/**
 * Raised when no credential is configured for a target API. This is a
 * configuration precondition distinct from the authentication failures above
 * (which all presume a stored credential exists). Carries no secret material.
 */
export class CredentialNotFoundError extends Error {
  public readonly targetApiRef: string;

  constructor(targetApiRef: string) {
    super(`No credential is configured for target API "${targetApiRef}".`);
    this.name = 'CredentialNotFoundError';
    this.targetApiRef = targetApiRef;
  }
}
