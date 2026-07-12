/**
 * Plan & Quota — Validators and tier-limit encoding
 *
 * Encodes the fixed tier limits (Req 17.2, 17.3) and resolves the limits that
 * apply to an account, including Enterprise configuration-record limits
 * (Req 17.6).
 *
 * Validates: Requirements 17.2, 17.3, 17.6
 */

import type { PlanTier } from '../api-copilot-shared';
import type { EnterpriseConfig, TierLimits } from './plan-quota.types';

/** Starter tier: 1 API / 100 AI queries per billing period (Req 17.2). */
export const STARTER_LIMITS: TierLimits = {
  maxApis: 1,
  maxQueries: 100,
};

/** Pro tier: unlimited APIs / 10,000 AI queries per billing period (Req 17.3). */
export const PRO_LIMITS: TierLimits = {
  maxApis: Number.POSITIVE_INFINITY,
  maxQueries: 10_000,
};

/**
 * Returns the fixed limits for the Starter and Pro tiers. Enterprise limits are
 * not fixed — they come from a configuration record (Req 17.6) — so this returns
 * `null` for the Enterprise tier.
 */
export function baseLimitsForTier(tier: PlanTier): TierLimits | null {
  switch (tier) {
    case 'starter':
      return { ...STARTER_LIMITS };
    case 'pro':
      return { ...PRO_LIMITS };
    case 'enterprise':
      return null;
    default: {
      // Exhaustiveness guard: a new tier must be encoded here.
      const _exhaustive: never = tier;
      return _exhaustive;
    }
  }
}

/**
 * Resolves the limits that apply to an Enterprise account from its configuration
 * record (Req 17.6). Non-finite `maxApis` is preserved to represent "unlimited".
 */
export function enterpriseLimits(config: EnterpriseConfig): TierLimits {
  return {
    maxApis: config.maxApis,
    maxQueries: config.maxQueries,
  };
}

/**
 * Validates an Enterprise configuration record: limits must be integers that are
 * at least zero (or `Number.POSITIVE_INFINITY` for an unlimited API count).
 */
export function isValidEnterpriseConfig(config: EnterpriseConfig): boolean {
  return (
    isNonNegativeLimit(config.maxApis, true) &&
    isNonNegativeLimit(config.maxQueries, false)
  );
}

function isNonNegativeLimit(value: number, allowInfinite: boolean): boolean {
  if (allowInfinite && value === Number.POSITIVE_INFINITY) {
    return true;
  }
  return Number.isInteger(value) && value >= 0;
}
