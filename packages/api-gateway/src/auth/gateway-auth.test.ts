/**
 * Tests for the gateway auth composition: real AuthService wired to the JWT
 * format + scrypt verification, seeded admin, and the dev-bypass behavior.
 */

import { createGatewayAuth } from './gateway-auth';

const silentLogger = { warn: () => undefined };

const SEED_ENV = {
  NODE_ENV: 'production',
  JWT_SECRET: 'a-sufficiently-long-secret',
  SEED_ADMIN_USERNAME: 'admin@example.com',
  SEED_ADMIN_PASSWORD: 'super-secret-pw',
};

describe('createGatewayAuth', () => {
  it('lets a seeded admin log in and validates the issued token', async () => {
    const { authService, validateToken } = createGatewayAuth(SEED_ENV, silentLogger);

    const authToken = await authService.authenticate({
      username: 'admin@example.com',
      password: 'super-secret-pw',
    });
    expect(authToken.role).toBe('Administrator');

    const validated = validateToken(authToken.token);
    expect(validated).not.toBeNull();
    expect(validated!.userId).toBe(authToken.userId);
    expect(validated!.role).toBe('Administrator');
  });

  it('rejects an invalid/garbage token in production', () => {
    const { validateToken } = createGatewayAuth(SEED_ENV, silentLogger);
    expect(validateToken('garbage-token')).toBeNull();
    expect(validateToken('')).toBeNull();
  });

  it('rejects login with a wrong password', async () => {
    const { authService } = createGatewayAuth(SEED_ENV, silentLogger);
    await expect(
      authService.authenticate({ username: 'admin@example.com', password: 'nope' })
    ).rejects.toThrow();
  });

  it('does NOT accept arbitrary tokens by default outside production', () => {
    const { validateToken } = createGatewayAuth({ NODE_ENV: 'development' }, silentLogger);
    expect(validateToken('any-token')).toBeNull();
  });

  it('accepts any token as Administrator only with the explicit dev bypass', () => {
    const { validateToken, refreshSession } = createGatewayAuth(
      { NODE_ENV: 'development', AUTH_DEV_BYPASS: 'true' },
      silentLogger
    );
    const result = validateToken('any-token');
    expect(result).not.toBeNull();
    expect(result!.role).toBe('Administrator');
    expect(refreshSession('dev-session')).toBe(true);
  });
});
