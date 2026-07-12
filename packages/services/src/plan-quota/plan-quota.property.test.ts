/**
 * Plan & Quota Service — Property-Based Tests
 * Uses fast-check to validate universal correctness properties from the design
 * document (Properties 8, 48, 49, 50).
 *
 * These property tests complement the example-based unit tests in
 * `plan-quota.service.test.ts`: they exercise the same public API
 * (`canAddApi`, `checkAndReserveQuery`, `resetBillingPeriod`, `applyTierChange`)
 * across a broad, generated input space. Enterprise configuration records are
 * used to drive small, fast quotas/limits so the suite stays quick.
 *
 * Feature: api-copilot-ai
 * Validates: Requirements 2.4, 2.5, 17.4, 17.5, 17.7, 17.8, 17.9
 */

import * as fc from 'fast-check';

import {
  InMemoryAccountRepository,
  InMemoryQuotaStateRepository,
} from '../api-copilot-shared';
import type { Account, PlanTier } from '../api-copilot-shared';
import {
  PlanQuotaService,
  InMemoryEnterpriseConfigRepository,
} from './plan-quota.service';
import { ApiLimitReachedError, QuotaExceededError } from './plan-quota.errors';
import { PRO_LIMITS, STARTER_LIMITS } from './plan-quota.validators';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const FIXED_NOW = new Date('2024-01-01T00:00:00.000Z');
const ACCOUNT_ID = 'acct-1';

function makeAccount(tier: PlanTier, accountId = ACCOUNT_ID): Account {
  return {
    accountId,
    email: `${accountId}@example.com`,
    passwordHash: 'hash',
    tier,
  };
}

/**
 * Build a fresh PlanQuotaService with isolated in-memory repositories and a
 * deterministic clock/id generator. When an Enterprise config is supplied it is
 * seeded so the account derives its limits from the record (Req 17.6).
 */
function makeService(
  tier: PlanTier,
  enterpriseConfig?: { maxApis: number; maxQueries: number }
): {
  service: PlanQuotaService;
  accountRepository: InMemoryAccountRepository;
  quotaStateRepository: InMemoryQuotaStateRepository;
  enterpriseConfigRepository: InMemoryEnterpriseConfigRepository;
} {
  const accountRepository = new InMemoryAccountRepository();
  const quotaStateRepository = new InMemoryQuotaStateRepository();
  const enterpriseConfigRepository = new InMemoryEnterpriseConfigRepository();
  accountRepository.save(makeAccount(tier));
  if (enterpriseConfig) {
    enterpriseConfigRepository.save({ accountId: ACCOUNT_ID, ...enterpriseConfig });
  }
  const service = new PlanQuotaService({
    accountRepository,
    quotaStateRepository,
    enterpriseConfigRepository,
    dateProvider: () => FIXED_NOW,
    idGenerator: () => 'id-fixed',
  });
  return {
    service,
    accountRepository,
    quotaStateRepository,
    enterpriseConfigRepository,
  };
}

// ─── Property 8: API count never exceeds the tier limit ─────────────────────────
// Feature: api-copilot-ai, Property 8: For any account at its Plan_Tier API
// limit, attempting to add another API is rejected, the existing set of APIs is
// unchanged, and a limit error is returned.
// Validates: Requirements 2.4, 2.5, 17.5

describe('Property 8: API count never exceeds the tier limit', () => {
  it('permits an addition iff the current count is below the tier limit', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Small Enterprise limits keep the generated space fast and meaningful.
        fc.integer({ min: 0, max: 10 }),
        fc.integer({ min: 0, max: 12 }),
        async (maxApis, currentApiCount) => {
          const { service } = makeService('enterprise', {
            maxApis,
            maxQueries: 100,
          });

          const canAdd = currentApiCount < maxApis;
          if (canAdd) {
            const decision = await service.canAddApi(ACCOUNT_ID, currentApiCount);
            expect(decision.allowed).toBe(true);
            expect(decision.limit).toBe(maxApis);
            expect(decision.currentApiCount).toBe(currentApiCount);
          } else {
            // At or beyond the limit: rejected with a limit error carrying the
            // unchanged current count (Req 2.5, 17.5).
            await expect(
              service.canAddApi(ACCOUNT_ID, currentApiCount)
            ).rejects.toBeInstanceOf(ApiLimitReachedError);
          }
        }
      )
    );
  });

  it('rejects the addition that would breach the limit and stays rejected (no state drift)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: 8 }),
        async (maxApis) => {
          const { service } = makeService('enterprise', {
            maxApis,
            maxQueries: 100,
          });

          // Fill exactly to the limit: each add up to maxApis-1 is allowed.
          for (let count = 0; count < maxApis; count += 1) {
            const decision = await service.canAddApi(ACCOUNT_ID, count);
            expect(decision.allowed).toBe(true);
          }

          // At the limit, the next add is rejected — and remains rejected on
          // repeated attempts, since canAddApi never mutates API state.
          await expect(
            service.canAddApi(ACCOUNT_ID, maxApis)
          ).rejects.toBeInstanceOf(ApiLimitReachedError);
          await expect(
            service.canAddApi(ACCOUNT_ID, maxApis)
          ).rejects.toBeInstanceOf(ApiLimitReachedError);
        }
      )
    );
  });

  it('enforces the fixed Starter limit of 1 API and unlimited Pro APIs', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 0, max: 100_000 }), async (count) => {
        // Starter: 1 API total (Req 17.2). Adding is allowed only from 0.
        const starter = makeService('starter').service;
        if (count < STARTER_LIMITS.maxApis) {
          await expect(starter.canAddApi(ACCOUNT_ID, count)).resolves.toMatchObject(
            { allowed: true, limit: STARTER_LIMITS.maxApis }
          );
        } else {
          await expect(
            starter.canAddApi(ACCOUNT_ID, count)
          ).rejects.toBeInstanceOf(ApiLimitReachedError);
        }

        // Pro: unlimited APIs (Req 17.3) — any current count can still add one.
        const pro = makeService('pro').service;
        await expect(pro.canAddApi(ACCOUNT_ID, count)).resolves.toMatchObject({
          allowed: true,
          limit: PRO_LIMITS.maxApis,
        });
      })
    );
  });
});

// ─── Property 48: Query quota is never exceeded ─────────────────────────────────
// Feature: api-copilot-ai, Property 48: For any account and billing period, the
// number of accepted AI queries never exceeds the Plan_Tier Query_Quota; once the
// consumed count equals the quota, further queries are rejected and the stored
// query count is unchanged.
// Validates: Requirements 17.4, 17.9

describe('Property 48: Query quota is never exceeded', () => {
  it('accepts exactly quota queries then rejects, leaving the stored count unchanged', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Small quota keeps runs fast; extra attempts probe past the quota.
        fc.integer({ min: 0, max: 20 }),
        fc.integer({ min: 1, max: 5 }),
        async (maxQueries, extraAttempts) => {
          const { service, quotaStateRepository } = makeService('enterprise', {
            maxApis: 1,
            maxQueries,
          });

          // Accept exactly `maxQueries` reservations, count rising 1..maxQueries.
          for (let i = 0; i < maxQueries; i += 1) {
            const decision = await service.checkAndReserveQuery(ACCOUNT_ID);
            expect(decision.allowed).toBe(true);
            expect(decision.queryCount).toBe(i + 1);
            expect(decision.limit).toBe(maxQueries);
            expect(decision.remaining).toBe(maxQueries - (i + 1));
          }

          // Every further attempt is rejected and never advances the count
          // beyond the quota (Req 17.4).
          for (let i = 0; i < extraAttempts; i += 1) {
            await expect(
              service.checkAndReserveQuery(ACCOUNT_ID)
            ).rejects.toBeInstanceOf(QuotaExceededError);

            const state = await quotaStateRepository.findByAccount(ACCOUNT_ID);
            expect(state?.queryCount).toBe(maxQueries);
          }
        }
      )
    );
  });

  it('never lets the accepted count exceed the quota over an arbitrary attempt sequence', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: 15 }),
        fc.integer({ min: 0, max: 30 }),
        async (maxQueries, attempts) => {
          const { service, quotaStateRepository } = makeService('enterprise', {
            maxApis: 1,
            maxQueries,
          });

          let accepted = 0;
          for (let i = 0; i < attempts; i += 1) {
            try {
              await service.checkAndReserveQuery(ACCOUNT_ID);
              accepted += 1;
            } catch (err) {
              expect(err).toBeInstanceOf(QuotaExceededError);
            }
            // Invariant: stored count is always the accepted count and is capped
            // at the quota (Req 17.4).
            const state = await quotaStateRepository.findByAccount(ACCOUNT_ID);
            const stored = state?.queryCount ?? 0;
            expect(stored).toBe(accepted);
            expect(stored).toBeLessThanOrEqual(maxQueries);
          }
          expect(accepted).toBe(Math.min(attempts, maxQueries));
        }
      )
    );
  });
});

// ─── Property 49: Billing-period reset restores capacity ────────────────────────
// Feature: api-copilot-ai, Property 49: For any account whose quota was
// exhausted, beginning a new billing period resets the consumed query count to 0
// and queries are accepted again up to the tier quota.
// Validates: Requirements 17.7

describe('Property 49: Billing-period reset restores capacity', () => {
  it('resets an exhausted quota to 0 and accepts a full quota again', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 20 }),
        async (maxQueries) => {
          const { service, quotaStateRepository } = makeService('enterprise', {
            maxApis: 1,
            maxQueries,
          });

          // Exhaust the quota.
          for (let i = 0; i < maxQueries; i += 1) {
            await service.checkAndReserveQuery(ACCOUNT_ID);
          }
          await expect(
            service.checkAndReserveQuery(ACCOUNT_ID)
          ).rejects.toBeInstanceOf(QuotaExceededError);

          // Beginning a new billing period resets the count to 0 (Req 17.7).
          const reset = await service.resetBillingPeriod(ACCOUNT_ID);
          expect(reset.queryCount).toBe(0);
          expect(
            (await quotaStateRepository.findByAccount(ACCOUNT_ID))?.queryCount
          ).toBe(0);

          // A full quota of queries is accepted again after the reset.
          for (let i = 0; i < maxQueries; i += 1) {
            const decision = await service.checkAndReserveQuery(ACCOUNT_ID);
            expect(decision.queryCount).toBe(i + 1);
          }
          await expect(
            service.checkAndReserveQuery(ACCOUNT_ID)
          ).rejects.toBeInstanceOf(QuotaExceededError);
        }
      )
    );
  });

  it('reset from any partially-consumed count restores full capacity', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 20 }),
        fc.nat(),
        async (maxQueries, rawConsumed) => {
          const consumed = rawConsumed % (maxQueries + 1); // 0..maxQueries
          const { service } = makeService('enterprise', {
            maxApis: 1,
            maxQueries,
          });

          for (let i = 0; i < consumed; i += 1) {
            await service.checkAndReserveQuery(ACCOUNT_ID);
          }

          const reset = await service.resetBillingPeriod(ACCOUNT_ID);
          expect(reset.queryCount).toBe(0);

          // Exactly `maxQueries` queries accepted after the reset regardless of
          // the pre-reset consumed count.
          let accepted = 0;
          for (let i = 0; i < maxQueries + 1; i += 1) {
            try {
              await service.checkAndReserveQuery(ACCOUNT_ID);
              accepted += 1;
            } catch (err) {
              expect(err).toBeInstanceOf(QuotaExceededError);
            }
          }
          expect(accepted).toBe(maxQueries);
        }
      )
    );
  });
});

// ─── Property 50: Tier upgrade applies new limits and retains count ─────────────
// Feature: api-copilot-ai, Property 50: For any mid-period upgrade to a higher
// tier, the new tier's API limit and Query_Quota take effect for the remainder of
// the period while the account's existing consumed query count is preserved.
// Validates: Requirements 17.8

describe('Property 50: Tier upgrade applies new limits and retains count', () => {
  it('Starter→Pro retains the consumed count and exposes the Pro quota/API limit', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Consume 0..100 of the Starter quota before upgrading.
        fc.integer({ min: 0, max: STARTER_LIMITS.maxQueries }),
        async (consumed) => {
          const { service, quotaStateRepository } = makeService('starter');

          for (let i = 0; i < consumed; i += 1) {
            await service.checkAndReserveQuery(ACCOUNT_ID);
          }

          await service.applyTierChange(ACCOUNT_ID, 'pro');
          expect(await service.tierOf(ACCOUNT_ID)).toBe('pro');

          // Consumed count is preserved across the upgrade (Req 17.8). A count
          // of 0 means no quota state was ever materialized (treated as 0).
          const stateAfterUpgrade =
            await quotaStateRepository.findByAccount(ACCOUNT_ID);
          expect(stateAfterUpgrade?.queryCount ?? 0).toBe(consumed);

          // The higher Pro quota now applies: since consumed <= 100 < 10,000 a
          // further query is accepted and the count advances from `consumed`.
          const decision = await service.checkAndReserveQuery(ACCOUNT_ID);
          expect(decision.queryCount).toBe(consumed + 1);
          expect(decision.limit).toBe(PRO_LIMITS.maxQueries);

          // The Pro API limit (unlimited) is in effect for the rest of the period.
          await expect(
            service.canAddApi(ACCOUNT_ID, 5_000)
          ).resolves.toMatchObject({ allowed: true, limit: PRO_LIMITS.maxApis });
        }
      )
    );
  });

  it('upgrade to a higher Enterprise quota retains count and raises capacity', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 15 }),
        fc.integer({ min: 1, max: 15 }),
        async (startQuota, bump) => {
          const higherQuota = startQuota + bump;
          const { service, quotaStateRepository } = makeService('enterprise', {
            maxApis: 2,
            maxQueries: startQuota,
          });

          // Exhaust the starting Enterprise quota.
          for (let i = 0; i < startQuota; i += 1) {
            await service.checkAndReserveQuery(ACCOUNT_ID);
          }
          await expect(
            service.checkAndReserveQuery(ACCOUNT_ID)
          ).rejects.toBeInstanceOf(QuotaExceededError);

          // Upgrade to a higher Enterprise quota via a new config record.
          await service.applyTierChange(ACCOUNT_ID, 'enterprise', {
            maxApis: 10,
            maxQueries: higherQuota,
          });

          // Count retained (Req 17.8): still at the old quota value.
          expect(
            (await quotaStateRepository.findByAccount(ACCOUNT_ID))?.queryCount
          ).toBe(startQuota);

          // New, higher limits take effect: the remaining capacity equals the
          // difference between the new quota and the retained count.
          let accepted = 0;
          for (let i = 0; i < bump + 1; i += 1) {
            try {
              await service.checkAndReserveQuery(ACCOUNT_ID);
              accepted += 1;
            } catch (err) {
              expect(err).toBeInstanceOf(QuotaExceededError);
            }
          }
          expect(accepted).toBe(higherQuota - startQuota);
        }
      )
    );
  });
});
