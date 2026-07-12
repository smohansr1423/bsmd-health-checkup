/**
 * JWT authentication middleware (Task 16.1).
 *
 * Extracts the bearer token, verifies it with the injected {@link AuthVerifier}
 * (see {@link HmacJwtVerifier}), and attaches an {@link AuthContext} to the
 * request context. On failure it short-circuits with a 401 carrying the shared
 * structured error contract.
 *
 * Inbound webhooks (`kind: 'webhook'`) are HMAC-verified downstream by the
 * owning service rather than JWT-authenticated, so this stage passes them
 * through untouched (optionally deferring to an injected
 * {@link WebhookAuthenticator} when one is provided).
 *
 * Requirements: 18.1, 25.2
 */

import { GATEWAY_ERROR, STATUS, respondError } from '../responses';
import { validationRejection } from '@calorie-cortisol/shared';
import type {
  AuthVerifier,
  Middleware,
  NextFn,
  RequestContext,
  WebhookAuthenticator,
} from '../types';

export interface AuthMiddlewareOptions {
  readonly verifier: AuthVerifier;
  /** Optional inbound-webhook authenticator (HMAC); passthrough if absent. */
  readonly webhookAuthenticator?: WebhookAuthenticator;
}

/** Extract a bearer token from the `Authorization` header (case-insensitive). */
export function extractBearerToken(
  headers: Readonly<Record<string, string>>,
): string | null {
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === 'authorization') {
      const match = /^Bearer\s+(.+)$/i.exec(value.trim());
      return match ? match[1].trim() : null;
    }
  }
  return null;
}

function unauthenticated(reason: string) {
  return respondError(
    STATUS.UNAUTHORIZED,
    validationRejection(GATEWAY_ERROR.UNAUTHENTICATED, `Authentication required: ${reason}.`),
  );
}

/** Build the JWT auth middleware. */
export function authMiddleware(options: AuthMiddlewareOptions): Middleware {
  const { verifier, webhookAuthenticator } = options;
  return {
    name: 'auth',
    async handle(ctx: RequestContext, next: NextFn) {
      if (ctx.request.kind === 'webhook') {
        if (webhookAuthenticator) {
          const result = await webhookAuthenticator.authenticate(ctx.request);
          if (!result.valid) {
            return unauthenticated(result.reason ?? 'invalid webhook signature');
          }
        }
        // Webhook signature enforcement is owned by the downstream service.
        return next(ctx);
      }

      const token = extractBearerToken(ctx.request.headers);
      if (!token) {
        return unauthenticated('missing bearer token');
      }

      const verification = await verifier.verify(token);
      if (!verification.valid || !verification.principal) {
        return unauthenticated(verification.reason ?? 'invalid token');
      }

      ctx.auth = { principal: verification.principal, token };
      return next(ctx);
    },
  };
}
