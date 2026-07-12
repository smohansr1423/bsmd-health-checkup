/**
 * Unit tests for PlanQuotaService — tier limits and quota accounting.
 *
 * Validates: Requirements 17.1, 17.2, 17.3, 17.4, 17.5, 17.6, 17.7, 17.8, 17.9, 2.4, 2.5
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
  AccountNotFoundError,
  ApiLimitReachedError,
  EnterpriseConfigMissingError,
  QuotaExceededError,
} from './plan-quota.errors';
import { PRO_LIMITS, STARTER_LIMITS } from './plan-quota.validators';

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

describe('PlanQuotaService.tierOf (Req 17.1)', () => {
  it('returns the account tier', async () => {
    const { service } = buildService(makeAccount('pro'));
    await expect(service.tierOf('acct-1')).resolves.toBe('pro');
  });

  it('throws AccountNotFoundError for an unknown account', async () => {
    const { service } = buildService(makeAccount('starter'));
    await expect(service.tierOf('missing')).rejects.toBeInstanceOf(
      AccountNotFoundError
    );
  });
});

describe('PlanQuotaService.checkAndReserveQuery (Req 17.2, 17.3, 17.4)', () => {
  it('admits queries up to the Starter quota then rejects, leaving the count unchanged', async () => {
    const { service, quotaStateRepository } = buildService(makeAccount('starter'));

    for (let i = 0; i < STARTER_LIMITS.maxQueries; i += 1) {
      const decision = await service.checkAndReserveQuery('acct-1');
      expect(decision.allowed).toBe(true);
      expect(decision.queryCount).toBe(i + 1);
    }

    await expect(service.checkAndReserveQuery('acct-1')).rejects.toBeInstanceOf(
      QuotaExceededError
    );

    // Stored count is left exactly at the quota (Req 17.4).
    const state = await quotaStateRepository.findByAccount('acct-1');
    expect(state?.queryCount).toBe(STARTER_LIMITS.maxQueries);
  });

  it('uses the 10,000-query Pro quota', async () => {
    const { service } = buildService(makeAccount('pro'));
    const decision = await service.checkAndReserveQuery('acct-1');
    expect(decision.limit).toBe(PRO_LIMITS.maxQueries);
    expect(decision.remaining).toBe(PRO_LIMITS.maxQueries - 1);
  });
});

describe('PlanQuotaService.canAddApi (Req 2.4, 2.5, 17.5)', () => {
  it('allows a Starter account to add its first API but rejects the second', async () => {
    const { service } = buildService(makeAccount('starter'));

    await expect(service.canAddApi('acct-1', 0)).resolves.toMatchObject({
      allowed: true,
      limit: 1,
    });

    await expect(service.canAddApi('acct-1', 1)).rejects.toBeInstanceOf(
      ApiLimitReachedError
    );
  });

  it('allows Pro accounts unlimited APIs', async () => {
    const { service } = buildService(makeAccount('pro'));
    await expect(service.canAddApi('acct-1', 10_000)).resolves.toMatchObject({
      allowed: true,
    });
  });
});

describe('PlanQuotaService Enterprise limits (Req 17.6)', () => {
  it('derives limits from the configuration record', async () => {
    const { service, enterpriseConfigRepository } = buildService(
      makeAccount('enterprise')
    );
    await enterpriseConfigRepository.save({
      accountId: 'acct-1',
      maxApis: 3,
      maxQueries: 2,
    });

    await service.checkAndReserveQuery('acct-1');
    await service.checkAndReserveQuery('acct-1');
    await expect(service.checkAndReserveQuery('acct-1')).rejects.toBeInstanceOf(
      QuotaExceededError
    );

    await expect(service.canAddApi('acct-1', 3)).rejects.toBeInstanceOf(
      ApiLimitReachedError
    );
  });

  it('throws EnterpriseConfigMissingError when no config record exists', async () => {
    const { service } = buildService(makeAccount('enterprise'));
    await expect(service.limitsFor('acct-1')).rejects.toBeInstanceOf(
      EnterpriseConfigMissingError
    );
  });
});

describe('PlanQuotaService.resetBillingPeriod (Req 17.7)', () => {
  it('resets the query count to 0 and resumes acceptance', async () => {
    const { service } = buildService(makeAccount('starter'));
    await service.checkAndReserveQuery('acct-1');
    await service.checkAndReserveQuery('acct-1');

    const reset = await service.resetBillingPeriod('acct-1');
    expect(reset.queryCount).toBe(0);

    const decision = await service.checkAndReserveQuery('acct-1');
    expect(decision.queryCount).toBe(1);
  });
});

describe('PlanQuotaService.applyTierChange (Req 17.8, 17.9)', () => {
  it('upgrade applies new limits and retains the query count', async () => {
    const { service } = buildService(makeAccount('starter'));
    // Use some of the Starter quota.
    for (let i = 0; i < 100; i += 1) {
      await service.checkAndReserveQuery('acct-1');
    }
    await expect(service.checkAndReserveQuery('acct-1')).rejects.toBeInstanceOf(
      QuotaExceededError
    );

    await service.applyTierChange('acct-1', 'pro');
    expect(await service.tierOf('acct-1')).toBe('pro');

    // Count retained (Req 17.8): still 100, now under the Pro quota so accepted.
    const decision = await service.checkAndReserveQuery('acct-1');
    expect(decision.queryCount).toBe(101);
    expect(decision.limit).toBe(PRO_LIMITS.maxQueries);
  });

  it('downgrade below current count blocks further queries immediately', async () => {
    const { service } = buildService(makeAccount('pro'));
    for (let i = 0; i < 150; i += 1) {
      await service.checkAndReserveQuery('acct-1');
    }

    // Downgrade to Starter (quota 100) with a retained count of 150 (Req 17.9).
    await service.applyTierChange('acct-1', 'starter');
    await expect(service.checkAndReserveQuery('acct-1')).rejects.toBeInstanceOf(
      QuotaExceededError
    );
  });

  it('applying enterprise tier requires a config record', async () => {
    const { service } = buildService(makeAccount('pro'));
    await expect(
      service.applyTierChange('acct-1', 'enterprise')
    ).rejects.toBeInstanceOf(EnterpriseConfigMissingError);

    await service.applyTierChange('acct-1', 'enterprise', {
      maxApis: 5,
      maxQueries: 50,
    });
    expect(await service.tierOf('acct-1')).toBe('enterprise');
  });
});
