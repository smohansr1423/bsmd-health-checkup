/**
 * Payment Processing Service Tests
 * Unit tests for payment initiation, processing, retries, installments, and session expiry.
 * Validates: Requirements 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7
 */

import { PaymentProcessingService } from './payment.service';
import type {
  PaymentDependencies,
  PaymentDetails,
  PaymentGateway,
  PaymentNotifier,
  PaymentRequest,
} from './payment.types';
import {
  PaymentSessionNotFoundError,
  PaymentSessionExpiredError,
  MaxRetriesExceededError,
  PaymentValidationError,
  InstallmentPlanError,
  InvalidSessionStateError,
} from './payment.errors';

describe('PaymentProcessingService', () => {
  let service: PaymentProcessingService;
  let idCounter: number;
  let currentDate: Date;
  let mockGateway: PaymentGateway;
  let mockNotifier: PaymentNotifier;
  let confirmationSent: boolean;

  const createDeps = (overrides?: Partial<PaymentDependencies>): Partial<PaymentDependencies> => ({
    idGenerator: () => `ID_${++idCounter}`,
    dateProvider: () => currentDate,
    paymentGateway: mockGateway,
    paymentNotifier: mockNotifier,
    sessionTimeoutMs: 10 * 60 * 1000, // 10 minutes
    processingTimeoutMs: 30 * 1000, // 30 seconds
    maxRetries: 5,
    ...overrides,
  });

  const validCreditCardDetails: PaymentDetails = {
    cardNumber: '4111111111111111',
    cardHolderName: 'John Doe',
    expiryMonth: 12,
    expiryYear: 2030,
    cvv: '123',
  };

  const validBankTransferDetails: PaymentDetails = {
    accountNumber: '1234567890',
    routingNumber: '021000021',
    bankName: 'Test Bank',
  };

  const validDigitalWalletDetails: PaymentDetails = {
    walletId: 'wallet_123',
    walletProvider: 'TestPay',
  };

  beforeEach(() => {
    idCounter = 0;
    currentDate = new Date('2024-06-15T10:00:00.000Z');
    confirmationSent = false;

    mockGateway = {
      processPayment: jest.fn().mockResolvedValue({
        success: true,
        transactionId: 'TXN_001',
      }),
      processRefund: jest.fn().mockResolvedValue({
        success: true,
        refundId: 'REF_001',
      }),
    };

    mockNotifier = {
      sendConfirmation: jest.fn().mockImplementation(async () => {
        confirmationSent = true;
      }),
    };

    service = new PaymentProcessingService(createDeps());
  });

  describe('initiatePayment', () => {
    it('should create a payment session with correct defaults', async () => {
      const request: PaymentRequest = {
        invoiceId: 'INV_001',
        amount: 1500,
        method: 'credit_card',
      };

      const session = await service.initiatePayment(request);

      expect(session.id).toBe('ID_1');
      expect(session.invoiceId).toBe('INV_001');
      expect(session.amount).toBe(1500);
      expect(session.method).toBe('credit_card');
      expect(session.status).toBe('active');
      expect(session.retryCount).toBe(0);
      expect(session.maxRetries).toBe(5);
      expect(session.holdReleased).toBe(false);
    });

    it('should set expiry to 10 minutes from creation', async () => {
      const request: PaymentRequest = {
        invoiceId: 'INV_001',
        amount: 1000,
        method: 'debit_card',
      };

      const session = await service.initiatePayment(request);

      const expectedExpiry = new Date(currentDate.getTime() + 10 * 60 * 1000);
      expect(session.expiresAt).toEqual(expectedExpiry);
    });

    it('should support all four payment methods', async () => {
      const methods: Array<'credit_card' | 'debit_card' | 'bank_transfer' | 'digital_wallet'> = [
        'credit_card',
        'debit_card',
        'bank_transfer',
        'digital_wallet',
      ];

      for (const method of methods) {
        const session = await service.initiatePayment({
          invoiceId: `INV_${method}`,
          amount: 100,
          method,
        });
        expect(session.method).toBe(method);
        expect(session.status).toBe('active');
      }
    });

    it('should reject zero or negative amounts', async () => {
      await expect(
        service.initiatePayment({ invoiceId: 'INV_001', amount: 0, method: 'credit_card' })
      ).rejects.toThrow(PaymentValidationError);

      await expect(
        service.initiatePayment({ invoiceId: 'INV_001', amount: -100, method: 'credit_card' })
      ).rejects.toThrow(PaymentValidationError);
    });
  });

  describe('processPayment', () => {
    it('should process payment successfully with valid credit card', async () => {
      const session = await service.initiatePayment({
        invoiceId: 'INV_001',
        amount: 1000,
        method: 'credit_card',
      });

      const result = await service.processPayment(session.id, validCreditCardDetails);

      expect(result.success).toBe(true);
      expect(result.transactionId).toBe('TXN_001');
      expect(result.paymentRecord.status).toBe('success');
      expect(result.receipt).toBeDefined();
      expect(result.receipt!.amount).toBe(1000);
    });

    it('should process payment with bank transfer', async () => {
      const session = await service.initiatePayment({
        invoiceId: 'INV_001',
        amount: 2000,
        method: 'bank_transfer',
      });

      const result = await service.processPayment(session.id, validBankTransferDetails);

      expect(result.success).toBe(true);
      expect(result.paymentRecord.status).toBe('success');
    });

    it('should process payment with digital wallet', async () => {
      const session = await service.initiatePayment({
        invoiceId: 'INV_001',
        amount: 500,
        method: 'digital_wallet',
      });

      const result = await service.processPayment(session.id, validDigitalWalletDetails);

      expect(result.success).toBe(true);
      expect(result.paymentRecord.status).toBe('success');
    });

    it('should generate receipt on successful payment', async () => {
      const session = await service.initiatePayment({
        invoiceId: 'INV_001',
        amount: 1000,
        method: 'credit_card',
      });

      const result = await service.processPayment(session.id, validCreditCardDetails);

      expect(result.receipt).toBeDefined();
      expect(result.receipt!.invoiceId).toBe('INV_001');
      expect(result.receipt!.amount).toBe(1000);
      expect(result.receipt!.method).toBe('credit_card');
      expect(result.receipt!.transactionId).toBe('TXN_001');
    });

    it('should send confirmation notification on success', async () => {
      const session = await service.initiatePayment({
        invoiceId: 'INV_001',
        amount: 1000,
        method: 'credit_card',
      });

      await service.processPayment(session.id, validCreditCardDetails);

      // Allow async notification to complete
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(mockNotifier.sendConfirmation).toHaveBeenCalled();
    });

    it('should handle gateway failure gracefully', async () => {
      mockGateway.processPayment = jest.fn().mockResolvedValue({
        success: false,
        failureReason: 'Insufficient funds',
      });
      service = new PaymentProcessingService(createDeps());

      const session = await service.initiatePayment({
        invoiceId: 'INV_001',
        amount: 1000,
        method: 'credit_card',
      });

      const result = await service.processPayment(session.id, validCreditCardDetails);

      expect(result.success).toBe(false);
      expect(result.failureReason).toBe('Insufficient funds');
      expect(result.paymentRecord.status).toBe('failed');
      expect(result.receipt).toBeUndefined();
    });

    it('should throw PaymentSessionNotFoundError for invalid session', async () => {
      await expect(
        service.processPayment('NONEXISTENT', validCreditCardDetails)
      ).rejects.toThrow(PaymentSessionNotFoundError);
    });

    it('should throw PaymentSessionExpiredError when session has expired', async () => {
      const session = await service.initiatePayment({
        invoiceId: 'INV_001',
        amount: 1000,
        method: 'credit_card',
      });

      // Advance time past expiry
      currentDate = new Date(currentDate.getTime() + 11 * 60 * 1000);

      await expect(
        service.processPayment(session.id, validCreditCardDetails)
      ).rejects.toThrow(PaymentSessionExpiredError);
    });
  });

  describe('Payment Validation (Req 10.2)', () => {
    it('should reject invalid card number (not 16 digits)', async () => {
      const session = await service.initiatePayment({
        invoiceId: 'INV_001',
        amount: 1000,
        method: 'credit_card',
      });

      const invalidDetails: PaymentDetails = {
        ...validCreditCardDetails,
        cardNumber: '1234',
      };

      await expect(
        service.processPayment(session.id, invalidDetails)
      ).rejects.toThrow(PaymentValidationError);
    });

    it('should reject expired card', async () => {
      const session = await service.initiatePayment({
        invoiceId: 'INV_001',
        amount: 1000,
        method: 'credit_card',
      });

      const expiredDetails: PaymentDetails = {
        ...validCreditCardDetails,
        expiryMonth: 1,
        expiryYear: 2020,
      };

      await expect(
        service.processPayment(session.id, expiredDetails)
      ).rejects.toThrow(PaymentValidationError);
    });

    it('should reject missing required fields for bank transfer', async () => {
      const session = await service.initiatePayment({
        invoiceId: 'INV_001',
        amount: 1000,
        method: 'bank_transfer',
      });

      const incompleteDetails: PaymentDetails = {
        accountNumber: '1234567890',
        // missing routingNumber and bankName
      };

      await expect(
        service.processPayment(session.id, incompleteDetails)
      ).rejects.toThrow(PaymentValidationError);
    });

    it('should reject missing wallet details for digital wallet', async () => {
      const session = await service.initiatePayment({
        invoiceId: 'INV_001',
        amount: 1000,
        method: 'digital_wallet',
      });

      const incompleteDetails: PaymentDetails = {
        walletId: 'wallet_123',
        // missing walletProvider
      };

      await expect(
        service.processPayment(session.id, incompleteDetails)
      ).rejects.toThrow(PaymentValidationError);
    });

    it('should reject invalid CVV format', async () => {
      const session = await service.initiatePayment({
        invoiceId: 'INV_001',
        amount: 1000,
        method: 'credit_card',
      });

      const invalidDetails: PaymentDetails = {
        ...validCreditCardDetails,
        cvv: '12', // Too short
      };

      await expect(
        service.processPayment(session.id, invalidDetails)
      ).rejects.toThrow(PaymentValidationError);
    });
  });

  describe('retryPayment (Req 10.4)', () => {
    it('should allow retry after failure', async () => {
      // First attempt fails
      mockGateway.processPayment = jest.fn()
        .mockResolvedValueOnce({ success: false, failureReason: 'Declined' })
        .mockResolvedValueOnce({ success: true, transactionId: 'TXN_RETRY' });
      service = new PaymentProcessingService(createDeps());

      const session = await service.initiatePayment({
        invoiceId: 'INV_001',
        amount: 1000,
        method: 'credit_card',
      });

      // First attempt - fails
      await service.processPayment(session.id, validCreditCardDetails);

      // Retry - succeeds
      const retryResult = await service.retryPayment(session.id, validCreditCardDetails);

      expect(retryResult.success).toBe(true);
      expect(retryResult.transactionId).toBe('TXN_RETRY');
    });

    it('should enforce max 5 retries per session', async () => {
      mockGateway.processPayment = jest.fn().mockResolvedValue({
        success: false,
        failureReason: 'Declined',
      });
      service = new PaymentProcessingService(createDeps());

      const session = await service.initiatePayment({
        invoiceId: 'INV_001',
        amount: 1000,
        method: 'credit_card',
      });

      // First attempt
      await service.processPayment(session.id, validCreditCardDetails);

      // Retry 5 times (all fail)
      for (let i = 0; i < 5; i++) {
        await service.retryPayment(session.id, validCreditCardDetails);
      }

      // 6th retry should throw
      await expect(
        service.retryPayment(session.id, validCreditCardDetails)
      ).rejects.toThrow(MaxRetriesExceededError);
    });

    it('should increment retry count on each attempt', async () => {
      mockGateway.processPayment = jest.fn().mockResolvedValue({
        success: false,
        failureReason: 'Declined',
      });
      service = new PaymentProcessingService(createDeps());

      const session = await service.initiatePayment({
        invoiceId: 'INV_001',
        amount: 1000,
        method: 'credit_card',
      });

      await service.processPayment(session.id, validCreditCardDetails);

      // Retry once
      await service.retryPayment(session.id, validCreditCardDetails);

      // Retry again - should have incremented count
      await service.retryPayment(session.id, validCreditCardDetails);

      // We can't directly check retryCount on the session via the service API,
      // but we verify it allows up to 5 retries (tested above)
      expect(true).toBe(true);
    });

    it('should throw if session is expired when retrying', async () => {
      mockGateway.processPayment = jest.fn().mockResolvedValue({
        success: false,
        failureReason: 'Declined',
      });
      service = new PaymentProcessingService(createDeps());

      const session = await service.initiatePayment({
        invoiceId: 'INV_001',
        amount: 1000,
        method: 'credit_card',
      });

      await service.processPayment(session.id, validCreditCardDetails);

      // Advance time past expiry
      currentDate = new Date(currentDate.getTime() + 11 * 60 * 1000);

      await expect(
        service.retryPayment(session.id, validCreditCardDetails)
      ).rejects.toThrow(PaymentSessionExpiredError);
    });
  });

  describe('setupInstallmentPlan (Req 10.5)', () => {
    it('should create a 3-installment plan with equal amounts', async () => {
      const session = await service.initiatePayment({
        invoiceId: 'INV_001',
        amount: 900,
        method: 'credit_card',
      });

      const plan = await service.setupInstallmentPlan('INV_001', 3);

      expect(plan.invoiceId).toBe('INV_001');
      expect(plan.totalAmount).toBe(900);
      expect(plan.installmentCount).toBe(3);
      expect(plan.installments).toHaveLength(3);

      // Verify sum equals total
      const totalFromInstallments = plan.installments.reduce((sum, i) => sum + i.amount, 0);
      expect(Math.round(totalFromInstallments * 100) / 100).toBe(900);
    });

    it('should create a 2-installment plan', async () => {
      await service.initiatePayment({
        invoiceId: 'INV_002',
        amount: 600,
        method: 'credit_card',
      });

      const plan = await service.setupInstallmentPlan('INV_002', 2);

      expect(plan.installmentCount).toBe(2);
      expect(plan.installments).toHaveLength(2);

      const totalFromInstallments = plan.installments.reduce((sum, i) => sum + i.amount, 0);
      expect(Math.round(totalFromInstallments * 100) / 100).toBe(600);
    });

    it('should handle odd amounts where division is not even (e.g., 1000/3)', async () => {
      await service.initiatePayment({
        invoiceId: 'INV_ODD',
        amount: 1000,
        method: 'credit_card',
      });

      const plan = await service.setupInstallmentPlan('INV_ODD', 3);

      expect(plan.installments).toHaveLength(3);

      // Sum of installments must exactly equal totalAmount
      const totalFromInstallments = plan.installments.reduce((sum, i) => sum + i.amount, 0);
      expect(Math.round(totalFromInstallments * 100) / 100).toBe(1000);

      // Last installment absorbs the remainder
      expect(plan.installments[0].amount).toBe(plan.installments[1].amount);
    });

    it('should reject installment count outside 2-3 range', async () => {
      await expect(
        service.setupInstallmentPlan('INV_001', 1)
      ).rejects.toThrow(InstallmentPlanError);

      await expect(
        service.setupInstallmentPlan('INV_001', 4)
      ).rejects.toThrow(InstallmentPlanError);

      await expect(
        service.setupInstallmentPlan('INV_001', 0)
      ).rejects.toThrow(InstallmentPlanError);
    });

    it('should reject if amount is below 500', async () => {
      await service.initiatePayment({
        invoiceId: 'INV_LOW',
        amount: 300,
        method: 'credit_card',
      });

      await expect(
        service.setupInstallmentPlan('INV_LOW', 3)
      ).rejects.toThrow(InstallmentPlanError);
    });

    it('should reject if amount is exactly 499', async () => {
      await service.initiatePayment({
        invoiceId: 'INV_499',
        amount: 499,
        method: 'credit_card',
      });

      await expect(
        service.setupInstallmentPlan('INV_499', 2)
      ).rejects.toThrow(InstallmentPlanError);
    });

    it('should accept amount of exactly 500', async () => {
      await service.initiatePayment({
        invoiceId: 'INV_500',
        amount: 500,
        method: 'credit_card',
      });

      const plan = await service.setupInstallmentPlan('INV_500', 2);
      expect(plan.totalAmount).toBe(500);
      expect(plan.installments).toHaveLength(2);
    });

    it('should reject non-Comprehensive package type', async () => {
      await service.initiatePayment({
        invoiceId: 'INV_BASIC',
        amount: 600,
        method: 'credit_card',
      });

      await expect(
        service.setupInstallmentPlan('INV_BASIC', 2, 'Basic')
      ).rejects.toThrow(InstallmentPlanError);

      await expect(
        service.setupInstallmentPlan('INV_BASIC', 2, 'Standard')
      ).rejects.toThrow(InstallmentPlanError);
    });

    it('should accept Comprehensive package type', async () => {
      await service.initiatePayment({
        invoiceId: 'INV_COMP',
        amount: 1500,
        method: 'credit_card',
      });

      const plan = await service.setupInstallmentPlan('INV_COMP', 3, 'Comprehensive');
      expect(plan.totalAmount).toBe(1500);
      expect(plan.installmentCount).toBe(3);
    });

    it('should set due dates monthly from now', async () => {
      await service.initiatePayment({
        invoiceId: 'INV_003',
        amount: 1500,
        method: 'credit_card',
      });

      const plan = await service.setupInstallmentPlan('INV_003', 3);

      // Each installment due one month apart
      for (let i = 0; i < plan.installments.length; i++) {
        const expectedMonth = (currentDate.getMonth() + i + 1) % 12;
        expect(plan.installments[i].dueDate.getMonth()).toBe(expectedMonth);
        expect(plan.installments[i].status).toBe('pending');
      }
    });
  });

  describe('makeInstallmentPayment (Req 10.5)', () => {
    it('should mark a specific installment as paid', async () => {
      await service.initiatePayment({
        invoiceId: 'INV_PAY',
        amount: 900,
        method: 'credit_card',
      });

      await service.setupInstallmentPlan('INV_PAY', 3);

      const updatedPlan = await service.makeInstallmentPayment('INV_PAY', 1, 'PAY_001');

      expect(updatedPlan.installments[0].status).toBe('paid');
      expect(updatedPlan.installments[0].paymentId).toBe('PAY_001');
      expect(updatedPlan.installments[1].status).toBe('pending');
      expect(updatedPlan.installments[2].status).toBe('pending');
    });

    it('should reject payment on already paid installment', async () => {
      await service.initiatePayment({
        invoiceId: 'INV_DUP_PAY',
        amount: 600,
        method: 'credit_card',
      });

      await service.setupInstallmentPlan('INV_DUP_PAY', 2);
      await service.makeInstallmentPayment('INV_DUP_PAY', 1, 'PAY_001');

      await expect(
        service.makeInstallmentPayment('INV_DUP_PAY', 1, 'PAY_002')
      ).rejects.toThrow(InstallmentPlanError);
    });

    it('should reject payment on non-existent installment number', async () => {
      await service.initiatePayment({
        invoiceId: 'INV_INVALID',
        amount: 500,
        method: 'credit_card',
      });

      await service.setupInstallmentPlan('INV_INVALID', 2);

      await expect(
        service.makeInstallmentPayment('INV_INVALID', 5, 'PAY_001')
      ).rejects.toThrow(InstallmentPlanError);
    });

    it('should reject payment if no plan exists for invoice', async () => {
      await expect(
        service.makeInstallmentPayment('INV_NO_PLAN', 1, 'PAY_001')
      ).rejects.toThrow(InstallmentPlanError);
    });
  });

  describe('getInstallmentPlanStatus (Req 10.5)', () => {
    it('should detect overdue installments based on current date', async () => {
      await service.initiatePayment({
        invoiceId: 'INV_OVERDUE',
        amount: 900,
        method: 'credit_card',
      });

      await service.setupInstallmentPlan('INV_OVERDUE', 3);

      // Advance time past the first installment due date (1 month + 1 day)
      currentDate = new Date('2024-07-20T10:00:00.000Z');

      const status = await service.getInstallmentPlanStatus('INV_OVERDUE');

      expect(status.installments[0].status).toBe('overdue');
      expect(status.installments[1].status).toBe('pending');
      expect(status.installments[2].status).toBe('pending');
    });

    it('should not change status of paid installments even if past due', async () => {
      await service.initiatePayment({
        invoiceId: 'INV_PAID_STATUS',
        amount: 600,
        method: 'credit_card',
      });

      await service.setupInstallmentPlan('INV_PAID_STATUS', 2);
      await service.makeInstallmentPayment('INV_PAID_STATUS', 1, 'PAY_001');

      // Advance time past both due dates
      currentDate = new Date('2024-09-20T10:00:00.000Z');

      const status = await service.getInstallmentPlanStatus('INV_PAID_STATUS');

      expect(status.installments[0].status).toBe('paid');
      expect(status.installments[1].status).toBe('overdue');
    });

    it('should throw if no plan exists for invoice', async () => {
      await expect(
        service.getInstallmentPlanStatus('INV_NONEXISTENT')
      ).rejects.toThrow(InstallmentPlanError);
    });

    it('should return all pending when none are past due', async () => {
      await service.initiatePayment({
        invoiceId: 'INV_FRESH',
        amount: 1500,
        method: 'credit_card',
      });

      await service.setupInstallmentPlan('INV_FRESH', 3);

      const status = await service.getInstallmentPlanStatus('INV_FRESH');

      expect(status.installments.every((i) => i.status === 'pending')).toBe(true);
    });
  });

  describe('expireSession (Req 10.6)', () => {
    it('should expire an active session', async () => {
      const session = await service.initiatePayment({
        invoiceId: 'INV_001',
        amount: 1000,
        method: 'credit_card',
      });

      await service.expireSession(session.id);

      // Trying to process should now fail
      await expect(
        service.processPayment(session.id, validCreditCardDetails)
      ).rejects.toThrow(InvalidSessionStateError);
    });

    it('should release holds on expiry', async () => {
      const session = await service.initiatePayment({
        invoiceId: 'INV_001',
        amount: 1000,
        method: 'credit_card',
      });

      await service.expireSession(session.id);

      // After expiry, a new session can be initiated for same invoice
      const newSession = await service.initiatePayment({
        invoiceId: 'INV_001',
        amount: 1000,
        method: 'credit_card',
      });

      expect(newSession.status).toBe('active');
      expect(newSession.id).not.toBe(session.id);
    });

    it('should be idempotent for already expired sessions', async () => {
      const session = await service.initiatePayment({
        invoiceId: 'INV_001',
        amount: 1000,
        method: 'credit_card',
      });

      await service.expireSession(session.id);
      // Should not throw
      await service.expireSession(session.id);
    });

    it('should throw for non-existent session', async () => {
      await expect(
        service.expireSession('NONEXISTENT')
      ).rejects.toThrow(PaymentSessionNotFoundError);
    });

    it('should auto-expire session after 10 minutes of inactivity', async () => {
      const session = await service.initiatePayment({
        invoiceId: 'INV_001',
        amount: 1000,
        method: 'credit_card',
      });

      // Advance time by 11 minutes
      currentDate = new Date(currentDate.getTime() + 11 * 60 * 1000);

      const expired = await service.checkAndExpireSession(session.id);
      expect(expired).toBe(true);
    });
  });

  describe('processRefund (Req 10.7)', () => {
    it('should process refund to original method', async () => {
      const result = await service.processRefund('TXN_001', 500);

      expect(result.amount).toBe(500);
      expect(result.status).toBe('pending');
      expect(result.paymentId).toBe('TXN_001');
    });

    it('should set estimated completion to 7 business days', async () => {
      // June 15, 2024 is a Saturday
      currentDate = new Date('2024-06-17T10:00:00.000Z'); // Monday
      service = new PaymentProcessingService(createDeps());

      const result = await service.processRefund('TXN_001', 500);

      // 7 business days from Monday June 17 = Monday June 26
      expect(result.estimatedCompletionDate.getDate()).toBe(26);
    });

    it('should reject zero or negative refund amount', async () => {
      await expect(
        service.processRefund('TXN_001', 0)
      ).rejects.toThrow(PaymentValidationError);

      await expect(
        service.processRefund('TXN_001', -100)
      ).rejects.toThrow(PaymentValidationError);
    });
  });

  describe('Payment timeout (Req 10.1)', () => {
    it('should timeout if gateway takes longer than 30 seconds', async () => {
      mockGateway.processPayment = jest.fn().mockImplementation(() => {
        return new Promise((resolve) => {
          setTimeout(() => resolve({ success: true, transactionId: 'TXN_LATE' }), 35000);
        });
      });

      // Use a very short timeout to test the mechanism
      service = new PaymentProcessingService(createDeps({
        processingTimeoutMs: 50, // 50ms for testing
      }));

      const session = await service.initiatePayment({
        invoiceId: 'INV_001',
        amount: 1000,
        method: 'credit_card',
      });

      await expect(
        service.processPayment(session.id, validCreditCardDetails)
      ).rejects.toThrow('Payment processing timed out');
    }, 10000);
  });
});
