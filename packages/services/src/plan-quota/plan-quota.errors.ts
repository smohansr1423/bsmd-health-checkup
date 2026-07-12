/**
 * Plan & Quota — Errors
 *
 * Domain errors raised when an account reaches a plan-tier limit. Each error
 * identifies the account, the applicable limit, and the tier so callers can
 * surface an actionable message without leaking internal state.
 *
 * Validates: Requirements 17.4, 17.5, 17.6, 17.9, 2.5
 */

import type { PlanTier } from '../api-copilot-shared';

/**
 * Thrown when a further AI query is submitted while the account's cumulative
 * query count for the current billing period has reached (or exceeded) its
 * Query_Quota. The stored count is left unchanged (Req 17.4, 17.9).
 */
export class QuotaExceededError extends Error {
  public readonly accountId: string;
  public readonly tier: PlanTier;
  /** The Query_Quota that applies for the current billing period. */
  public readonly limit: number;
  /** The account's stored query count (unchanged by the rejected request). */
  public readonly queryCount: number;

  constructor(
    accountId: string,
    tier: PlanTier,
    limit: number,
    queryCount: number
  ) {
    super(
      `Query quota reached for account ${accountId} on the ${tier} tier: ` +
        `${queryCount}/${limit} AI queries used for the current billing period.`
    );
    this.name = 'QuotaExceededError';
    this.accountId = accountId;
    this.tier = tier;
    this.limit = limit;
    this.queryCount = queryCount;
  }
}

/**
 * Thrown when adding an API would cause the account's API count to exceed the
 * maximum permitted by its Plan_Tier. The existing set of APIs is left unchanged
 * (Req 2.5, 17.5).
 */
export class ApiLimitReachedError extends Error {
  public readonly accountId: string;
  public readonly tier: PlanTier;
  /** The API count limit that applies to the account's tier. */
  public readonly limit: number;
  /** The account's current distinct API count (unchanged by the rejected request). */
  public readonly currentApiCount: number;

  constructor(
    accountId: string,
    tier: PlanTier,
    limit: number,
    currentApiCount: number
  ) {
    super(
      `API limit reached for account ${accountId} on the ${tier} tier: ` +
        `${currentApiCount}/${limit} APIs. Upgrade the plan to add more APIs.`
    );
    this.name = 'ApiLimitReachedError';
    this.accountId = accountId;
    this.tier = tier;
    this.limit = limit;
    this.currentApiCount = currentApiCount;
  }
}

/**
 * Thrown when a plan-quota operation references an account that does not exist.
 */
export class AccountNotFoundError extends Error {
  public readonly accountId: string;

  constructor(accountId: string) {
    super(`Account not found: ${accountId}.`);
    this.name = 'AccountNotFoundError';
    this.accountId = accountId;
  }
}

/**
 * Thrown when an Enterprise-tier account has no Enterprise configuration record
 * from which to derive its limits (Req 17.6).
 */
export class EnterpriseConfigMissingError extends Error {
  public readonly accountId: string;

  constructor(accountId: string) {
    super(
      `Enterprise configuration record not found for account ${accountId}. ` +
        `Enterprise accounts require a configuration record defining their ` +
        `API count limit and Query_Quota.`
    );
    this.name = 'EnterpriseConfigMissingError';
    this.accountId = accountId;
  }
}
