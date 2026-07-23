/**
 * Unit tests for auth configuration resolution (secret + mode hardening).
 */

import { resolveAuthConfig, type AuthConfigError } from './auth-config';

const silentLogger = { warn: () => undefined };

describe('resolveAuthConfig', () => {
  it('throws in production when JWT_SECRET is missing (fail fast)', () => {
    expect(() =>
      resolveAuthConfig({ NODE_ENV: 'production' }, silentLogger)
    ).toThrow(/JWT_SECRET must be set in production/);
  });

  it('throws in production when JWT_SECRET is too short', () => {
    let caught: AuthConfigError | undefined;
    try {
      resolveAuthConfig({ NODE_ENV: 'production', JWT_SECRET: 'short' }, silentLogger);
    } catch (e) {
      caught = e as AuthConfigError;
    }
    expect(caught).toBeDefined();
    expect(caught!.code).toBe('JWT_SECRET_REQUIRED');
  });

  it('accepts a strong JWT_SECRET in production', () => {
    const cfg = resolveAuthConfig(
      { NODE_ENV: 'production', JWT_SECRET: 'a-sufficiently-long-secret' },
      silentLogger
    );
    expect(cfg.secret).toBe('a-sufficiently-long-secret');
    expect(cfg.isProduction).toBe(true);
    expect(cfg.devBypass).toBe(false);
    expect(cfg.ephemeralSecret).toBe(false);
  });

  it('generates an ephemeral secret outside production when none is set', () => {
    const cfg = resolveAuthConfig({ NODE_ENV: 'development' }, silentLogger);
    expect(cfg.secret.length).toBeGreaterThan(0);
    expect(cfg.ephemeralSecret).toBe(true);
    expect(cfg.isProduction).toBe(false);
  });

  it('never enables devBypass in production, even if AUTH_DEV_BYPASS=true', () => {
    const cfg = resolveAuthConfig(
      { NODE_ENV: 'production', JWT_SECRET: 'a-sufficiently-long-secret', AUTH_DEV_BYPASS: 'true' },
      silentLogger
    );
    expect(cfg.devBypass).toBe(false);
  });

  it('enables devBypass only outside production with the explicit opt-in', () => {
    const off = resolveAuthConfig({ NODE_ENV: 'development' }, silentLogger);
    expect(off.devBypass).toBe(false);

    const on = resolveAuthConfig(
      { NODE_ENV: 'development', AUTH_DEV_BYPASS: 'true' },
      silentLogger
    );
    expect(on.devBypass).toBe(true);
  });
});
