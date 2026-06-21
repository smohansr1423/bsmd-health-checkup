/**
 * Billing Service barrel export
 */
export {
  BillingEngineService,
  InMemoryInvoiceRepository,
  InMemoryPaymentRepository,
  InMemoryRefundRepository,
} from './billing.service';
export {
  validateCostData,
  validateLineItemCount,
  roundToTwoDecimals,
  clampTotalAmount,
  validateDiscountRate,
} from './billing.validators';
export {
  MissingCostDataError,
  InvoiceNotFoundError,
  InvoiceAlreadyFinalizedError,
  PaymentExceedsBalanceError,
  RefundExceedsPaymentsError,
  TooManyLineItemsError,
} from './billing.errors';
export type {
  RefundRecord,
  BillingConfig,
  InvoiceGenerationData,
  InvoiceRepository,
  PaymentRepository,
  RefundRepository,
  SessionDataProvider,
  BillingDependencies,
} from './billing.types';
