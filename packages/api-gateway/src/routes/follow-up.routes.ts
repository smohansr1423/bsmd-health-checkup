/**
 * Follow-Up Tracker Service Routes
 * Validates: Requirements 8.1–8.6
 */

import { Router, type Response, type NextFunction } from 'express';
import type { AuthenticatedRequest } from '../types';
import { RATE_LIMIT_PRESETS } from '../types';
import { createRateLimiter, createRoleGuard } from '../middleware';
import type { ServiceRegistry } from '../service-registry';

const router = Router();
const readLimiter = createRateLimiter(RATE_LIMIT_PRESETS.read);
const writeLimiter = createRateLimiter({ ...RATE_LIMIT_PRESETS.write, keyPrefix: 'follow-up:write' });

function getServices(req: AuthenticatedRequest): ServiceRegistry { return req.app.locals.services; }

router.post(
  '/actions',
  writeLimiter,
  createRoleGuard('Physician', 'Administrator'),
  async (req: AuthenticatedRequest, res: Response, _next: NextFunction) => {
    try {
      const { followUpTrackerService } = getServices(req);
      const data = req.body;
      if (typeof data.dueDate === 'string') data.dueDate = new Date(data.dueDate);
      const action = await followUpTrackerService.assignFollowUp(data);
      res.status(201).json({ data: action });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Assignment failed';
      res.status(400).json({ error: { code: 'ASSIGN_FAILED', message } });
    }
  }
);

router.put(
  '/actions/:id/complete',
  writeLimiter,
  createRoleGuard('Physician', 'Senior_Citizen', 'Administrator'),
  async (req: AuthenticatedRequest, res: Response, _next: NextFunction) => {
    try {
      const { followUpTrackerService } = getServices(req);
      const { notes } = req.body;
      const action = await followUpTrackerService.completeFollowUp(req.params.id, notes);
      res.json({ data: action });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Completion failed';
      const status = message.includes('not found') ? 404 : 400;
      res.status(status).json({ error: { code: 'COMPLETE_FAILED', message } });
    }
  }
);

router.get(
  '/dashboard/:seniorId',
  readLimiter,
  createRoleGuard('Physician', 'Senior_Citizen', 'Caregiver', 'Administrator'),
  async (req: AuthenticatedRequest, res: Response, _next: NextFunction) => {
    try {
      const { followUpTrackerService } = getServices(req);
      const dashboard = await followUpTrackerService.getDashboard(req.params.seniorId);
      res.json({ data: dashboard });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to get dashboard';
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message } });
    }
  }
);

router.get(
  '/overdue',
  readLimiter,
  createRoleGuard('Physician', 'Administrator'),
  async (req: AuthenticatedRequest, res: Response, _next: NextFunction) => {
    try {
      const { followUpTrackerService } = getServices(req);
      const physicianId = req.auth?.userId || '';
      const actions = await followUpTrackerService.getOverdueActions(physicianId);
      res.json({ data: actions });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to get overdue actions';
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message } });
    }
  }
);

export default router;
