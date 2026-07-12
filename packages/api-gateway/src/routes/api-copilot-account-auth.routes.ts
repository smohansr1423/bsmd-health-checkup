/**
 * API Copilot AI — Account Auth Routes
 *
 * Public sign-up and sign-in for API Copilot AI accounts. These endpoints
 * establish authentication and therefore run before the gateway auth
 * middleware; the remaining API Copilot routes are protected. Errors map per
 * the design's error table (Req 13.2 → 409, 13.3 → 400, 13.6 → 423, invalid
 * credentials → 401).
 *
 * Validates: Requirements 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 18.1
 */

import { Router } from 'express';
import type { accountAuth } from '@health-checkup/services';
import { RATE_LIMIT_PRESETS } from '../types';
import { createRateLimiter } from '../middleware';
import { requireService, wrap } from './api-copilot-support';

const router = Router();

// Sensitive rate limits for credential endpoints (auth surface).
const signUpLimiter = createRateLimiter({ ...RATE_LIMIT_PRESETS.sensitive, keyPrefix: 'copilot:signup' });
const signInLimiter = createRateLimiter({ ...RATE_LIMIT_PRESETS.sensitive, keyPrefix: 'copilot:signin' });

/**
 * POST /sign-up
 * Create a new API Copilot account (Req 13.1–13.3).
 */
router.post(
  '/sign-up',
  signUpLimiter,
  wrap(async (req, res) => {
    const service = requireService(req, 'accountAuthService', 'Account Auth service');
    const account = await service.signUp(req.body as accountAuth.SignUpRequest);
    // Never echo the password hash back to the client.
    res.status(201).json({
      data: { accountId: account.accountId, email: account.email, tier: account.tier },
    });
  })
);

/**
 * POST /sign-in
 * Authenticate and establish a session (Req 13.4–13.6).
 */
router.post(
  '/sign-in',
  signInLimiter,
  wrap(async (req, res) => {
    const service = requireService(req, 'accountAuthService', 'Account Auth service');
    const session = await service.signIn(req.body as accountAuth.SignInRequest);
    res.status(200).json({ data: session });
  })
);

export default router;
