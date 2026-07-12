/**
 * API Copilot AI — Conversation History Routes
 *
 * Lists a workspace's conversation history for authorized members and records
 * Q&A entries. Protected by the gateway auth middleware and an authenticated
 * role guard. Unauthorized reads map to 403 disclosing nothing (Req 15.4) and
 * record failures to 500 while preserving the answer (Req 15.2).
 *
 * Validates: Requirements 15.1, 15.2, 15.3, 15.4, 15.5, 15.6
 */

import { Router } from 'express';
import type { apiCopilotShared } from '@health-checkup/services';
import { RATE_LIMIT_PRESETS } from '../types';
import { createRateLimiter, createRoleGuard } from '../middleware';
import { badRequest } from '../middleware';
import { requesterOf, requireService, wrap } from './api-copilot-support';

const router = Router();

const readLimiter = createRateLimiter(RATE_LIMIT_PRESETS.read);
const writeLimiter = createRateLimiter({ ...RATE_LIMIT_PRESETS.write, keyPrefix: 'copilot:conversation:write' });

/**
 * GET /:workspaceId
 * List the workspace's conversation history most-recent-first for an authorized
 * member; denies unauthorized readers disclosing nothing (Req 15.3, 15.4, 15.5).
 */
router.get(
  '/:workspaceId',
  readLimiter,
  createRoleGuard(),
  wrap(async (req, res) => {
    const service = requireService(req, 'conversationService', 'Conversation History service');
    const entries = await service.list(req.params.workspaceId, requesterOf(req));
    res.status(200).json({ data: entries });
  })
);

/**
 * POST /:workspaceId
 * Record a Q&A entry carrying the submitting user's identity (Req 15.1, 15.6).
 * On a save failure the error preserves the answer for display (Req 15.2).
 */
router.post(
  '/:workspaceId',
  writeLimiter,
  createRoleGuard(),
  wrap(async (req, res) => {
    const service = requireService(req, 'conversationService', 'Conversation History service');
    const { question, answer } = req.body ?? {};
    if (typeof question !== 'string' || answer == null) {
      throw badRequest('question and answer are required.');
    }
    const entry = await service.record({
      workspaceId: req.params.workspaceId,
      userId: requesterOf(req).userId,
      question,
      answer: answer as apiCopilotShared.Answer,
    });
    res.status(201).json({ data: entry });
  })
);

export default router;
