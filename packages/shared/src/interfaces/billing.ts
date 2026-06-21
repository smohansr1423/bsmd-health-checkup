/**
 * Billing, Invoice, and Payment interfaces
 */
import { PaymentMethod, SupportedLanguage } from '../enums';

export interface InvoiceLineItem {
  testType: string;
  testName: string;
  cost: number;
  discountApplied: number;
  taxApplied: number;
  netAmount: number;
}

export interface Invoice {
  id: string;
  invoiceNumber: string; // unique
  checkupSessionId: string;
  seniorId: string;
  lineItems: InvoiceLineItem[];
  subtotal: number;
  discountRate: number;
  discountAmount: number;
  taxAmount: number;
  insuranceCoveredAmount: number;
  advancePayments: number;
  totalAmountDue: number; // 0.00 to 999,999,999.99
  outstandingBalance: number;
  paymentStatus: 'Unpaid' | 'Partially Paid' | 'Paid in Full';
  language: SupportedLanguage;
  createdAt: Date;
  finalizedAt?: Date;
}

export interface PaymentRecord {
  id: string;
  invoiceId: string;
  amount: number;
  method: PaymentMethod;
  status: 'pending' | 'success' | 'failed' | 'refunded';
  transactionId?: string;
  failureReason?: string;
  processedAt?: Date;
  createdAt: Date;
}

export interface InstallmentPlan {
  id: string;
  invoiceId: string;
  totalAmount: number;
  installmentCount: number; // up to 3
  installments: Installment[];
}

export interface Installment {
  number: number;
  amount: number;
  dueDate: Date;
  status: 'pending' | 'paid' | 'overdue';
  paymentId?: string;
}
