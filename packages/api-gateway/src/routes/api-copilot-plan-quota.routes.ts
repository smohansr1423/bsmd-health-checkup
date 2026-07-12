/**
 * API Copilot AI — Plan & Quota Routes
 *
 * Exposes tier resolution, quota reservation, billing-period reset, and tier
 * changes. Protected by the gateway auth middleware and an authenticated role
 * guard. Quota rejection maps to 429 and API-limit rejection to 409 per the
 * design's error table.
 *
 * Validates: Requirements 2.4, 2.5, 17.1, 17.4, 17.5, 17.7, 17.8, 17.9
 */

import { Router } from 'express';
import type { apiCopilotShared } from '@health-checkup/services';
import { RATE_LIMIT_PRESETS } from '../types';
import { createRateLimiter, createRoleGuard } from '../middleware';
import { requesterOf, requireService, wrap } from './api-copilot-support';

const router = Router();

const readLimiter = createRateLimiter(RATE_LIMIT_PRESETS.read);
const writeLimiter = createRateLimiter({ ...RATE_LIMIT_PRESETS.write, keyPrefix: 'copilot:plan-quota:write' });

/**
 * GET /tier
 * Return the requesting account's plan tier (Req 17.1).
 */
router.get(
  '/tier',
  readLimiter,
  createRoleGuard(),
  wrap(async (req, res) => {
    const service = requireService(req, 'planQuotaService', 'Plan & Quota service');
    const tier = await service.tierOf(requesterOf(req).accountId);
    res.status(200).json({ data: { tier } });
  })
);

/**
 * GET /limits
 * Return the limits currently applying to the account (Req 17.2, 17.3, 17.6).
 */
router.get(
  '/limits',
  readLimiter,
  createRoleGuard(),
  wrap(async (req, res) => {
    const service = requireService(req, 'planQuotaService', 'Plan & Quota service');
    const limits = await service.limitsFor(requesterOf(req).accountId);
    res.status(200).json({ data: limits });
  })
);

/**
 * POST /queries/reserve
 * Reserve one AI query against the account's quota (Req 17.4, 17.9).
 */
router.post(
  '/queries/reserve',
  writeLimiter,
  createRoleGuard(),
  wrap(async (req, res) => {
    const service = requireService(req, 'planQuotaService', 'Plan & Quota service');
    const decision = await service.checkAndReserveQuery(requesterOf(req).accountId);
    res.status(200).json({ data: decision });
  })
);

/**
 * POST /billing-period/reset
 * Begin a new billing period, resetting the query count (Req 17.7).
 */
router.post(
  '/billing-period/reset',
  writeLimiter,
  createRoleGuard(),
  wrap(async (req, res) => {
    const service = requireService(req, 'planQuotaService', 'Plan & Quota service');
    const state = await service.resetBillingPeriod(requesterOf(req).accountId);
    res.status(200).json({ data: state });
  })
);

/**
 * POST /tier-change
 * Apply a plan-tier change for the current billing period (Req 17.8, 17.9).
 */
router.post(
  '/tier-change',
  writeLimiter,
  createRoleGuard(),
  wrap(async (req, res) => {
    const service = requireService(req, 'planQuotaService', 'Plan & Quota service');
    const { accountId } = requesterOf(req);
    await service.applyTierChange(
      accountId,
      req.body?.newTier as apiCopilotShared.PlanTier,
      req.body?.enterpriseConfig
    );
    res.status(200).json({ data: { accountId, newTier: req.body?.newTier } });
  })
);

export default router;
