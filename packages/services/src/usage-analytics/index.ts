/**
 * Usage Analytics domain — barrel export.
 *
 * Event-sourced usage recording and the per-workspace analytics dashboard for
 * API Copilot AI. Exported namespaced from the services root as `usageAnalytics`.
 *
 * Validates: Requirements 16.1, 16.2, 16.3, 16.4, 16.5, 16.6, 16.7
 */

export {
  AnalyticsService,
  WorkspaceRepositoryAuthorizer,
  InMemoryQuotaConsumptionProvider,
} from './usage-analytics.service';

export { AuthorizationError, DashboardLoadError } from './usage-analytics.errors';

export {
  USAGE_EVENT_TYPES,
  emptyUsageCounts,
  isUsageEventType,
  normalizeUsageEvent,
  tallyCounts,
} from './usage-analytics.validators';

export {
  MAX_RECORD_ATTEMPTS,
  NO_USAGE_DATA_MESSAGE,
  DEFAULT_DASHBOARD_TIMEOUT_MS,
} from './usage-analytics.types';

export type {
  RecordOutcome,
  UsageCounts,
  QuotaConsumption,
  DashboardView,
  WorkspaceAuthorizer,
  QuotaConsumptionProvider,
  UsageAnalyticsDependencies,
  UsageEvent,
  UsageEventType,
  UserRef,
  PlanTier,
} from './usage-analytics.types';
