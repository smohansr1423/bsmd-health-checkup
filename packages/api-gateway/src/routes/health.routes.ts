/**
 * Health Check Routes
 * Public health-check endpoint underpinning the monthly availability
 * measurement. A health check is considered successful when it returns a
 * valid response within 5 seconds (Req 19.1).
 * Validates: Requirements 19.1
 */

import { Router, type Request, type Response } from 'express';

const router = Router();

/**
 * GET /
 * Lightweight liveness/health probe. Returns quickly (well within the 5s
 * success threshold) so it can be polled to compute service availability.
 */
router.get('/', (_req: Request, res: Response) => {
  const databaseUrl = process.env.DATABASE_URL;

  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    db: {
      status: databaseUrl ? 'configured' : 'not_configured',
      connected: !!databaseUrl,
    },
    env: {
      port: process.env.PORT || '3000',
      corsOrigin: process.env.CORS_ORIGIN || '*',
    },
  });
});

export default router;
