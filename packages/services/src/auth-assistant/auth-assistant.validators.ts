/**
 * Auth Assistant — Validators & Scheme Helpers
 *
 * Pure helpers for scheme support checks and scheme classification. None of
 * these functions accept or return credential values.
 *
 * Validates: Requirements 6.1, 6.4, 6.5
 */

import type { AuthScheme } from '../api-copilot-shared';
import type { CredentialSecret } from './auth-assistant.types';

/** The authentication schemes supported by the Auth Assistant (Req 6.1). */
export const SUPPORTED_SCHEMES: readonly AuthScheme[] = [
  'oauth2',
  'jwt',
  'apiKey',
  'bearer',
  'basic',
  'clientCredentials',
  'pkce',
] as const;

/** Schemes whose material is derived directly from the stored credential and
 *  requires no network token acquisition. */
const STATIC_SCHEMES: readonly AuthScheme[] = ['apiKey', 'bearer', 'basic', 'jwt'] as const;

/** Schemes that obtain a token from a token endpoint. */
const TOKEN_SCHEMES: readonly AuthScheme[] = ['oauth2', 'clientCredentials', 'pkce'] as const;

export function isSupportedScheme(scheme: AuthScheme): boolean {
  return SUPPORTED_SCHEMES.includes(scheme);
}

export function isStaticScheme(scheme: AuthScheme): boolean {
  return STATIC_SCHEMES.includes(scheme);
}

export function isTokenScheme(scheme: AuthScheme): boolean {
  return TOKEN_SCHEMES.includes(scheme);
}

/**
 * Whether a configured refresh mechanism exists for the given credential
 * (Req 6.5, 6.6):
 *  - `clientCredentials` can always re-acquire via its client credentials.
 *  - `oauth2` / `pkce` require a stored refresh token.
 */
export function hasRefreshMechanism(scheme: AuthScheme, secret: CredentialSecret): boolean {
  if (scheme === 'clientCredentials') {
    return true;
  }
  if (scheme === 'oauth2' || scheme === 'pkce') {
    return typeof secret.oauth?.refreshToken === 'string' && secret.oauth.refreshToken.length > 0;
  }
  return false;
}
