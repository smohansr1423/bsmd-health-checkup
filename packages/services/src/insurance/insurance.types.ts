/**
 * Insurance Integration Service Types
 * Request/response types and repository interfaces for insurance policy management.
 * Validates: Requirements 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7, 11.8
 */

import type { InsuranceClaim, ClaimLineItem } from '@health-checkup/shared';

export type { InsuranceClaim, ClaimLineItem };

/**
 * Details provided when recording an insurance policy for a senior citizen.
 */
export interface InsuranceDetails {
  provider: string;
  policyNumber: string;
  coveragePercentage: number; // 0-100
  maxClaimableAmount: number;
  validUntil: Date;
}

/**
 * Recorded insurance policy linked to a senior citizen.
 */
export interface InsurancePolicy {
  id: string;
  seniorId: string;
  provider: string;
  policyNumber: string;
  coveragePercentage: number; // 0-100
  maxClaimableAmount: number;
  validUntil: Date;
  createdAt: Date;
}

/**
 * Result of a coverage calculation for an invoice against a policy.
 *
 * Business rule: eligibleAmount = min(invoiceAmount × coveragePercentage/100, maxClaimableAmount)
 * Patient responsibility: invoiceAmount - eligibleAmount
 */
export interface CoverageCalculation {
  invoiceAmount: number;
  coveragePercentage: number;
  maxClaimableAmount: number;
  eligibleAmount: number;
  patientResponsibility: number;
}

/**
 * Request to submit an insurance claim.
 */
export interface ClaimSubmissionRequest {
  invoiceId: string;
  seniorId: string;
  policyId: string;
  claimedAmount: number;
  lineItems?: ClaimLineItem[];
}

/**
 * Status of an insurance claim with all relevant tracking info.
 */
export interface ClaimStatus {
  claimId: string;
  status: 'submitted' | 'pending' | 'approved' | 'rejected' | 'failed';
  claimedAmount: number;
  approvedAmount?: number;
  rejectionReason?: string;
  failureReason?: string;
  submissionReference: string;
  submittedAt: Date;
  lastStatusUpdate: Date;
}

/**
 * Repository interface for InsurancePolicy persistence.
 */
export interface InsurancePolicyRepository {
  save(policy: InsurancePolicy): Promise<InsurancePolicy>;
  findById(id: string): Promise<InsurancePolicy | null>;
  findBySeniorId(seniorId: string): Promise<InsurancePolicy[]>;
}

/**
 * Repository interface for InsuranceClaim persistence.
 */
export interface InsuranceClaimRepository {
  save(claim: InsuranceClaim): Promise<InsuranceClaim>;
  findById(id: string): Promise<InsuranceClaim | null>;
  findByInvoiceId(invoiceId: string): Promise<InsuranceClaim[]>;
  findBySeniorId(seniorId: string): Promise<InsuranceClaim[]>;
  update(claim: InsuranceClaim): Promise<InsuranceClaim>;
}

/**
 * Interface to look up invoice details for coverage calculation.
 */
export interface InvoiceLookup {
  getInvoiceAmount(invoiceId: string): Promise<number>;
  reduceInvoiceBalance(invoiceId: string, amount: number): Promise<void>;
  markFullAmountAsPatientResponsibility(invoiceId: string): Promise<void>;
}

/**
 * Notification service interface for claim rejection alerts.
 */
export interface InsuranceNotifier {
  notifyClaimRejection(seniorId: string, claimId: string, reason: string): Promise<void>;
}

/**
 * External insurance provider adapter for submitting claims.
 * Abstraction for the external API call to the insurance company.
 */
export interface InsuranceProviderAdapter {
  submitClaim(claim: InsuranceClaim): Promise<void>;
}

/**
 * Dependencies injected into the InsuranceIntegrationService for testability.
 */
export interface InsuranceDependencies {
  idGenerator: () => string;
  dateProvider: () => Date;
  referenceNumberGenerator: () => string;
  policyRepository: InsurancePolicyRepository;
  claimRepository: InsuranceClaimRepository;
  invoiceLookup: InvoiceLookup;
  notifier: InsuranceNotifier;
  insuranceProviderAdapter?: InsuranceProviderAdapter;
}
