/**
 * Billing Engine Service - Unit Tests
 * Validates: Requirements 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.8
 */

import { SupportedLanguage, PaymentMethod } from '@health-checkup/shared';
import type { PackageTest, CheckupSession, CheckupPackage, PaymentRecord } from '@health-checkup/shared';
import { BillingEngineService, InMemoryInvoiceRepository, InMemoryPaymentRepository, InMemoryRefundRepository } from './billing.service';
import { roundToTwoDecimals, clampTotalAmount } from './billing.validators';
import {
  MissingCostDataError,
  InvoiceNotFoundError,
  InvoiceAlreadyFinalizedError,
  PaymentExceedsBalanceError,
  RefundExceedsPaymentsError,
  TooManyLineItemsError,
} from './billing.errors';
import type { SessionDataProvider, BillingConfig, InvoiceGenerationData } from './billing.types';

// --- Test Helpers ---

function createTestPackageTest(overrides?: Partial<PackageTest>): PackageTest {
  return {
    testType: 'blood',
    name: 'Complete Blood Count',
    category: 'blood' as any,
    cost: 500,
    contraindications: [],
    plausibleRange: { min: 0, max: 100 },
    unit: 'mg/dL',
    ...overrides,
  };
}

function createTestSession(overrides?: Partial<CheckupSession>): CheckupSession {
  return {
    id: 'session-1',
    appointmentId: 'apt-1',
    seniorId: 'senior-1',
    packageId: 'pkg-1',
    assignedPhysicianId: 'doc-1',
    assignedSpecialists: [],
    status: 'complete',
    startedAt: new Date('2024-01-15'),
    completedAt: new Date('2024-01-15'),
    ...overrides,
  };
}

function createTestPackage(overrides?: Partial<CheckupPackage>): CheckupPackage {
  return {
    id: 'pkg-1',
    name: 'Basic Package',
    tier: 'Basic',
    tests: [
      createTestPackageTest({ name: 'CBC', cost: 500 }),
      createTestPackageTest({ name: 'Lipid Panel', testType: 'blood', cost: 800 }),
    ],
    totalCost: 1300,
    discountRate: 10,
    isActive: true,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    ...overrides,
  };
}

function createMockSessionDataProvider(
  data?: Partial<InvoiceGenerationData>
): SessionDataProvider {
  const defaultData: InvoiceGenerationData = {
    session: createTestSession(),
    package: createTestPackage(),
    seniorLanguage: SupportedLanguage.English,
    insuranceCoveredAmount: 0,
    advancePayments: 0,
    ...data,
  };

  return {
    getInvoiceGenerationData: jest.fn().mockResolvedValue(defaultData),
  };
}

let idCounter = 0;
const testIdGenerator = () => `test-id-${++idCounter}`;
const testDateProvider = () => new Date('2024-06-15T10:00:00Z');
let invoiceSeq = 0;
const testInvoiceNumberGenerator = (date: Date) => {
  invoiceSeq++;
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `INV-${y}${m}${d}-${String(invoiceSeq).padStart(4, '0')}`;
};

const defaultConfig: BillingConfig = { taxRate: 18, currency: 'INR' };

function createService(overrides?: {
  sessionDataProvider?: SessionDataProvider;
  billingConfig?: BillingConfig;
}) {
  const invoiceRepository = new InMemoryInvoiceRepository();
  const paymentRepository = new InMemoryPaymentRepository();
  const refundRepository = new InMemoryRefundRepository();

  const service = new BillingEngineService({
    idGenerator: testIdGenerator,
    dateProvider: testDateProvider,
    invoiceNumberGenerator: testInvoiceNumberGenerator,
    invoiceRepository,
    paymentRepository,
    refundRepository,
    sessionDataProvider: overrides?.sessionDataProvider ?? createMockSessionDataProvider(),
    billingConfig: overrides?.billingConfig ?? defaultConfig,
  });

  return { service, invoiceRepository, paymentRepository, refundRepository };
}

// --- Tests ---

describe('BillingEngineService', () => {
  beforeEach(() => {
    idCounter = 0;
    invoiceSeq = 0;
  });

  describe('generateInvoice', () => {
    it('should generate an invoice with correct line items', async () => {
      const { service } = createService();

      const invoice = await service.generateInvoice('session-1');

      expect(invoice.lineItems).toHaveLength(2);
      expect(invoice.checkupSessionId).toBe('session-1');
      expect(invoice.seniorId).toBe('senior-1');
      expect(invoice.paymentStatus).toBe('Unpaid');
      expect(invoice.language).toBe(SupportedLanguage.English);
    });

    it('should calculate line item amounts correctly', async () => {
      // cost=500, discountRate=10%, taxRate=18%
      // discountApplied = 500 * 10/100 = 50
      // taxApplied = (500 - 50) * 18/100 = 81
      // netAmount = 500 - 50 + 81 = 531
      const { service } = createService();

      const invoice = await service.generateInvoice('session-1');
      const item1 = invoice.lineItems[0];

      expect(item1.cost).toBe(500);
      expect(item1.discountApplied).toBe(50);
      expect(item1.taxApplied).toBe(81);
      expect(item1.netAmount).toBe(531);
    });

    it('should calculate totals correctly', async () => {
      // Tests: CBC(500), Lipid Panel(800). discountRate=10%, taxRate=18%
      // subtotal = 500 + 800 = 1300
      // discountAmount = 1300 * 10/100 = 130
      // taxAmount per item:
      //   CBC: (500-50)*0.18 = 81
      //   Lipid: (800-80)*0.18 = 129.6
      //   total tax = 210.6
      // totalAmountDue = 1300 - 130 + 210.6 - 0 - 0 = 1380.6
      const { service } = createService();

      const invoice = await service.generateInvoice('session-1');

      expect(invoice.subtotal).toBe(1300);
      expect(invoice.discountAmount).toBe(130);
      expect(invoice.taxAmount).toBe(210.6);
      expect(invoice.totalAmountDue).toBe(1380.6);
      expect(invoice.outstandingBalance).toBe(1380.6);
    });

    it('should apply insurance coverage and advance payments', async () => {
      const provider = createMockSessionDataProvider({
        insuranceCoveredAmount: 200,
        advancePayments: 100,
      });
      const { service } = createService({ sessionDataProvider: provider });

      const invoice = await service.generateInvoice('session-1');

      // totalAmountDue = 1300 - 130 + 210.6 - 200 - 100 = 1080.6
      expect(invoice.insuranceCoveredAmount).toBe(200);
      expect(invoice.advancePayments).toBe(100);
      expect(invoice.totalAmountDue).toBe(1080.6);
    });

    it('should clamp totalAmountDue to minimum 0.00', async () => {
      const provider = createMockSessionDataProvider({
        insuranceCoveredAmount: 50000,
        advancePayments: 50000,
      });
      const { service } = createService({ sessionDataProvider: provider });

      const invoice = await service.generateInvoice('session-1');

      expect(invoice.totalAmountDue).toBe(0);
    });

    it('should throw MissingCostDataError if any test lacks cost data', async () => {
      const pkg = createTestPackage({
        tests: [
          createTestPackageTest({ name: 'CBC', cost: 500 }),
          createTestPackageTest({ name: 'ECG', cost: 0 }),
        ],
      });
      const provider = createMockSessionDataProvider({ package: pkg });
      const { service } = createService({ sessionDataProvider: provider });

      await expect(service.generateInvoice('session-1')).rejects.toThrow(MissingCostDataError);
    });

    it('should throw TooManyLineItemsError if more than 50 tests', async () => {
      const tests = Array.from({ length: 51 }, (_, i) =>
        createTestPackageTest({ name: `Test ${i + 1}`, cost: 100 })
      );
      const pkg = createTestPackage({ tests });
      const provider = createMockSessionDataProvider({ package: pkg });
      const { service } = createService({ sessionDataProvider: provider });

      await expect(service.generateInvoice('session-1')).rejects.toThrow(TooManyLineItemsError);
    });

    it('should render invoice in preferred language', async () => {
      const provider = createMockSessionDataProvider({
        seniorLanguage: SupportedLanguage.Hindi,
      });
      const { service } = createService({ sessionDataProvider: provider });

      const invoice = await service.generateInvoice('session-1');

      expect(invoice.language).toBe(SupportedLanguage.Hindi);
    });

    it('should handle zero discount rate', async () => {
      const pkg = createTestPackage({ discountRate: 0 });
      const provider = createMockSessionDataProvider({ package: pkg });
      const { service } = createService({ sessionDataProvider: provider });

      const invoice = await service.generateInvoice('session-1');

      expect(invoice.discountRate).toBe(0);
      expect(invoice.discountAmount).toBe(0);
      // subtotal = 1300, tax = 1300 * 0.18 = 234, total = 1300 + 234 = 1534
      expect(invoice.totalAmountDue).toBe(1534);
    });

    it('should handle 100% discount rate', async () => {
      const pkg = createTestPackage({ discountRate: 100 });
      const provider = createMockSessionDataProvider({ package: pkg });
      const { service } = createService({ sessionDataProvider: provider });

      const invoice = await service.generateInvoice('session-1');

      expect(invoice.discountRate).toBe(100);
      expect(invoice.discountAmount).toBe(1300);
      // All costs are discounted, so taxApplied on each item is 0
      expect(invoice.taxAmount).toBe(0);
      expect(invoice.totalAmountDue).toBe(0);
    });

    it('should round all monetary values to 2 decimal places', async () => {
      // cost=333, discountRate=7%, taxRate=18%
      // discountApplied = 333 * 7/100 = 23.31
      // taxApplied = (333 - 23.31) * 18/100 = 309.69 * 0.18 = 55.7442 -> 55.74
      // netAmount = 333 - 23.31 + 55.74 = 365.43
      const pkg = createTestPackage({
        tests: [createTestPackageTest({ name: 'Test A', cost: 333 })],
        discountRate: 7,
      });
      const provider = createMockSessionDataProvider({ package: pkg });
      const { service } = createService({ sessionDataProvider: provider });

      const invoice = await service.generateInvoice('session-1');
      const item = invoice.lineItems[0];

      expect(item.discountApplied).toBe(23.31);
      expect(item.taxApplied).toBe(55.74);
      expect(item.netAmount).toBe(365.43);
    });
  });

  describe('finalizeInvoice', () => {
    it('should assign a unique invoice number on finalization', async () => {
      const { service } = createService();
      const invoice = await service.generateInvoice('session-1');

      const finalized = await service.finalizeInvoice(invoice.id);

      expect(finalized.invoiceNumber).toBe('INV-20240615-0001');
      expect(finalized.finalizedAt).toEqual(new Date('2024-06-15T10:00:00Z'));
    });

    it('should throw InvoiceNotFoundError for non-existent invoice', async () => {
      const { service } = createService();

      await expect(service.finalizeInvoice('nonexistent')).rejects.toThrow(InvoiceNotFoundError);
    });

    it('should throw InvoiceAlreadyFinalizedError if already finalized', async () => {
      const { service } = createService();
      const invoice = await service.generateInvoice('session-1');
      await service.finalizeInvoice(invoice.id);

      await expect(service.finalizeInvoice(invoice.id)).rejects.toThrow(InvoiceAlreadyFinalizedError);
    });

    it('should generate unique invoice numbers for multiple invoices', async () => {
      const { service } = createService();
      const inv1 = await service.generateInvoice('session-1');
      const inv2 = await service.generateInvoice('session-1');

      const f1 = await service.finalizeInvoice(inv1.id);
      const f2 = await service.finalizeInvoice(inv2.id);

      expect(f1.invoiceNumber).not.toBe(f2.invoiceNumber);
    });
  });

  describe('applyPayment', () => {
    it('should reduce outstanding balance on payment', async () => {
      const { service } = createService();
      const invoice = await service.generateInvoice('session-1');

      const payment: PaymentRecord = {
        id: 'pay-1',
        invoiceId: invoice.id,
        amount: 500,
        method: PaymentMethod.CreditCard,
        status: 'success',
        createdAt: new Date(),
      };

      const updated = await service.applyPayment(invoice.id, payment);

      expect(updated.outstandingBalance).toBe(roundToTwoDecimals(1380.6 - 500));
      expect(updated.paymentStatus).toBe('Partially Paid');
    });

    it('should mark as Paid in Full when balance reaches zero', async () => {
      const { service } = createService();
      const invoice = await service.generateInvoice('session-1');

      const payment: PaymentRecord = {
        id: 'pay-1',
        invoiceId: invoice.id,
        amount: invoice.totalAmountDue,
        method: PaymentMethod.BankTransfer,
        status: 'success',
        createdAt: new Date(),
      };

      const updated = await service.applyPayment(invoice.id, payment);

      expect(updated.outstandingBalance).toBe(0);
      expect(updated.paymentStatus).toBe('Paid in Full');
    });

    it('should throw PaymentExceedsBalanceError if payment exceeds balance', async () => {
      const { service } = createService();
      const invoice = await service.generateInvoice('session-1');

      const payment: PaymentRecord = {
        id: 'pay-1',
        invoiceId: invoice.id,
        amount: invoice.totalAmountDue + 1,
        method: PaymentMethod.CreditCard,
        status: 'success',
        createdAt: new Date(),
      };

      await expect(service.applyPayment(invoice.id, payment)).rejects.toThrow(
        PaymentExceedsBalanceError
      );
    });

    it('should throw InvoiceNotFoundError for non-existent invoice', async () => {
      const { service } = createService();

      const payment: PaymentRecord = {
        id: 'pay-1',
        invoiceId: 'nonexistent',
        amount: 100,
        method: PaymentMethod.CreditCard,
        status: 'success',
        createdAt: new Date(),
      };

      await expect(service.applyPayment('nonexistent', payment)).rejects.toThrow(
        InvoiceNotFoundError
      );
    });
  });

  describe('processRefund', () => {
    it('should process refund and increase outstanding balance', async () => {
      const { service } = createService();
      const invoice = await service.generateInvoice('session-1');

      // Pay in full first
      const payment: PaymentRecord = {
        id: 'pay-1',
        invoiceId: invoice.id,
        amount: invoice.totalAmountDue,
        method: PaymentMethod.CreditCard,
        status: 'success',
        createdAt: new Date(),
      };
      await service.applyPayment(invoice.id, payment);

      // Process partial refund
      const refund = await service.processRefund(invoice.id, 200);

      expect(refund.amount).toBe(200);
      expect(refund.invoiceId).toBe(invoice.id);

      const updated = await service.getInvoice(invoice.id);
      expect(updated.outstandingBalance).toBe(200);
      expect(updated.paymentStatus).toBe('Partially Paid');
    });

    it('should throw RefundExceedsPaymentsError if refund exceeds payments', async () => {
      const { service } = createService();
      const invoice = await service.generateInvoice('session-1');

      // No payments made, so refund should fail
      await expect(service.processRefund(invoice.id, 100)).rejects.toThrow(
        RefundExceedsPaymentsError
      );
    });

    it('should throw InvoiceNotFoundError for non-existent invoice', async () => {
      const { service } = createService();

      await expect(service.processRefund('nonexistent', 100)).rejects.toThrow(
        InvoiceNotFoundError
      );
    });
  });

  describe('getInvoice', () => {
    it('should retrieve an existing invoice', async () => {
      const { service } = createService();
      const invoice = await service.generateInvoice('session-1');

      const retrieved = await service.getInvoice(invoice.id);

      expect(retrieved.id).toBe(invoice.id);
    });

    it('should throw InvoiceNotFoundError for non-existent invoice', async () => {
      const { service } = createService();

      await expect(service.getInvoice('nonexistent')).rejects.toThrow(InvoiceNotFoundError);
    });
  });

  describe('downloadInvoicePDF', () => {
    it('should return a Buffer with invoice content', async () => {
      const { service } = createService();
      const invoice = await service.generateInvoice('session-1');
      await service.finalizeInvoice(invoice.id);

      const pdf = await service.downloadInvoicePDF(invoice.id);

      expect(Buffer.isBuffer(pdf)).toBe(true);
      const content = pdf.toString('utf-8');
      expect(content).toContain('INV-20240615-0001');
      expect(content).toContain('CBC');
      expect(content).toContain('Lipid Panel');
    });

    it('should throw InvoiceNotFoundError for non-existent invoice', async () => {
      const { service } = createService();

      await expect(service.downloadInvoicePDF('nonexistent')).rejects.toThrow(
        InvoiceNotFoundError
      );
    });
  });

  describe('Payment Status Tracking (Requirement 9.7)', () => {
    describe('Status transitions: Unpaid → Partially Paid → Paid in Full', () => {
      it('should start as Unpaid when invoice is generated', async () => {
        const { service } = createService();
        const invoice = await service.generateInvoice('session-1');

        const status = await service.getPaymentStatus(invoice.id);

        expect(status.status).toBe('Unpaid');
        expect(status.totalPaymentsReceived).toBe(0);
        expect(status.totalRefunds).toBe(0);
        expect(status.outstandingBalance).toBe(invoice.totalAmountDue);
      });

      it('should transition to Partially Paid after a partial payment', async () => {
        const { service } = createService();
        const invoice = await service.generateInvoice('session-1');

        const payment: PaymentRecord = {
          id: 'pay-1',
          invoiceId: invoice.id,
          amount: 500,
          method: PaymentMethod.CreditCard,
          status: 'success',
          createdAt: new Date(),
        };
        await service.applyPayment(invoice.id, payment);

        const status = await service.getPaymentStatus(invoice.id);

        expect(status.status).toBe('Partially Paid');
        expect(status.totalPaymentsReceived).toBe(500);
        expect(status.outstandingBalance).toBe(roundToTwoDecimals(invoice.totalAmountDue - 500));
      });

      it('should transition to Paid in Full when balance reaches zero', async () => {
        const { service } = createService();
        const invoice = await service.generateInvoice('session-1');

        const payment: PaymentRecord = {
          id: 'pay-1',
          invoiceId: invoice.id,
          amount: invoice.totalAmountDue,
          method: PaymentMethod.BankTransfer,
          status: 'success',
          createdAt: new Date(),
        };
        await service.applyPayment(invoice.id, payment);

        const status = await service.getPaymentStatus(invoice.id);

        expect(status.status).toBe('Paid in Full');
        expect(status.totalPaymentsReceived).toBe(invoice.totalAmountDue);
        expect(status.outstandingBalance).toBe(0);
      });
    });

    describe('Status transitions: Paid in Full → Partially Paid (after refund)', () => {
      it('should revert to Partially Paid after a partial refund', async () => {
        const { service } = createService();
        const invoice = await service.generateInvoice('session-1');

        // Pay in full
        const payment: PaymentRecord = {
          id: 'pay-1',
          invoiceId: invoice.id,
          amount: invoice.totalAmountDue,
          method: PaymentMethod.CreditCard,
          status: 'success',
          createdAt: new Date(),
        };
        await service.applyPayment(invoice.id, payment);

        // Process partial refund
        await service.processRefund(invoice.id, 300);

        const status = await service.getPaymentStatus(invoice.id);

        expect(status.status).toBe('Partially Paid');
        expect(status.totalRefunds).toBe(300);
        expect(status.outstandingBalance).toBe(300);
      });

      it('should revert to Unpaid after a full refund', async () => {
        const { service } = createService();
        const invoice = await service.generateInvoice('session-1');

        // Pay in full
        const payment: PaymentRecord = {
          id: 'pay-1',
          invoiceId: invoice.id,
          amount: invoice.totalAmountDue,
          method: PaymentMethod.CreditCard,
          status: 'success',
          createdAt: new Date(),
        };
        await service.applyPayment(invoice.id, payment);

        // Full refund
        await service.processRefund(invoice.id, invoice.totalAmountDue);

        const status = await service.getPaymentStatus(invoice.id);

        expect(status.status).toBe('Unpaid');
        expect(status.totalRefunds).toBe(invoice.totalAmountDue);
        expect(status.outstandingBalance).toBe(invoice.totalAmountDue);
      });
    });

    describe('Multiple partial payments tracking', () => {
      it('should accumulate multiple partial payments correctly', async () => {
        const { service } = createService();
        const invoice = await service.generateInvoice('session-1');

        const pay1: PaymentRecord = {
          id: 'pay-1',
          invoiceId: invoice.id,
          amount: 400,
          method: PaymentMethod.CreditCard,
          status: 'success',
          createdAt: new Date(),
        };
        const pay2: PaymentRecord = {
          id: 'pay-2',
          invoiceId: invoice.id,
          amount: 300,
          method: PaymentMethod.DebitCard,
          status: 'success',
          createdAt: new Date(),
        };
        const pay3: PaymentRecord = {
          id: 'pay-3',
          invoiceId: invoice.id,
          amount: 200,
          method: PaymentMethod.DigitalWallet,
          status: 'success',
          createdAt: new Date(),
        };

        await service.applyPayment(invoice.id, pay1);
        await service.applyPayment(invoice.id, pay2);
        await service.applyPayment(invoice.id, pay3);

        const status = await service.getPaymentStatus(invoice.id);

        expect(status.status).toBe('Partially Paid');
        expect(status.totalPaymentsReceived).toBe(900);
        expect(status.outstandingBalance).toBe(roundToTwoDecimals(invoice.totalAmountDue - 900));
      });

      it('should track payment history with correct count', async () => {
        const { service } = createService();
        const invoice = await service.generateInvoice('session-1');

        const pay1: PaymentRecord = {
          id: 'pay-1',
          invoiceId: invoice.id,
          amount: 200,
          method: PaymentMethod.CreditCard,
          status: 'success',
          createdAt: new Date(),
        };
        const pay2: PaymentRecord = {
          id: 'pay-2',
          invoiceId: invoice.id,
          amount: 300,
          method: PaymentMethod.BankTransfer,
          status: 'success',
          createdAt: new Date(),
        };

        await service.applyPayment(invoice.id, pay1);
        await service.applyPayment(invoice.id, pay2);

        const history = await service.getPaymentHistory(invoice.id);

        expect(history).toHaveLength(2);
        expect(history[0].id).toBe('pay-1');
        expect(history[1].id).toBe('pay-2');
      });

      it('should calculate total payments received correctly', async () => {
        const { service } = createService();
        const invoice = await service.generateInvoice('session-1');

        const pay1: PaymentRecord = {
          id: 'pay-1',
          invoiceId: invoice.id,
          amount: 250.50,
          method: PaymentMethod.CreditCard,
          status: 'success',
          createdAt: new Date(),
        };
        const pay2: PaymentRecord = {
          id: 'pay-2',
          invoiceId: invoice.id,
          amount: 149.50,
          method: PaymentMethod.DebitCard,
          status: 'success',
          createdAt: new Date(),
        };

        await service.applyPayment(invoice.id, pay1);
        await service.applyPayment(invoice.id, pay2);

        const total = await service.getTotalPaymentsReceived(invoice.id);

        expect(total).toBe(400);
      });
    });

    describe('Status calculation with exact boundary values', () => {
      it('should be Unpaid when outstanding balance equals total amount due', async () => {
        const { service } = createService();
        const invoice = await service.generateInvoice('session-1');

        const status = await service.getPaymentStatus(invoice.id);

        expect(status.outstandingBalance).toBe(status.totalAmountDue);
        expect(status.status).toBe('Unpaid');
      });

      it('should be Paid in Full when outstanding balance is exactly 0', async () => {
        const { service } = createService();
        const invoice = await service.generateInvoice('session-1');

        const payment: PaymentRecord = {
          id: 'pay-1',
          invoiceId: invoice.id,
          amount: invoice.totalAmountDue,
          method: PaymentMethod.CreditCard,
          status: 'success',
          createdAt: new Date(),
        };
        await service.applyPayment(invoice.id, payment);

        const status = await service.getPaymentStatus(invoice.id);

        expect(status.outstandingBalance).toBe(0);
        expect(status.status).toBe('Paid in Full');
      });

      it('should be Partially Paid when balance is between 0 and totalAmountDue (exclusive)', async () => {
        const { service } = createService();
        const invoice = await service.generateInvoice('session-1');

        // Pay exactly 1 unit (smallest meaningful partial payment)
        const payment: PaymentRecord = {
          id: 'pay-1',
          invoiceId: invoice.id,
          amount: 0.01,
          method: PaymentMethod.CreditCard,
          status: 'success',
          createdAt: new Date(),
        };
        await service.applyPayment(invoice.id, payment);

        const status = await service.getPaymentStatus(invoice.id);

        expect(status.outstandingBalance).toBeGreaterThan(0);
        expect(status.outstandingBalance).toBeLessThan(status.totalAmountDue);
        expect(status.status).toBe('Partially Paid');
      });

      it('should be Partially Paid at boundary: pay all but 0.01', async () => {
        const { service } = createService();
        const invoice = await service.generateInvoice('session-1');

        const payment: PaymentRecord = {
          id: 'pay-1',
          invoiceId: invoice.id,
          amount: roundToTwoDecimals(invoice.totalAmountDue - 0.01),
          method: PaymentMethod.CreditCard,
          status: 'success',
          createdAt: new Date(),
        };
        await service.applyPayment(invoice.id, payment);

        const status = await service.getPaymentStatus(invoice.id);

        expect(status.outstandingBalance).toBe(0.01);
        expect(status.status).toBe('Partially Paid');
      });
    });

    describe('getPaymentStatus error handling', () => {
      it('should throw InvoiceNotFoundError for non-existent invoice', async () => {
        const { service } = createService();

        await expect(service.getPaymentStatus('nonexistent')).rejects.toThrow(InvoiceNotFoundError);
      });
    });

    describe('getPaymentHistory error handling', () => {
      it('should throw InvoiceNotFoundError for non-existent invoice', async () => {
        const { service } = createService();

        await expect(service.getPaymentHistory('nonexistent')).rejects.toThrow(InvoiceNotFoundError);
      });

      it('should return empty array when no payments exist', async () => {
        const { service } = createService();
        const invoice = await service.generateInvoice('session-1');

        const history = await service.getPaymentHistory(invoice.id);

        expect(history).toHaveLength(0);
      });
    });

    describe('getTotalPaymentsReceived error handling', () => {
      it('should throw InvoiceNotFoundError for non-existent invoice', async () => {
        const { service } = createService();

        await expect(service.getTotalPaymentsReceived('nonexistent')).rejects.toThrow(InvoiceNotFoundError);
      });

      it('should return 0 when no payments have been made', async () => {
        const { service } = createService();
        const invoice = await service.generateInvoice('session-1');

        const total = await service.getTotalPaymentsReceived(invoice.id);

        expect(total).toBe(0);
      });
    });
  });
});

describe('Billing Validators', () => {
  describe('roundToTwoDecimals', () => {
    it('should round to 2 decimal places', () => {
      expect(roundToTwoDecimals(1.005)).toBe(1.01);
      expect(roundToTwoDecimals(1.004)).toBe(1.0);
      expect(roundToTwoDecimals(100.999)).toBe(101.0);
      expect(roundToTwoDecimals(0)).toBe(0);
      expect(roundToTwoDecimals(55.7442)).toBe(55.74);
      expect(roundToTwoDecimals(23.31)).toBe(23.31);
    });
  });

  describe('clampTotalAmount', () => {
    it('should clamp negative values to 0', () => {
      expect(clampTotalAmount(-100)).toBe(0);
    });

    it('should clamp values exceeding max to 999,999,999.99', () => {
      expect(clampTotalAmount(1_000_000_000)).toBe(999_999_999.99);
    });

    it('should leave valid amounts unchanged', () => {
      expect(clampTotalAmount(1500.50)).toBe(1500.50);
    });
  });
});
