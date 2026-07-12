/**
 * API Copilot AI — Code Generator Routes
 *
 * Lists supported languages and generates client-code snippets for a selected
 * endpoint. Protected by the gateway auth middleware and an authenticated role
 * guard. Missing endpoint maps to 404, unsupported language to 400, and no
 * valid version to 409 per the design's error table (Req 7.6, 7.7, 7.8).
 *
 * Validates: Requirements 7.1, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8
 */

import { Router } from 'express';
import type { codeGenerator } from '@health-checkup/services';
import { RATE_LIMIT_PRESETS } from '../types';
import { createRateLimiter, createRoleGuard } from '../middleware';
import { requireService, wrap } from './api-copilot-support';

const router = Router();

const readLimiter = createRateLimiter(RATE_LIMIT_PRESETS.read);

/**
 * GET /languages
 * List the code-generation languages supported for the MVP (Req 7.1).
 */
router.get(
  '/languages',
  readLimiter,
  createRoleGuard(),
  wrap(async (req, res) => {
    const service = requireService(req, 'codeGeneratorService', 'Code Generator');
    res.status(200).json({ data: { languages: service.supportedLanguages() } });
  })
);

/**
 * POST /generate
 * Generate a syntactically complete snippet for the selected endpoint scoped to
 * the selected version (Req 7.1, 7.3, 7.4, 7.5).
 */
router.post(
  '/generate',
  readLimiter,
  createRoleGuard(),
  wrap(async (req, res) => {
    const service = requireService(req, 'codeGeneratorService', 'Code Generator');
    const snippet = await service.generate(req.body as codeGenerator.GenerateCodeRequest);
    res.status(200).json({ data: snippet });
  })
);

export default router;
