/**
 * Notification & Alert Service Routes
 * Validates: Requirements 19.1–19.8, 20.1–20.7
 */

import { Router, type Response, type NextFunction } from 'express';
import type { AuthenticatedRequest } from '../types';
import { RATE_LIMIT_PRESETS } from '../types';
import { createRateLimiter, createRoleGuard } from '../middleware';
import type { ServiceRegistry } from '../service-registry';

const router = Router();
const readLimiter = createRateLimiter(RATE_LIMIT_PRESETS.read);
const writeLimiter = createRateLimiter({ ...RATE_LIMIT_PRESETS.write, keyPrefix: 'notifications:write' });

function getServices(req: AuthenticatedRequest): ServiceRegistry { return req.app.locals.services; }

router.get(
  '/preferences',
  readLimiter,
  async (req: AuthenticatedRequest, res: Response, _next: NextFunction) => {
    // Preferences are typically fetched from the preferences repository
    // For now, return a default structure
    res.json({ data: { userId: req.auth?.userId, activeChannels: ['push'], optOutNonCritical: false } });
  }
);

router.put(
  '/preferences',
  writeLimiter,
  async (req: AuthenticatedRequest, res: Response, _next: NextFunction) => {
    try {
      const { notificationService } = getServices(req);
      const userId = req.auth?.userId || '';
      await notificationService.configurePreferences(userId, req.body);
      res.json({ data: { message: 'Preferences updated successfully' } });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to update preferences';
      res.status(400).json({ error: { code: 'UPDATE_FAILED', message } });
    }
  }
);

router.post(
  '/alerts/:id/acknowledge',
  writeLimiter,
  createRoleGuard('Physician', 'Administrator'),
  async (req: AuthenticatedRequest, res: Response, _next: NextFunction) => {
    try {
      const { criticalAlertService } = getServices(req);
      const { responderId, actionStatus } = req.body;
      const result = await criticalAlertService.acknowledge(
        req.params.id,
        responderId || req.auth?.userId || '',
        actionStatus
      );
      res.json({ data: result });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Acknowledgement failed';
      const status = message.includes('not found') ? 404 : 400;
      res.status(status).json({ error: { code: 'ACK_FAILED', message } });
    }
  }
);

export default router;
