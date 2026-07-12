/**
 * Boundary-guard middleware seats (Task 16.1).
 *
 * These thin adapters give the chain its TLS-termination and consent/residency
 * *seats* and delegate to injected guard implementations. Task 16.1 owns the
 * seats and ships permissive/pass-through defaults; the enforcing logic is
 * delivered by sibling tasks that plug their implementations into the same
 * interfaces:
 *
 *   - {@link TlsTerminator}        → Task 16.4 (TLS 1.3 / cert-pinning egress guard)
 *   - {@link ConsentResidencyGuard} → Task 16.6 (BAA + EU data-residency guards)
 *
 * Requirements: 18.1, 23.3, 25.2
 */

import {
  GATEWAY_ERROR,
  STATUS,
  respondError,
} from '../responses';
import { validationRejection } from '@calorie-cortisol/shared';
import type {
  ConsentResidencyGuard,
  GatewayRequest,
  GuardDecision,
  Middleware,
  NextFn,
  RequestContext,
  TlsDecision,
  TlsTerminator,
} from '../types';

// ---------------------------------------------------------------------------
// TLS termination seat (Task 16.4 plugs in the enforcing implementation)
// ---------------------------------------------------------------------------

/**
 * Pass-through TLS terminator used until Task 16.4 provides the enforcing
 * TLS 1.3 / cert-pinning guard. Accepts every connection.
 */
export class PassthroughTlsTerminator implements TlsTerminator {
  terminate(_request: GatewayRequest): TlsDecision {
    return { accepted: true };
  }
}

export interface TlsMiddlewareOptions {
  readonly terminator: TlsTerminator;
}

/** Build the TLS-termination middleware (first stage of the chain). */
export function tlsMiddleware(options: TlsMiddlewareOptions): Middleware {
  const { terminator } = options;
  return {
    name: 'tls-termination',
    async handle(ctx: RequestContext, next: NextFn) {
      const decision = await terminator.terminate(ctx.request);
      if (!decision.accepted) {
        const error =
          decision.error ??
          validationRejection(
            GATEWAY_ERROR.TLS_REQUIRED,
            'TLS 1.3 with certificate pinning is required.',
          );
        return respondError(STATUS.FORBIDDEN, error);
      }
      return next(ctx);
    },
  };
}

// ---------------------------------------------------------------------------
// Consent / residency seat (Task 16.6 plugs in the enforcing implementation)
// ---------------------------------------------------------------------------

/**
 * Permissive consent/residency guard used until Task 16.6 provides the
 * enforcing BAA + EU-residency implementation. Allows every request.
 */
export class AllowAllConsentResidencyGuard implements ConsentResidencyGuard {
  evaluate(_ctx: RequestContext): GuardDecision {
    return { allowed: true };
  }
}

export interface ConsentResidencyMiddlewareOptions {
  readonly guard: ConsentResidencyGuard;
}

/** Build the consent/residency guard middleware. */
export function consentResidencyMiddleware(
  options: ConsentResidencyMiddlewareOptions,
): Middleware {
  const { guard } = options;
  return {
    name: 'consent-residency',
    async handle(ctx: RequestContext, next: NextFn) {
      const decision = await guard.evaluate(ctx);
      if (!decision.allowed) {
        const error =
          decision.error ??
          validationRejection(
            GATEWAY_ERROR.CONSENT_REQUIRED,
            'Consent or data-residency requirements were not satisfied.',
          );
        return respondError(STATUS.FORBIDDEN, error);
      }
      return next(ctx);
    },
  };
}
