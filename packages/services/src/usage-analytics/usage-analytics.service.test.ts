/**
 * Usage Analytics — Service unit tests
 *
 * Example-based coverage of recording (retry + non-blocking) and the dashboard
 * (counts, empty state, authorization, quota, and load failure).
 *
 * Validates: Requirements 16.1, 16.2, 16.3, 16.4, 16.5, 16.6, 16.7
 */

import {
  InMemoryProductEventBus,
  InMemoryUsageRepository,
  InMemoryWorkspaceRepository,
} from '../api-copilot-shared';
import type {
  UsageEvent,
  UsageRepository,
  UserRef,
  Workspace,
} from '../api-copilot-shared';
import {
  AnalyticsService,
  InMemoryQuotaConsumptionProvider,
  WorkspaceRepositoryAuthorizer,
} from './usage-analytics.service';
import { AuthorizationError, DashboardLoadError } from './usage-analytics.errors';
import { MAX_RECORD_ATTEMPTS, NO_USAGE_DATA_MESSAGE } from './usage-analytics.types';

const WORKSPACE_ID = 'ws-1';
const OWNER: UserRef = { userId: 'u-owner', accountId: 'acct-1' };
const MEMBER: UserRef = { userId: 'u-member', accountId: 'acct-2' };
const OUTSIDER: UserRef = { userId: 'u-outsider', accountId: 'acct-3' };

function seededWorkspaceRepo(): InMemoryWorkspaceRepository {
  const repo = new InMemoryWorkspaceRepository();
  const workspace: Workspace = {
    workspaceId: WORKSPACE_ID,
    ownerAccountId: OWNER.accountId,
    name: 'Analytics WS',
    memberUserIds: [MEMBER.userId],
  };
  // Seed synchronously via the async API (resolves immediately for in-memory).
  void repo.save(workspace);
  return repo;
}

function event(type: UsageEvent['type'], workspaceId = WORKSPACE_ID): UsageEvent {
  return { workspaceId, type, timestamp: new Date('2024-01-01T00:00:00Z') };
}

function buildService(overrides?: {
  usageRepository?: UsageRepository;
  eventBus?: InMemoryProductEventBus;
  quotaProvider?: InMemoryQuotaConsumptionProvider;
}): {
  service: AnalyticsService;
  bus: InMemoryProductEventBus;
  usageRepository: UsageRepository;
  quotaProvider: InMemoryQuotaConsumptionProvider;
} {
  const bus = overrides?.eventBus ?? new InMemoryProductEventBus();
  const usageRepository = overrides?.usageRepository ?? new InMemoryUsageRepository();
  const quotaProvider =
    overrides?.quotaProvider ?? new InMemoryQuotaConsumptionProvider();
  const authorizer = new WorkspaceRepositoryAuthorizer(seededWorkspaceRepo());
  const service = new AnalyticsService({
    usageRepository,
    eventBus: bus,
    authorizer,
    quotaProvider,
  });
  return { service, bus, usageRepository, quotaProvider };
}

describe('AnalyticsService.recordUsage (Req 16.1, 16.2)', () => {
  it('records a usage event tagged with workspace id, type, and timestamp', async () => {
    const { service, usageRepository } = buildService();

    const outcome = await service.recordUsage(event('ai_query'));

    expect(outcome).toEqual({ recorded: true, attempts: 1 });
    const stored = await usageRepository.list(WORKSPACE_ID);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ workspaceId: WORKSPACE_ID, type: 'ai_query' });
    expect(stored[0].timestamp).toBeInstanceOf(Date);
  });

  it('defaults a missing timestamp from the injected clock (Req 16.1)', async () => {
    const fixed = new Date('2030-06-01T12:00:00Z');
    const usageRepository = new InMemoryUsageRepository();
    const service = new AnalyticsService({
      usageRepository,
      dateProvider: () => fixed,
    });

    await service.recordUsage({
      workspaceId: WORKSPACE_ID,
      type: 'api_execution',
      // Force an invalid timestamp to exercise normalization.
      timestamp: new Date('not-a-date'),
    });

    const stored = await usageRepository.list(WORKSPACE_ID);
    expect(stored[0].timestamp).toEqual(fixed);
  });

  it('retries up to MAX_RECORD_ATTEMPTS then drops without throwing (Req 16.2)', async () => {
    let calls = 0;
    const failing: UsageRepository = {
      async record() {
        calls += 1;
        throw new Error('write failed');
      },
      async list() {
        return [];
      },
    };
    const service = new AnalyticsService({ usageRepository: failing });

    const outcome = await service.recordUsage(event('code_generation'));

    expect(outcome).toEqual({ recorded: false, attempts: MAX_RECORD_ATTEMPTS });
    expect(calls).toBe(MAX_RECORD_ATTEMPTS);
  });

  it('succeeds on a later attempt when an earlier attempt fails (Req 16.2)', async () => {
    let calls = 0;
    const flaky: UsageRepository = {
      async record() {
        calls += 1;
        if (calls < 2) {
          throw new Error('transient');
        }
      },
      async list() {
        return [];
      },
    };
    const service = new AnalyticsService({ usageRepository: flaky });

    const outcome = await service.recordUsage(event('ai_query'));

    expect(outcome).toEqual({ recorded: true, attempts: 2 });
  });

  it('subscribes to the event bus and records published events without blocking (Req 16.1, 16.2)', async () => {
    const { service, bus, usageRepository } = buildService();
    const sub = service.subscribe();

    await bus.publishUsage(event('ai_query'));
    await bus.publishUsage(event('api_execution'));

    const stored = await usageRepository.list(WORKSPACE_ID);
    expect(stored.map((e) => e.type)).toEqual(['ai_query', 'api_execution']);
    sub.unsubscribe();
  });

  it('a failing recorder does not block the originating publish (Req 16.2)', async () => {
    const failing: UsageRepository = {
      async record() {
        throw new Error('down');
      },
      async list() {
        return [];
      },
    };
    const bus = new InMemoryProductEventBus();
    const service = new AnalyticsService({ usageRepository: failing, eventBus: bus });
    service.subscribe();

    // Must resolve, not reject, even though recording fails every attempt.
    await expect(bus.publishUsage(event('ai_query'))).resolves.toBeUndefined();
  });
});

describe('AnalyticsService.dashboard (Req 16.3–16.7)', () => {
  it('displays counts matching recorded usage for authorized owner and member (Req 16.3)', async () => {
    const { service } = buildService();
    await service.recordUsage(event('ai_query'));
    await service.recordUsage(event('ai_query'));
    await service.recordUsage(event('api_execution'));
    await service.recordUsage(event('code_generation'));

    const ownerView = await service.dashboard(WORKSPACE_ID, OWNER);
    expect(ownerView.counts).toEqual({
      ai_query: 2,
      api_execution: 1,
      code_generation: 1,
    });
    expect(ownerView.totalEvents).toBe(4);
    expect(ownerView.empty).toBe(false);
    expect(ownerView.message).toBeUndefined();

    const memberView = await service.dashboard(WORKSPACE_ID, MEMBER);
    expect(memberView.counts).toEqual(ownerView.counts);
  });

  it('shows zeros and a no-usage message when empty (Req 16.4)', async () => {
    const { service } = buildService();

    const view = await service.dashboard(WORKSPACE_ID, OWNER);

    expect(view.empty).toBe(true);
    expect(view.totalEvents).toBe(0);
    expect(view.counts).toEqual({ ai_query: 0, api_execution: 0, code_generation: 0 });
    expect(view.message).toBe(NO_USAGE_DATA_MESSAGE);
  });

  it('denies an unauthorized reader and discloses no counts (Req 16.5)', async () => {
    const { service } = buildService();
    await service.recordUsage(event('ai_query'));

    await expect(service.dashboard(WORKSPACE_ID, OUTSIDER)).rejects.toBeInstanceOf(
      AuthorizationError
    );
  });

  it('shows consumed query count vs. the Plan_Tier limit (Req 16.6)', async () => {
    const quotaProvider = new InMemoryQuotaConsumptionProvider();
    quotaProvider.setConsumption(WORKSPACE_ID, {
      consumed: 42,
      limit: 100,
      tier: 'starter',
    });
    const { service } = buildService({ quotaProvider });

    const view = await service.dashboard(WORKSPACE_ID, OWNER);

    expect(view.quota).toEqual({ consumed: 42, limit: 100, tier: 'starter' });
  });

  it('surfaces a retryable load error and retains events when retrieval fails (Req 16.7)', async () => {
    const backing = new InMemoryUsageRepository();
    await backing.record(event('ai_query'));
    let failNext = true;
    const flakyList: UsageRepository = {
      record: (e) => backing.record(e),
      async list(workspaceId: string) {
        if (failNext) {
          failNext = false;
          throw new Error('read timeout');
        }
        return backing.list(workspaceId);
      },
    };
    const service = new AnalyticsService({
      usageRepository: flakyList,
      authorizer: new WorkspaceRepositoryAuthorizer(seededWorkspaceRepo()),
    });

    await expect(service.dashboard(WORKSPACE_ID, OWNER)).rejects.toMatchObject({
      name: 'DashboardLoadError',
      retryable: true,
    });

    // Events are retained; a subsequent load succeeds (Req 16.7).
    const view = await service.dashboard(WORKSPACE_ID, OWNER);
    expect(view.totalEvents).toBe(1);
  });

  it('DashboardLoadError carries the workspace id and retry affordance', () => {
    const err = new DashboardLoadError(WORKSPACE_ID);
    expect(err.workspaceId).toBe(WORKSPACE_ID);
    expect(err.retryable).toBe(true);
  });
});
