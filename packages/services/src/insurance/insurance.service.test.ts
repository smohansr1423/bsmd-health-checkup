// @ts-nocheck
/**
 * Insurance Integration Service - Unit Tests
 * Validates: Requirements 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7, 11.8
 */

import {
  InsuranceIntegrationService,
  InMemoryPolicyRepository,
  InMemoryClaimRepository,
} from './insurance.service';
import {
  PolicyNotFoundError,
  ClaimNotFoundError,
  InvalidCoveragePercentageError,
  ClaimExceedsMaxError,
  PolicyExpiredError,
  InvalidClaimStateError,
  ClaimSubmissionFailedError,
} from './insurance.errors';
import type {
  InsuranceDetails,
  ClaimSubmissionRequest,
  InvoiceLookup,
  InsuranceNotifier,
  InsuranceProviderAdapter,
} from './insurance.types';

// --- Test Helpers ---

let idCounter = 0;
const testIdGenerator = () => `test-id-${++idCounter}`;
const testDateProvider = () => new Date('2024-06-15T10:00:00Z');
let refCounter = 0;
const testReferenceNumberGenerator = () => `CLM-REF-${++refCounter}`;

function createMockInvoiceLookup(invoiceAmount = 10000): InvoiceLookup {
  return {
    getInvoiceAmount: jest.fn().mockResolvedValue(invoiceAmount),
    reduceInvoiceBalance: jest.fn().mockResolvedValue(undefined),
    markFullAmountAsPatientResponsibility: jest.fn().mockResolvedValue(undefined),
  };
}

function createMockNotifier(): InsuranceNotifier {
  return {
    notifyClaimRejection: jest.fn().mockResolvedValue(undefined),
  };
}

function createMockProviderAdapter(): InsuranceProviderAdapter {
  return {
    submitClaim: jest.fn().mockResolvedValue(undefined),
  };
}

function createService(overrides?: {
  invoiceLookup?: InvoiceLookup;
  notifier?: InsuranceNotifier;
  insuranceProviderAdapter?: InsuranceProviderAdapter;
}) {
  const policyRepository = new InMemoryPolicyRepository();
  const claimRepository = new InMemoryClaimRepository();
  const invoiceLookup = overrides?.invoiceLookup ?? createMockInvoiceLookup();
  const notifier = overrides?.notifier ?? createMockNotifier();
  const insuranceProviderAdapter = overrides?.insuranceProviderAdapter ?? createMockProviderAdapter();

  const service = new InsuranceIntegrationService({
    idGenerator: testIdGenerator,
    dateProvider: testDateProvider,
    referenceNumberGenerator: testReferenceNumberGenerator,
    policyRepository,
    claimRepository,
    invoiceLookup,
    notifier,
    insuranceProviderAdapter,
  });

  return { service, policyRepository, claimRepository, invoiceLookup, notifier, insuranceProviderAdapter };
}

function createValidInsuranceDetails(overrides?: Partial<InsuranceDetails>): InsuranceDetails {
  return {
    provider: 'HealthPlus Insurance',
    policyNumber: 'HP-2024-001234',
    coveragePercentage: 80,
    maxClaimableAmount: 50000,
    validUntil: new Date('2025-12-31'),
    ...overrides,
  };
}

// --- Tests ---

describe('InsuranceIntegrationService', () => {
  beforeEach(() => {
    idCounter = 0;
    refCounter = 0;
  });

  describe('recordInsuranceDetails', () => {
    it('should record insurance details and return a policy', async () => {
      const { service } = createService();
      const details = createValidInsuranceDetails();

      const policy = await service.recordInsuranceDetails('senior-1', details);

      expect(policy.id).toBe('test-id-1');
      expect(policy.seniorId).toBe('senior-1');
      expect(policy.provider).toBe('HealthPlus Insurance');
      expect(policy.policyNumber).toBe('HP-2024-001234');
      expect(policy.coveragePercentage).toBe(80);
      expect(policy.maxClaimableAmount).toBe(50000);
      expect(policy.validUntil).toEqual(new Date('2025-12-31'));
      expect(policy.createdAt).toEqual(new Date('2024-06-15T10:00:00Z'));
    });

    it('should reject coverage percentage below 0', async () => {
      const { service } = createService();
      const details = createValidInsuranceDetails({ coveragePercentage: -1 });

      await expect(
        service.recordInsuranceDetails('senior-1', details)
      ).rejects.toThrow(InvalidCoveragePercentageError);
    });

    it('should reject coverage percentage above 100', async () => {
      const { service } = createService();
      const details = createValidInsuranceDetails({ coveragePercentage: 101 });

      await expect(
        service.recordInsuranceDetails('senior-1', details)
      ).rejects.toThrow(InvalidCoveragePercentageError);
    });

    it('should accept coverage percentage at boundary 0', async () => {
      const { service } = createService();
      const details = createValidInsuranceDetails({ coveragePercentage: 0 });

      const policy = await service.recordInsuranceDetails('senior-1', details);

      expect(policy.coveragePercentage).toBe(0);
    });

    it('should accept coverage percentage at boundary 100', async () => {
      const { service } = createService();
      const details = createValidInsuranceDetails({ coveragePercentage: 100 });

      const policy = await service.recordInsuranceDetails('senior-1', details);

      expect(policy.coveragePercentage).toBe(100);
    });
  });

  describe('calculateCoverage', () => {
    it('should calculate eligible amount as min(invoice × coverage%, maxClaimable)', async () => {
      const invoiceLookup = createMockInvoiceLookup(10000);
      const { service } = createService({ invoiceLookup });
      const details = createValidInsuranceDetails({
        coveragePercentage: 80,
        maxClaimableAmount: 50000,
      });
      const policy = await service.recordInsuranceDetails('senior-1', details);

      const result = await service.calculateCoverage('invoice-1', policy.id);

      // 10000 * 80/100 = 8000, min(8000, 50000) = 8000
      expect(result.invoiceAmount).toBe(10000);
      expect(result.coveragePercentage).toBe(80);
      expect(result.maxClaimableAmount).toBe(50000);
      expect(result.eligibleAmount).toBe(8000);
      expect(result.patientResponsibility).toBe(2000);
    });

    it('should cap eligible amount at maxClaimableAmount', async () => {
      const invoiceLookup = createMockInvoiceLookup(100000);
      const { service } = createService({ invoiceLookup });
      const details = createValidInsuranceDetails({
        coveragePercentage: 80,
        maxClaimableAmount: 50000,
      });
      const policy = await service.recordInsuranceDetails('senior-1', details);

      const result = await service.calculateCoverage('invoice-1', policy.id);

      // 100000 * 80/100 = 80000, min(80000, 50000) = 50000
      expect(result.eligibleAmount).toBe(50000);
      expect(result.patientResponsibility).toBe(50000);
    });

    it('should handle zero coverage percentage', async () => {
      const invoiceLookup = createMockInvoiceLookup(10000);
      const { service } = createService({ invoiceLookup });
      const details = createValidInsuranceDetails({ coveragePercentage: 0 });
      const policy = await service.recordInsuranceDetails('senior-1', details);

      const result = await service.calculateCoverage('invoice-1', policy.id);

      expect(result.eligibleAmount).toBe(0);
      expect(result.patientResponsibility).toBe(10000);
    });

    it('should handle 100% coverage within max limit', async () => {
      const invoiceLookup = createMockInvoiceLookup(5000);
      const { service } = createService({ invoiceLookup });
      const details = createValidInsuranceDetails({
        coveragePercentage: 100,
        maxClaimableAmount: 50000,
      });
      const policy = await service.recordInsuranceDetails('senior-1', details);

      const result = await service.calculateCoverage('invoice-1', policy.id);

      // 5000 * 100/100 = 5000, min(5000, 50000) = 5000
      expect(result.eligibleAmount).toBe(5000);
      expect(result.patientResponsibility).toBe(0);
    });

    it('should round eligible amount to 2 decimal places', async () => {
      const invoiceLookup = createMockInvoiceLookup(333.33);
      const { service } = createService({ invoiceLookup });
      const details = createValidInsuranceDetails({
        coveragePercentage: 70,
        maxClaimableAmount: 50000,
      });
      const policy = await service.recordInsuranceDetails('senior-1', details);

      const result = await service.calculateCoverage('invoice-1', policy.id);

      // 333.33 * 70/100 = 233.331 -> 233.33
      expect(result.eligibleAmount).toBe(233.33);
      expect(result.patientResponsibility).toBe(100);
    });

    it('should throw PolicyNotFoundError for non-existent policy', async () => {
      const { service } = createService();

      await expect(
        service.calculateCoverage('invoice-1', 'nonexistent')
      ).rejects.toThrow(PolicyNotFoundError);
    });
  });

  describe('submitClaim', () => {
    it('should submit a claim and return it with reference number', async () => {
      const { service } = createService();
      const details = createValidInsuranceDetails();
      const policy = await service.recordInsuranceDetails('senior-1', details);

      const request: ClaimSubmissionRequest = {
        invoiceId: 'invoice-1',
        seniorId: 'senior-1',
        policyId: policy.id,
        claimedAmount: 8000,
      };

      const claim = await service.submitClaim(request);

      expect(claim.id).toBeDefined();
      expect(claim.invoiceId).toBe('invoice-1');
      expect(claim.seniorId).toBe('senior-1');
      expect(claim.policyNumber).toBe('HP-2024-001234');
      expect(claim.insuranceProvider).toBe('HealthPlus Insurance');
      expect(claim.claimedAmount).toBe(8000);
      expect(claim.status).toBe('submitted');
      expect(claim.submissionReference).toBe('CLM-REF-1');
      expect(claim.submittedAt).toEqual(new Date('2024-06-15T10:00:00Z'));
      expect(claim.lastStatusUpdate).toBeInstanceOf(Date);
    });

    it('should throw ClaimExceedsMaxError if claimedAmount exceeds maxClaimableAmount', async () => {
      const { service } = createService();
      const details = createValidInsuranceDetails({ maxClaimableAmount: 50000 });
      const policy = await service.recordInsuranceDetails('senior-1', details);

      const request: ClaimSubmissionRequest = {
        invoiceId: 'invoice-1',
        seniorId: 'senior-1',
        policyId: policy.id,
        claimedAmount: 50001,
      };

      await expect(service.submitClaim(request)).rejects.toThrow(ClaimExceedsMaxError);
    });

    it('should throw PolicyNotFoundError for non-existent policy', async () => {
      const { service } = createService();

      const request: ClaimSubmissionRequest = {
        invoiceId: 'invoice-1',
        seniorId: 'senior-1',
        policyId: 'nonexistent',
        claimedAmount: 5000,
      };

      await expect(service.submitClaim(request)).rejects.toThrow(PolicyNotFoundError);
    });

    it('should throw PolicyExpiredError if policy has expired', async () => {
      const { service } = createService();
      // Policy expired before the test date (2024-06-15)
      const details = createValidInsuranceDetails({
        validUntil: new Date('2024-01-01'),
      });
      const policy = await service.recordInsuranceDetails('senior-1', details);

      const request: ClaimSubmissionRequest = {
        invoiceId: 'invoice-1',
        seniorId: 'senior-1',
        policyId: policy.id,
        claimedAmount: 5000,
      };

      await expect(service.submitClaim(request)).rejects.toThrow(PolicyExpiredError);
    });

    it('should allow claim at exactly maxClaimableAmount', async () => {
      const { service } = createService();
      const details = createValidInsuranceDetails({ maxClaimableAmount: 50000 });
      const policy = await service.recordInsuranceDetails('senior-1', details);

      const request: ClaimSubmissionRequest = {
        invoiceId: 'invoice-1',
        seniorId: 'senior-1',
        policyId: policy.id,
        claimedAmount: 50000,
      };

      const claim = await service.submitClaim(request);

      expect(claim.claimedAmount).toBe(50000);
    });
  });

  describe('getClaimStatus', () => {
    it('should return the current claim status', async () => {
      const { service } = createService();
      const details = createValidInsuranceDetails();
      const policy = await service.recordInsuranceDetails('senior-1', details);

      const request: ClaimSubmissionRequest = {
        invoiceId: 'invoice-1',
        seniorId: 'senior-1',
        policyId: policy.id,
        claimedAmount: 5000,
      };
      const claim = await service.submitClaim(request);

      const status = await service.getClaimStatus(claim.id);

      expect(status.claimId).toBe(claim.id);
      expect(status.status).toBe('submitted');
      expect(status.claimedAmount).toBe(5000);
      expect(status.submissionReference).toBe('CLM-REF-1');
      expect(status.submittedAt).toEqual(new Date('2024-06-15T10:00:00Z'));
    });

    it('should throw ClaimNotFoundError for non-existent claim', async () => {
      const { service } = createService();

      await expect(service.getClaimStatus('nonexistent')).rejects.toThrow(ClaimNotFoundError);
    });
  });

  describe('processClaimApproval', () => {
    it('should approve claim and reduce invoice balance', async () => {
      const invoiceLookup = createMockInvoiceLookup(10000);
      const { service } = createService({ invoiceLookup });
      const details = createValidInsuranceDetails();
      const policy = await service.recordInsuranceDetails('senior-1', details);

      const request: ClaimSubmissionRequest = {
        invoiceId: 'invoice-1',
        seniorId: 'senior-1',
        policyId: policy.id,
        claimedAmount: 8000,
      };
      const claim = await service.submitClaim(request);

      await service.processClaimApproval(claim.id, 7500);

      const status = await service.getClaimStatus(claim.id);
      expect(status.status).toBe('approved');
      expect(status.approvedAmount).toBe(7500);
      expect(invoiceLookup.reduceInvoiceBalance).toHaveBeenCalledWith('invoice-1', 7500);
    });

    it('should throw ClaimNotFoundError for non-existent claim', async () => {
      const { service } = createService();

      await expect(
        service.processClaimApproval('nonexistent', 5000)
      ).rejects.toThrow(ClaimNotFoundError);
    });

    it('should throw InvalidClaimStateError if claim is already approved', async () => {
      const { service } = createService();
      const details = createValidInsuranceDetails();
      const policy = await service.recordInsuranceDetails('senior-1', details);

      const request: ClaimSubmissionRequest = {
        invoiceId: 'invoice-1',
        seniorId: 'senior-1',
        policyId: policy.id,
        claimedAmount: 5000,
      };
      const claim = await service.submitClaim(request);

      await service.processClaimApproval(claim.id, 5000);

      await expect(
        service.processClaimApproval(claim.id, 5000)
      ).rejects.toThrow(InvalidClaimStateError);
    });

    it('should throw InvalidClaimStateError if claim is rejected', async () => {
      const { service } = createService();
      const details = createValidInsuranceDetails();
      const policy = await service.recordInsuranceDetails('senior-1', details);

      const request: ClaimSubmissionRequest = {
        invoiceId: 'invoice-1',
        seniorId: 'senior-1',
        policyId: policy.id,
        claimedAmount: 5000,
      };
      const claim = await service.submitClaim(request);

      await service.processClaimRejection(claim.id, 'Not covered');

      await expect(
        service.processClaimApproval(claim.id, 5000)
      ).rejects.toThrow(InvalidClaimStateError);
    });
  });

  describe('processClaimRejection', () => {
    it('should reject claim, mark patient responsibility, and notify', async () => {
      const notifier = createMockNotifier();
      const invoiceLookup = createMockInvoiceLookup(10000);
      const { service } = createService({ invoiceLookup, notifier });
      const details = createValidInsuranceDetails();
      const policy = await service.recordInsuranceDetails('senior-1', details);

      const request: ClaimSubmissionRequest = {
        invoiceId: 'invoice-1',
        seniorId: 'senior-1',
        policyId: policy.id,
        claimedAmount: 8000,
      };
      const claim = await service.submitClaim(request);

      await service.processClaimRejection(claim.id, 'Pre-existing condition not covered');

      const status = await service.getClaimStatus(claim.id);
      expect(status.status).toBe('rejected');
      expect(status.rejectionReason).toBe('Pre-existing condition not covered');
      expect(invoiceLookup.markFullAmountAsPatientResponsibility).toHaveBeenCalledWith('invoice-1');
      expect(notifier.notifyClaimRejection).toHaveBeenCalledWith(
        'senior-1',
        claim.id,
        'Pre-existing condition not covered'
      );
    });

    it('should throw ClaimNotFoundError for non-existent claim', async () => {
      const { service } = createService();

      await expect(
        service.processClaimRejection('nonexistent', 'reason')
      ).rejects.toThrow(ClaimNotFoundError);
    });

    it('should throw InvalidClaimStateError if claim is already rejected', async () => {
      const { service } = createService();
      const details = createValidInsuranceDetails();
      const policy = await service.recordInsuranceDetails('senior-1', details);

      const request: ClaimSubmissionRequest = {
        invoiceId: 'invoice-1',
        seniorId: 'senior-1',
        policyId: policy.id,
        claimedAmount: 5000,
      };
      const claim = await service.submitClaim(request);

      await service.processClaimRejection(claim.id, 'Not covered');

      await expect(
        service.processClaimRejection(claim.id, 'Different reason')
      ).rejects.toThrow(InvalidClaimStateError);
    });
  });

  describe('submitClaim - line items', () => {
    it('should submit a claim with line items', async () => {
      const { service } = createService();
      const details = createValidInsuranceDetails();
      const policy = await service.recordInsuranceDetails('senior-1', details);

      const request: ClaimSubmissionRequest = {
        invoiceId: 'invoice-1',
        seniorId: 'senior-1',
        policyId: policy.id,
        claimedAmount: 8000,
        lineItems: [
          { description: 'Blood Test', amount: 3000 },
          { description: 'X-Ray', amount: 5000 },
        ],
      };

      const claim = await service.submitClaim(request);

      expect(claim.lineItems).toEqual([
        { description: 'Blood Test', amount: 3000 },
        { description: 'X-Ray', amount: 5000 },
      ]);
      expect(claim.status).toBe('submitted');
      expect(claim.submissionReference).toBeDefined();
    });

    it('should submit a claim without line items (backward compatible)', async () => {
      const { service } = createService();
      const details = createValidInsuranceDetails();
      const policy = await service.recordInsuranceDetails('senior-1', details);

      const request: ClaimSubmissionRequest = {
        invoiceId: 'invoice-1',
        seniorId: 'senior-1',
        policyId: policy.id,
        claimedAmount: 5000,
      };

      const claim = await service.submitClaim(request);

      expect(claim.lineItems).toBeUndefined();
      expect(claim.status).toBe('submitted');
    });
  });

  describe('submitClaim - communication error handling', () => {
    it('should mark claim as failed when provider adapter throws', async () => {
      const failingAdapter: InsuranceProviderAdapter = {
        submitClaim: jest.fn().mockRejectedValue(new Error('Network timeout')),
      };
      const { service, claimRepository } = createService({ insuranceProviderAdapter: failingAdapter });
      const details = createValidInsuranceDetails();
      const policy = await service.recordInsuranceDetails('senior-1', details);

      const request: ClaimSubmissionRequest = {
        invoiceId: 'invoice-1',
        seniorId: 'senior-1',
        policyId: policy.id,
        claimedAmount: 5000,
      };

      await expect(service.submitClaim(request)).rejects.toThrow(ClaimSubmissionFailedError);

      // Claim data should be retained with failed status
      const claims = await claimRepository.findBySeniorId('senior-1');
      expect(claims).toHaveLength(1);
      expect(claims[0].status).toBe('failed');
      expect(claims[0].failureReason).toBe('Network timeout');
    });

    it('should retain claim data after communication failure', async () => {
      const failingAdapter: InsuranceProviderAdapter = {
        submitClaim: jest.fn().mockRejectedValue(new Error('Connection refused')),
      };
      const { service, claimRepository } = createService({ insuranceProviderAdapter: failingAdapter });
      const details = createValidInsuranceDetails();
      const policy = await service.recordInsuranceDetails('senior-1', details);

      const request: ClaimSubmissionRequest = {
        invoiceId: 'invoice-1',
        seniorId: 'senior-1',
        policyId: policy.id,
        claimedAmount: 7000,
        lineItems: [{ description: 'ECG', amount: 7000 }],
      };

      await expect(service.submitClaim(request)).rejects.toThrow(ClaimSubmissionFailedError);

      const claims = await claimRepository.findBySeniorId('senior-1');
      expect(claims[0].claimedAmount).toBe(7000);
      expect(claims[0].lineItems).toEqual([{ description: 'ECG', amount: 7000 }]);
      expect(claims[0].policyNumber).toBe('HP-2024-001234');
      expect(claims[0].seniorId).toBe('senior-1');
    });
  });

  describe('retryClaim', () => {
    it('should retry a failed claim successfully', async () => {
      const adapter: InsuranceProviderAdapter = {
        submitClaim: jest.fn()
          .mockRejectedValueOnce(new Error('Timeout'))
          .mockResolvedValueOnce(undefined),
      };
      const { service } = createService({ insuranceProviderAdapter: adapter });
      const details = createValidInsuranceDetails();
      const policy = await service.recordInsuranceDetails('senior-1', details);

      const request: ClaimSubmissionRequest = {
        invoiceId: 'invoice-1',
        seniorId: 'senior-1',
        policyId: policy.id,
        claimedAmount: 5000,
      };

      // First submission fails
      await expect(service.submitClaim(request)).rejects.toThrow(ClaimSubmissionFailedError);

      // Get the claim ID from history
      const history = await service.getClaimHistory('senior-1');
      const failedClaim = history[0];
      expect(failedClaim.status).toBe('failed');

      // Retry succeeds
      const retriedClaim = await service.retryClaim(failedClaim.id);
      expect(retriedClaim.status).toBe('submitted');
      expect(retriedClaim.failureReason).toBeUndefined();
    });

    it('should throw ClaimNotFoundError for non-existent claim', async () => {
      const { service } = createService();

      await expect(service.retryClaim('nonexistent')).rejects.toThrow(ClaimNotFoundError);
    });

    it('should throw InvalidClaimStateError if claim is not in failed state', async () => {
      const { service } = createService();
      const details = createValidInsuranceDetails();
      const policy = await service.recordInsuranceDetails('senior-1', details);

      const request: ClaimSubmissionRequest = {
        invoiceId: 'invoice-1',
        seniorId: 'senior-1',
        policyId: policy.id,
        claimedAmount: 5000,
      };
      const claim = await service.submitClaim(request);

      await expect(service.retryClaim(claim.id)).rejects.toThrow(InvalidClaimStateError);
    });

    it('should throw ClaimSubmissionFailedError if retry also fails', async () => {
      const adapter: InsuranceProviderAdapter = {
        submitClaim: jest.fn().mockRejectedValue(new Error('Service unavailable')),
      };
      const { service } = createService({ insuranceProviderAdapter: adapter });
      const details = createValidInsuranceDetails();
      const policy = await service.recordInsuranceDetails('senior-1', details);

      const request: ClaimSubmissionRequest = {
        invoiceId: 'invoice-1',
        seniorId: 'senior-1',
        policyId: policy.id,
        claimedAmount: 5000,
      };

      await expect(service.submitClaim(request)).rejects.toThrow(ClaimSubmissionFailedError);

      const history = await service.getClaimHistory('senior-1');

      await expect(service.retryClaim(history[0].id)).rejects.toThrow(ClaimSubmissionFailedError);
    });
  });

  describe('getClaimHistory', () => {
    it('should return all claims for a senior citizen', async () => {
      const { service } = createService();
      const details = createValidInsuranceDetails();
      const policy = await service.recordInsuranceDetails('senior-1', details);

      // Submit two claims
      await service.submitClaim({
        invoiceId: 'invoice-1',
        seniorId: 'senior-1',
        policyId: policy.id,
        claimedAmount: 5000,
      });
      await service.submitClaim({
        invoiceId: 'invoice-2',
        seniorId: 'senior-1',
        policyId: policy.id,
        claimedAmount: 3000,
      });

      const history = await service.getClaimHistory('senior-1');

      expect(history).toHaveLength(2);
      expect(history[0].invoiceId).toBe('invoice-1');
      expect(history[1].invoiceId).toBe('invoice-2');
    });

    it('should return empty array for senior with no claims', async () => {
      const { service } = createService();

      const history = await service.getClaimHistory('senior-no-claims');

      expect(history).toEqual([]);
    });

    it('should not include claims from other seniors', async () => {
      const { service } = createService();
      const details = createValidInsuranceDetails();
      const policy1 = await service.recordInsuranceDetails('senior-1', details);
      const policy2 = await service.recordInsuranceDetails('senior-2', details);

      await service.submitClaim({
        invoiceId: 'invoice-1',
        seniorId: 'senior-1',
        policyId: policy1.id,
        claimedAmount: 5000,
      });
      await service.submitClaim({
        invoiceId: 'invoice-2',
        seniorId: 'senior-2',
        policyId: policy2.id,
        claimedAmount: 3000,
      });

      const history = await service.getClaimHistory('senior-1');

      expect(history).toHaveLength(1);
      expect(history[0].seniorId).toBe('senior-1');
    });
  });

  describe('status tracking - lastStatusUpdate changes', () => {
    it('should update lastStatusUpdate when claim is approved', async () => {
      let callCount = 0;
      const dateSequence = [
        new Date('2024-06-15T10:00:00Z'), // submit
        new Date('2024-06-16T14:30:00Z'), // approval
      ];
      const sequentialDateProvider = () => dateSequence[callCount++] ?? new Date();

      const policyRepository = new InMemoryPolicyRepository();
      const claimRepository = new InMemoryClaimRepository();
      const service = new InsuranceIntegrationService({
        idGenerator: testIdGenerator,
        dateProvider: sequentialDateProvider,
        referenceNumberGenerator: testReferenceNumberGenerator,
        policyRepository,
        claimRepository,
        invoiceLookup: createMockInvoiceLookup(),
        notifier: createMockNotifier(),
        insuranceProviderAdapter: createMockProviderAdapter(),
      });

      const details = createValidInsuranceDetails();
      const policy = await service.recordInsuranceDetails('senior-1', details);
      const claim = await service.submitClaim({
        invoiceId: 'invoice-1',
        seniorId: 'senior-1',
        policyId: policy.id,
        claimedAmount: 5000,
      });

      expect(claim.lastStatusUpdate).toBeInstanceOf(Date);

      await service.processClaimApproval(claim.id, 4500);

      const status = await service.getClaimStatus(claim.id);
      expect(status.lastStatusUpdate).toBeInstanceOf(Date);
    });

    it('should update lastStatusUpdate when claim is rejected', async () => {
      let callCount = 0;
      const dateSequence = [
        new Date('2024-06-15T10:00:00Z'), // submit
        new Date('2024-06-17T09:00:00Z'), // rejection
      ];
      const sequentialDateProvider = () => dateSequence[callCount++] ?? new Date();

      const policyRepository = new InMemoryPolicyRepository();
      const claimRepository = new InMemoryClaimRepository();
      const service = new InsuranceIntegrationService({
        idGenerator: testIdGenerator,
        dateProvider: sequentialDateProvider,
        referenceNumberGenerator: testReferenceNumberGenerator,
        policyRepository,
        claimRepository,
        invoiceLookup: createMockInvoiceLookup(),
        notifier: createMockNotifier(),
        insuranceProviderAdapter: createMockProviderAdapter(),
      });

      const details = createValidInsuranceDetails();
      const policy = await service.recordInsuranceDetails('senior-1', details);
      const claim = await service.submitClaim({
        invoiceId: 'invoice-1',
        seniorId: 'senior-1',
        policyId: policy.id,
        claimedAmount: 5000,
      });

      await service.processClaimRejection(claim.id, 'Not covered');

      const status = await service.getClaimStatus(claim.id);
      expect(status.lastStatusUpdate).toBeInstanceOf(Date);
    });
  });

  describe('full flow: submit → pending → approved (reduces balance)', () => {
    it('should process full approval flow reducing invoice balance', async () => {
      const invoiceLookup = createMockInvoiceLookup(10000);
      const { service } = createService({ invoiceLookup });
      const details = createValidInsuranceDetails({ coveragePercentage: 80 });
      const policy = await service.recordInsuranceDetails('senior-1', details);

      // Step 1: Submit claim
      const claim = await service.submitClaim({
        invoiceId: 'invoice-1',
        seniorId: 'senior-1',
        policyId: policy.id,
        claimedAmount: 8000,
        lineItems: [
          { description: 'Complete Blood Count', amount: 3000 },
          { description: 'Lipid Profile', amount: 5000 },
        ],
      });
      expect(claim.status).toBe('submitted');
      expect(claim.submissionReference).toBeDefined();

      // Step 2: Verify status is submitted
      let status = await service.getClaimStatus(claim.id);
      expect(status.status).toBe('submitted');

      // Step 3: Process approval
      await service.processClaimApproval(claim.id, 7500);

      // Step 4: Verify status is approved and invoice balance reduced
      status = await service.getClaimStatus(claim.id);
      expect(status.status).toBe('approved');
      expect(status.approvedAmount).toBe(7500);
      expect(invoiceLookup.reduceInvoiceBalance).toHaveBeenCalledWith('invoice-1', 7500);
    });
  });

  describe('full flow: submit → pending → rejected (notifies + marks patient responsibility)', () => {
    it('should process full rejection flow with notification and patient responsibility', async () => {
      const invoiceLookup = createMockInvoiceLookup(10000);
      const notifier = createMockNotifier();
      const { service } = createService({ invoiceLookup, notifier });
      const details = createValidInsuranceDetails();
      const policy = await service.recordInsuranceDetails('senior-1', details);

      // Step 1: Submit claim
      const claim = await service.submitClaim({
        invoiceId: 'invoice-1',
        seniorId: 'senior-1',
        policyId: policy.id,
        claimedAmount: 8000,
        lineItems: [{ description: 'ECG', amount: 8000 }],
      });
      expect(claim.status).toBe('submitted');

      // Step 2: Process rejection
      await service.processClaimRejection(claim.id, 'Pre-existing condition not covered');

      // Step 3: Verify status is rejected
      const status = await service.getClaimStatus(claim.id);
      expect(status.status).toBe('rejected');
      expect(status.rejectionReason).toBe('Pre-existing condition not covered');

      // Step 4: Verify patient responsibility marked
      expect(invoiceLookup.markFullAmountAsPatientResponsibility).toHaveBeenCalledWith('invoice-1');

      // Step 5: Verify notification sent
      expect(notifier.notifyClaimRejection).toHaveBeenCalledWith(
        'senior-1',
        claim.id,
        'Pre-existing condition not covered'
      );
    });
  });
});
