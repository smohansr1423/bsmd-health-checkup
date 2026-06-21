/**
 * Analytics Service barrel export
 */
export { AnalyticsService } from './analytics.service';
export { AdminAnalyticsService } from './analytics.admin';
export type {
  IAnalyticsService,
  AnalyticsDependencies,
  AnalyticsDataProvider,
  TrendFilters,
  PatientTrends,
  ParameterTrend,
  TrendDataPoint,
  SummaryCard,
  Benchmark,
  PhysicianDashboard,
  RiskDistribution,
  HealthIssue,
  MonthlyUtilization,
  PhysicianExportRequest,
  FollowUpRecord,
  AppointmentRecord,
  // Admin Dashboard Types (Requirements 17.1–17.8)
  PeriodMetric,
  PackageDistribution,
  LanguageDistribution,
  FinancialSummary,
  AdminDashboard,
  ReportSchedule,
  ReportPeriod,
  AdminExportRequest,
  AdminExportResult,
  AdminDataProvider,
  AdminAnalyticsDependencies,
  IAdminAnalyticsService,
} from './analytics.types';
