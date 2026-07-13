/**
 * Auth Service Routes
 * Handles login, logout, and token refresh (public routes).
 *
 * Backed by the real AuthService: `/login` authenticates credentials and issues
 * a signed JWT; `/logout` terminates the session; `/refresh` re-issues a token
 * for a still-valid session.
 *
 * Validates: Requirements 18.1, 18.2, 18.5
 */

import { Router, type Request, type Response } from 'express';
import {
  AuthService,
  AuthenticationError,
  AccountLockedError,
} from '@health-checkup/services';
import { RATE_LIMIT_PRESETS } from '../types';
import { createRateLimiter } from '../middleware';

export interface AuthRoutesDeps {
  authService: AuthService;
}

/**
 * Create the auth router bound to an AuthService instance.
 */
export function createAuthRoutes(deps: AuthRoutesDeps): Router {
  const router = Router();
  const { authService } = deps;

  // Auth routes use sensitive rate limiting to slow brute-force attempts.
  const authLimiter = createRateLimiter({ ...RATE_LIMIT_PRESETS.sensitive, keyPrefix: 'auth' });

  /**
   * POST /auth/login
   * Authenticate with { username, password } and receive a signed token.
   * Public route (no auth middleware).
   */
  router.post('/login', authLimiter, async (req: Request, res: Response) => {
    const { username, password } = (req.body ?? {}) as {
      username?: unknown;
      password?: unknown;
    };

    if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
      res.status(400).json({
        error: {
          code: 'INVALID_CREDENTIALS_FORMAT',
          message: 'A JSON body with string "username" and "password" is required.',
        },
      });
      return;
    }

    try {
      const authToken = await authService.authenticate({ username, password });
      res.status(200).json({
        token: authToken.token,
        userId: authToken.userId,
        role: authToken.role,
        expiresAt: authToken.expiresAt.toISOString(),
      });
    } catch (error: unknown) {
      if (error instanceof AccountLockedError) {
        res.status(423).json({
          error: {
            code: 'ACCOUNT_LOCKED',
            message: error.message,
            details: { lockExpiresAt: error.lockExpiresAt.toISOString() },
          },
        });
        return;
      }
      if (error instanceof AuthenticationError) {
        // Uniform message — never disclose whether the username exists.
        res.status(401).json({
          error: { code: 'AUTHENTICATION_FAILED', message: 'Invalid credentials.' },
        });
        return;
      }
      res.status(500).json({
        error: { code: 'AUTH_INTERNAL_ERROR', message: 'Authentication failed unexpectedly.' },
      });
    }
  });

  /**
   * POST /auth/logout
   * Invalidate the current session. Accepts a Bearer token or { token } body.
   * Public route (token may be supplied in the body).
   */
  router.post('/logout', authLimiter, async (req: Request, res: Response) => {
    const token = extractToken(req);
    if (!token) {
      res.status(400).json({
        error: {
          code: 'TOKEN_REQUIRED',
          message: 'Provide the token via Authorization: Bearer <token> or a { "token" } body.',
        },
      });
      return;
    }

    // Resolve the session from the token, then terminate it. Idempotent: an
    // invalid/expired token still yields a 200 (nothing to revoke).
    const authToken = authService.validateToken(token);
    if (authToken) {
      await authService.terminateSession(authToken.sessionId, 'user_logout');
    }
    res.status(200).json({ success: true });
  });

  /**
   * POST /auth/refresh
   * Issue a fresh token for a still-valid session.
   * Public route (uses the current token).
   */
  router.post('/refresh', authLimiter, async (req: Request, res: Response) => {
    const token = extractToken(req);
    if (!token) {
      res.status(400).json({
        error: {
          code: 'TOKEN_REQUIRED',
          message: 'Provide the token via Authorization: Bearer <token> or a { "token" } body.',
        },
      });
      return;
    }

    const current = authService.validateToken(token);
    if (!current) {
      res.status(401).json({
        error: { code: 'INVALID_TOKEN', message: 'Invalid or expired token. Please log in again.' },
      });
      return;
    }

    const refreshed = authService.reissueToken(current.sessionId);
    if (!refreshed) {
      res.status(401).json({
        error: { code: 'SESSION_EXPIRED', message: 'Session is no longer active. Please log in again.' },
      });
      return;
    }

    res.status(200).json({
      token: refreshed.token,
      userId: refreshed.userId,
      role: refreshed.role,
      expiresAt: refreshed.expiresAt.toISOString(),
    });
  });

  return router;
}

/** Pull a bearer token from the Authorization header or a { token } body. */
function extractToken(req: Request): string | null {
  const header = req.headers['authorization'];
  const headerValue = Array.isArray(header) ? header[0] : header;
  if (headerValue && headerValue.startsWith('Bearer ')) {
    return headerValue.substring(7);
  }
  const bodyToken = (req.body ?? {}) as { token?: unknown };
  if (typeof bodyToken.token === 'string' && bodyToken.token) {
    return bodyToken.token;
  }
  return null;
}

export default createAuthRoutes;
