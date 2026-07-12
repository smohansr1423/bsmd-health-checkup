/**
 * Gateway assembly (Task 16.1).
 *
 * Wires the ordered middleware chain described in the design ("API Gateway"):
 *
 *   TLS termination → JWT auth → rate limiter → capacity shedding
 *     → consent/residency guard → request validation → route
 *
 * (Capacity shedding sits with the rate limiter per the design's
 * "token bucket ... capacity shedding" throughput controls, Req 23.3.)
 *
 * Every stage is built from an injected dependency so the whole gateway can be
 * exercised with in-memory fakes in unit tests. Guards owned by sibling tasks
 * default to permissive placeholders here and are replaced by their enforcing
 * implementations when those tasks land:
 *
 *   - TLS terminator            → Task 16.4
 *   - consent/residency guard    → Task 16.6
 *   - audit middleware (outer)   → Task 16.2 (via `outerMiddleware`)
 *
 * Requirements: 18.1, 23.3, 25.2
 */

import { composeChain } from './middleware/chain';
import { authMiddleware } from './middleware/auth';
import { rateLimiterMiddleware } from './middleware/rate-limiter';
import { capacityMiddleware } from './middleware/capacity';
import {
  AllowAllConsentResidencyGuard,
  PassthroughTlsTerminator,
  consentResidencyMiddleware,
  tlsMiddleware,
} from './middleware/guards';
import { validationMiddleware } from './middleware/validation';
import { TableServiceRouter, type ServiceHandlers } from './router/service-router';
import type {
  AuthVerifier,
  CapacityController,
  ConsentResidencyGuard,
  GatewayRequest,
  GatewayResponse,
  Middleware,
  RateLimitStore,
  RequestContext,
  RequestValidator,
  ServiceRouter,
  TlsTerminator,
  WebhookAuthenticator,
} from './types';

/** Injectable dependencies required to assemble the gateway. */
export interface GatewayDependencies {
  /** JWT verifier for the auth stage (Task 16.1). */
  readonly authVerifier: AuthVerifier;
  /** Token-bucket store for the rate-limit stage (Task 16.1). */
  readonly rateLimitStore: RateLimitStore;
  /** Admission controller for capacity shedding (Task 16.1, Req 23.3). */
  readonly capacityController: CapacityController;
  /** Per-service downstream handlers. */
  readonly serviceHandlers: ServiceHandlers;

  /** TLS terminator seat (Task 16.4). Defaults to pass-through. */
  readonly tlsTerminator?: TlsTerminator;
  /** Consent/residency guard seat (Task 16.6). Defaults to allow-all. */
  readonly consentResidencyGuard?: ConsentResidencyGuard;
  /** Optional inbound-webhook (HMAC) authenticator. */
  readonly webhookAuthenticator?: WebhookAuthenticator;
  /** Optional request validator override. Defaults to structural validation. */
  readonly requestValidator?: RequestValidator;
  /** Tokens consumed per request by the rate limiter. Defaults to 1. */
  readonly rateLimitCost?: number;

  /**
   * Cross-cutting middleware composed *outside* the standard stages (runs
   * first/outermost so it observes every allow/deny). This is the seat the
   * audit-logging middleware (Task 16.2) plugs into.
   */
  readonly outerMiddleware?: readonly Middleware[];
}

/** The assembled gateway: a single entry point plus introspection. */
export interface Gateway {
  /** Handle one normalized request through the full chain. */
  handle(request: GatewayRequest): Promise<GatewayResponse>;
  /** Ordered stage names (for introspection / tests). */
  readonly stageNames: readonly string[];
  readonly router: ServiceRouter;
}

/**
 * Build the ordered stage list (excluding any `outerMiddleware`). Exposed so
 * tests can assert the canonical ordering.
 */
export function buildStages(deps: GatewayDependencies): Middleware[] {
  const tlsTerminator = deps.tlsTerminator ?? new PassthroughTlsTerminator();
  const consentResidencyGuard =
    deps.consentResidencyGuard ?? new AllowAllConsentResidencyGuard();

  return [
    tlsMiddleware({ terminator: tlsTerminator }),
    authMiddleware({
      verifier: deps.authVerifier,
      ...(deps.webhookAuthenticator
        ? { webhookAuthenticator: deps.webhookAuthenticator }
        : {}),
    }),
    rateLimiterMiddleware({
      store: deps.rateLimitStore,
      ...(deps.rateLimitCost !== undefined ? { cost: deps.rateLimitCost } : {}),
    }),
    capacityMiddleware({ controller: deps.capacityController }),
    consentResidencyMiddleware({ guard: consentResidencyGuard }),
    validationMiddleware(
      deps.requestValidator ? { validator: deps.requestValidator } : {},
    ),
  ];
}

/** Create a fresh {@link RequestContext} for an inbound request. */
export function createContext(request: GatewayRequest): RequestContext {
  return {
    request,
    auth: null,
    route: null,
    startedAt: Date.now(),
    attributes: {},
  };
}

/** Assemble the gateway from its injected dependencies. */
export function buildGateway(deps: GatewayDependencies): Gateway {
  const router = new TableServiceRouter(deps.serviceHandlers);
  const stages = [...(deps.outerMiddleware ?? []), ...buildStages(deps)];
  const run = composeChain(stages, (ctx) => router.route(ctx));

  return {
    stageNames: stages.map((m) => m.name),
    router,
    handle(request: GatewayRequest): Promise<GatewayResponse> {
      return run(createContext(request));
    },
  };
}
