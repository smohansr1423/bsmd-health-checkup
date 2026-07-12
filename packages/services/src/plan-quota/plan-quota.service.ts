/**
 * Plan & Quota — Service
 *
 * Enforces plan-tier limits and accounts for AI-query usage per billing period.
 *
 * - Exactly one tier per account (Req 17.1).
 * - Starter: 1 API / 100 queries; Pro: unlimited APIs / 10,000 queries;
 *   Enterprise: config-record limits (Req 17.2, 17.3, 17.6).
 * - On reaching the Query_Quota, further queries are rejected and the stored
 *   count is left unchanged (Req 17.4).
 * - Adding an API beyond the tier limit is rejected, leaving existing APIs
 *   unchanged (Req 2.4, 2.5, 17.5).
 * - A new billing period resets the count to 0 (Req 17.7).
 * - A tier upgrade applies new limits while retaining the count (Req 17.8);
 *   a downgrade applies new limits immediately, so a count already at/above the
 *   new quota blocks further queries (Req 17.9).
 *
 * Validates: Requirements 17.1, 17.2, 17.3, 17.4, 17.5, 17.6, 17.7, 17.8, 17.9, 2.4, 2.5
 */

import {
  InMemoryAccountRepository,
  InMemoryQuotaStateRepository,
  defaultDateProvider,
  defaultIdGenerator,
} from '../api-copilot-shared';
import type {
  AccountRepository,
  PlanTier,
  QuotaState,
  QuotaStateRepository,
} from '../api-copilot-shared';
import type {
  ApiLimitDecision,
  EnterpriseConfig,
  EnterpriseConfigRepository,
  PlanQuotaDependencies,
  QuotaDecision,
  TierLimits,
} from './plan-quota.types';
import {
  AccountNotFoundError,
  ApiLimitReachedError,
  EnterpriseConfigMissingError,
  QuotaExceededError,
} from './plan-quota.errors';
import {
  baseLimitsForTier,
  enterpriseLimits,
} from './plan-quota.validators';

/**
 * In-memory Enterprise configuration repository. Suitable for development and
 * tests; production swaps in a persistent implementation.
 */
export class InMemoryEnterpriseConfigRepository
  implements EnterpriseConfigRepository
{
  private configs: Map<string, EnterpriseConfig> = new Map();

  async save(config: EnterpriseConfig): Promise<EnterpriseConfig> {
    this.configs.set(config.accountId, config);
    return config;
  }

  async findByAccount(accountId: string): Promise<EnterpriseConfig | null> {
    return this.configs.get(accountId) ?? null;
  }

  /** Utility for testing: remove all configuration records. */
  clear(): void {
    this.configs.clear();
  }
}

/**
 * PlanQuotaService — plan-tier limits and quota accounting.
 */
export class PlanQuotaService {
  private readonly idGenerator: () => string;
  private readonly dateProvider: () => Date;
  private readonly accountRepository: AccountRepository;
  private readonly quotaStateRepository: QuotaStateRepository;
  private readonly enterpriseConfigRepository: EnterpriseConfigRepository;

  constructor(deps?: Partial<PlanQuotaDependencies>) {
    this.idGenerator = deps?.idGenerator ?? defaultIdGenerator;
    this.dateProvider = deps?.dateProvider ?? defaultDateProvider;
    this.accountRepository =
      deps?.accountRepository ?? new InMemoryAccountRepository();
    this.quotaStateRepository =
      deps?.quotaStateRepository ?? new InMemoryQuotaStateRepository();
    this.enterpriseConfigRepository =
      deps?.enterpriseConfigRepository ??
      new InMemoryEnterpriseConfigRepository();
  }

  /**
   * Returns the account's Plan_Tier (Req 17.1).
   * @throws AccountNotFoundError when the account does not exist.
   */
  async tierOf(accountId: string): Promise<PlanTier> {
    const account = await this.accountRepository.findById(accountId);
    if (!account) {
      throw new AccountNotFoundError(accountId);
    }
    return account.tier;
  }

  /**
   * Resolves the limits that currently apply to the account: fixed limits for
   * Starter/Pro (Req 17.2, 17.3) or the Enterprise configuration record for
   * Enterprise (Req 17.6).
   *
   * @throws AccountNotFoundError when the account does not exist.
   * @throws EnterpriseConfigMissingError when an Enterprise account has no config.
   */
  async limitsFor(accountId: string): Promise<TierLimits> {
    const tier = await this.tierOf(accountId);
    const base = baseLimitsForTier(tier);
    if (base) {
      return base;
    }
    // Enterprise: derive from the configuration record.
    const config = await this.enterpriseConfigRepository.findByAccount(accountId);
    if (!config) {
      throw new EnterpriseConfigMissingError(accountId);
    }
    return enterpriseLimits(config);
  }

  /**
   * Admits and reserves a single AI query against the account's Query_Quota for
   * the current billing period. Increments and persists the stored count on
   * success (Req 17.2–17.4).
   *
   * @throws QuotaExceededError when the count has reached the quota; the stored
   *   count is left unchanged (Req 17.4, 17.9).
   */
  async checkAndReserveQuery(accountId: string): Promise<QuotaDecision> {
    const tier = await this.tierOf(accountId);
    const limits = await this.limitsFor(accountId);
    const state = await this.getOrCreateQuotaState(accountId);

    // Reject when the count has reached the quota; leave stored count unchanged
    // (Req 17.4). A downgrade that pushes the count at/above the new quota also
    // lands here, blocking further queries (Req 17.9).
    if (state.queryCount >= limits.maxQueries) {
      throw new QuotaExceededError(
        accountId,
        tier,
        limits.maxQueries,
        state.queryCount
      );
    }

    const updated: QuotaState = {
      ...state,
      queryCount: state.queryCount + 1,
    };
    await this.quotaStateRepository.update(updated);

    return {
      allowed: true,
      tier,
      queryCount: updated.queryCount,
      limit: limits.maxQueries,
      remaining: limits.maxQueries - updated.queryCount,
    };
  }

  /**
   * Checks whether an additional API can be added without exceeding the tier's
   * API count limit (Req 2.4, 2.5, 17.5). Does not mutate any API state.
   *
   * @param currentApiCount the account's current distinct API count.
   * @throws ApiLimitReachedError when adding one more API would exceed the limit;
   *   the existing set of APIs is left unchanged.
   */
  async canAddApi(
    accountId: string,
    currentApiCount: number
  ): Promise<ApiLimitDecision> {
    const tier = await this.tierOf(accountId);
    const limits = await this.limitsFor(accountId);

    // Adding one more must not push the count beyond the limit (Req 17.5).
    if (currentApiCount + 1 > limits.maxApis) {
      throw new ApiLimitReachedError(
        accountId,
        tier,
        limits.maxApis,
        currentApiCount
      );
    }

    return {
      allowed: true,
      tier,
      currentApiCount,
      limit: limits.maxApis,
    };
  }

  /**
   * Begins a new billing period for the account: resets the AI query count to 0
   * and records the new period start, resuming query acceptance up to the
   * account's Query_Quota (Req 17.7).
   */
  async resetBillingPeriod(accountId: string): Promise<QuotaState> {
    const existing = await this.getOrCreateQuotaState(accountId);
    const reset: QuotaState = {
      ...existing,
      billingPeriodStart: this.dateProvider(),
      queryCount: 0,
    };
    await this.quotaStateRepository.update(reset);
    return reset;
  }

  /**
   * Applies a Plan_Tier change for the current billing period (Req 17.8, 17.9).
   *
   * The account's stored query count is retained across the change: an upgrade
   * simply exposes the higher tier's limits, and a downgrade exposes the lower
   * tier's limits immediately. Enforcement happens on the next
   * `checkAndReserveQuery`, so a retained count at/above a lower quota blocks
   * further queries (Req 17.9) without discarding usage already recorded.
   *
   * @param enterpriseConfig required when `newTier` is `enterprise` and no
   *   configuration record yet exists for the account (Req 17.6).
   * @throws AccountNotFoundError when the account does not exist.
   * @throws EnterpriseConfigMissingError when downgrading/upgrading to Enterprise
   *   without an available configuration record.
   */
  async applyTierChange(
    accountId: string,
    newTier: PlanTier,
    enterpriseConfig?: Omit<EnterpriseConfig, 'accountId'>
  ): Promise<void> {
    const account = await this.accountRepository.findById(accountId);
    if (!account) {
      throw new AccountNotFoundError(accountId);
    }

    if (newTier === 'enterprise') {
      if (enterpriseConfig) {
        await this.enterpriseConfigRepository.save({
          accountId,
          ...enterpriseConfig,
        });
      } else {
        const existing =
          await this.enterpriseConfigRepository.findByAccount(accountId);
        if (!existing) {
          throw new EnterpriseConfigMissingError(accountId);
        }
      }
    }

    // Exactly one tier per account (Req 17.1). The stored query count is left
    // untouched so it is retained across the change (Req 17.8, 17.9).
    await this.accountRepository.update({ ...account, tier: newTier });
  }

  /**
   * Reads the account's current quota state, creating a zeroed state for the
   * current billing period when none exists yet.
   */
  private async getOrCreateQuotaState(accountId: string): Promise<QuotaState> {
    const existing = await this.quotaStateRepository.findByAccount(accountId);
    if (existing) {
      return existing;
    }
    const created: QuotaState = {
      accountId,
      billingPeriodStart: this.dateProvider(),
      queryCount: 0,
    };
    await this.quotaStateRepository.save(created);
    return created;
  }
}
