/**
 * API Copilot AI — Execution Engine Routes
 *
 * Plans and executes authenticated calls to a target API. Protected by the
 * gateway auth middleware and an authenticated role guard. Missing required
 * values map to 400, timeout to 504, and network failure to 502 per the
 * design's error table (Req 5.2, 5.6, 5.7).
 *
 * Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7
 */

import { Router } from 'express';
import type { executionEngine } from '@health-checkup/services';
import { RATE_LIMIT_PRESETS } from '../types';
import { createRateLimiter, createRoleGuard } from '../middleware';
import { badRequest } from '../middleware';
import { requireService, wrap } from './api-copilot-support';

const router = Router();

const writeLimiter = createRateLimiter({ ...RATE_LIMIT_PRESETS.write, keyPrefix: 'copilot:execution:write' });

/**
 * POST /plan
 * Resolve the endpoint's required values and return a ready-to-send plan, or a
 * 400 listing each missing value without sending (Req 5.1, 5.2).
 */
router.post(
  '/plan',
  writeLimiter,
  createRoleGuard(),
  wrap(async (req, res) => {
    const engine = requireService(req, 'executionEngine', 'Execution Engine');
    const plan = await engine.planExecution(req.body as executionEngine.PlanExecutionRequest);
    res.status(200).json({ data: plan });
  })
);

/**
 * POST /execute
 * Send a previously planned request and return the target's response with the
 * status/body passed through unmodified (Req 5.3–5.7).
 */
router.post(
  '/execute',
  writeLimiter,
  createRoleGuard(),
  wrap(async (req, res) => {
    const engine = requireService(req, 'executionEngine', 'Execution Engine');
    const plan = req.body?.plan as executionEngine.ExecutionPlan | undefined;
    if (!plan) {
      throw badRequest('An execution plan is required.');
    }
    const result = await engine.execute(plan);
    res.status(200).json({ data: result });
  })
);

export default router;
