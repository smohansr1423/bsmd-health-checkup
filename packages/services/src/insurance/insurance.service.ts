/**
 * Insurance Integration Service
 * Handles insurance policy management, coverage calculation, claim submission, and status tracking.
 * Validates: Requirements 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7, 11.8
 */

import type { InsuranceClaim } from '@health-checkup/shared';
import type {
  InsuranceDetails,
  InsurancePolicy,
  CoverageCalculation,
  ClaimSubmissionRequest,
  ClaimStatus,
  InsuranceDependencies,
  InsurancePolicyRepository,
  InsuranceClaimRepository,
  InvoiceLookup,
  InsuranceNotifier,
  InsuranceProviderAdapter,
} from './insurance.types';
import {
  PolicyNotFoundError,
  ClaimNotFoundError,
  InvalidCoveragePercentageError,
  ClaimExceedsMaxError,
  PolicyExpiredError,
  InvalidClaimStateError,
  ClaimSubmissionFailedError,
} from './insurance.errors';

/**
 * In-memory implementation of InsurancePolicyRepository.
 * Suitable for development and testing.
 */
export class InMemoryPolicyRepository implements InsurancePolicyRepository {
  private policies: InsurancePolicy[] = [];

  async save(policy: InsurancePolicy): Promise<InsurancePolicy> {
    this.policies.push(policy);
    return policy;
  }

  async findById(id: string): Promise<InsurancePolicy | null> {
    return this.policies.find((p) => p.id === id) ?? null;
  }

  async findBySeniorId(seniorId: string): Promise<InsurancePolicy[]> {
    return this.policies.filter((p) => p.seniorId === seniorId);
  }

  clear(): void {
    this.policies = [];
  }
}

/**
 * In-memory implementation of InsuranceClaimRepository.
 */
export class InMemoryClaimRepository implements InsuranceClaimRepository {
  private claims: InsuranceClaim[] = [];

  async save(claim: InsuranceClaim): Promise<InsuranceClaim> {
    this.claims.push(claim);
    return claim;
  }

  async findById(id: string): Promise<InsuranceClaim | null> {
    return this.claims.find((c) => c.id === id) ?? null;
  }

  async findByInvoiceId(invoiceId: string): Promise<InsuranceClaim[]> {
    return this.claims.filter((c) => c.invoiceId === invoiceId);
  }

  async findBySeniorId(seniorId: string): Promise<InsuranceClaim[]> {
    return this.claims.filter((c) => c.seniorId === seniorId);
  }

  async update(claim: InsuranceClaim): Promise<InsuranceClaim> {
    const index = this.claims.findIndex((c) => c.id === claim.id);
    if (index === -1) {
      throw new Error(`Claim not found: ${claim.id}`);
    }
    this.claims[index] = claim;
    return claim;
  }

  clear(): void {
    this.claims = [];
  }
}

/** Default ID generator using timestamp + random suffix */
const defaultIdGenerator = (): string => {
  return `INS_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
};

/** Default date provider returning the current system date */
const defaultDateProvider = (): Date => new Date();

/** Default reference number generator for claim submissions */
const defaultReferenceNumberGenerator = (): string => {
  return `CLM-${Date.now()}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
};

/** Default no-op invoice lookup */
const defaultInvoiceLookup: InvoiceLookup = {
  getInvoiceAmount: async () => {
    throw new Error('InvoiceLookup not configured');
  },
  reduceInvoiceBalance: async () => {},
  markFullAmountAsPatientResponsibility: async () => {},
};

/** Default no-op notifier */
const defaultNotifier: InsuranceNotifier = {
  notifyClaimRejection: async () => {},
};

/** Default insurance provider adapter that always succeeds (no-op) */
const defaultInsuranceProviderAdapter: InsuranceProviderAdapter = {
  submitClaim: async () => {},
};

/**
 * Rounds a number to 2 decimal places.
 */
function roundToTwoDecimals(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * InsuranceIntegrationService implementation.
 *
 * Business rules:
 * - Coverage calculation: min(invoiceAmount × coveragePercentage/100, maxClaimableAmount)
 * - Patient responsibility: invoiceAmount - eligibleAmount
 * - Claim submission generates a unique reference number within 30 seconds
 * - On approval: reduce invoice balance by approved amount
 * - On rejection: notify within 24 hours, mark full amount as patient responsibility
 * - Cap claims at maxClaimableAmount
 */
export class InsuranceIntegrationService {
  private readonly idGenerator: () => string;
  private readonly dateProvider: () => Date;
  private readonly referenceNumberGenerator: () => string;
  private readonly policyRepository: InsurancePolicyRepository;
  private readonly claimRepository: InsuranceClaimRepository;
  private readonly invoiceLookup: InvoiceLookup;
  private readonly notifier: InsuranceNotifier;
  private readonly insuranceProviderAdapter: InsuranceProviderAdapter;

  constructor(deps?: Partial<InsuranceDependencies>) {
    this.idGenerator = deps?.idGenerator ?? defaultIdGenerator;
    this.dateProvider = deps?.dateProvider ?? defaultDateProvider;
    this.referenceNumberGenerator = deps?.referenceNumberGenerator ?? defaultReferenceNumberGenerator;
    this.policyRepository = deps?.policyRepository ?? new InMemoryPolicyRepository();
    this.claimRepository = deps?.claimRepository ?? new InMemoryClaimRepository();
    this.invoiceLookup = deps?.invoiceLookup ?? defaultInvoiceLookup;
    this.notifier = deps?.notifier ?? defaultNotifier;
    this.insuranceProviderAdapter = deps?.insuranceProviderAdapter ?? defaultInsuranceProviderAdapter;
  }

  /**
   * Record insurance details for a senior citizen.
   *
   * Requirement 11.1: Record policy — provider, policy number, coverage percentage, max claimable amount.
   *
   * @throws InvalidCoveragePercentageError if coveragePercentage is not in [0, 100].
   */
  async recordInsuranceDetails(
    seniorId: string,
    details: InsuranceDetails
  ): Promise<InsurancePolicy> {
    // Validate coverage percentage
    if (details.coveragePercentage < 0 || details.coveragePercentage > 100) {
      throw new InvalidCoveragePercentageError(details.coveragePercentage);
    }

    const now = this.dateProvider();
    const policy: InsurancePolicy = {
      id: this.idGenerator(),
      seniorId,
      provider: details.provider,
      policyNumber: details.policyNumber,
      coveragePercentage: details.coveragePercentage,
      maxClaimableAmount: details.maxClaimableAmount,
      validUntil: details.validUntil,
      createdAt: now,
    };

    return this.policyRepository.save(policy);
  }

  /**
   * Calculate insurance coverage for an invoice against a policy.
   *
   * Requirement 11.2: Calculate eligible amount: min(invoice × coverage%, max claimable).
   * Requirement 11.8: Cap claims at max claimable amount; assign remainder as patient responsibility.
   *
   * @throws PolicyNotFoundError if policyId does not exist.
   */
  async calculateCoverage(
    invoiceId: string,
    policyId: string
  ): Promise<CoverageCalculation> {
    const policy = await this.policyRepository.findById(policyId);
    if (!policy) {
      throw new PolicyNotFoundError(policyId);
    }

    const invoiceAmount = await this.invoiceLookup.getInvoiceAmount(invoiceId);

    // Business rule: eligibleAmount = min(invoiceAmount × coveragePercentage/100, maxClaimableAmount)
    const calculatedCoverage = roundToTwoDecimals(
      invoiceAmount * policy.coveragePercentage / 100
    );
    const eligibleAmount = roundToTwoDecimals(
      Math.min(calculatedCoverage, policy.maxClaimableAmount)
    );

    // Patient responsibility: invoiceAmount - eligibleAmount
    const patientResponsibility = roundToTwoDecimals(invoiceAmount - eligibleAmount);

    return {
      invoiceAmount: roundToTwoDecimals(invoiceAmount),
      coveragePercentage: policy.coveragePercentage,
      maxClaimableAmount: policy.maxClaimableAmount,
      eligibleAmount,
      patientResponsibility,
    };
  }

  /**
   * Submit an insurance claim.
   *
   * Requirement 11.3: Submit claim with line items, policy number, senior citizen ID.
   * Generates a unique reference number within 30 seconds.
   * Caps claims at maxClaimableAmount.
   * Requirement 11.7: On communication error, retain data and allow retry.
   *
   * @throws PolicyNotFoundError if policyId does not exist.
   * @throws PolicyExpiredError if the policy has expired.
   * @throws ClaimExceedsMaxError if claimedAmount exceeds maxClaimableAmount.
   */
  async submitClaim(request: ClaimSubmissionRequest): Promise<InsuranceClaim> {
    const policy = await this.policyRepository.findById(request.policyId);
    if (!policy) {
      throw new PolicyNotFoundError(request.policyId);
    }

    // Check if policy is expired
    const now = this.dateProvider();
    if (now > policy.validUntil) {
      throw new PolicyExpiredError(policy.id, policy.validUntil);
    }

    // Cap claims at maxClaimableAmount
    if (request.claimedAmount > policy.maxClaimableAmount) {
      throw new ClaimExceedsMaxError(request.claimedAmount, policy.maxClaimableAmount);
    }

    const claim: InsuranceClaim = {
      id: this.idGenerator(),
      invoiceId: request.invoiceId,
      seniorId: request.seniorId,
      policyNumber: policy.policyNumber,
      insuranceProvider: policy.provider,
      claimedAmount: roundToTwoDecimals(request.claimedAmount),
      lineItems: request.lineItems,
      status: 'submitted',
      submissionReference: this.referenceNumberGenerator(),
      submittedAt: now,
      lastStatusUpdate: now,
    };

    const savedClaim = await this.claimRepository.save(claim);

    // Attempt to submit to external insurance provider
    try {
      await this.insuranceProviderAdapter.submitClaim(savedClaim);
    } catch (error) {
      // Communication error: retain data, mark as failed, allow retry
      const failedClaim: InsuranceClaim = {
        ...savedClaim,
        status: 'failed',
        failureReason: error instanceof Error ? error.message : 'Communication error',
        lastStatusUpdate: this.dateProvider(),
      };
      await this.claimRepository.update(failedClaim);
      throw new ClaimSubmissionFailedError(savedClaim.id, error instanceof Error ? error : undefined);
    }

    return savedClaim;
  }

  /**
   * Get the current status of an insurance claim.
   *
   * Requirement 11.4: Display current claim status and date of last status update.
   *
   * @throws ClaimNotFoundError if claimId does not exist.
   */
  async getClaimStatus(claimId: string): Promise<ClaimStatus> {
    const claim = await this.claimRepository.findById(claimId);
    if (!claim) {
      throw new ClaimNotFoundError(claimId);
    }

    return {
      claimId: claim.id,
      status: claim.status,
      claimedAmount: claim.claimedAmount,
      approvedAmount: claim.approvedAmount,
      rejectionReason: claim.rejectionReason,
      failureReason: claim.failureReason,
      submissionReference: claim.submissionReference,
      submittedAt: claim.submittedAt,
      lastStatusUpdate: claim.lastStatusUpdate,
    };
  }

  /**
   * Process a claim approval.
   *
   * Reduces the invoice balance by the approved amount.
   *
   * @throws ClaimNotFoundError if claimId does not exist.
   * @throws InvalidClaimStateError if claim is not in 'submitted' or 'pending' state.
   */
  async processClaimApproval(claimId: string, approvedAmount: number): Promise<void> {
    const claim = await this.claimRepository.findById(claimId);
    if (!claim) {
      throw new ClaimNotFoundError(claimId);
    }

    if (claim.status !== 'submitted' && claim.status !== 'pending') {
      throw new InvalidClaimStateError(claimId, claim.status, 'submitted or pending');
    }

    const now = this.dateProvider();
    const updatedClaim: InsuranceClaim = {
      ...claim,
      status: 'approved',
      approvedAmount: roundToTwoDecimals(approvedAmount),
      lastStatusUpdate: now,
    };

    await this.claimRepository.update(updatedClaim);

    // Reduce invoice balance by approved amount
    await this.invoiceLookup.reduceInvoiceBalance(claim.invoiceId, roundToTwoDecimals(approvedAmount));
  }

  /**
   * Process a claim rejection.
   *
   * Requirement 11.6: Notify within 24 hours with the reason, mark full amount as patient responsibility.
   *
   * @throws ClaimNotFoundError if claimId does not exist.
   * @throws InvalidClaimStateError if claim is not in 'submitted' or 'pending' state.
   */
  async processClaimRejection(claimId: string, reason: string): Promise<void> {
    const claim = await this.claimRepository.findById(claimId);
    if (!claim) {
      throw new ClaimNotFoundError(claimId);
    }

    if (claim.status !== 'submitted' && claim.status !== 'pending') {
      throw new InvalidClaimStateError(claimId, claim.status, 'submitted or pending');
    }

    const now = this.dateProvider();
    const updatedClaim: InsuranceClaim = {
      ...claim,
      status: 'rejected',
      rejectionReason: reason,
      lastStatusUpdate: now,
    };

    await this.claimRepository.update(updatedClaim);

    // Mark full amount as patient responsibility
    await this.invoiceLookup.markFullAmountAsPatientResponsibility(claim.invoiceId);

    // Notify within 24 hours (fire-and-forget with error suppression)
    this.notifier.notifyClaimRejection(claim.seniorId, claimId, reason).catch(() => {
      // Log failure but don't block the operation
    });
  }

  /**
   * Retry a failed claim submission.
   *
   * Requirement 11.7: Retain claim data and allow retry after communication error.
   *
   * @throws ClaimNotFoundError if claimId does not exist.
   * @throws InvalidClaimStateError if claim is not in 'failed' state.
   * @throws ClaimSubmissionFailedError if the retry also fails.
   */
  async retryClaim(claimId: string): Promise<InsuranceClaim> {
    const claim = await this.claimRepository.findById(claimId);
    if (!claim) {
      throw new ClaimNotFoundError(claimId);
    }

    if (claim.status !== 'failed') {
      throw new InvalidClaimStateError(claimId, claim.status, 'failed');
    }

    // Attempt to resubmit to external insurance provider
    try {
      await this.insuranceProviderAdapter.submitClaim(claim);
    } catch (error) {
      // Update failure reason with latest error
      const failedClaim: InsuranceClaim = {
        ...claim,
        failureReason: error instanceof Error ? error.message : 'Communication error',
        lastStatusUpdate: this.dateProvider(),
      };
      await this.claimRepository.update(failedClaim);
      throw new ClaimSubmissionFailedError(claimId, error instanceof Error ? error : undefined);
    }

    // On success, update status back to submitted
    const now = this.dateProvider();
    const updatedClaim: InsuranceClaim = {
      ...claim,
      status: 'submitted',
      failureReason: undefined,
      lastStatusUpdate: now,
    };

    return this.claimRepository.update(updatedClaim);
  }

  /**
   * Get all claims for a senior citizen.
   *
   * Provides claim history for tracking and auditing purposes.
   */
  async getClaimHistory(seniorId: string): Promise<InsuranceClaim[]> {
    return this.claimRepository.findBySeniorId(seniorId);
  }
}
