/**
 * Payment Processing Service Types
 * Request/response types and repository interfaces for payment processing.
 * Validates: Requirements 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7
 */

import type { PaymentRecord, InstallmentPlan, Installment } from '@health-checkup/shared';
import { PaymentMethod } from '@health-checkup/shared';

export type { PaymentRecord, InstallmentPlan, Installment };
export { PaymentMethod };

/** Payment methods supported by the system */
export type PaymentMethodType = 'credit_card' | 'debit_card' | 'bank_transfer' | 'digital_wallet';

/** Status of a payment session */
export type PaymentSessionStatus = 'active' | 'completed' | 'failed' | 'expired';

/**
 * Request to initiate a payment session.
 */
export interface PaymentRequest {
  invoiceId: string;
  amount: number;
  method: PaymentMethodType;
}

/**
 * Active payment session tracking retries and expiration.
 */
export interface PaymentSession {
  id: string;
  invoiceId: string;
  amount: number;
  method: PaymentMethodType;
  status: PaymentSessionStatus;
  retryCount: number;
  maxRetries: number;
  createdAt: Date;
  expiresAt: Date;
  lastActivityAt: Date;
  holdReleased: boolean;
}

/**
 * Details required to process a payment, varies by method.
 */
export interface PaymentDetails {
  // Credit/debit card fields
  cardNumber?: string;
  cardHolderName?: string;
  expiryMonth?: number;
  expiryYear?: number;
  cvv?: string;

  // Bank transfer fields
  accountNumber?: string;
  routingNumber?: string;
  bankName?: string;

  // Digital wallet fields
  walletId?: string;
  walletProvider?: string;
}

/**
 * Result of a payment processing attempt.
 */
export interface PaymentResult {
  success: boolean;
  transactionId?: string;
  paymentRecord: PaymentRecord;
  receipt?: PaymentReceipt;
  failureReason?: string;
}

/**
 * Payment receipt generated on successful payment.
 */
export interface PaymentReceipt {
  id: string;
  paymentId: string;
  invoiceId: string;
  amount: number;
  method: PaymentMethodType;
  transactionId: string;
  generatedAt: Date;
}

/**
 * Refund request for a completed payment.
 */
export interface RefundRequest {
  paymentId: string;
  amount: number;
  reason?: string;
}

/**
 * Refund result returned after processing.
 */
export interface RefundResult {
  id: string;
  paymentId: string;
  amount: number;
  method: PaymentMethodType;
  status: 'pending' | 'processed';
  estimatedCompletionDate: Date;
  processedAt: Date;
}

/**
 * Repository interface for PaymentSession persistence.
 */
export interface PaymentSessionRepository {
  save(session: PaymentSession): Promise<PaymentSession>;
  findById(id: string): Promise<PaymentSession | null>;
  update(session: PaymentSession): Promise<PaymentSession>;
  findActiveByInvoiceId(invoiceId: string): Promise<PaymentSession | null>;
}

/**
 * Repository interface for PaymentReceipt persistence.
 */
export interface PaymentReceiptRepository {
  save(receipt: PaymentReceipt): Promise<PaymentReceipt>;
  findByPaymentId(paymentId: string): Promise<PaymentReceipt | null>;
}

/**
 * Repository interface for InstallmentPlan persistence.
 */
export interface InstallmentPlanRepository {
  save(plan: InstallmentPlan): Promise<InstallmentPlan>;
  findByInvoiceId(invoiceId: string): Promise<InstallmentPlan | null>;
  update(plan: InstallmentPlan): Promise<InstallmentPlan>;
}

/**
 * Interface for payment gateway integration.
 */
export interface PaymentGateway {
  processPayment(amount: number, method: PaymentMethodType, details: PaymentDetails): Promise<{
    success: boolean;
    transactionId?: string;
    failureReason?: string;
  }>;
  processRefund(transactionId: string, amount: number): Promise<{
    success: boolean;
    refundId?: string;
    failureReason?: string;
  }>;
}

/**
 * Interface for sending payment confirmations.
 */
export interface PaymentNotifier {
  sendConfirmation(receipt: PaymentReceipt): Promise<void>;
}

/**
 * Dependencies injected into the PaymentProcessingService.
 */
export interface PaymentDependencies {
  idGenerator: () => string;
  dateProvider: () => Date;
  sessionRepository: PaymentSessionRepository;
  receiptRepository: PaymentReceiptRepository;
  installmentPlanRepository: InstallmentPlanRepository;
  paymentGateway: PaymentGateway;
  paymentNotifier: PaymentNotifier;
  /** Session timeout in milliseconds (default: 10 minutes) */
  sessionTimeoutMs: number;
  /** Maximum payment processing timeout in milliseconds (default: 30 seconds) */
  processingTimeoutMs: number;
  /** Maximum retry attempts per session (default: 5) */
  maxRetries: number;
}
