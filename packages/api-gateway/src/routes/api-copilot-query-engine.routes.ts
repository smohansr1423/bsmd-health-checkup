/**
 * API Copilot AI — Query Engine Routes
 *
 * Semantic search and natural-language Q&A (RAG). Protected by the gateway auth
 * middleware and an authenticated role guard. Length validation maps to 400,
 * no-API-selected to 409, vector-store unavailability to 503, and generation
 * timeout/failure to 504 per the design's error table (Req 4.7, 4.8).
 *
 * Validates: Requirements 3.2, 3.6, 3.7, 4.1, 4.5, 4.7, 4.8, 4.9
 */

import { Router } from 'express';
import type { apiCopilotShared } from '@health-checkup/services';
import { RATE_LIMIT_PRESETS } from '../types';
import { createRateLimiter, createRoleGuard } from '../middleware';
import { requesterOf, requireService, wrap } from './api-copilot-support';

const router = Router();

const readLimiter = createRateLimiter(RATE_LIMIT_PRESETS.read);
const writeLimiter = createRateLimiter({ ...RATE_LIMIT_PRESETS.write, keyPrefix: 'copilot:query:write' });

/**
 * POST /search
 * Semantic search scoped to the selected API/version (Req 3.2–3.4, 3.6, 3.7).
 */
router.post(
  '/search',
  readLimiter,
  createRoleGuard(),
  wrap(async (req, res) => {
    const engine = requireService(req, 'queryEngine', 'Query Engine');
    const result = await engine.semanticSearch({
      query: String(req.body?.query ?? ''),
      selection: req.body?.selection as apiCopilotShared.ApiSelection,
    });
    res.status(200).json({ data: result });
  })
);

/**
 * POST /questions
 * Answer a natural-language question using RAG grounded in indexed content.
 * Requires a selected API (Req 4.7) and validates the question length (Req 4.8).
 */
router.post(
  '/questions',
  writeLimiter,
  createRoleGuard(),
  wrap(async (req, res) => {
    const engine = requireService(req, 'queryEngine', 'Query Engine');
    const answer = await engine.ask({
      question: String(req.body?.question ?? ''),
      selection: (req.body?.selection ?? null) as apiCopilotShared.ApiSelection | null,
      requester: requesterOf(req),
    });
    res.status(200).json({ data: answer });
  })
);

export default router;
