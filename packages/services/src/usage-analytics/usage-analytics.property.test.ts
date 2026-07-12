/**
 * Usage Analytics Service — Property-Based Tests
 * Uses fast-check to validate universal correctness properties from the design document.
 *
 * These property tests complement the example-based unit tests in
 * `usage-analytics.service.test.ts`: they exercise the public API
 * (`AnalyticsService.recordUsage`, `AnalyticsService.subscribe`,
 * `AnalyticsService.dashboard`) across a broad, generated input space using
 * deterministic id/clock injection, in-memory + failing/flaky repository fakes,
 * an in-memory product event bus, a WorkspaceAuthorizer fake, and an in-memory
 * quota-consumption provider.
 *
 * Feature: api-copilot-ai
 * Validates: Requirements 16.1, 16.2, 16.3, 16.6, 16.7
 */

import * as fc from 'fast-check';

import {
  AnalyticsService,
  InMemoryQuotaConsumptionProvider,
} from './index';
import { AuthorizationError, DashboardLoadError } from './usage-analytics.errors';
import { MAX_RECORD_ATTEMPTS } from './usage-analytics.types';
import type { WorkspaceAuthorizer, QuotaConsumption } from './index';
import {
  InMemoryProductEventBus,
  InMemoryUsageRepository,
} from '../api-copilot-shared';
import type {
  UsageEvent,
  UsageEventType,
  UsageRepository,
  UserRef,
  PlanTier,
} from '../api-copilot-shared';
import type { AccessDecision } from '../workspace';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const WORKSPACE_ID = 'ws-analytics';
const REQUESTER: UserRef = { userId: 'u-owner', accountId: 'acct-1' };

const USAGE_EVENT_TYPES: readonly UsageEventType[] = [
  'ai_query',
  'api_execution',
  'code_generation',
];

/** A deterministic clock so recorded/normalized events are stable. */
function fixedDateProvider(): () => Date {
  return () => new Date('2024-01-01T00:00:00.000Z');
}

/** A deterministic, monotonically increasing id generator. */
function makeIdGenerator(): () => string {
  let counter = 0;
  return () => {
    counter += 1;
    return `evt_${counter}`;
  };
}

/** A WorkspaceAuthorizer fake that grants access to every requester. */
function allowingAuthorizer(): WorkspaceAuthorizer {
  return {
    authorize: (requester: UserRef, workspaceId: string): AccessDecision => ({
      allowed: true,
      workspaceId,
      userId: requester.userId,
      role: 'owner',
    }),
  };
}

/**
 * A UsageRepository fake whose `record` always fails, so every recording
 * attempt exhausts the bounded-retry budget (Property 45). `list` returns the
 * events it never managed to store — always empty.
 */
function alwaysFailingRepository(counter: { calls: number }): UsageRepository {
  return {
    async record() {
      counter.calls += 1;
      throw new Error('write failed');
    },
    async list() {
      return [];
    },
  };
}

/**
 * A flaky UsageRepository fake that fails the first `failuresBeforeSuccess`
 * record attempts for a given event and then succeeds, delegating persistence
 * to a real in-memory backing store. Used to show recording still succeeds
 * within the retry budget without blocking (Property 45).
 */
function flakyRecordingRepository(
  failuresBeforeSuccess: number
): { repo: UsageRepository; attemptsPerEvent: number[] } {
  const backing = new InMemoryUsageRepository();
  const attemptsPerEvent: number[] = [];
  let attemptsForCurrent = 0;
  const repo: UsageRepository = {
    async record(e: UsageEvent) {
      attemptsForCurrent += 1;
      if (attemptsForCurrent <= failuresBeforeSuccess) {
        throw new Error('transient');
      }
      await backing.record(e);
      attemptsPerEvent.push(attemptsForCurrent);
      attemptsForCurrent = 0;
    },
    async list(workspaceId: string) {
      return backing.list(workspaceId);
    },
  };
  return { repo, attemptsPerEvent };
}

/**
 * A UsageRepository fake whose `list` fails a configurable number of times
 * before delegating to a real in-memory backing store, so previously recorded
 * events survive a dashboard load failure (Property 47).
 */
function loadFailingRepository(listFailures: number): UsageRepository {
  const backing = new InMemoryUsageRepository();
  let remainingFailures = listFailures;
  return {
    async record(e: UsageEvent) {
      await backing.record(e);
    },
    async list(workspaceId: string) {
      if (remainingFailures > 0) {
        remainingFailures -= 1;
        throw new Error('read timeout');
      }
      return backing.list(workspaceId);
    },
  };
}

/** Arbitrary for a single usage event scoped to the fixed workspace. */
function usageEventArb(): fc.Arbitrary<UsageEvent> {
  return fc.record({
    workspaceId: fc.constant(WORKSPACE_ID),
    type: fc.constantFrom(...USAGE_EVENT_TYPES),
    timestamp: fc.constant(new Date('2024-01-01T00:00:00.000Z')),
  });
}

// ─── Property 45 ─────────────────────────────────────────────────────────────
// Feature: api-copilot-ai, Property 45: Analytics recording is bounded-retry
// and non-blocking — For any usage event whose recording fails, the system
// retries at most 3 times and then drops the event, without blocking or
// failing the originating query, execution, or code-generation request.
// Validates: Requirements 16.2
describe('Property 45: Analytics recording is bounded-retry and non-blocking', () => {
  it('retries at most MAX_RECORD_ATTEMPTS then drops the event without throwing', async () => {
    await fc.assert(
      fc.asyncProperty(usageEventArb(), async (event) => {
        const counter = { calls: 0 };
        const service = new AnalyticsService({
          usageRepository: alwaysFailingRepository(counter),
          dateProvider: fixedDateProvider(),
          idGenerator: makeIdGenerator(),
        });

        // recordUsage must resolve (never reject) even when persistence fails.
        const outcome = await service.recordUsage(event);

        expect(outcome.recorded).toBe(false);
        // Bounded retry: exactly MAX_RECORD_ATTEMPTS attempts, no more.
        expect(outcome.attempts).toBe(MAX_RECORD_ATTEMPTS);
        expect(counter.calls).toBe(MAX_RECORD_ATTEMPTS);
        expect(outcome.attempts).toBeLessThanOrEqual(MAX_RECORD_ATTEMPTS);
      })
    );
  });

  it('does not block or fail the originating publish when recording always fails', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(usageEventArb(), { maxLength: 8 }), async (events) => {
        const counter = { calls: 0 };
        const bus = new InMemoryProductEventBus();
        const service = new AnalyticsService({
          usageRepository: alwaysFailingRepository(counter),
          eventBus: bus,
          dateProvider: fixedDateProvider(),
          idGenerator: makeIdGenerator(),
        });
        service.subscribe();

        // The originating operation (publish) must always resolve, never reject.
        for (const event of events) {
          await expect(bus.publishUsage(event)).resolves.toBeUndefined();
        }
      })
    );
  });

  it('succeeds within the retry budget when earlier attempts fail transiently', async () => {
    await fc.assert(
      fc.asyncProperty(
        usageEventArb(),
        fc.integer({ min: 0, max: MAX_RECORD_ATTEMPTS - 1 }),
        async (event, failuresBeforeSuccess) => {
          const { repo, attemptsPerEvent } = flakyRecordingRepository(
            failuresBeforeSuccess
          );
          const service = new AnalyticsService({
            usageRepository: repo,
            dateProvider: fixedDateProvider(),
            idGenerator: makeIdGenerator(),
          });

          const outcome = await service.recordUsage(event);

          expect(outcome.recorded).toBe(true);
          expect(outcome.attempts).toBe(failuresBeforeSuccess + 1);
          expect(outcome.attempts).toBeLessThanOrEqual(MAX_RECORD_ATTEMPTS);
          expect(attemptsPerEvent).toEqual([failuresBeforeSuccess + 1]);
        }
      )
    );
  });
});

// ─── Property 46 ─────────────────────────────────────────────────────────────
// Feature: api-copilot-ai, Property 46: Dashboard counts match recorded usage
// and show quota — For any set of recorded usage events in a Workspace, the
// dashboard's AI-query, API-execution, and code-generation counts equal the
// number of recorded events of each type, and it displays the Workspace's
// consumed query count against its Plan_Tier limit.
// Validates: Requirements 16.1, 16.3, 16.6
describe('Property 46: Dashboard counts match recorded usage and show quota', () => {
  it('per-type counts equal the number of recorded events of each type, and quota is displayed', async () => {
    const planTierArb: fc.Arbitrary<PlanTier> = fc.constantFrom(
      'starter',
      'pro',
      'enterprise'
    );
    const quotaArb: fc.Arbitrary<QuotaConsumption> = fc.record({
      consumed: fc.integer({ min: 0, max: 10_000 }),
      limit: fc.oneof(
        fc.integer({ min: 0, max: 10_000 }),
        fc.constant(Number.POSITIVE_INFINITY)
      ),
      tier: planTierArb,
    });

    await fc.assert(
      fc.asyncProperty(
        fc.array(usageEventArb(), { maxLength: 40 }),
        quotaArb,
        async (events, quota) => {
          const quotaProvider = new InMemoryQuotaConsumptionProvider();
          quotaProvider.setConsumption(WORKSPACE_ID, quota);
          const service = new AnalyticsService({
            usageRepository: new InMemoryUsageRepository(),
            authorizer: allowingAuthorizer(),
            quotaProvider,
            dateProvider: fixedDateProvider(),
            idGenerator: makeIdGenerator(),
          });

          for (const event of events) {
            const outcome = await service.recordUsage(event);
            expect(outcome.recorded).toBe(true);
          }

          const view = await service.dashboard(WORKSPACE_ID, REQUESTER);

          // Expected per-type tally computed independently from the inputs.
          const expected: Record<UsageEventType, number> = {
            ai_query: 0,
            api_execution: 0,
            code_generation: 0,
          };
          for (const event of events) {
            expected[event.type] += 1;
          }

          expect(view.counts).toEqual(expected);
          expect(view.totalEvents).toBe(events.length);
          expect(view.empty).toBe(events.length === 0);

          // Sum of per-type counts equals the total recorded events.
          const sum =
            view.counts.ai_query +
            view.counts.api_execution +
            view.counts.code_generation;
          expect(sum).toBe(events.length);

          // Req 16.6: consumed query count vs. the Plan_Tier limit is displayed.
          expect(view.quota).toEqual(quota);
        }
      )
    );
  });
});

// ─── Property 47 ─────────────────────────────────────────────────────────────
// Feature: api-copilot-ai, Property 47: Dashboard load failure preserves events
// — For any dashboard load that cannot retrieve data in time, an error
// indication with a retry action is shown and previously recorded usage events
// are retained.
// Validates: Requirements 16.7
describe('Property 47: Dashboard load failure preserves events', () => {
  it('surfaces a retryable load error, then retains events for a subsequent successful load', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(usageEventArb(), { minLength: 1, maxLength: 30 }),
        fc.integer({ min: 1, max: 3 }),
        async (events, listFailures) => {
          const repo = loadFailingRepository(listFailures);
          const service = new AnalyticsService({
            usageRepository: repo,
            authorizer: allowingAuthorizer(),
            dateProvider: fixedDateProvider(),
            idGenerator: makeIdGenerator(),
          });

          for (const event of events) {
            await service.recordUsage(event);
          }

          // The first `listFailures` dashboard loads fail with a retryable error.
          for (let i = 0; i < listFailures; i += 1) {
            const error = await service
              .dashboard(WORKSPACE_ID, REQUESTER)
              .then(
                () => {
                  throw new Error('expected DashboardLoadError');
                },
                (e: unknown) => e
              );
            expect(error).toBeInstanceOf(DashboardLoadError);
            expect((error as DashboardLoadError).retryable).toBe(true);
            expect((error as DashboardLoadError).workspaceId).toBe(WORKSPACE_ID);
          }

          // Events are retained across the failure: a later load reflects them all.
          const view = await service.dashboard(WORKSPACE_ID, REQUESTER);
          expect(view.totalEvents).toBe(events.length);
          const sum =
            view.counts.ai_query +
            view.counts.api_execution +
            view.counts.code_generation;
          expect(sum).toBe(events.length);
        }
      )
    );
  });

  it('never discloses counts to an unauthorized reader even under load failure', async () => {
    // Sanity guard alongside Property 47: authorization is enforced before any
    // retrieval, so a denied reader gets an AuthorizationError, not a load view.
    const denyingAuthorizer: WorkspaceAuthorizer = {
      authorize: (requester, workspaceId): AccessDecision => ({
        allowed: false,
        workspaceId,
        userId: requester.userId,
        role: null,
        reason: 'not_authorized',
      }),
    };

    await fc.assert(
      fc.asyncProperty(fc.array(usageEventArb(), { maxLength: 10 }), async (events) => {
        const service = new AnalyticsService({
          usageRepository: loadFailingRepository(2),
          authorizer: denyingAuthorizer,
          dateProvider: fixedDateProvider(),
          idGenerator: makeIdGenerator(),
        });
        for (const event of events) {
          await service.recordUsage(event);
        }

        await expect(
          service.dashboard(WORKSPACE_ID, REQUESTER)
        ).rejects.toBeInstanceOf(AuthorizationError);
      })
    );
  });
});
