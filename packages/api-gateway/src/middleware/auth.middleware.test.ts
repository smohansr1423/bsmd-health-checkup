// @ts-nocheck
/**
 * Unit tests for API Gateway Auth Middleware
 */

import { createGatewayAuthMiddleware, createRoleGuard } from './auth.middleware';
import type { AuthenticatedRequest } from '../types';
import type { Response, NextFunction } from 'express';

function createMockReq(headers: Record<string, string> = {}): AuthenticatedRequest {
  return {
    headers,
    auth: undefined,
  } as unknown as AuthenticatedRequest;
}

function createMockRes(): Response {
  const res = { statusCode: 200,
    body: null as unknown,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(body: unknown) {
      (res as any).body = body;
      return res;
    },
  } as unknown as Response;
  return res;
}

describe('createGatewayAuthMiddleware', () => {
  const validToken = {
    token: 'valid-token',
    userId: 'user-1',
    role: 'Physician' as const,
    sessionId: 'session-1',
    issuedAt: new Date(),
    expiresAt: new Date(Date.now() + 3600000),
  };

  const config = {
    validateToken: jest.fn().mockReturnValue(validToken),
    refreshSession: jest.fn().mockReturnValue(true),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return 401 when no authorization header is provided', () => {
    const middleware = createGatewayAuthMiddleware(config);
    const req = createMockReq({});
    const res = createMockRes();
    const next = jest.fn();

    middleware(req, res, next);

    expect(res.statusCode).toBe(401);
    expect((res as any).body.error.code).toBe('AUTHENTICATION_REQUIRED');
    expect(next).not.toHaveBeenCalled();
  });

  it('should return 401 when authorization header is not Bearer format', () => {
    const middleware = createGatewayAuthMiddleware(config);
    const req = createMockReq({ authorization: 'Basic abc123' });
    const res = createMockRes();
    const next = jest.fn();

    middleware(req, res, next);

    expect(res.statusCode).toBe(401);
    expect((res as any).body.error.code).toBe('INVALID_AUTH_FORMAT');
    expect(next).not.toHaveBeenCalled();
  });

  it('should return 401 when token validation fails', () => {
    const failConfig = { ...config, validateToken: jest.fn().mockReturnValue(null) };
    const middleware = createGatewayAuthMiddleware(failConfig);
    const req = createMockReq({ authorization: 'Bearer invalid-token' });
    const res = createMockRes();
    const next = jest.fn();

    middleware(req, res, next);

    expect(res.statusCode).toBe(401);
    expect((res as any).body.error.code).toBe('INVALID_TOKEN');
    expect(next).not.toHaveBeenCalled();
  });

  it('should return 401 when session is expired', () => {
    const sessionConfig = { ...config, refreshSession: jest.fn().mockReturnValue(false) };
    const middleware = createGatewayAuthMiddleware(sessionConfig);
    const req = createMockReq({ authorization: 'Bearer valid-token' });
    const res = createMockRes();
    const next = jest.fn();

    middleware(req, res, next);

    expect(res.statusCode).toBe(401);
    expect((res as any).body.error.code).toBe('SESSION_EXPIRED');
    expect(next).not.toHaveBeenCalled();
  });

  it('should call next and attach auth when token and session are valid', () => {
    const middleware = createGatewayAuthMiddleware(config);
    const req = createMockReq({ authorization: 'Bearer valid-token' });
    const res = createMockRes();
    const next = jest.fn();

    middleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.auth).toEqual(validToken);
  });
});

describe('createRoleGuard', () => {
  it('should return 401 when no auth context is present', () => {
    const guard = createRoleGuard('Administrator');
    const req = createMockReq({});
    const res = createMockRes();
    const next = jest.fn();

    guard(req, res, next);

    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('should return 403 when role is not in allowed list', () => {
    const guard = createRoleGuard('Administrator');
    const req = createMockReq({});
    req.auth = {
      token: 't',
      userId: 'u',
      role: 'Senior_Citizen',
      sessionId: 's',
      issuedAt: new Date(),
      expiresAt: new Date(),
    };
    const res = createMockRes();
    const next = jest.fn();

    guard(req, res, next);

    expect(res.statusCode).toBe(403);
    expect((res as any).body.error.code).toBe('INSUFFICIENT_PERMISSIONS');
    expect(next).not.toHaveBeenCalled();
  });

  it('should call next when role is in allowed list', () => {
    const guard = createRoleGuard('Physician', 'Administrator');
    const req = createMockReq({});
    req.auth = {
      token: 't',
      userId: 'u',
      role: 'Physician',
      sessionId: 's',
      issuedAt: new Date(),
      expiresAt: new Date(),
    };
    const res = createMockRes();
    const next = jest.fn();

    guard(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  it('should allow all authenticated users when no roles specified', () => {
    const guard = createRoleGuard();
    const req = createMockReq({});
    req.auth = {
      token: 't',
      userId: 'u',
      role: 'Lab_Technician',
      sessionId: 's',
      issuedAt: new Date(),
      expiresAt: new Date(),
    };
    const res = createMockRes();
    const next = jest.fn();

    guard(req, res, next);

    expect(next).toHaveBeenCalled();
  });
});
