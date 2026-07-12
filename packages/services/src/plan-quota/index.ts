/**
 * Plan & Quota domain — barrel export.
 *
 * Validates: Requirements 17.1, 17.2, 17.3, 17.4, 17.5, 17.6, 17.7, 17.8, 17.9, 2.4, 2.5
 */

export {
  PlanQuotaService,
  InMemoryEnterpriseConfigRepository,
} from './plan-quota.service';

export {
  QuotaExceededError,
  ApiLimitReachedError,
  AccountNotFoundError,
  EnterpriseConfigMissingError,
} from './plan-quota.errors';

export {
  STARTER_LIMITS,
  PRO_LIMITS,
  baseLimitsForTier,
  enterpriseLimits,
  isValidEnterpriseConfig,
} from './plan-quota.validators';

export type {
  TierLimits,
  EnterpriseConfig,
  QuotaDecision,
  ApiLimitDecision,
  EnterpriseConfigRepository,
  PlanQuotaDependencies,
} from './plan-quota.types';
