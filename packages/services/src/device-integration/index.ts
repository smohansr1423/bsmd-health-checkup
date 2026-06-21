/**
 * Device Integration Service barrel export
 * Daily health device readings domain types, errors, and constants.
 */

export {
  PLAUSIBLE_RANGES,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
} from './device-integration.types';

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
  AgeGroup,
  NormalRange,
  NormalRangeRequest,
  TrendSummary,
  ValidationError,
  PaginationParams,
  PaginationMeta,
  PaginatedResponse,
} from './device-integration.types';

export {
  DeviceConflictError,
  UnauthorizedDeviceError,
  TimestampOutOfRangeError,
  ImplausibleValueError,
  RangeOrderInvalidError,
  ValidationError as DeviceValidationError,
} from './device-integration.errors';

export {
  DeviceRegistrationService,
  InMemoryDeviceRepository,
} from './device-registration.service';

export type {
  DeviceRepository,
  DeviceRegistrationDependencies,
} from './device-registration.service';

export {
  validateReadingPayload,
  validateTimestamp,
  validatePlausibleRange,
  validateBloodPressure,
} from './device-gateway';

export { formatReading, parseReading } from './reading-serializer';
export type { HealthReadingJson } from './reading-serializer';

export {
  DeviceIntegrationService,
  InMemoryHealthReadingRepository,
  InMemoryDailyHealthRecordRepository,
} from './device-integration.service';

export type {
  HealthReadingRepository,
  DailyHealthRecordRepository,
  DeviceIntegrationDependencies,
  DailyHealthRecordGrouped,
} from './device-integration.service';

export {
  NormalRangeService,
  InMemoryNormalRangeRepository,
  validateRangeOrdering,
  DEFAULT_NORMAL_RANGES,
} from './normal-range.service';

export type {
  NormalRangeRepository,
  NormalRangeServiceDependencies,
} from './normal-range.service';

export {
  ReadingAlertEngine,
  InMemoryReadingAlertRepository,
} from './reading-alert-engine';

export type {
  ReadingAlertRepository,
  EventPublisher,
  ReadingAlertEngineDependencies,
} from './reading-alert-engine';

export {
  TrendAnalyzer,
  InMemoryReadingsDataSource,
  SystemDateProvider,
} from './trend-analyzer';

export type {
  ReadingsDataSource,
  DateProvider,
  TrendDirection,
  TrendPeriod,
} from './trend-analyzer';

export { parsePaginationParams, paginateArray } from './pagination';

export {
  classifySyncStatus,
  getDeviceStatusEntries,
  isDaytime,
  STALE_THRESHOLD_MS,
  DAYTIME_START_HOUR,
  DAYTIME_END_HOUR,
} from './device-sync-status';

export type {
  SyncStatus,
  DeviceStatusEntry,
} from './device-sync-status';
