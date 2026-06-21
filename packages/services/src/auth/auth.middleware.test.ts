/**
 * Unit tests for Auth Middleware
 * Validates: Requirements 18.1, 18.5, 18.7
 */

import { AuthService } from './auth.service';
import { AuditService } from './audit.service';
import {
  createAuthMiddleware,
  requireRole,
  requirePermission,
} from './auth.middleware';
import type { AuthenticatedRequest, MiddlewareResponse } from './auth.middleware';
import type { UserAccount } from './auth.types';

describe('Auth Middleware', () => {
  let authService: AuthService;
  let auditService: AuditService;
  let middleware: ReturnType<typeof createAuthMiddleware>;

  const physician: UserAccount = {
    userId: 'doc-1',
    username: 'doc@hospital.com',
    passwordHash: 'pass123',
    role: 'Physician',
    isLocked: false,
    lockExpiresAt: null,
    consecutiveFailures: 0,
    lastFailedAt: null,
  };

  const labTech: UserAccount = {
    userId: 'tech-1',
    username: 'tech@hospital.com',
    passwordHash: 'tech-pass',
    role: 'Lab_Technician',
    isLocked: false,
    lockExpiresAt: null,
    consecutiveFailures: 0,
    lastFailedAt: null,
  };

  function createMockResponse(): MiddlewareResponse & { statusCode?: number; body?: unknown } {
    const res: any = {
      statusCode: undefined,
      body: undefined,
      status(code: number) {
        res.statusCode = code;
        return res;
      },
      json(body: unknown) {
        res.body = body;
      },
    };
    return res;
  }

  beforeEach(() => {
    auditService = new AuditService();
    authService = new AuthService({
      auditService,
      passwordVerifier: (password, hash) => password === hash,
    });
    authService.registerUser({ ...physician });
    authService.registerUser({ ...labTech });
    middleware = createAuthMiddleware(authService);
  });

  describe('createAuthMiddleware', () => {
    it('should reject requests without Authorization header', () => {
      const req: AuthenticatedRequest = { headers: {} };
      const res = createMockResponse();
      let nextCalled = false;

      middleware(req, res, () => { nextCalled = true; });

      expect(res.statusCode).toBe(401);
      expect(nextCalled).toBe(false);
    });

    it('should reject requests with invalid header format', () => {
      const req: AuthenticatedRequest = { headers: { authorization: 'Basic abc123' } };
      const res = createMockResponse();
      let nextCalled = false;

      middleware(req, res, () => { nextCalled = true; });

      expect(res.statusCode).toBe(401);
      expect(nextCalled).toBe(false);
    });

    it('should reject requests with invalid token', () => {
      const req: AuthenticatedRequest = { headers: { authorization: 'Bearer invalid-token' } };
      const res = createMockResponse();
      let nextCalled = false;

      middleware(req, res, () => { nextCalled = true; });

      expect(res.statusCode).toBe(401);
      expect(nextCalled).toBe(false);
    });

    it('should accept requests with valid token and attach auth', async () => {
      const token = await authService.authenticate({
        username: 'doc@hospital.com',
        password: 'pass123',
      });

      const req: AuthenticatedRequest = { headers: { authorization: `Bearer ${token.token}` } };
      const res = createMockResponse();
      let nextCalled = false;

      middleware(req, res, () => { nextCalled = true; });

      expect(nextCalled).toBe(true);
      expect(req.auth).toBeDefined();
      expect(req.auth!.userId).toBe('doc-1');
      expect(req.auth!.role).toBe('Physician');
    });

    it('should reject token from terminated session', async () => {
      const token = await authService.authenticate({
        username: 'doc@hospital.com',
        password: 'pass123',
      });

      await authService.terminateSession(token.sessionId);

      const req: AuthenticatedRequest = { headers: { authorization: `Bearer ${token.token}` } };
      const res = createMockResponse();
      let nextCalled = false;

      middleware(req, res, () => { nextCalled = true; });

      expect(res.statusCode).toBe(401);
      expect(nextCalled).toBe(false);
    });
  });

  describe('requireRole', () => {
    it('should allow access for permitted role', async () => {
      const token = await authService.authenticate({
        username: 'doc@hospital.com',
        password: 'pass123',
      });

      const req: AuthenticatedRequest = {
        headers: { authorization: `Bearer ${token.token}` },
        auth: token,
      };
      const res = createMockResponse();
      let nextCalled = false;

      const roleMiddleware = requireRole(authService, 'Physician', 'Administrator');
      await roleMiddleware(req, res, () => { nextCalled = true; });

      expect(nextCalled).toBe(true);
    });

    it('should deny access for non-permitted role', async () => {
      const token = await authService.authenticate({
        username: 'tech@hospital.com',
        password: 'tech-pass',
      });

      const req: AuthenticatedRequest = {
        headers: { authorization: `Bearer ${token.token}` },
        auth: token,
      };
      const res = createMockResponse();
      let nextCalled = false;

      const roleMiddleware = requireRole(authService, 'Physician', 'Administrator');
      await roleMiddleware(req, res, () => { nextCalled = true; });

      expect(res.statusCode).toBe(403);
      expect(nextCalled).toBe(false);
    });

    it('should return 401 if not authenticated', async () => {
      const req: AuthenticatedRequest = { headers: {} };
      const res = createMockResponse();
      let nextCalled = false;

      const roleMiddleware = requireRole(authService, 'Physician');
      await roleMiddleware(req, res, () => { nextCalled = true; });

      expect(res.statusCode).toBe(401);
      expect(nextCalled).toBe(false);
    });
  });

  describe('requirePermission', () => {
    it('should allow action when role has permission', async () => {
      const token = await authService.authenticate({
        username: 'doc@hospital.com',
        password: 'pass123',
      });

      const req: AuthenticatedRequest = {
        headers: { authorization: `Bearer ${token.token}` },
        auth: token,
      };
      const res = createMockResponse();
      let nextCalled = false;

      const permMiddleware = requirePermission(authService, 'health_profile', 'read');
      await permMiddleware(req, res, () => { nextCalled = true; });

      expect(nextCalled).toBe(true);
    });

    it('should deny action when role lacks permission', async () => {
      const token = await authService.authenticate({
        username: 'tech@hospital.com',
        password: 'tech-pass',
      });

      const req: AuthenticatedRequest = {
        headers: { authorization: `Bearer ${token.token}` },
        auth: token,
      };
      const res = createMockResponse();
      let nextCalled = false;

      const permMiddleware = requirePermission(authService, 'health_profile', 'write');
      await permMiddleware(req, res, () => { nextCalled = true; });

      expect(res.statusCode).toBe(403);
      expect(nextCalled).toBe(false);
    });
  });
});
