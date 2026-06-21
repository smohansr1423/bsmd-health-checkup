// @health-checkup/services
// Backend microservices for the Senior Citizen Health Checkup System

export * from './auth';
export * from './registration';
export * from './checkup-package';
export * from './localization';
export * from './scheduling';
export * from './physician-assignment';
export * from './test-execution';
export * from './risk-assessment';
export * from './report-generation';
export * from './follow-up';

// Billing — exclude validateDiscountRate to avoid conflict with checkup-package
export {
  BillingEngineService,
  InMemoryInvoiceRepository,
  InMemoryPaymentRepository,
  InMemoryRefundRepository,
} from './billing/billing.service';
export {
  validateCostData,
  validateLineItemCount,
  roundToTwoDecimals,
  clampTotalAmount,
  validateDiscountRate as validateBillingDiscountRate,
} from './billing/billing.validators';
export {
  MissingCostDataError,
  InvoiceNotFoundError,
  InvoiceAlreadyFinalizedError,
  PaymentExceedsBalanceError,
  RefundExceedsPaymentsError,
  TooManyLineItemsError,
} from './billing/billing.errors';
export type {
  RefundRecord,
  BillingConfig,
  InvoiceGenerationData,
  InvoiceRepository,
  PaymentRepository,
  RefundRepository,
  SessionDataProvider,
  BillingDependencies,
} from './billing/billing.types';

export * from './payment';

// Insurance — exclude InsuranceDetails to avoid conflict with registration
export {
  InsuranceIntegrationService,
  InMemoryPolicyRepository,
  InMemoryClaimRepository,
} from './insurance/insurance.service';
export {
  PolicyNotFoundError,
  ClaimNotFoundError,
  InvalidCoveragePercentageError,
  ClaimExceedsMaxError,
  PolicyExpiredError,
  InvalidClaimStateError,
  ClaimSubmissionFailedError,
} from './insurance/insurance.errors';
export type {
  InsuranceDetails as InsuranceInsuranceDetails,
  InsurancePolicy,
  CoverageCalculation,
  ClaimSubmissionRequest,
  ClaimStatus,
  ClaimLineItem,
  InsurancePolicyRepository,
  InsuranceClaimRepository,
  InvoiceLookup,
  InsuranceNotifier,
  InsuranceProviderAdapter,
  InsuranceDependencies,
} from './insurance/insurance.types';

export * from './notification';

// Critical Alert — exclude EscalationEvent to avoid conflict with follow-up
export {
  CriticalAlertService,
  InMemoryCriticalAlertRepository,
  InMemoryAlertLogRepository,
} from './critical-alert/critical-alert.service';
export {
  CriticalAlertNotFoundError,
  AlertAlreadyAcknowledgedError,
  IncompleteAcknowledgementError,
  InvalidAlertDataError,
} from './critical-alert/critical-alert.errors';
export {
  AlertDeliveryService,
  MAX_PRIMARY_RETRIES,
  PRIMARY_RETRY_INTERVAL_MS,
  SECONDARY_FALLBACK_DEADLINE_MS,
} from './critical-alert/critical-alert.delivery';
export type {
  CriticalAlertData,
  CriticalAlertState,
  CriticalAlertStatus,
  EscalationEvent as CriticalAlertEscalationEvent,
  EscalationAction,
  AlertLogEntry,
  ICriticalAlertStateMachine,
  CriticalAlertRepository,
  AlertLogRepository,
  CriticalAlertDependencies,
} from './critical-alert/critical-alert.types';
export type {
  AlertDeliveryAttempt,
  AlertDeliveryResult,
  IAlertDeliveryService,
  AlertDeliveryDependencies,
} from './critical-alert/critical-alert.delivery';

export * from './accessibility';
export * from './analytics';

// Device Integration — rename ValidationError type to avoid conflict with registration
export {
  PLAUSIBLE_RANGES,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  DeviceConflictError,
  UnauthorizedDeviceError,
  TimestampOutOfRangeError,
  ImplausibleValueError,
  RangeOrderInvalidError,
  DeviceValidationError,
  DeviceRegistrationService,
  InMemoryDeviceRepository,
  validateReadingPayload,
  validateTimestamp,
  validatePlausibleRange,
  validateBloodPressure,
  formatReading,
  parseReading,
  DeviceIntegrationService,
  InMemoryHealthReadingRepository,
  InMemoryDailyHealthRecordRepository,
  NormalRangeService,
  InMemoryNormalRangeRepository,
  validateRangeOrdering,
  DEFAULT_NORMAL_RANGES,
  ReadingAlertEngine,
  InMemoryReadingAlertRepository,
  TrendAnalyzer,
  InMemoryReadingsDataSource,
  SystemDateProvider,
  parsePaginationParams,
  paginateArray,
  classifySyncStatus,
  getDeviceStatusEntries,
  isDaytime,
  STALE_THRESHOLD_MS,
  DAYTIME_START_HOUR,
  DAYTIME_END_HOUR,
} from './device-integration';

export type {
  DeviceType,
  DeviceRegistryEntry,
  DeviceRegistrationRequest,
  ReadingType,
  ReadingUnit,
  HealthReading,
  HealthReadingRequest,
  DailyHealthRecord,
  LatestReadingSummary,
  ReadingAlert,
  AlertResult,
  AlertFilters,
  AgeGroup as DeviceAgeGroup,
  NormalRange,
  NormalRangeRequest,
  TrendSummary,
  ValidationError as DeviceValidationErrorType,
  PaginationParams,
  PaginationMeta,
  PaginatedResponse,
  DeviceRepository,
  DeviceRegistrationDependencies,
  HealthReadingJson,
  HealthReadingRepository,
  DailyHealthRecordRepository,
  DeviceIntegrationDependencies,
  DailyHealthRecordGrouped,
  NormalRangeRepository,
  NormalRangeServiceDependencies,
  ReadingAlertRepository,
  EventPublisher,
  ReadingAlertEngineDependencies,
  ReadingsDataSource,
  DateProvider,
  TrendDirection,
  TrendPeriod,
  SyncStatus,
  DeviceStatusEntry,
} from './device-integration';
