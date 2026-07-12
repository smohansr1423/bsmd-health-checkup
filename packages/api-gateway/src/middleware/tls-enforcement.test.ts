// @ts-nocheck
/**
 * Unit tests for API Gateway TLS Enforcement Middleware
 * Validates: Requirements 18.2, 18.3
 */

import { createTlsEnforcement, isConnectionSecure } from './tls-enforcement';
import type { Request, Response, NextFunction } from 'express';

function createMockReq(overrides: Partial<Request> = {}): Request {
  return {
    secure: false,
    headers: {},
    ...overrides,
  } as unknown as Request;
}

function createMockRes(): Response & { statusCode: number; body: unknown; headers: Record<string, string> } {
  const res = {
    statusCode: 200,
    body: null as unknown,
    headers: {} as Record<string, string>,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(body: unknown) {
      res.body = body;
      return res;
    },
    setHeader(name: string, value: string) {
      res.headers[name] = value;
      return res;
    },
  } as unknown as Response & { statusCode: number; body: unknown; headers: Record<string, string> };
  return res;
}

describe('isConnectionSecure', () => {
  it('returns true for a TLS socket (req.secure)', () => {
    expect(isConnectionSecure(createMockReq({ secure: true }), true)).toBe(true);
  });

  it('returns true when trusted proxy forwards https', () => {
    const req = createMockReq({ headers: { 'x-forwarded-proto': 'https' } });
    expect(isConnectionSecure(req, true)).toBe(true);
  });

  it('honors the left-most protocol in a comma-separated forwarded header', () => {
    const req = createMockReq({ headers: { 'x-forwarded-proto': 'https, http' } });
    expect(isConnectionSecure(req, true)).toBe(true);
  });

  it('returns false when the forwarded header is http', () => {
    const req = createMockReq({ headers: { 'x-forwarded-proto': 'http' } });
    expect(isConnectionSecure(req, true)).toBe(false);
  });

  it('ignores the forwarded header when proxy is not trusted', () => {
    const req = createMockReq({ headers: { 'x-forwarded-proto': 'https' } });
    expect(isConnectionSecure(req, false)).toBe(false);
  });
});

describe('createTlsEnforcement', () => {
  it('refuses unencrypted connections with 403 and does not call next', () => {
    const middleware = createTlsEnforcement({ enabled: true });
    const req = createMockReq();
    const res = createMockRes();
    const next: NextFunction = jest.fn();

    middleware(req, res, next);

    expect(res.statusCode).toBe(403);
    expect((res.body as any).error.code).toBe('TLS_REQUIRED');
    expect(next).not.toHaveBeenCalled();
  });

  it('allows encrypted connections and sets HSTS header', () => {
    const middleware = createTlsEnforcement({ enabled: true });
    const req = createMockReq({ secure: true });
    const res = createMockRes();
    const next: NextFunction = jest.fn();

    middleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.headers['Strict-Transport-Security']).toContain('max-age=');
  });

  it('bypasses enforcement when disabled', () => {
    const middleware = createTlsEnforcement({ enabled: false });
    const req = createMockReq();
    const res = createMockRes();
    const next: NextFunction = jest.fn();

    middleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
  });

  it('refuses forwarded http even when proxy header is present', () => {
    const middleware = createTlsEnforcement({ enabled: true, trustProxyHeader: true });
    const req = createMockReq({ headers: { 'x-forwarded-proto': 'http' } });
    const res = createMockRes();
    const next: NextFunction = jest.fn();

    middleware(req, res, next);

    expect(res.statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });
});
