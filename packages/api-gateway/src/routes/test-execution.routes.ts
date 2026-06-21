/**
 * Test Execution Service Routes
 * Validates: Requirements 5.1–5.8
 */

import { Router, type Response, type NextFunction } from 'express';
import type { AuthenticatedRequest } from '../types';
import { RATE_LIMIT_PRESETS } from '../types';
import { createRateLimiter, createRoleGuard } from '../middleware';
import type { ServiceRegistry } from '../service-registry';

const router = Router();
const readLimiter = createRateLimiter(RATE_LIMIT_PRESETS.read);
const writeLimiter = createRateLimiter({ ...RATE_LIMIT_PRESETS.write, keyPrefix: 'test-execution:write' });

function getServices(req: AuthenticatedRequest): ServiceRegistry { return req.app.locals.services; }

router.post(
  '/sessions/:sessionId/results',
  writeLimiter,
  createRoleGuard('Lab_Technician'),
  async (req: AuthenticatedRequest, res: Response, _next: NextFunction) => {
    try {
      const { testExecutionService } = getServices(req);
      const data = { ...req.body, checkupSessionId: req.params.sessionId };
      if (typeof data.collectionTimestamp === 'string') data.collectionTimestamp = new Date(data.collectionTimestamp);
      const result = await testExecutionService.recordTestResult(data);
      res.status(201).json({ data: result });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Record failed';
      const status = message.includes('not found') ? 404 : 400;
      res.status(status).json({ error: { code: 'RECORD_FAILED', message } });
    }
  }
);

router.put(
  '/sessions/:sessionId/results/:resultId',
  writeLimiter,
  createRoleGuard('Lab_Technician'),
  async (req: AuthenticatedRequest, res: Response, _next: NextFunction) => {
    try {
      const { testExecutionService } = getServices(req);
      const { value, unit, reason } = req.body;
      const technicianId = req.auth?.userId || 'unknown';
      const result = await testExecutionService.amendTestResult(req.params.resultId, { value, unit, reason }, technicianId);
      res.json({ data: result });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Amendment failed';
      const status = message.includes('not found') ? 404 : 400;
      res.status(status).json({ error: { code: 'AMEND_FAILED', message } });
    }
  }
);

router.get(
  '/sessions/:sessionId/results',
  readLimiter,
  createRoleGuard('Lab_Technician', 'Physician', 'Administrator'),
  async (req: AuthenticatedRequest, res: Response, _next: NextFunction) => {
    try {
      const { testExecutionService } = getServices(req);
      const results = await testExecutionService.getTestResults(req.params.sessionId);
      res.json({ data: results });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to get results';
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message } });
    }
  }
);

router.get(
  '/seniors/:seniorId/history',
  readLimiter,
  createRoleGuard('Physician', 'Senior_Citizen', 'Caregiver', 'Administrator'),
  async (req: AuthenticatedRequest, res: Response, _next: NextFunction) => {
    try {
      const { testExecutionService } = getServices(req);
      const testType = req.query.testType as string | undefined;
      const results = await testExecutionService.getTestHistory(req.params.seniorId, testType);
      res.json({ data: results });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to get history';
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message } });
    }
  }
);

export default router;
