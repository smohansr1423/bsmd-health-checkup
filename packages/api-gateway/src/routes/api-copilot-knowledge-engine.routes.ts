/**
 * API Copilot AI — Knowledge Engine Routes
 *
 * Specification upload/versioning and version selection. Protected by the
 * gateway auth middleware and an authenticated role guard. Parse/format/storage
 * errors map to 422/413/415/500 and unavailable-version selection to 409 per
 * the design's error table.
 *
 * Validates: Requirements 1.5, 1.7, 2.1, 2.3, 2.4, 2.5, 2.6, 2.7
 */

import { Router } from 'express';
import type { apiCopilotShared } from '@health-checkup/services';
import { RATE_LIMIT_PRESETS } from '../types';
import { createRateLimiter, createRoleGuard } from '../middleware';
import { badRequest } from '../middleware';
import { requesterOf, requireService, wrap } from './api-copilot-support';

const router = Router();

const writeLimiter = createRateLimiter({ ...RATE_LIMIT_PRESETS.write, keyPrefix: 'copilot:knowledge:write' });

/**
 * POST /uploads
 * Parse an uploaded specification and store it as an immutable API version
 * (Req 1.5, 1.7, 2.1, 2.3, 2.4, 2.5). The raw specification is supplied as a
 * UTF-8 string in `spec` with the declared `contentType` (`yaml` | `json`).
 */
router.post(
  '/uploads',
  writeLimiter,
  createRoleGuard(),
  wrap(async (req, res) => {
    const service = requireService(req, 'knowledgeEngineService', 'Knowledge Engine service');
    const { workspaceId, spec, contentType, apiId } = req.body ?? {};
    if (typeof workspaceId !== 'string' || typeof spec !== 'string' || typeof contentType !== 'string') {
      throw badRequest('workspaceId, spec, and contentType are required.');
    }
    const version = await service.uploadSpecification({
      workspaceId,
      accountId: requesterOf(req).accountId,
      raw: Buffer.from(spec, 'utf-8'),
      contentType,
      apiId: typeof apiId === 'string' ? apiId : undefined,
    });
    res.status(201).json({ data: version });
  })
);

/**
 * POST /versions/select
 * Scope subsequent operations to a specific API version; an unavailable version
 * is rejected and the prior selection retained (Req 2.6, 2.7).
 */
router.post(
  '/versions/select',
  writeLimiter,
  createRoleGuard(),
  wrap(async (req, res) => {
    const service = requireService(req, 'knowledgeEngineService', 'Knowledge Engine service');
    const { workspaceId, apiId, version, previousSelection } = req.body ?? {};
    if (typeof workspaceId !== 'string' || typeof apiId !== 'string' || typeof version !== 'number') {
      throw badRequest('workspaceId, apiId, and numeric version are required.');
    }
    const selection = await service.selectVersion(
      workspaceId,
      apiId,
      version,
      previousSelection as apiCopilotShared.ApiSelection | undefined
    );
    res.status(200).json({ data: selection });
  })
);

export default router;
