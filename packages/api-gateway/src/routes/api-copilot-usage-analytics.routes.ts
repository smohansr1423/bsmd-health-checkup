/**
 * API Copilot AI — Usage Analytics Routes
 *
 * Renders the per-workspace analytics dashboard. Protected by the gateway auth
 * middleware and an authenticated role guard. Unauthorized access maps to 403
 * disclosing no counts (Req 16.5) and a load failure to 503 while retaining
 * events (Req 16.7).
 *
 * Validates: Requirements 16.3, 16.4, 16.5, 16.6, 16.7
 */

import { Router } from 'express';
import { RATE_LIMIT_PRESETS } from '../types';
import { createRateLimiter, createRoleGuard } from '../middleware';
import { requesterOf, requireService, wrap } from './api-copilot-support';

const router = Router();

const readLimiter = createRateLimiter(RATE_LIMIT_PRESETS.read);

/**
 * GET /:workspaceId/dashboard
 * Return the analytics dashboard for an authorized requester, including query
 * quota consumption vs. the tier limit (Req 16.3–16.7).
 */
router.get(
  '/:workspaceId/dashboard',
  readLimiter,
  createRoleGuard(),
  wrap(async (req, res) => {
    const service = requireService(req, 'usageAnalyticsService', 'Usage Analytics service');
    const view = await service.dashboard(req.params.workspaceId, requesterOf(req));
    res.status(200).json({ data: view });
  })
);

export default router;
