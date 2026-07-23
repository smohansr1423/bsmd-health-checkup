/**
 * HTTP-level tests for the auth routes (login / logout / refresh), exercised
 * against a real Express app over an ephemeral port.
 */

import express from 'express';
import type { AddressInfo } from 'net';
import http from 'http';

import { createGatewayAuth } from '../auth/gateway-auth';
import { clearRateLimitStore } from '../middleware';
import { createAuthRoutes } from './auth.routes';

const ENV = {
  NODE_ENV: 'production',
  JWT_SECRET: 'a-sufficiently-long-secret',
  SEED_ADMIN_USERNAME: 'admin@example.com',
  SEED_ADMIN_PASSWORD: 'super-secret-pw',
};

function buildApp() {
  const { authService } = createGatewayAuth(ENV, { warn: () => undefined });
  const app = express();
  app.use(express.json());
  app.use('/api/auth', createAuthRoutes({ authService }));
  return app;
}

interface Resp {
  status: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any;
}

function request(
  port: number,
  method: string,
  path: string,
  opts: { body?: unknown; token?: string } = {}
): Promise<Resp> {
  return new Promise((resolve, reject) => {
    const payload = opts.body !== undefined ? JSON.stringify(opts.body) : undefined;
    const headers: Record<string, string> = {};
    if (payload !== undefined) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(payload).toString();
    }
    if (opts.token) {
      headers['Authorization'] = `Bearer ${opts.token}`;
    }
    const req = http.request({ host: '127.0.0.1', port, method, path, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve({ status: res.statusCode ?? 0, body: raw ? JSON.parse(raw) : undefined });
      });
    });
    req.on('error', reject);
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}

describe('auth routes (HTTP)', () => {
  let server: http.Server;
  let port: number;

  beforeAll(async () => {
    const app = buildApp();
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        port = (server.address() as AddressInfo).port;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  // The auth endpoints share a sensitive rate limiter (5/min). Reset the store
  // between tests so counts from one case don't bleed into the next.
  beforeEach(() => clearRateLimitStore());

  it('POST /login returns a token for valid credentials', async () => {
    const res = await request(port, 'POST', '/api/auth/login', {
      body: { username: 'admin@example.com', password: 'super-secret-pw' },
    });
    expect(res.status).toBe(200);
    expect(typeof res.body.token).toBe('string');
    expect(res.body.role).toBe('Administrator');
    expect(typeof res.body.expiresAt).toBe('string');
  });

  it('POST /login rejects invalid credentials with 401 and a uniform message', async () => {
    const res = await request(port, 'POST', '/api/auth/login', {
      body: { username: 'admin@example.com', password: 'wrong' },
    });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('AUTHENTICATION_FAILED');
    expect(res.body.error.message).toBe('Invalid credentials.');
  });

  it('POST /login rejects a malformed body with 400', async () => {
    const res = await request(port, 'POST', '/api/auth/login', { body: { username: 'x' } });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS_FORMAT');
  });

  it('POST /refresh issues a new token for a valid session, then /logout revokes it', async () => {
    const login = await request(port, 'POST', '/api/auth/login', {
      body: { username: 'admin@example.com', password: 'super-secret-pw' },
    });
    const token = login.body.token as string;

    const refresh = await request(port, 'POST', '/api/auth/refresh', { token });
    expect(refresh.status).toBe(200);
    expect(typeof refresh.body.token).toBe('string');

    const logout = await request(port, 'POST', '/api/auth/logout', { token });
    expect(logout.status).toBe(200);
    expect(logout.body.success).toBe(true);

    // After logout the session is gone, so refresh must fail.
    const refreshAfter = await request(port, 'POST', '/api/auth/refresh', { token });
    expect(refreshAfter.status).toBe(401);
  });

  it('POST /refresh with no token returns 400', async () => {
    const res = await request(port, 'POST', '/api/auth/refresh', {});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('TOKEN_REQUIRED');
  });
});
