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

// API Copilot AI — product-shared module (distinct product surface).
// Namespaced to keep it cleanly separable and to avoid cross-product name
// collisions (e.g., Session) with the health-checkup domains.
export * as apiCopilotShared from './api-copilot-shared';

// API Copilot AI — Auth Assistant domain. Namespaced to avoid collisions with
// the health-checkup `auth` domain and other products.
export * as apiCopilotAuthAssistant from './auth-assistant';

// API Copilot AI — Account Auth domain (namespaced to avoid cross-product
// name collisions such as Account / Session with health-checkup domains).
export * as accountAuth from './account-auth';
export * as planQuota from './plan-quota';

// API Copilot AI — Knowledge Engine domain (Req 1). Namespaced for the same
// separability reason and to avoid collisions (e.g., SpecParseError).
export * as knowledgeEngine from './knowledge-engine';

// API Copilot AI — Workspace domain (Req 14, 18.4, 18.5). Namespaced for the
// same separability reason and to avoid collisions (e.g., AuthorizationError).
export * as workspace from './workspace';

// API Copilot AI — Usage Analytics domain (Req 16). Namespaced for the same
// separability reason and to avoid collisions (e.g., AuthorizationError,
// which it reuses from the workspace domain).
export * as usageAnalytics from './usage-analytics';

// API Copilot AI — Conversation History domain (Req 15). Namespaced for the
// same separability reason and to avoid collisions (e.g., ConversationEntry).
export * as conversation from './conversation';

// API Copilot AI — Execution Engine domain (Req 5). Namespaced for the same
// separability reason and to avoid collisions (e.g., EndpointNotFoundError,
// VersionUnavailableError).
export * as executionEngine from './execution-engine';

// API Copilot AI — Interactive Testing Console domain (Req 8). Namespaced for
// the same separability reason and to avoid collisions (e.g., the shared
// HistoryEntry / OutboundRequestSnapshot types and SavedAuthInvalidError).
export * as testingConsole from './testing-console';

// API Copilot AI — Code Generator domain (Req 7). Namespaced for the same
// separability reason and to avoid collisions (e.g., VersionUnavailableError,
// which it defines with code-generation-specific semantics).
export * as codeGenerator from './code-generator';

// API Copilot AI — Query Engine domain (Req 3, 4). Namespaced for the same
// separability reason and to avoid collisions (e.g., IndexingService, and the
// later semantic-search / RAG answering surface). This task adds semantic
// indexing (Req 3.1, 3.5); search and Q&A build on the same domain.
export * as queryEngine from './query-engine';

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
