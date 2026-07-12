/**
 * Usage Analytics — Types
 *
 * Domain types for the API Copilot AI Usage Analytics service: event-sourced
 * usage counters fed by the product event bus, and the per-workspace analytics
 * dashboard.
 *
 * Cross-domain primitives (UsageEvent, UsageEventType, UserRef, PlanTier,
 * UsageRepository) and the event-bus contract come from the API Copilot AI
 * product-shared module. The access-control decision is reused from the
 * workspace domain, and the consumed-query-count-vs-tier-limit display depends
 * on the plan-quota domain through an injectable seam (see
 * {@link QuotaConsumptionProvider}) rather than a hard import.
 *
 * Validates: Requirements 16.1, 16.2, 16.3, 16.4, 16.5, 16.6, 16.7
 */

import type {
  BaseServiceDependencies,
  PlanTier,
  ProductEventBus,
  UsageEvent,
  UsageEventType,
  UsageRepository,
  UserRef,
} from '../api-copilot-shared';
import type { AccessDecision } from '../workspace';

// ---------------------------------------------------------------------------
// Recording (Req 16.1, 16.2)
// ---------------------------------------------------------------------------

/**
 * Maximum number of attempts made to record a single usage event before the
 * event is dropped without blocking the originating operation (Req 16.2).
 */
export const MAX_RECORD_ATTEMPTS = 3;

/**
 * Outcome of a {@link AnalyticsService.recordUsage} call. Recording never
 * throws and never blocks the originating AI query, API execution, or
 * code-generation request (Req 16.2); callers may inspect this outcome for
 * observability, but a dropped event is not an error condition for the caller.
 */
export interface RecordOutcome {
  /** True when the event was persisted; false when dropped after all retries. */
  recorded: boolean;
  /** Number of recording attempts made (1..{@link MAX_RECORD_ATTEMPTS}). */
  attempts: number;
}

// ---------------------------------------------------------------------------
// Dashboard (Req 16.3–16.7)
// ---------------------------------------------------------------------------

/** Message shown when a workspace has no recorded usage events (Req 16.4). */
export const NO_USAGE_DATA_MESSAGE = 'No usage data available.';

/** Default budget within which analytics data must be retrievable (Req 16.3, 16.7). */
export const DEFAULT_DASHBOARD_TIMEOUT_MS = 3000;

/**
 * Per-event-type usage counts for a workspace. Keys mirror {@link UsageEventType}
 * so every measurable category is represented, even when its count is zero.
 */
export type UsageCounts = Record<UsageEventType, number>;

/**
 * The current Query_Quota consumption for a workspace, shown on the dashboard
 * as both the consumed count and the account's Plan_Tier limit (Req 16.6).
 */
export interface QuotaConsumption {
  /** AI queries consumed in the current billing period. */
  consumed: number;
  /**
   * The Query_Quota that applies to the workspace's account for the current
   * billing period. `Number.POSITIVE_INFINITY` represents an unlimited quota.
   */
  limit: number;
  /** The account's Plan_Tier, for display alongside the limit. */
  tier: PlanTier;
}

/**
 * The analytics dashboard view for a workspace (Req 16.3, 16.4, 16.6).
 */
export interface DashboardView {
  workspaceId: string;
  /** Counts of AI queries, API executions, and code-generation requests. */
  counts: UsageCounts;
  /** Total recorded usage events for the workspace. */
  totalEvents: number;
  /** True when the workspace has no recorded usage events (Req 16.4). */
  empty: boolean;
  /** Populated with {@link NO_USAGE_DATA_MESSAGE} when `empty` is true. */
  message?: string;
  /** Consumed query count vs. Plan_Tier limit (Req 16.6). */
  quota: QuotaConsumption;
}

// ---------------------------------------------------------------------------
// Injectable seams
// ---------------------------------------------------------------------------

/**
 * Access-control seam. Reuses the workspace domain's {@link AccessDecision} so
 * conversation-history and usage-analytics reads share one isolation rule
 * (Req 14.3, 16.5, 18.4, 18.5). The default adapter resolves the workspace and
 * evaluates the same `decideAccess` decision used by the Workspace service.
 */
export interface WorkspaceAuthorizer {
  authorize(
    requester: UserRef,
    workspaceId: string
  ): AccessDecision | Promise<AccessDecision>;
}

/**
 * Consumed-query-count-vs-tier-limit seam (Req 16.6).
 *
 * Kept as an injectable interface — rather than a hard import of the plan-quota
 * domain — so this service is not blocked on, or tightly coupled to, plan-quota.
 * A production deployment supplies an adapter that resolves the workspace's
 * owning account and reads the authoritative Plan_Tier limit and consumed count
 * from the Plan & Quota service.
 */
export interface QuotaConsumptionProvider {
  getConsumption(
    workspaceId: string
  ): QuotaConsumption | Promise<QuotaConsumption>;
}

// ---------------------------------------------------------------------------
// Dependency injection
// ---------------------------------------------------------------------------

/**
 * Dependencies injected into the {@link AnalyticsService}. Every dependency has
 * an in-memory / default fallback so the service is unit- and property-testable
 * with fakes, matching the repo's `Partial<{Domain}Dependencies>` convention.
 */
export interface UsageAnalyticsDependencies extends BaseServiceDependencies {
  /** Persistence for recorded usage events. */
  usageRepository: UsageRepository;
  /** Product event bus the service subscribes to for `UsageEvent`s (Req 16.1). */
  eventBus: ProductEventBus;
  /** Reuses the workspace access-control decision for dashboard reads (Req 16.5). */
  authorizer: WorkspaceAuthorizer;
  /** Supplies consumed-vs-limit quota for the dashboard (Req 16.6). */
  quotaProvider: QuotaConsumptionProvider;
  /** Maximum recording attempts before dropping an event (Req 16.2). */
  maxRecordAttempts: number;
}

export type { UsageEvent, UsageEventType, UserRef, PlanTier };
