/**
 * Usage Analytics — Service
 *
 * Event-sourced usage counters fed by the product event bus, plus the
 * per-workspace analytics dashboard.
 *
 * Business rules:
 * - Subscribe to `UsageEvent`s emitted by the Query, Execution, and
 *   Code-generation flows; each event is tagged with a workspace id, type, and
 *   timestamp (Req 16.1).
 * - Retry recording at most {@link MAX_RECORD_ATTEMPTS} times; if all attempts
 *   fail, drop the event without blocking the originating operation (Req 16.2).
 * - The dashboard shows counts within the time budget (Req 16.3), shows zeros
 *   plus a "no usage data" message when empty (Req 16.4), denies unauthorized
 *   readers (Req 16.5), shows consumed query count vs. Plan_Tier limit
 *   (Req 16.6), and on retrieval failure surfaces a retryable load error while
 *   retaining previously recorded events (Req 16.7).
 *
 * Validates: Requirements 16.1, 16.2, 16.3, 16.4, 16.5, 16.6, 16.7
 */

import {
  InMemoryUsageRepository,
  InMemoryProductEventBus,
  InMemoryWorkspaceRepository,
  defaultDateProvider,
  defaultIdGenerator,
} from '../api-copilot-shared';
import type {
  DateProvider,
  IdGenerator,
  ProductEventBus,
  Subscription,
  UsageEvent,
  UsageRepository,
  UserRef,
  WorkspaceRepository,
} from '../api-copilot-shared';
import { decideAccess } from '../workspace';
import type { AccessDecision } from '../workspace';
import {
  MAX_RECORD_ATTEMPTS,
  NO_USAGE_DATA_MESSAGE,
  type DashboardView,
  type QuotaConsumption,
  type QuotaConsumptionProvider,
  type RecordOutcome,
  type UsageAnalyticsDependencies,
  type WorkspaceAuthorizer,
} from './usage-analytics.types';
import { normalizeUsageEvent, tallyCounts } from './usage-analytics.validators';
import { AuthorizationError, DashboardLoadError } from './usage-analytics.errors';

/**
 * Default {@link WorkspaceAuthorizer} adapter. Loads the workspace from a
 * {@link WorkspaceRepository} and evaluates the exact same `decideAccess`
 * decision used by the Workspace service, so the analytics dashboard reuses one
 * isolation rule (Req 16.5). A missing workspace is treated as not-authorized,
 * disclosing nothing about its existence.
 */
export class WorkspaceRepositoryAuthorizer implements WorkspaceAuthorizer {
  constructor(private readonly workspaceRepository: WorkspaceRepository) {}

  async authorize(
    requester: UserRef,
    workspaceId: string
  ): Promise<AccessDecision> {
    const workspace = await this.workspaceRepository.findById(workspaceId);
    if (!workspace) {
      return {
        allowed: false,
        workspaceId,
        userId: requester.userId,
        role: null,
        reason: 'workspace_not_found',
      };
    }
    return decideAccess(workspace, requester);
  }
}

/**
 * In-memory {@link QuotaConsumptionProvider}. Seedable per workspace; returns a
 * configurable default for workspaces that have not been seeded. Suitable for
 * development and tests until an authoritative Plan & Quota adapter is wired
 * (Req 16.6).
 */
export class InMemoryQuotaConsumptionProvider implements QuotaConsumptionProvider {
  private readonly byWorkspace: Map<string, QuotaConsumption> = new Map();

  constructor(
    private readonly defaultConsumption: QuotaConsumption = {
      consumed: 0,
      limit: 100,
      tier: 'starter',
    }
  ) {}

  setConsumption(workspaceId: string, consumption: QuotaConsumption): void {
    this.byWorkspace.set(workspaceId, consumption);
  }

  getConsumption(workspaceId: string): QuotaConsumption {
    return this.byWorkspace.get(workspaceId) ?? { ...this.defaultConsumption };
  }

  clear(): void {
    this.byWorkspace.clear();
  }
}

/**
 * AnalyticsService — records usage events and renders the analytics dashboard.
 */
export class AnalyticsService {
  private readonly idGenerator: IdGenerator;
  private readonly dateProvider: DateProvider;
  private readonly usageRepository: UsageRepository;
  private readonly eventBus: ProductEventBus;
  private readonly authorizer: WorkspaceAuthorizer;
  private readonly quotaProvider: QuotaConsumptionProvider;
  private readonly maxRecordAttempts: number;

  constructor(deps?: Partial<UsageAnalyticsDependencies>) {
    this.idGenerator = deps?.idGenerator ?? defaultIdGenerator;
    this.dateProvider = deps?.dateProvider ?? defaultDateProvider;
    this.usageRepository = deps?.usageRepository ?? new InMemoryUsageRepository();
    this.eventBus = deps?.eventBus ?? new InMemoryProductEventBus();
    this.authorizer =
      deps?.authorizer ??
      new WorkspaceRepositoryAuthorizer(new InMemoryWorkspaceRepository());
    this.quotaProvider =
      deps?.quotaProvider ?? new InMemoryQuotaConsumptionProvider();
    this.maxRecordAttempts = Math.max(1, deps?.maxRecordAttempts ?? MAX_RECORD_ATTEMPTS);
  }

  /**
   * Subscribe to `UsageEvent`s on the product event bus and record each one.
   *
   * Requirement 16.1: Record a usage event tagged with the workspace id, the
   * event type, and the timestamp when an AI query, API execution, or
   * code-generation request occurs.
   *
   * Recording is non-blocking and never throws (Req 16.2), so a failing record
   * attempt cannot disrupt the originating operation or the event bus.
   *
   * @returns a {@link Subscription} handle the caller can use to unsubscribe.
   */
  subscribe(): Subscription {
    return this.eventBus.subscribeUsage(async (event) => {
      await this.recordUsage(event);
    });
  }

  /**
   * Record a single usage event, retrying up to {@link maxRecordAttempts} times.
   *
   * Requirement 16.2: If recording fails, retry up to 3 attempts; if all
   * attempts fail, discard the event without blocking the originating AI query,
   * API execution, or code-generation request. This method therefore never
   * rejects — persistence failures are absorbed and reported via the returned
   * {@link RecordOutcome}.
   */
  async recordUsage(event: UsageEvent): Promise<RecordOutcome> {
    const normalized = normalizeUsageEvent(event, this.dateProvider);

    let attempts = 0;
    while (attempts < this.maxRecordAttempts) {
      attempts += 1;
      try {
        await this.usageRepository.record(normalized);
        return { recorded: true, attempts };
      } catch {
        // Swallow and retry; on the final failed attempt the event is dropped
        // without surfacing an error to the originating operation (Req 16.2).
      }
    }

    return { recorded: false, attempts };
  }

  /**
   * Render the analytics dashboard for a workspace.
   *
   * Requirement 16.5: Deny access to a requester who is not authorized for the
   * workspace, disclosing no usage counts.
   * Requirement 16.3: Display counts of AI queries, API executions, and
   * code-generation requests.
   * Requirement 16.4: When there are no recorded events, display each count as
   * zero and a "no usage data" message.
   * Requirement 16.6: Display the consumed query count vs. the account's
   * Plan_Tier limit.
   * Requirement 16.7: If usage data cannot be retrieved, surface a retryable
   * load error while retaining previously recorded events (retrieval is
   * read-only and mutates nothing).
   *
   * @throws AuthorizationError when the requester is not authorized (Req 16.5).
   * @throws DashboardLoadError when analytics data cannot be retrieved (Req 16.7).
   */
  async dashboard(
    workspaceId: string,
    requester: UserRef
  ): Promise<DashboardView> {
    // Req 16.5: enforce the shared workspace access-control decision first, so
    // an unauthorized reader never sees any usage counts.
    const decision = await this.authorizer.authorize(requester, workspaceId);
    if (!decision.allowed) {
      throw new AuthorizationError(workspaceId, requester.userId);
    }

    // Req 16.7: read-only retrieval; a failure surfaces a retryable error while
    // leaving previously recorded events untouched.
    let events: UsageEvent[];
    try {
      events = await this.usageRepository.list(workspaceId);
    } catch (cause) {
      throw new DashboardLoadError(workspaceId, cause);
    }

    let quota: QuotaConsumption;
    try {
      quota = await this.quotaProvider.getConsumption(workspaceId);
    } catch (cause) {
      throw new DashboardLoadError(workspaceId, cause);
    }

    const counts = tallyCounts(events);
    const totalEvents = events.length;
    const empty = totalEvents === 0;

    return {
      workspaceId,
      counts,
      totalEvents,
      empty,
      // Req 16.4: zeros + message when empty.
      ...(empty ? { message: NO_USAGE_DATA_MESSAGE } : {}),
      quota,
    };
  }
}
