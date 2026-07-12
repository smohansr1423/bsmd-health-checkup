/**
 * API Copilot AI — Workspace Routes
 *
 * Workspace creation, the central access-control decision, and membership
 * management. Protected by the gateway auth middleware and an authenticated
 * role guard; workspace-level isolation is enforced by the service and mapped
 * to 403 (Req 14.4, 18.5). Name/limit errors map to 400/409.
 *
 * Validates: Requirements 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.7, 18.4, 18.5
 */

import { Router } from 'express';
import { RATE_LIMIT_PRESETS } from '../types';
import { createRateLimiter, createRoleGuard } from '../middleware';
import { requesterOf, requireService, wrap } from './api-copilot-support';

const router = Router();

const readLimiter = createRateLimiter(RATE_LIMIT_PRESETS.read);
const writeLimiter = createRateLimiter({ ...RATE_LIMIT_PRESETS.write, keyPrefix: 'copilot:workspace:write' });

/**
 * POST /
 * Create a workspace owned by the requesting account (Req 14.1, 14.2).
 */
router.post(
  '/',
  writeLimiter,
  createRoleGuard(),
  wrap(async (req, res) => {
    const service = requireService(req, 'workspaceService', 'Workspace service');
    const { accountId } = requesterOf(req);
    const workspace = await service.create(accountId, String(req.body?.name ?? ''));
    res.status(201).json({ data: workspace });
  })
);

/**
 * GET /:workspaceId/access
 * Return the access-control decision for the requester (Req 14.3, 14.4).
 */
router.get(
  '/:workspaceId/access',
  readLimiter,
  createRoleGuard(),
  wrap(async (req, res) => {
    const service = requireService(req, 'workspaceService', 'Workspace service');
    const decision = await service.authorize(requesterOf(req), req.params.workspaceId);
    res.status(200).json({ data: decision });
  })
);

/**
 * POST /:workspaceId/members
 * Add a member to a workspace, capped by the tier member limit (Req 14.5, 14.6).
 */
router.post(
  '/:workspaceId/members',
  writeLimiter,
  createRoleGuard(),
  wrap(async (req, res) => {
    const service = requireService(req, 'workspaceService', 'Workspace service');
    const { accountId } = requesterOf(req);
    const workspace = await service.addMember(
      accountId,
      req.params.workspaceId,
      String(req.body?.userId ?? '')
    );
    res.status(200).json({ data: workspace });
  })
);

/**
 * DELETE /:workspaceId/members/:userId
 * Remove a member; revokes access but retains workspace data (Req 14.7).
 */
router.delete(
  '/:workspaceId/members/:userId',
  writeLimiter,
  createRoleGuard(),
  wrap(async (req, res) => {
    const service = requireService(req, 'workspaceService', 'Workspace service');
    const { accountId } = requesterOf(req);
    const workspace = await service.removeMember(
      accountId,
      req.params.workspaceId,
      req.params.userId
    );
    res.status(200).json({ data: workspace });
  })
);

export default router;
