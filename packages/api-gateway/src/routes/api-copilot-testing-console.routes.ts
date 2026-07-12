/**
 * API Copilot AI — Testing Console Routes
 *
 * Runs requests through the Execution Engine, saves them to the per-workspace
 * history, and replays saved requests. Protected by the gateway auth middleware
 * and an authenticated role guard. Unusable saved auth maps to 401 and an
 * unknown history entry to 404 per the design's error table (Req 8.5).
 *
 * Validates: Requirements 8.1, 8.2, 8.3, 8.4, 8.5
 */

import { Router } from 'express';
import type { testingConsole } from '@health-checkup/services';
import { RATE_LIMIT_PRESETS } from '../types';
import { createRateLimiter, createRoleGuard } from '../middleware';
import { requireService, wrap } from './api-copilot-support';

const router = Router();

const writeLimiter = createRateLimiter({ ...RATE_LIMIT_PRESETS.write, keyPrefix: 'copilot:console:write' });

/**
 * POST /runs
 * Run a request from the console and save the completed run to history
 * (Req 8.1, 8.2, 8.3).
 */
router.post(
  '/runs',
  writeLimiter,
  createRoleGuard(),
  wrap(async (req, res) => {
    const console_ = requireService(req, 'testingConsole', 'Testing Console');
    const outcome = await console_.run(req.body as testingConsole.ConsoleRunRequest);
    res.status(200).json({ data: outcome });
  })
);

/**
 * POST /:workspaceId/replays/:historyId
 * Replay a saved request using its saved parameters and authentication; refuses
 * to send when the saved auth is missing/invalid/expired (Req 8.4, 8.5).
 */
router.post(
  '/:workspaceId/replays/:historyId',
  writeLimiter,
  createRoleGuard(),
  wrap(async (req, res) => {
    const console_ = requireService(req, 'testingConsole', 'Testing Console');
    const outcome = await console_.replay(req.params.workspaceId, req.params.historyId);
    res.status(200).json({ data: outcome });
  })
);

export default router;
