/**
 * Billing Errors
 * Custom error types for the billing engine workflow.
 * Validates: Requirements 9.8
 */

/**
 * Thrown when invoice generation is attempted but one or more tests
 * in the package lack cost data (cost is 0 or undefined).
 *
 * Requirement 9.8: Block invoice generation if any test lacks cost data.
 */
export class MissingCostDataError extends Error {
  /** Names of tests that are missing cost data. */
  public readonly testsWithMissingCost: string[];

  constructor(testsWithMissingCost: string[]) {
    const message =
      `Invoice generation blocked: the following tests lack cost data: ${testsWithMissingCost.join(', ')}. ` +
      `All tests must have a valid cost (> 0) before an invoice can be generated.`;
    super(message);
    this.name = 'MissingCostDataError';
    this.testsWithMissingCost = testsWithMissingCost;
  }
}

/**
 * Thrown when an invoice is not found by ID.
 */
export class InvoiceNotFoundError extends Error {
  public readonly invoiceId: string;

  constructor(invoiceId: string) {
    super(`Invoice not found: ${invoiceId}`);
    this.name = 'InvoiceNotFoundError';
    this.invoiceId = invoiceId;
  }
}

/**
 * Thrown when attempting to finalize an already-finalized invoice.
 */
export class InvoiceAlreadyFinalizedError extends Error {
  public readonly invoiceId: string;

  constructor(invoiceId: string) {
    super(`Invoice has already been finalized: ${invoiceId}`);
    this.name = 'InvoiceAlreadyFinalizedError';
    this.invoiceId = invoiceId;
  }
}

/**
 * Thrown when a payment amount exceeds the outstanding balance.
 */
export class PaymentExceedsBalanceError extends Error {
  public readonly invoiceId: string;
  public readonly paymentAmount: number;
  public readonly outstandingBalance: number;

  constructor(invoiceId: string, paymentAmount: number, outstandingBalance: number) {
    super(
      `Payment of ${paymentAmount} exceeds outstanding balance of ${outstandingBalance} for invoice ${invoiceId}.`
    );
    this.name = 'PaymentExceedsBalanceError';
    this.invoiceId = invoiceId;
    this.paymentAmount = paymentAmount;
    this.outstandingBalance = outstandingBalance;
  }
}

/**
 * Thrown when a refund amount exceeds the total payments received.
 */
export class RefundExceedsPaymentsError extends Error {
  public readonly invoiceId: string;
  public readonly refundAmount: number;
  public readonly totalPayments: number;

  constructor(invoiceId: string, refundAmount: number, totalPayments: number) {
    super(
      `Refund of ${refundAmount} exceeds total payments of ${totalPayments} for invoice ${invoiceId}.`
    );
    this.name = 'RefundExceedsPaymentsError';
    this.invoiceId = invoiceId;
    this.refundAmount = refundAmount;
    this.totalPayments = totalPayments;
  }
}

/**
 * Thrown when the line items exceed the maximum allowed (50).
 */
export class TooManyLineItemsError extends Error {
  public readonly count: number;

  constructor(count: number) {
    super(`Invoice cannot have more than 50 line items. Received: ${count}.`);
    this.name = 'TooManyLineItemsError';
    this.count = count;
  }
}
