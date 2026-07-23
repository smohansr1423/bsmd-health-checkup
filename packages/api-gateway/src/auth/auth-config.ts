/**
 * Auth configuration resolution — secret + operating mode.
 *
 * Closes the two production holes that previously existed in the gateway boot:
 *   1. `JWT_SECRET` silently falling back to a hardcoded default (forgeable).
 *   2. "dev mode" accepting ANY non-empty token as Administrator whenever
 *      NODE_ENV was not exactly "production".
 *
 * Validates: Requirements 18.1, 18.2
 */

import crypto from 'crypto';

export interface ResolvedAuthConfig {
  /** The HMAC secret used to sign/verify tokens. */
  secret: string;
  /** True when running with NODE_ENV=production. */
  isProduction: boolean;
  /**
   * Explicit, opt-in developer bypass that accepts any non-empty token. Only
   * ever true OUTSIDE production AND when AUTH_DEV_BYPASS=true is set. Never
   * enabled implicitly.
   */
  devBypass: boolean;
  /** True when the secret was randomly generated for this process (dev only). */
  ephemeralSecret: boolean;
}

export interface AuthConfigError extends Error {
  code: 'JWT_SECRET_REQUIRED';
}

/** Minimal env shape (injectable for tests). */
export type EnvLike = Record<string, string | undefined>;

/**
 * Resolve the auth secret and mode from the environment.
 *
 * - Production + no `JWT_SECRET` → throws (fail fast; never boots insecure).
 * - Production + short `JWT_SECRET` (< 16 chars) → throws (weak secret).
 * - Non-production + no `JWT_SECRET` → generates an ephemeral random secret and
 *   warns; tokens simply won't survive a restart, which is fine for local dev.
 */
export function resolveAuthConfig(
  env: EnvLike,
  logger: Pick<Console, 'warn'> = console
): ResolvedAuthConfig {
  const isProduction = env.NODE_ENV === 'production';
  const rawSecret = (env.JWT_SECRET ?? '').trim();

  const devBypass = !isProduction && env.AUTH_DEV_BYPASS === 'true';

  if (rawSecret) {
    if (isProduction && rawSecret.length < 16) {
      throw makeSecretError(
        'JWT_SECRET is too short for production (need at least 16 characters).'
      );
    }
    return { secret: rawSecret, isProduction, devBypass, ephemeralSecret: false };
  }

  // No secret provided.
  if (isProduction) {
    throw makeSecretError(
      'JWT_SECRET must be set in production. Refusing to start with an insecure default.'
    );
  }

  const ephemeral = crypto.randomBytes(32).toString('base64url');
  logger.warn(
    '[API Gateway] JWT_SECRET is not set — generated an ephemeral dev secret. ' +
      'Tokens will be invalidated on restart. Set JWT_SECRET for stable local tokens.'
  );
  if (devBypass) {
    logger.warn(
      '[API Gateway] AUTH_DEV_BYPASS=true — any non-empty bearer token is accepted ' +
        'as Administrator. NEVER enable this outside local development.'
    );
  }
  return { secret: ephemeral, isProduction, devBypass, ephemeralSecret: true };
}

function makeSecretError(message: string): AuthConfigError {
  const err = new Error(`[API Gateway] ${message}`) as AuthConfigError;
  err.code = 'JWT_SECRET_REQUIRED';
  return err;
}
