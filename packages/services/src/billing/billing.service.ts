/**
 * Billing Engine Service
 * Handles invoice generation, finalization, payments, refunds, and PDF download.
 * Validates: Requirements 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.8
 */

import type { Invoice, InvoiceLineItem, PaymentRecord } from '@health-checkup/shared';
import type {
  RefundRecord,
  BillingDependencies,
  InvoiceRepository,
  PaymentRepository,
  RefundRepository,
  SessionDataProvider,
  BillingConfig,
} from './billing.types';
import {
  validateCostData,
  validateLineItemCount,
  roundToTwoDecimals,
  clampTotalAmount,
} from './billing.validators';
import {
  InvoiceNotFoundError,
  InvoiceAlreadyFinalizedError,
  PaymentExceedsBalanceError,
  RefundExceedsPaymentsError,
} from './billing.errors';

/**
 * In-memory implementation of InvoiceRepository.
 * Suitable for development and testing.
 */
export class InMemoryInvoiceRepository implements InvoiceRepository {
  private invoices: Invoice[] = [];

  async save(invoice: Invoice): Promise<Invoice> {
    this.invoices.push(invoice);
    return invoice;
  }

  async findById(id: string): Promise<Invoice | null> {
    return this.invoices.find((inv) => inv.id === id) ?? null;
  }

  async update(invoice: Invoice): Promise<Invoice> {
    const index = this.invoices.findIndex((inv) => inv.id === invoice.id);
    if (index === -1) {
      throw new Error(`Invoice not found: ${invoice.id}`);
    }
    this.invoices[index] = invoice;
    return invoice;
  }

  clear(): void {
    this.invoices = [];
  }
}

/**
 * In-memory implementation of PaymentRepository.
 */
export class InMemoryPaymentRepository implements PaymentRepository {
  private payments: PaymentRecord[] = [];

  async save(payment: PaymentRecord): Promise<PaymentRecord> {
    this.payments.push(payment);
    return payment;
  }

  async findByInvoiceId(invoiceId: string): Promise<PaymentRecord[]> {
    return this.payments.filter((p) => p.invoiceId === invoiceId);
  }

  clear(): void {
    this.payments = [];
  }
}

/**
 * In-memory implementation of RefundRepository.
 */
export class InMemoryRefundRepository implements RefundRepository {
  private refunds: RefundRecord[] = [];

  async save(refund: RefundRecord): Promise<RefundRecord> {
    this.refunds.push(refund);
    return refund;
  }

  async findByInvoiceId(invoiceId: string): Promise<RefundRecord[]> {
    return this.refunds.filter((r) => r.invoiceId === invoiceId);
  }

  clear(): void {
    this.refunds = [];
  }
}

/** Default ID generator using timestamp + random suffix */
const defaultIdGenerator = (): string => {
  return `INV_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
};

/** Default date provider returning the current system date */
const defaultDateProvider = (): Date => new Date();

/** Invoice number sequence counter (in-memory, resets on restart) */
let invoiceNumberSequence = 0;

/**
 * Default invoice number generator.
 * Format: INV-YYYYMMDD-NNNN (zero-padded sequence number).
 */
const defaultInvoiceNumberGenerator = (date: Date): string => {
  invoiceNumberSequence++;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const seq = String(invoiceNumberSequence).padStart(4, '0');
  return `INV-${year}${month}${day}-${seq}`;
};

/** Default billing configuration */
const defaultBillingConfig: BillingConfig = {
  taxRate: 18, // 18% GST
  currency: 'INR',
};

/**
 * BillingEngineService implementation.
 *
 * Uses dependency injection for ID generation, date provision, repositories,
 * and configuration to support testability.
 *
 * Business rules:
 * - Each test in the package becomes a line item (up to 50)
 * - Discount rate comes from the package tier configuration (0-100%)
 * - Per line item: discountApplied = cost * discountRate/100
 *                  taxApplied = (cost - discountApplied) * taxRate/100
 *                  netAmount = cost - discountApplied + taxApplied
 * - subtotal = sum of all line item costs
 * - discountAmount = subtotal * discountRate / 100
 * - totalAmountDue = subtotal - discountAmount + taxAmount - insuranceCoveredAmount - advancePayments
 * - All amounts rounded to 2 decimal places
 * - totalAmountDue clamped to [0.00, 999,999,999.99]
 */
export class BillingEngineService {
  private readonly idGenerator: () => string;
  private readonly dateProvider: () => Date;
  private readonly invoiceNumberGenerator: (date: Date) => string;
  private readonly invoiceRepository: InvoiceRepository;
  private readonly paymentRepository: PaymentRepository;
  private readonly refundRepository: RefundRepository;
  private readonly sessionDataProvider: SessionDataProvider;
  private readonly billingConfig: BillingConfig;

  constructor(deps?: Partial<BillingDependencies>) {
    this.idGenerator = deps?.idGenerator ?? defaultIdGenerator;
    this.dateProvider = deps?.dateProvider ?? defaultDateProvider;
    this.invoiceNumberGenerator = deps?.invoiceNumberGenerator ?? defaultInvoiceNumberGenerator;
    this.invoiceRepository = deps?.invoiceRepository ?? new InMemoryInvoiceRepository();
    this.paymentRepository = deps?.paymentRepository ?? new InMemoryPaymentRepository();
    this.refundRepository = deps?.refundRepository ?? new InMemoryRefundRepository();
    this.sessionDataProvider = deps?.sessionDataProvider ?? { getInvoiceGenerationData: () => { throw new Error('SessionDataProvider not configured'); } };
    this.billingConfig = deps?.billingConfig ?? defaultBillingConfig;
  }

  /**
   * Generate an invoice for a completed checkup session.
   *
   * Requirement 9.1: Itemize each test with cost, taxes, discounts.
   * Requirement 9.2: Apply configured discount rate per package tier.
   * Requirement 9.3: Calculate total within valid range.
   * Requirement 9.4: All monetary values rounded to 2 decimal places.
   * Requirement 9.5: Render invoice in preferred language.
   * Requirement 9.8: Block generation if missing cost data.
   */
  async generateInvoice(sessionId: string): Promise<Invoice> {
    const data = await this.sessionDataProvider.getInvoiceGenerationData(sessionId);
    const { session, package: pkg, seniorLanguage, insuranceCoveredAmount, advancePayments } = data;

    // Validate cost data (Req 9.8)
    validateCostData(pkg.tests);

    // Validate line item count (max 50)
    validateLineItemCount(pkg.tests.length);

    const discountRate = pkg.discountRate ?? 0;
    const taxRate = this.billingConfig.taxRate;

    // Build line items (Req 9.1)
    const lineItems: InvoiceLineItem[] = pkg.tests.map((test) => {
      const cost = roundToTwoDecimals(test.cost);
      const discountApplied = roundToTwoDecimals(cost * discountRate / 100);
      const taxApplied = roundToTwoDecimals((cost - discountApplied) * taxRate / 100);
      const netAmount = roundToTwoDecimals(cost - discountApplied + taxApplied);

      return {
        testType: test.testType,
        testName: test.name,
        cost,
        discountApplied,
        taxApplied,
        netAmount,
      };
    });

    // Calculate totals
    const subtotal = roundToTwoDecimals(
      lineItems.reduce((sum, item) => sum + item.cost, 0)
    );
    const discountAmount = roundToTwoDecimals(subtotal * discountRate / 100);
    const taxAmount = roundToTwoDecimals(
      lineItems.reduce((sum, item) => sum + item.taxApplied, 0)
    );

    // Req 9.3: totalAmountDue = subtotal - discountAmount + taxAmount - insuranceCoveredAmount - advancePayments
    const rawTotal = subtotal - discountAmount + taxAmount - insuranceCoveredAmount - advancePayments;
    const totalAmountDue = clampTotalAmount(rawTotal);

    const now = this.dateProvider();
    const id = this.idGenerator();

    const invoice: Invoice = {
      id,
      invoiceNumber: '', // Assigned on finalization
      checkupSessionId: session.id,
      seniorId: session.seniorId,
      lineItems,
      subtotal,
      discountRate,
      discountAmount,
      taxAmount,
      insuranceCoveredAmount: roundToTwoDecimals(insuranceCoveredAmount),
      advancePayments: roundToTwoDecimals(advancePayments),
      totalAmountDue,
      outstandingBalance: totalAmountDue,
      paymentStatus: 'Unpaid',
      language: seniorLanguage,
      createdAt: now,
    };

    return this.invoiceRepository.save(invoice);
  }

  /**
   * Finalize an invoice, assigning a unique invoice number.
   *
   * Requirement 9.6: Assign unique invoice number on finalization (format: INV-YYYYMMDD-NNNN).
   *
   * @throws InvoiceNotFoundError if invoice does not exist.
   * @throws InvoiceAlreadyFinalizedError if invoice is already finalized.
   */
  async finalizeInvoice(invoiceId: string): Promise<Invoice> {
    const invoice = await this.getInvoiceOrThrow(invoiceId);

    if (invoice.finalizedAt) {
      throw new InvoiceAlreadyFinalizedError(invoiceId);
    }

    const now = this.dateProvider();
    const invoiceNumber = this.invoiceNumberGenerator(now);

    const finalized: Invoice = {
      ...invoice,
      invoiceNumber,
      finalizedAt: now,
    };

    return this.invoiceRepository.update(finalized);
  }

  /**
   * Apply a payment to an invoice.
   *
   * Updates outstanding balance and payment status accordingly.
   *
   * @throws InvoiceNotFoundError if invoice does not exist.
   * @throws PaymentExceedsBalanceError if payment amount exceeds outstanding balance.
   */
  async applyPayment(invoiceId: string, payment: PaymentRecord): Promise<Invoice> {
    const invoice = await this.getInvoiceOrThrow(invoiceId);

    if (payment.amount > invoice.outstandingBalance) {
      throw new PaymentExceedsBalanceError(
        invoiceId,
        payment.amount,
        invoice.outstandingBalance
      );
    }

    // Save payment record
    await this.paymentRepository.save(payment);

    // Update invoice balance
    const newBalance = roundToTwoDecimals(invoice.outstandingBalance - payment.amount);
    const paymentStatus = this.determinePaymentStatus(invoice.totalAmountDue, newBalance);

    const updated: Invoice = {
      ...invoice,
      outstandingBalance: newBalance,
      paymentStatus,
    };

    return this.invoiceRepository.update(updated);
  }

  /**
   * Process a refund for an invoice.
   *
   * @throws InvoiceNotFoundError if invoice does not exist.
   * @throws RefundExceedsPaymentsError if refund exceeds total payments received.
   */
  async processRefund(invoiceId: string, amount: number): Promise<RefundRecord> {
    const invoice = await this.getInvoiceOrThrow(invoiceId);

    const totalPayments = roundToTwoDecimals(invoice.totalAmountDue - invoice.outstandingBalance);

    if (amount > totalPayments) {
      throw new RefundExceedsPaymentsError(invoiceId, amount, totalPayments);
    }

    const refund: RefundRecord = {
      id: this.idGenerator(),
      invoiceId,
      amount: roundToTwoDecimals(amount),
      processedAt: this.dateProvider(),
    };

    await this.refundRepository.save(refund);

    // Update invoice: increase outstanding balance by refund amount
    const newBalance = roundToTwoDecimals(invoice.outstandingBalance + amount);
    const paymentStatus = this.determinePaymentStatus(invoice.totalAmountDue, newBalance);

    const updated: Invoice = {
      ...invoice,
      outstandingBalance: newBalance,
      paymentStatus,
    };

    await this.invoiceRepository.update(updated);

    return refund;
  }

  /**
   * Get an invoice by ID.
   *
   * @throws InvoiceNotFoundError if invoice does not exist.
   */
  async getInvoice(invoiceId: string): Promise<Invoice> {
    return this.getInvoiceOrThrow(invoiceId);
  }

  /**
   * Get the current payment status with a detailed breakdown for an invoice.
   *
   * Requirement 9.7: Track outstanding balance: Unpaid / Partially Paid / Paid in Full.
   *
   * @throws InvoiceNotFoundError if invoice does not exist.
   */
  async getPaymentStatus(invoiceId: string): Promise<{
    status: 'Unpaid' | 'Partially Paid' | 'Paid in Full';
    totalAmountDue: number;
    totalPaymentsReceived: number;
    totalRefunds: number;
    outstandingBalance: number;
  }> {
    const invoice = await this.getInvoiceOrThrow(invoiceId);
    const payments = await this.paymentRepository.findByInvoiceId(invoiceId);
    const refunds = await this.refundRepository.findByInvoiceId(invoiceId);

    const totalPaymentsReceived = roundToTwoDecimals(
      payments.reduce((sum, p) => sum + p.amount, 0)
    );
    const totalRefunds = roundToTwoDecimals(
      refunds.reduce((sum, r) => sum + r.amount, 0)
    );

    return {
      status: invoice.paymentStatus,
      totalAmountDue: invoice.totalAmountDue,
      totalPaymentsReceived,
      totalRefunds,
      outstandingBalance: invoice.outstandingBalance,
    };
  }

  /**
   * Get payment history for an invoice, ordered by creation date.
   *
   * @throws InvoiceNotFoundError if invoice does not exist.
   */
  async getPaymentHistory(invoiceId: string): Promise<PaymentRecord[]> {
    await this.getInvoiceOrThrow(invoiceId);
    return this.paymentRepository.findByInvoiceId(invoiceId);
  }

  /**
   * Calculate total payments received for an invoice.
   *
   * @throws InvoiceNotFoundError if invoice does not exist.
   */
  async getTotalPaymentsReceived(invoiceId: string): Promise<number> {
    await this.getInvoiceOrThrow(invoiceId);
    const payments = await this.paymentRepository.findByInvoiceId(invoiceId);
    return roundToTwoDecimals(payments.reduce((sum, p) => sum + p.amount, 0));
  }

  /**
   * Download invoice as PDF buffer.
   *
   * Requirement 9.6: PDF available within 30 seconds of finalization.
   * Returns a simple text-based PDF representation for now.
   *
   * @throws InvoiceNotFoundError if invoice does not exist.
   */
  async downloadInvoicePDF(invoiceId: string): Promise<Buffer> {
    const invoice = await this.getInvoiceOrThrow(invoiceId);

    // Generate a simple PDF-like content (in production, use a PDF library)
    const content = this.renderInvoiceContent(invoice);
    return Buffer.from(content, 'utf-8');
  }

  /**
   * Determine payment status based on total amount due and outstanding balance.
   */
  private determinePaymentStatus(
    totalAmountDue: number,
    outstandingBalance: number
  ): 'Unpaid' | 'Partially Paid' | 'Paid in Full' {
    if (outstandingBalance <= 0) {
      return 'Paid in Full';
    }
    if (outstandingBalance >= totalAmountDue) {
      return 'Unpaid';
    }
    return 'Partially Paid';
  }

  /**
   * Retrieve invoice or throw InvoiceNotFoundError.
   */
  private async getInvoiceOrThrow(invoiceId: string): Promise<Invoice> {
    const invoice = await this.invoiceRepository.findById(invoiceId);
    if (!invoice) {
      throw new InvoiceNotFoundError(invoiceId);
    }
    return invoice;
  }

  /**
   * Render invoice content as a text representation (placeholder for PDF generation).
   * In production, this would use a PDF library like pdfkit or puppeteer.
   *
   * Requirement 9.5: Render invoice in preferred language.
   */
  private renderInvoiceContent(invoice: Invoice): string {
    const lines: string[] = [
      `INVOICE ${invoice.invoiceNumber || '(DRAFT)'}`,
      `Language: ${invoice.language}`,
      `Date: ${invoice.createdAt.toISOString()}`,
      `Session: ${invoice.checkupSessionId}`,
      `Patient ID: ${invoice.seniorId}`,
      '',
      'LINE ITEMS:',
      '-'.repeat(60),
    ];

    invoice.lineItems.forEach((item, index) => {
      lines.push(
        `${index + 1}. ${item.testName} (${item.testType})`,
        `   Cost: ${item.cost.toFixed(2)} | Discount: ${item.discountApplied.toFixed(2)} | Tax: ${item.taxApplied.toFixed(2)} | Net: ${item.netAmount.toFixed(2)}`
      );
    });

    lines.push(
      '',
      '-'.repeat(60),
      `Subtotal: ${invoice.subtotal.toFixed(2)}`,
      `Discount (${invoice.discountRate}%): -${invoice.discountAmount.toFixed(2)}`,
      `Tax: +${invoice.taxAmount.toFixed(2)}`,
      `Insurance Coverage: -${invoice.insuranceCoveredAmount.toFixed(2)}`,
      `Advance Payments: -${invoice.advancePayments.toFixed(2)}`,
      '-'.repeat(60),
      `TOTAL AMOUNT DUE: ${invoice.totalAmountDue.toFixed(2)}`,
      `Outstanding Balance: ${invoice.outstandingBalance.toFixed(2)}`,
      `Payment Status: ${invoice.paymentStatus}`,
    );

    if (invoice.finalizedAt) {
      lines.push(`Finalized At: ${invoice.finalizedAt.toISOString()}`);
    }

    return lines.join('\n');
  }
}
