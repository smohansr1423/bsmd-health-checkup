/**
 * Auth Service Routes
 * Handles login, logout, and token refresh (public routes).
 * Validates: Requirements 18.1, 18.2, 18.5
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import { RATE_LIMIT_PRESETS } from '../types';
import { createRateLimiter } from '../middleware';

const router = Router();

// Auth routes use sensitive rate limiting to prevent brute force
const authLimiter = createRateLimiter({ ...RATE_LIMIT_PRESETS.sensitive, keyPrefix: 'auth' });

/**
 * POST /auth/login
 * Authenticate and receive a token
 * Public route (no auth middleware)
 */
router.post(
  '/login',
  authLimiter,
  (req: Request, res: Response, _next: NextFunction) => {
    res.status(501).json({
      error: { code: 'NOT_IMPLEMENTED', message: 'Login endpoint not yet wired' },
    });
  }
);

/**
 * POST /auth/logout
 * Invalidate the current session
 * Public route (no auth middleware — token may be in body)
 */
router.post(
  '/logout',
  authLimiter,
  (req: Request, res: Response, _next: NextFunction) => {
    res.status(501).json({
      error: { code: 'NOT_IMPLEMENTED', message: 'Logout endpoint not yet wired' },
    });
  }
);

/**
 * POST /auth/refresh
 * Refresh an authentication token
 * Public route (uses refresh token)
 */
router.post(
  '/refresh',
  authLimiter,
  (req: Request, res: Response, _next: NextFunction) => {
    res.status(501).json({
      error: { code: 'NOT_IMPLEMENTED', message: 'Token refresh endpoint not yet wired' },
    });
  }
);

export default router;
