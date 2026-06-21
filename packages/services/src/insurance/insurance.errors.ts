/**
 * Insurance Integration Errors
 * Custom error types for the insurance integration service.
 * Validates: Requirements 11.1, 11.2, 11.8
 */

/**
 * Thrown when an insurance policy is not found by ID.
 */
export class PolicyNotFoundError extends Error {
  public readonly policyId: string;

  constructor(policyId: string) {
    super(`Insurance policy not found: ${policyId}`);
    this.name = 'PolicyNotFoundError';
    this.policyId = policyId;
  }
}

/**
 * Thrown when an insurance claim is not found by ID.
 */
export class ClaimNotFoundError extends Error {
  public readonly claimId: string;

  constructor(claimId: string) {
    super(`Insurance claim not found: ${claimId}`);
    this.name = 'ClaimNotFoundError';
    this.claimId = claimId;
  }
}

/**
 * Thrown when coverage percentage is outside the valid range (0-100).
 */
export class InvalidCoveragePercentageError extends Error {
  public readonly coveragePercentage: number;

  constructor(coveragePercentage: number) {
    super(
      `Coverage percentage must be between 0 and 100. Received: ${coveragePercentage}.`
    );
    this.name = 'InvalidCoveragePercentageError';
    this.coveragePercentage = coveragePercentage;
  }
}

/**
 * Thrown when a claim is submitted for an amount exceeding the max claimable amount.
 */
export class ClaimExceedsMaxError extends Error {
  public readonly claimedAmount: number;
  public readonly maxClaimableAmount: number;

  constructor(claimedAmount: number, maxClaimableAmount: number) {
    super(
      `Claimed amount (${claimedAmount}) exceeds maximum claimable amount (${maxClaimableAmount}).`
    );
    this.name = 'ClaimExceedsMaxError';
    this.claimedAmount = claimedAmount;
    this.maxClaimableAmount = maxClaimableAmount;
  }
}

/**
 * Thrown when a policy has expired and cannot be used for claims.
 */
export class PolicyExpiredError extends Error {
  public readonly policyId: string;
  public readonly validUntil: Date;

  constructor(policyId: string, validUntil: Date) {
    super(
      `Insurance policy ${policyId} expired on ${validUntil.toISOString()}. Cannot process claim.`
    );
    this.name = 'PolicyExpiredError';
    this.policyId = policyId;
    this.validUntil = validUntil;
  }
}

/**
 * Thrown when a claim is in an invalid state for the requested operation.
 */
export class InvalidClaimStateError extends Error {
  public readonly claimId: string;
  public readonly currentStatus: string;
  public readonly expectedStatus: string;

  constructor(claimId: string, currentStatus: string, expectedStatus: string) {
    super(
      `Claim ${claimId} is in state '${currentStatus}', expected '${expectedStatus}' for this operation.`
    );
    this.name = 'InvalidClaimStateError';
    this.claimId = claimId;
    this.currentStatus = currentStatus;
    this.expectedStatus = expectedStatus;
  }
}

/**
 * Thrown when a claim submission to the insurance provider fails due to a communication error.
 */
export class ClaimSubmissionFailedError extends Error {
  public readonly claimId: string;
  public readonly originalError?: Error;

  constructor(claimId: string, originalError?: Error) {
    super(
      `Claim submission failed for claim ${claimId}: ${originalError?.message ?? 'Communication error'}`
    );
    this.name = 'ClaimSubmissionFailedError';
    this.claimId = claimId;
    this.originalError = originalError;
  }
}
