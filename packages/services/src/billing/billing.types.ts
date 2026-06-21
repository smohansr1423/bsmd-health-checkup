/**
 * Billing Service Types
 * Request/response types and repository interfaces for the billing engine.
 * Validates: Requirements 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.8
 */

import type {
  Invoice,
  InvoiceLineItem,
  PaymentRecord,
  CheckupPackage,
  CheckupSession,
} from '@health-checkup/shared';
import { SupportedLanguage } from '@health-checkup/shared';

export type { Invoice, InvoiceLineItem, PaymentRecord };

/**
 * Refund record created when a refund is processed.
 */
export interface RefundRecord {
  id: string;
  invoiceId: string;
  amount: number;
  reason?: string;
  processedAt: Date;
}

/**
 * Configuration for tax rate applied to line items.
 */
export interface BillingConfig {
  taxRate: number; // percentage, e.g. 18 for 18%
  currency: string;
}

/**
 * Data needed to generate an invoice from a checkup session.
 */
export interface InvoiceGenerationData {
  session: CheckupSession;
  package: CheckupPackage;
  seniorLanguage: SupportedLanguage;
  insuranceCoveredAmount: number;
  advancePayments: number;
}

/**
 * Repository interface for Invoice persistence.
 */
export interface InvoiceRepository {
  save(invoice: Invoice): Promise<Invoice>;
  findById(id: string): Promise<Invoice | null>;
  update(invoice: Invoice): Promise<Invoice>;
}

/**
 * Repository interface for PaymentRecord persistence.
 */
export interface PaymentRepository {
  save(payment: PaymentRecord): Promise<PaymentRecord>;
  findByInvoiceId(invoiceId: string): Promise<PaymentRecord[]>;
}

/**
 * Repository interface for RefundRecord persistence.
 */
export interface RefundRepository {
  save(refund: RefundRecord): Promise<RefundRecord>;
  findByInvoiceId(invoiceId: string): Promise<RefundRecord[]>;
}

/**
 * Interface for fetching session data needed for invoice generation.
 */
export interface SessionDataProvider {
  getInvoiceGenerationData(sessionId: string): Promise<InvoiceGenerationData>;
}

/**
 * Dependencies injected into the BillingEngineService for testability.
 */
export interface BillingDependencies {
  idGenerator: () => string;
  dateProvider: () => Date;
  invoiceNumberGenerator: (date: Date) => string;
  invoiceRepository: InvoiceRepository;
  paymentRepository: PaymentRepository;
  refundRepository: RefundRepository;
  sessionDataProvider: SessionDataProvider;
  billingConfig: BillingConfig;
}
