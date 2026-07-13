/**
 * Gateway auth composition — wires the real AuthService to the gateway's JWT
 * format and scrypt password verification, and exposes the
 * `validateToken`/`refreshSession` pair consumed by the auth middleware.
 *
 * Replaces the previous inline validator in index.ts that (a) fell back to a
 * hardcoded secret and (b) accepted any token as Administrator outside prod.
 *
 * Validates: Requirements 18.1, 18.2, 18.5
 */

import {
  AuthService,
  DEFAULT_AUTH_CONFIG,
  type AuthToken,
  type Role,
  type UserAccount,
} from '@health-checkup/services';
import { signToken, verifyToken } from './jwt';
import { hashPassword, verifyPassword } from './password';
import { resolveAuthConfig, type EnvLike, type ResolvedAuthConfig } from './auth-config';

const VALID_ROLES: readonly Role[] = [
  'Administrator',
  'Physician',
  'Lab_Technician',
  'Senior_Citizen',
  'Caregiver',
];

export interface GatewayAuth {
  authService: AuthService;
  validateToken: (token: string) => AuthToken | null;
  refreshSession: (sessionId: string) => boolean;
  config: ResolvedAuthConfig;
}

/**
 * Build the gateway auth stack from the environment.
 *
 * Seeds an initial Administrator account when `SEED_ADMIN_USERNAME` and
 * `SEED_ADMIN_PASSWORD` are provided, so there is a bootstrap login path. In a
 * real deployment, user accounts come from the database instead.
 */
export function createGatewayAuth(
  env: EnvLike,
  logger: Pick<Console, 'warn'> = console
): GatewayAuth {
  const config = resolveAuthConfig(env, logger);
  const tokenExpiryMs = DEFAULT_AUTH_CONFIG.tokenExpiryMs;

  const authService = new AuthService({
    // Issue real HS256 JWTs signed with the resolved secret.
    tokenGenerator: (userId, role, sessionId) =>
      signToken({ sub: userId, role, sid: sessionId }, config.secret, tokenExpiryMs).token,

    // Verify the signature + expiry, then map claims → AuthToken. Session-level
    // checks (active session, inactivity timeout) are layered on by AuthService.
    tokenValidator: (tokenString): AuthToken | null => {
      const claims = verifyToken(tokenString, config.secret);
      if (!claims) {
        return null;
      }
      if (!VALID_ROLES.includes(claims.role as Role)) {
        return null;
      }
      return {
        token: tokenString,
        userId: claims.sub,
        role: claims.role as Role,
        sessionId: claims.sid,
        issuedAt: new Date(claims.iat * 1000),
        expiresAt: new Date(claims.exp * 1000),
      };
    },

    // Secure password verification (scrypt) instead of plaintext comparison.
    passwordVerifier: (password, hash) => verifyPassword(password, hash),
  });

  seedAdminUser(authService, env, logger);

  const validateToken = buildValidateToken(authService, config);
  const refreshSession = (sessionId: string): boolean =>
    config.devBypass ? true : authService.refreshSession(sessionId);

  return { authService, validateToken, refreshSession, config };
}

/**
 * The token validator handed to the auth middleware. In the normal path it
 * delegates to AuthService.validateToken. The explicit dev bypass (opt-in,
 * non-production only) short-circuits to a mock Administrator context.
 */
function buildValidateToken(
  authService: AuthService,
  config: ResolvedAuthConfig
): (token: string) => AuthToken | null {
  return (token: string): AuthToken | null => {
    if (!token) {
      return null;
    }
    if (config.devBypass) {
      const now = new Date();
      return {
        token,
        userId: 'dev-user',
        role: 'Administrator',
        sessionId: 'dev-session',
        issuedAt: now,
        expiresAt: new Date(now.getTime() + DEFAULT_AUTH_CONFIG.tokenExpiryMs),
      };
    }
    return authService.validateToken(token);
  };
}

function seedAdminUser(
  authService: AuthService,
  env: EnvLike,
  logger: Pick<Console, 'warn'>
): void {
  const username = env.SEED_ADMIN_USERNAME?.trim();
  const password = env.SEED_ADMIN_PASSWORD;
  if (!username || !password) {
    return;
  }

  const account: UserAccount = {
    userId: env.SEED_ADMIN_USER_ID?.trim() || `admin-${username}`,
    username,
    passwordHash: hashPassword(password),
    role: 'Administrator',
    isLocked: false,
    lockExpiresAt: null,
    consecutiveFailures: 0,
    lastFailedAt: null,
  };
  authService.registerUser(account);
  logger.warn(`[API Gateway] Seeded Administrator account "${username}" from environment.`);
}
