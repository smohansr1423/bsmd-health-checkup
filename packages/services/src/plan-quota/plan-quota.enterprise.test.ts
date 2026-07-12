/**
 * Unit tests for PlanQuotaService — Enterprise configuration-record edge cases
 * and immediate-downgrade blocking.
 *
 * These example-based tests complement the property-based tests in
 * `plan-quota.property.test.ts` by pinning down the specific edge cases called
 * out in Requirements 17.1 (exactly one tier), 17.6 (Enterprise config record),
 * and 17.9 (a downgrade applies new limits immediately, so a retained count at or
 * above the new quota blocks further queries).
 *
 * Feature: api-copilot-ai
 * Validates: Requirements 17.1, 17.6, 17.9
 */

import {
  InMemoryAccountRepository,
  InMemoryQuotaStateRepository,
} from '../api-copilot-shared';
import type { Account, PlanTier } from '../api-copilot-shared';
import {
  PlanQuotaService,
  InMemoryEnterpriseConfigRepository,
} from './plan-quota.service';
import {
  EnterpriseConfigMissingError,
  QuotaExceededError,
} from './plan-quota.errors';
import { enterpriseLimits, isValidEnterpriseConfig } from './plan-quota.validators';

const FIXED_NOW = new Date('2024-01-01T00:00:00.000Z');

function makeAccount(tier: PlanTier, accountId = 'acct-1'): Account {
  return {
    accountId,
    email: `${accountId}@example.com`,
    passwordHash: 'hash',
    tier,
  };
}

function buildService(account: Account) {
  const accountRepository = new InMemoryAccountRepository();
  const quotaStateRepository = new InMemoryQuotaStateRepository();
  const enterpriseConfigRepository = new InMemoryEnterpriseConfigRepository();
  accountRepository.save(account);
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

// ─── Enterprise configuration-record limits (Req 17.6) ──────────────────────────

describe('Enterprise configuration-record limits (Req 17.6)', () => {
  it('derives both the API limit and Query_Quota from the config record', async () => {
    const { service, enterpriseConfigRepository } = buildService(
      makeAccount('enterprise')
    );
    await enterpriseConfigRepository.save({
      accountId: 'acct-1',
      maxApis: 4,
      maxQueries: 3,
    });

    const limits = await service.limitsFor('acct-1');
    expect(limits).toEqual({ maxApis: 4, maxQueries: 3 });
  });

  it('supports an unlimited API count via POSITIVE_INFINITY in the config', async () => {
    const { service, enterpriseConfigRepository } = buildService(
      makeAccount('enterprise')
    );
    await enterpriseConfigRepository.save({
      accountId: 'acct-1',
      maxApis: Number.POSITIVE_INFINITY,
      maxQueries: 2,
    });

    // Any current API count can still add one more when unlimited.
    await expect(service.canAddApi('acct-1', 1_000_000)).resolves.toMatchObject({
      allowed: true,
      limit: Number.POSITIVE_INFINITY,
    });
  });

  it('treats a zero Query_Quota as immediately exhausted', async () => {
    const { service, quotaStateRepository, enterpriseConfigRepository } =
      buildService(makeAccount('enterprise'));
    await enterpriseConfigRepository.save({
      accountId: 'acct-1',
      maxApis: 1,
      maxQueries: 0,
    });

    await expect(
      service.checkAndReserveQuery('acct-1')
    ).rejects.toBeInstanceOf(QuotaExceededError);

    // The stored count is never advanced past the (zero) quota.
    const state = await quotaStateRepository.findByAccount('acct-1');
    expect(state?.queryCount ?? 0).toBe(0);
  });

  it('rejects Enterprise operations when no config record exists', async () => {
    const { service } = buildService(makeAccount('enterprise'));

    await expect(service.limitsFor('acct-1')).rejects.toBeInstanceOf(
      EnterpriseConfigMissingError
    );
    await expect(
      service.checkAndReserveQuery('acct-1')
    ).rejects.toBeInstanceOf(EnterpriseConfigMissingError);
    await expect(service.canAddApi('acct-1', 0)).rejects.toBeInstanceOf(
      EnterpriseConfigMissingError
    );
  });

  it('enterpriseLimits preserves the record values, including infinite maxApis', () => {
    expect(
      enterpriseLimits({ accountId: 'a', maxApis: 7, maxQueries: 9 })
    ).toEqual({ maxApis: 7, maxQueries: 9 });
    expect(
      enterpriseLimits({
        accountId: 'a',
        maxApis: Number.POSITIVE_INFINITY,
        maxQueries: 1,
      })
    ).toEqual({ maxApis: Number.POSITIVE_INFINITY, maxQueries: 1 });
  });

  it('isValidEnterpriseConfig accepts non-negative integers and unlimited APIs, rejects the rest', () => {
    expect(
      isValidEnterpriseConfig({ accountId: 'a', maxApis: 0, maxQueries: 0 })
    ).toBe(true);
    expect(
      isValidEnterpriseConfig({
        accountId: 'a',
        maxApis: Number.POSITIVE_INFINITY,
        maxQueries: 5,
      })
    ).toBe(true);

    // Negative, fractional, or an infinite Query_Quota are invalid.
    expect(
      isValidEnterpriseConfig({ accountId: 'a', maxApis: -1, maxQueries: 5 })
    ).toBe(false);
    expect(
      isValidEnterpriseConfig({ accountId: 'a', maxApis: 2, maxQueries: 1.5 })
    ).toBe(false);
    expect(
      isValidEnterpriseConfig({
        accountId: 'a',
        maxApis: 2,
        maxQueries: Number.POSITIVE_INFINITY,
      })
    ).toBe(false);
  });
});

// ─── Exactly one tier per account (Req 17.1) ────────────────────────────────────

describe('Exactly one tier per account (Req 17.1)', () => {
  it('applyTierChange replaces the tier rather than accumulating tiers', async () => {
    const { service, enterpriseConfigRepository } = buildService(
      makeAccount('starter')
    );

    await service.applyTierChange('acct-1', 'pro');
    expect(await service.tierOf('acct-1')).toBe('pro');

    await enterpriseConfigRepository.save({
      accountId: 'acct-1',
      maxApis: 5,
      maxQueries: 50,
    });
    await service.applyTierChange('acct-1', 'enterprise');
    expect(await service.tierOf('acct-1')).toBe('enterprise');

    await service.applyTierChange('acct-1', 'starter');
    expect(await service.tierOf('acct-1')).toBe('starter');
  });
});

// ─── Immediate downgrade blocking (Req 17.9) ────────────────────────────────────

describe('Immediate downgrade blocking (Req 17.9)', () => {
  it('a downgrade with a retained count above the new quota blocks further queries immediately', async () => {
    const { service, quotaStateRepository } = buildService(makeAccount('pro'));

    // Consume 150 queries on Pro (well within its 10,000 quota).
    for (let i = 0; i < 150; i += 1) {
      await service.checkAndReserveQuery('acct-1');
    }

    // Downgrade to Starter (quota 100). The retained count of 150 exceeds it.
    await service.applyTierChange('acct-1', 'starter');
    expect(await service.tierOf('acct-1')).toBe('starter');

    await expect(
      service.checkAndReserveQuery('acct-1')
    ).rejects.toBeInstanceOf(QuotaExceededError);

    // Downgrade discards no usage: the stored count is retained unchanged.
    expect(
      (await quotaStateRepository.findByAccount('acct-1'))?.queryCount
    ).toBe(150);
  });

  it('a downgrade with the retained count exactly at the new quota blocks the next query', async () => {
    // Enterprise (quota 10) consumed down to exactly 5, then downgraded to a new
    // Enterprise config with quota 5: at the boundary, further queries reject.
    const { service, enterpriseConfigRepository } = buildService(
      makeAccount('enterprise')
    );
    await enterpriseConfigRepository.save({
      accountId: 'acct-1',
      maxApis: 3,
      maxQueries: 10,
    });

    for (let i = 0; i < 5; i += 1) {
      await service.checkAndReserveQuery('acct-1');
    }

    // Downgrade to a lower Enterprise quota equal to the retained count.
    await service.applyTierChange('acct-1', 'enterprise', {
      maxApis: 3,
      maxQueries: 5,
    });

    await expect(
      service.checkAndReserveQuery('acct-1')
    ).rejects.toBeInstanceOf(QuotaExceededError);
  });

  it('a downgrade with headroom still accepts queries up to the new (lower) quota', async () => {
    const { service } = buildService(makeAccount('pro'));

    // Consume 40 queries, then downgrade to Starter (quota 100): 60 remain.
    for (let i = 0; i < 40; i += 1) {
      await service.checkAndReserveQuery('acct-1');
    }
    await service.applyTierChange('acct-1', 'starter');

    let accepted = 0;
    for (let i = 0; i < 61; i += 1) {
      try {
        await service.checkAndReserveQuery('acct-1');
        accepted += 1;
      } catch (err) {
        expect(err).toBeInstanceOf(QuotaExceededError);
      }
    }
    // 60 accepted brings the count from 40 to the Starter quota of 100.
    expect(accepted).toBe(60);
  });

  it('downgrading to Enterprise requires a config record when none exists', async () => {
    const { service } = buildService(makeAccount('pro'));
    await expect(
      service.applyTierChange('acct-1', 'enterprise')
    ).rejects.toBeInstanceOf(EnterpriseConfigMissingError);
  });
});
