/**
 * Insurance Integration Service barrel export
 */
export {
  InsuranceIntegrationService,
  InMemoryPolicyRepository,
  InMemoryClaimRepository,
} from './insurance.service';
export {
  PolicyNotFoundError,
  ClaimNotFoundError,
  InvalidCoveragePercentageError,
  ClaimExceedsMaxError,
  PolicyExpiredError,
  InvalidClaimStateError,
  ClaimSubmissionFailedError,
} from './insurance.errors';
export type {
  InsuranceDetails,
  InsurancePolicy,
  CoverageCalculation,
  ClaimSubmissionRequest,
  ClaimStatus,
  ClaimLineItem,
  InsurancePolicyRepository,
  InsuranceClaimRepository,
  InvoiceLookup,
  InsuranceNotifier,
  InsuranceProviderAdapter,
  InsuranceDependencies,
} from './insurance.types';
