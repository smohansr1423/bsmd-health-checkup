/**
 * API Copilot AI — Auth Assistant Routes
 *
 * Lists supported authentication schemes and registers target-API credentials
 * (stored encrypted at rest). Token material is never exposed over HTTP — the
 * Execution Engine consumes it internally — so no endpoint returns decrypted
 * credentials (Req 6.8). Protected by the gateway auth middleware and an
 * authenticated role guard; redacted auth errors map to 401 (Req 6.3, 6.6–6.9).
 *
 * Validates: Requirements 6.1, 6.3, 6.6, 6.7, 6.8, 6.9
 */

import { Router } from 'express';
import type { apiCopilotAuthAssistant } from '@health-checkup/services';
import { RATE_LIMIT_PRESETS } from '../types';
import { createRateLimiter, createRoleGuard } from '../middleware';
import { requireService, wrap } from './api-copilot-support';

const router = Router();

const readLimiter = createRateLimiter(RATE_LIMIT_PRESETS.read);
const writeLimiter = createRateLimiter({ ...RATE_LIMIT_PRESETS.sensitive, keyPrefix: 'copilot:auth-assistant:write' });

/**
 * GET /schemes
 * List the authentication schemes the Auth Assistant supports (Req 6.1).
 */
router.get(
  '/schemes',
  readLimiter,
  createRoleGuard(),
  wrap(async (req, res) => {
    const assistant = requireService(req, 'authAssistant', 'Auth Assistant');
    res.status(200).json({ data: { schemes: assistant.supportedSchemes() } });
  })
);

/**
 * POST /credentials
 * Register a target-API credential, stored encrypted at rest. The response
 * carries only the non-secret reference and ciphertext metadata — never the
 * plaintext credential (Req 6.8).
 */
router.post(
  '/credentials',
  writeLimiter,
  createRoleGuard(),
  wrap(async (req, res) => {
    const assistant = requireService(req, 'authAssistant', 'Auth Assistant');
    const stored = await assistant.registerCredential(
      req.body as apiCopilotAuthAssistant.RegisterCredentialInput
    );
    res.status(201).json({
      data: {
        credentialId: stored.credentialId,
        targetApiRef: stored.targetApiRef,
        scheme: stored.scheme,
      },
    });
  })
);

export default router;
