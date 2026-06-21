// @ts-nocheck
/**
 * Unit tests for API Gateway Rate Limiter Middleware
 */

import { createRateLimiter, clearRateLimitStore } from './rate-limiter';
import type { AuthenticatedRequest } from '../types';
import type { Response, NextFunction } from 'express';

function createMockReq(path = '/test', userId?: string): AuthenticatedRequest {
  const req: Partial<AuthenticatedRequest> = {
    path,
    ip: '127.0.0.1',
    headers: {},
  };
  if (userId) {
    req.auth = {
      token: 't',
      userId,
      role: 'Physician',
      sessionId: 's',
      issuedAt: new Date(),
      expiresAt: new Date(),
    };
  }
  return req as AuthenticatedRequest;
}

function createMockRes(): Response & { headers: Record<string, string> } {
  const res = { statusCode: 200,
    body: null as unknown,
    headers: {} as Record<string, string>,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(body: unknown) {
      (res as any).body = body;
      return res;
    },
    setHeader(name: string, value: string) {
      res.headers[name] = value;
      return res;
    },
  } as unknown as Response & { headers: Record<string, string> };
  return res;
}

describe('createRateLimiter', () => {
  beforeEach(() => {
    clearRateLimitStore();
  });

  it('should allow requests within the limit', () => {
    const limiter = createRateLimiter({ maxRequests: 3, windowMs: 60000 });
    const req = createMockReq('/api/test', 'user-1');
    const res = createMockRes();
    const next = jest.fn();

    // First 3 requests should pass
    limiter(req, res, next);
    limiter(req, res, next);
    limiter(req, res, next);

    expect(next).toHaveBeenCalledTimes(3);
  });

  it('should block requests exceeding the limit', () => {
    const limiter = createRateLimiter({ maxRequests: 2, windowMs: 60000 });
    const req = createMockReq('/api/test', 'user-2');
    const res = createMockRes();
    const next = jest.fn();

    limiter(req, res, next);
    limiter(req, res, next);
    // 3rd should be blocked
    limiter(req, res, next);

    expect(next).toHaveBeenCalledTimes(2);
    expect(res.statusCode).toBe(429);
    expect((res as any).body.error.code).toBe('RATE_LIMIT_EXCEEDED');
  });

  it('should set rate limit headers on successful requests', () => {
    const limiter = createRateLimiter({ maxRequests: 5, windowMs: 60000 });
    const req = createMockReq('/api/test', 'user-3');
    const res = createMockRes();
    const next = jest.fn();

    limiter(req, res, next);

    expect(res.headers['X-RateLimit-Limit']).toBe('5');
    expect(res.headers['X-RateLimit-Remaining']).toBe('4');
    expect(res.headers['X-RateLimit-Reset']).toBeDefined();
  });

  it('should set Retry-After header when rate limited', () => {
    const limiter = createRateLimiter({ maxRequests: 1, windowMs: 60000 });
    const req = createMockReq('/api/test', 'user-4');
    const res = createMockRes();
    const next = jest.fn();

    limiter(req, res, next);
    limiter(req, res, next);

    expect(res.headers['Retry-After']).toBeDefined();
    expect(Number(res.headers['Retry-After'])).toBeGreaterThan(0);
  });

  it('should track different users separately', () => {
    const limiter = createRateLimiter({ maxRequests: 1, windowMs: 60000 });
    const req1 = createMockReq('/api/test', 'user-A');
    const req2 = createMockReq('/api/test', 'user-B');
    const res1 = createMockRes();
    const res2 = createMockRes();
    const next = jest.fn();

    limiter(req1, res1, next);
    limiter(req2, res2, next);

    expect(next).toHaveBeenCalledTimes(2);
  });

  it('should use keyPrefix when provided', () => {
    const limiter = createRateLimiter({ maxRequests: 1, windowMs: 60000, keyPrefix: 'custom' });
    const req = createMockReq('/api/different-path', 'user-5');
    const res = createMockRes();
    const next = jest.fn();

    limiter(req, res, next);
    // Same keyPrefix means same bucket regardless of path
    const req2 = createMockReq('/api/another-path', 'user-5');
    limiter(req2, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(429);
  });
});
