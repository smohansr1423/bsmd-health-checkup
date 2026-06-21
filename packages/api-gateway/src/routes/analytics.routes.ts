/**
 * Analytics Service Routes
 * Validates: Requirements 15.1–15.7, 16.1–16.7, 17.1–17.8
 */

import { Router, type Response, type NextFunction } from 'express';
import type { AuthenticatedRequest } from '../types';
import { RATE_LIMIT_PRESETS } from '../types';
import { createRateLimiter, createRoleGuard } from '../middleware';
import type { ServiceRegistry } from '../service-registry';

const router = Router();
const readLimiter = createRateLimiter(RATE_LIMIT_PRESETS.read);

function getServices(req: AuthenticatedRequest): ServiceRegistry { return req.app.locals.services; }

// --- Patient analytics ---

router.get(
  '/patients/:seniorId/trends',
  readLimiter,
  createRoleGuard('Physician', 'Senior_Citizen', 'Caregiver', 'Administrator'),
  async (req: AuthenticatedRequest, res: Response, _next: NextFunction) => {
    try {
      const { analyticsService } = getServices(req);
      const trends = await analyticsService.getPatientTrends(req.params.seniorId, req.query as any);
      res.json({ data: trends });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to get trends';
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message } });
    }
  }
);

router.get(
  '/patients/:seniorId/summary',
  readLimiter,
  createRoleGuard('Physician', 'Senior_Citizen', 'Caregiver', 'Administrator'),
  async (req: AuthenticatedRequest, res: Response, _next: NextFunction) => {
    try {
      const { analyticsService } = getServices(req);
      const summary = await analyticsService.getPatientSummaryCard(req.params.seniorId);
      res.json({ data: summary });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to get summary';
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message } });
    }
  }
);

// --- Physician dashboard ---

router.get(
  '/physician/dashboard',
  readLimiter,
  createRoleGuard('Physician', 'Administrator'),
  async (req: AuthenticatedRequest, res: Response, _next: NextFunction) => {
    try {
      const { analyticsService } = getServices(req);
      const physicianId = req.auth?.userId || '';
      const dashboard = await analyticsService.getPhysicianDashboard(physicianId);
      res.json({ data: dashboard });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to get physician dashboard';
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message } });
    }
  }
);

// --- Admin dashboard ---

router.get(
  '/admin/dashboard',
  readLimiter,
  createRoleGuard('Administrator'),
  async (_req: AuthenticatedRequest, res: Response, _next: NextFunction) => {
    // Admin dashboard uses a separate AdminAnalyticsService
    // For now return a basic structure
    res.json({
      data: {
        registrations: { total: 0 },
        checkups: { completed: 0 },
        revenue: { total: 0 },
        resourceUtilization: { physicianWorkload: 0, labCapacity: 0, slotOccupancy: 0 },
        lastRefreshed: new Date().toISOString(),
      },
    });
  }
);

export default router;
