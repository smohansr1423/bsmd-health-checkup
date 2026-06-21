/**
 * Health Report Service Routes
 * Validates: Requirements 7.1–7.9
 */

import { Router, type Response, type NextFunction } from 'express';
import type { AuthenticatedRequest } from '../types';
import { RATE_LIMIT_PRESETS } from '../types';
import { createRateLimiter, createRoleGuard } from '../middleware';
import type { ServiceRegistry } from '../service-registry';

const router = Router();
const readLimiter = createRateLimiter(RATE_LIMIT_PRESETS.read);

function getServices(req: AuthenticatedRequest): ServiceRegistry { return req.app.locals.services; }

router.get(
  '/senior/:seniorId',
  readLimiter,
  createRoleGuard('Physician', 'Senior_Citizen', 'Caregiver', 'Administrator'),
  async (req: AuthenticatedRequest, res: Response, _next: NextFunction) => {
    try {
      const { reportGenerationService } = getServices(req);
      const reports = await reportGenerationService.getReportHistory(req.params.seniorId);
      res.json({ data: reports });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to get reports';
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message } });
    }
  }
);

router.get(
  '/:id',
  readLimiter,
  createRoleGuard('Physician', 'Senior_Citizen', 'Caregiver', 'Administrator'),
  async (req: AuthenticatedRequest, res: Response, _next: NextFunction) => {
    try {
      const { reportGenerationService } = getServices(req);
      const format = (req.query.format as 'clinical' | 'simplified') || 'simplified';
      const report = await reportGenerationService.getReport(req.params.id, format);
      res.json({ data: report });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Report not found';
      const status = message.includes('not found') ? 404 : 500;
      res.status(status).json({ error: { code: status === 404 ? 'NOT_FOUND' : 'INTERNAL_ERROR', message } });
    }
  }
);

router.post(
  '/generate/:sessionId',
  createRateLimiter({ ...RATE_LIMIT_PRESETS.write, keyPrefix: 'reports:generate' }),
  createRoleGuard('Physician', 'Administrator'),
  async (req: AuthenticatedRequest, res: Response, _next: NextFunction) => {
    try {
      const { reportGenerationService } = getServices(req);
      const report = await reportGenerationService.generateReport(req.params.sessionId);
      res.status(201).json({ data: report });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Generation failed';
      res.status(400).json({ error: { code: 'GENERATE_FAILED', message } });
    }
  }
);

export default router;
