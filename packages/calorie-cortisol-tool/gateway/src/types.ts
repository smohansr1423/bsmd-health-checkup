/**
 * Core gateway types and extension-point interfaces (Task 16.1).
 *
 * The API gateway runs a composable middleware chain per the design
 * ("API Gateway"):
 *
 *   TLS termination → JWT auth → rate limiter (+ capacity shedding)
 *     → consent/residency guard → request validation → route
 *
 * Every stage is a small, independently testable {@link Middleware} with its
 * dependencies injected, so unit tests can substitute in-memory fakes. Guards
 * owned by sibling tasks are represented here as **interfaces / extension
 * points** only — their concrete implementations land in:
 *
 *   - Task 16.2  Audit logging            → {@link AuditSink}
 *   - Task 16.4  TLS / certificate pinning → {@link TlsTerminator}
 *   - Task 16.6  BAA / EU-residency guard   → {@link ConsentResidencyGuard}
 *   - Task 16.9  Health-check subsystem     → {@link HealthChecker}
 *
 * Requirements: 18.1, 23.3, 25.2
 */

import type { ErrorContract } from '@calorie-cortisol/shared';

/** The six backend microservices the gateway fronts (design: Microservices). */
export type ServiceName =
  | 'food-vision'
  | 'nutrition-lookup'
  | 'cortisol-data'
  | 'insights-ml'
  | 'user-profile'
  | 'notification';

/** All service names, useful for iteration and validation. */
export const SERVICE_NAMES: readonly ServiceName[] = [
  'food-vision',
  'nutrition-lookup',
  'cortisol-data',
  'insights-ml',
  'user-profile',
  'notification',
];

/**
 * How a request reaches the gateway:
 *  - `graphql`  — the primary client API (aggregated reads / mutations).
 *  - `rest`     — authenticated client REST calls (e.g. `POST /recognize`).
 *  - `webhook`  — inbound third-party REST callbacks (HMAC-verified, no JWT).
 */
export type RequestKind = 'graphql' | 'rest' | 'webhook';

/** A single top-level GraphQL operation extracted from the request document. */
export interface GraphQLOperation {
  readonly operationType: 'query' | 'mutation';
  /** Top-level field name, e.g. `cortisolTrend` or `updateConsent`. */
  readonly fieldName: string;
  readonly variables?: Readonly<Record<string, unknown>>;
}

/** Transport / connection metadata surfaced to the TLS-termination stage. */
export interface ConnectionMetadata {
  readonly tlsVersion?: string;
  readonly certPinned?: boolean;
  readonly remoteIp?: string;
}

/** A normalized inbound request handed to the middleware chain. */
export interface GatewayRequest {
  readonly id: string;
  readonly kind: RequestKind;
  readonly method: string;
  /** Request path, e.g. `/graphql`, `/recognize`, `/webhooks/lab-results`. */
  readonly path: string;
  readonly headers: Readonly<Record<string, string>>;
  /** Present when `kind === 'graphql'`. */
  readonly graphql?: GraphQLOperation;
  readonly body?: unknown;
  readonly connection?: ConnectionMetadata;
}

/** The response envelope produced by the chain. */
export interface GatewayResponse {
  /** HTTP-style status code. */
  readonly status: number;
  readonly ok: boolean;
  /** Present on success. */
  readonly body?: unknown;
  /** Present on failure; the shared structured error contract. */
  readonly error?: ErrorContract;
  readonly headers?: Readonly<Record<string, string>>;
}

// ---------------------------------------------------------------------------
// Authentication (owned by this task — JWT verification)
// ---------------------------------------------------------------------------

/** Identity + authorization facts resolved from a verified token. */
export interface AuthPrincipal {
  readonly userId: string;
  readonly familyAccountId?: string;
  readonly roles: readonly string[];
  /** Data-residency region of the principal (used by the residency guard). */
  readonly region?: string;
  /** Consent categories the principal has opted into (used by consent guard). */
  readonly consentedCategories?: readonly string[];
}

/** Result of verifying a bearer token. */
export interface AuthVerification {
  readonly valid: boolean;
  readonly principal?: AuthPrincipal;
  readonly reason?: string;
}

/**
 * Injectable JWT verifier. Unit tests provide an in-memory fake; production
 * wires an OAuth2/JWKS-backed verifier (design: AuthN).
 */
export interface AuthVerifier {
  verify(token: string): Promise<AuthVerification> | AuthVerification;
}

/** Authenticated context attached to the request once auth succeeds. */
export interface AuthContext {
  readonly principal: AuthPrincipal;
  readonly token: string;
}

/**
 * Extension point (future) for inbound webhook authentication (HMAC). Task
 * 16.1 leaves webhook signature verification to the downstream Cortisol Data
 * Service; when a `WebhookAuthenticator` is injected the auth stage will defer
 * to it instead of passing through.
 */
export interface WebhookAuthenticator {
  authenticate(request: GatewayRequest): Promise<AuthVerification> | AuthVerification;
}

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------

/** Decision returned by the rate-limit store for a single request. */
export interface RateLimitDecision {
  readonly allowed: boolean;
  readonly limit: number;
  readonly remaining: number;
  readonly retryAfterSeconds?: number;
}

/**
 * Injectable per-user / per-IP token-bucket store (design: Redis token bucket).
 * Unit tests use an in-memory fake.
 */
export interface RateLimitStore {
  consume(key: string, cost?: number): Promise<RateLimitDecision> | RateLimitDecision;
}

// ---------------------------------------------------------------------------
// Capacity shedding (Req 23.3)
// ---------------------------------------------------------------------------

/**
 * The outcome of asking the capacity controller to admit a request. When
 * `admitted` is false the request is shed (rejected or queued) with a
 * capacity-exceeded response; already-admitted work is never dropped.
 */
export interface CapacityAdmission {
  readonly admitted: boolean;
  /** True when the excess request was queued rather than outright rejected. */
  readonly queued: boolean;
  /** Release the admission slot; must be called once the request completes. */
  release(): void;
}

/**
 * Injectable admission controller enforcing the configured concurrency /
 * throughput ceiling. Excess load is rejected or queued (Req 23.3) while
 * in-progress admitted requests are preserved.
 */
export interface CapacityController {
  tryAdmit(request: GatewayRequest): Promise<CapacityAdmission> | CapacityAdmission;
}

// ---------------------------------------------------------------------------
// Consent / residency guard (extension point — Task 16.6)
// ---------------------------------------------------------------------------

/** Allow/deny decision from a boundary guard, with a structured error on deny. */
export interface GuardDecision {
  readonly allowed: boolean;
  readonly error?: ErrorContract;
}

/**
 * Consent / EU-residency guard checked before routing (design middleware
 * chain). Task 16.1 wires the stage and ships a permissive placeholder; the
 * enforcing BAA / residency implementation is Task 16.6.
 */
export interface ConsentResidencyGuard {
  evaluate(ctx: RequestContext): Promise<GuardDecision> | GuardDecision;
}

// ---------------------------------------------------------------------------
// TLS termination (extension point — Task 16.4)
// ---------------------------------------------------------------------------

/** Decision from the TLS-termination / cert-pinning stage. */
export interface TlsDecision {
  readonly accepted: boolean;
  readonly error?: ErrorContract;
}

/**
 * TLS-termination + certificate-pinning stage (design: TLS 1.3 + cert pinning,
 * Req 25.2/25.3). Task 16.1 provides the chain seat and a pass-through
 * placeholder; the enforcing implementation is Task 16.4.
 */
export interface TlsTerminator {
  terminate(request: GatewayRequest): Promise<TlsDecision> | TlsDecision;
}

// ---------------------------------------------------------------------------
// Request validation
// ---------------------------------------------------------------------------

/** Outcome of validating a request at the boundary. */
export interface ValidationOutcome {
  readonly valid: boolean;
  readonly error?: ErrorContract;
}

/** Injectable request validator (structural / schema validation). */
export interface RequestValidator {
  validate(ctx: RequestContext): ValidationOutcome | Promise<ValidationOutcome>;
}

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

/** Where a request resolved to. */
export interface RouteResolution {
  readonly service: ServiceName;
  /** Logical operation identifier (GraphQL field name or REST path). */
  readonly operation: string;
  readonly kind: RequestKind;
}

/** A downstream service handler (injectable; in-memory fake in tests). */
export type ServiceHandler = (
  ctx: RequestContext,
) => Promise<GatewayResponse> | GatewayResponse;

/**
 * Resolves a request to a backend service and dispatches to it. Acts as the
 * terminal step of the middleware chain.
 */
export interface ServiceRouter {
  resolve(request: GatewayRequest): RouteResolution | null;
  route(ctx: RequestContext): Promise<GatewayResponse>;
}

// ---------------------------------------------------------------------------
// Audit sink (extension point — Task 16.2)
// ---------------------------------------------------------------------------

/** A single audit event emitted at chain boundaries. */
export interface AuditEvent {
  readonly requestId: string;
  readonly actorId: string | null;
  readonly action: string;
  readonly path: string;
  readonly outcome: 'allowed' | 'denied' | 'error';
  readonly timestamp: string;
  readonly reason?: string;
}

/**
 * Append-only audit sink (design: audit log, Req 25.6/25.7). Task 16.1 exposes
 * the hook and defaults to a no-op sink; the durable implementation is Task
 * 16.2.
 */
export interface AuditSink {
  record(event: AuditEvent): void | Promise<void>;
}

// ---------------------------------------------------------------------------
// Health checking (extension point — Task 16.9)
// ---------------------------------------------------------------------------

/** Health status for a single service. */
export interface ServiceHealth {
  readonly service: ServiceName;
  readonly healthy: boolean;
  readonly checkedAt: string;
}

/**
 * Per-service health-check probe (design: health checks every 60s, Req 24).
 * Interface only in Task 16.1; the monitoring subsystem is Task 16.9.
 */
export interface HealthChecker {
  check(service: ServiceName): Promise<ServiceHealth> | ServiceHealth;
}

// ---------------------------------------------------------------------------
// Middleware & chain
// ---------------------------------------------------------------------------

/** Mutable per-request context threaded through the chain. */
export interface RequestContext {
  readonly request: GatewayRequest;
  /** Set by the auth stage; null until authenticated. */
  auth: AuthContext | null;
  /** Set by the routing stage; null until resolved. */
  route: RouteResolution | null;
  readonly startedAt: number;
  /** Free-form extension slots for future stages. */
  readonly attributes: Record<string, unknown>;
}

/** Invokes the next middleware in the chain (or the terminal handler). */
export type NextFn = (ctx: RequestContext) => Promise<GatewayResponse>;

/**
 * A composable, individually testable middleware unit. `name` makes the
 * assembled chain introspectable (and its ordering assertable in tests).
 */
export interface Middleware {
  readonly name: string;
  handle(ctx: RequestContext, next: NextFn): Promise<GatewayResponse>;
}
