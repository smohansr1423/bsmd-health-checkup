/**
 * Plan & Quota — Types
 *
 * Types for plan-tier limits, quota decisions, and the Enterprise configuration
 * record used by the Plan & Quota service. Cross-domain primitives (PlanTier,
 * QuotaState, Account) come from the API Copilot AI product-shared module.
 *
 * Validates: Requirements 17.1, 17.2, 17.3, 17.4, 17.5, 17.6, 17.7, 17.8, 17.9, 2.4, 2.5
 */

import type {
  PlanTier,
  QuotaState,
} from '../api-copilot-shared';
import type {
  AccountRepository,
  QuotaStateRepository,
} from '../api-copilot-shared';

/**
 * The resolved limits that apply to an account for the current billing period.
 * `maxApis` uses `Number.POSITIVE_INFINITY` to represent an unlimited API count
 * (Pro tier, Req 17.3).
 */
export interface TierLimits {
  /** Maximum number of distinct APIs; `Number.POSITIVE_INFINITY` when unlimited. */
  maxApis: number;
  /** Maximum number of AI queries permitted per billing period. */
  maxQueries: number;
}

/**
 * Enterprise configuration record (Req 17.6). Enterprise accounts derive their
 * API count limit and Query_Quota from this record rather than fixed tier
 * constants.
 */
export interface EnterpriseConfig {
  accountId: string;
  /** Maximum distinct APIs; use `Number.POSITIVE_INFINITY` for unlimited. */
  maxApis: number;
  /** Maximum AI queries per billing period. */
  maxQueries: number;
}

/**
 * Result of a successful query reservation (Req 17.4). Returned only when the
 * query was admitted and the stored count incremented; rejection throws
 * `QuotaExceededError` and leaves the stored count unchanged.
 */
export interface QuotaDecision {
  allowed: true;
  tier: PlanTier;
  /** Stored query count after this reservation. */
  queryCount: number;
  /** Query_Quota that applies to the account for the current billing period. */
  limit: number;
  /** Remaining queries after this reservation. */
  remaining: number;
}

/**
 * Result of a successful `canAddApi` check (Req 17.5). Returned only when adding
 * an API is permitted; rejection throws `ApiLimitReachedError` and leaves the
 * existing set of APIs unchanged.
 */
export interface ApiLimitDecision {
  allowed: true;
  tier: PlanTier;
  /** Distinct API count before the addition. */
  currentApiCount: number;
  /** Maximum distinct APIs permitted; `Number.POSITIVE_INFINITY` when unlimited. */
  limit: number;
}

/**
 * Persistence for Enterprise configuration records (Req 17.6). Local to the
 * plan-quota domain; production swaps in a Prisma-backed implementation.
 */
export interface EnterpriseConfigRepository {
  save(config: EnterpriseConfig): Promise<EnterpriseConfig>;
  findByAccount(accountId: string): Promise<EnterpriseConfig | null>;
}

/**
 * Dependencies injected into the PlanQuotaService. Every dependency has an
 * in-memory / default fallback so the service is unit- and property-testable.
 */
export interface PlanQuotaDependencies {
  idGenerator: () => string;
  dateProvider: () => Date;
  accountRepository: AccountRepository;
  quotaStateRepository: QuotaStateRepository;
  enterpriseConfigRepository: EnterpriseConfigRepository;
}

export type { QuotaState };
