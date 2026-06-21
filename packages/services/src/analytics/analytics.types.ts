/**
 * Analytics Service Types
 * Interfaces and types for patient health trends, summary cards,
 * benchmarks, physician dashboards, and admin dashboards.
 *
 * Validates: Requirements 15.1, 15.2, 15.3, 15.4, 15.5, 15.6, 15.7, 16.1, 16.2, 16.3, 16.4, 16.5, 16.6, 16.7
 */

import type { AgeGroup, RiskCategory, TestCategory, SupportedLanguage } from '@health-checkup/shared';
import type { TestResult } from '@health-checkup/shared';

/**
 * Filters for trend data queries.
 * Requirement 15.3: Filter by date range (1 month–5 years), test category, risk level.
 */
export interface TrendFilters {
  startDate?: Date;
  endDate?: Date;
  testCategory?: TestCategory;
  riskLevel?: RiskCategory;
}

/**
 * A single data point on a trend line.
 */
export interface TrendDataPoint {
  date: Date;
  value: number;
  unit: string;
  riskCategory: RiskCategory;
  checkupSessionId: string;
}

/**
 * Trend data for a single health parameter.
 * Requirement 15.1: Max 50 data points per parameter.
 * Requirement 15.4: Flag 3+ consecutive abnormal readings.
 */
export interface ParameterTrend {
  testType: string;
  testCategory: TestCategory;
  dataPoints: TrendDataPoint[];
  hasConsecutiveAbnormal: boolean;
  consecutiveAbnormalCount: number;
}

/**
 * Patient trends response.
 * Requirement 15.6: "insufficient data" if <2 checkups.
 */
export interface PatientTrends {
  parameters: ParameterTrend[];
  insufficientData: boolean;
  message?: string;
}

/**
 * Patient summary card displayed on the analytics dashboard.
 * Requirement 15.2: health score 0–100, point change, high/critical counts.
 */
export interface SummaryCard {
  healthScore: number;
  previousScore: number | null;
  scoreChange: number | null;
  highRiskCount: number;
  criticalCount: number;
  totalParameters: number;
  lastCheckupDate: Date | null;
  consecutiveAbnormalWarnings: string[];
}

/**
 * Benchmark data for age group comparison.
 * Requirement 15.5: Comparative benchmarks by age group (10-year brackets).
 * Requirement 15.7: "benchmark unavailable" when no data.
 */
export interface Benchmark {
  ageGroup: AgeGroup;
  testType: string;
  averageValue: number;
  normalRangeMin: number;
  normalRangeMax: number;
  sampleSize: number;
}

/**
 * Data provider interface for the analytics service.
 * Allows injection of test result data sources for testability.
 */
export interface AnalyticsDataProvider {
  /** Get all test results for a senior citizen, ordered by collection timestamp ascending. */
  getTestResults(seniorId: string): Promise<TestResult[]>;
  /** Get distinct checkup session IDs for a senior citizen, ordered by date ascending. */
  getCheckupSessionIds(seniorId: string): Promise<string[]>;
  /** Get the age group for a senior citizen. */
  getAgeGroup(seniorId: string): Promise<AgeGroup>;
  /** Get benchmark data for a given age group and test type. Returns null if unavailable. */
  getBenchmarkData(ageGroup: AgeGroup, testType: string): Promise<Benchmark | null>;
  /** Get the health score for a specific checkup session. */
  getHealthScore(sessionId: string): Promise<number | null>;

  // ─── Physician Dashboard Data Access ─────────────────────────────────────────

  /** Get all patient IDs managed by a physician. */
  getPhysicianPatientIds(physicianId: string): Promise<string[]>;
  /** Get all test results for a list of patient IDs. */
  getTestResultsForPatients(patientIds: string[]): Promise<TestResult[]>;
  /** Get health scores for all latest sessions of a physician's patients. */
  getLatestHealthScoresForPhysician(physicianId: string): Promise<number[]>;
  /** Get follow-up records for a physician within a date range. */
  getFollowUpRecords(physicianId: string, since: Date): Promise<FollowUpRecord[]>;
  /** Get appointment records for a physician within a date range. */
  getAppointmentRecords(physicianId: string, since: Date): Promise<AppointmentRecord[]>;
}

/**
 * Dependencies injected into the AnalyticsService.
 */
export interface AnalyticsDependencies {
  dataProvider: AnalyticsDataProvider;
}

/**
 * Interface for the Analytics Service (patient-facing methods).
 */
export interface IAnalyticsService {
  getPatientTrends(seniorId: string, filters: TrendFilters): Promise<PatientTrends>;
  getPatientSummaryCard(seniorId: string): Promise<SummaryCard>;
  getBenchmarks(ageGroup: AgeGroup, testType: string): Promise<Benchmark | null>;
  getPhysicianDashboard(physicianId: string): Promise<PhysicianDashboard>;
}

// ─── Physician Dashboard Types (Requirements 16.1–16.7) ───────────────────────

/**
 * Risk distribution per test type.
 * Requirement 16.2: Percentage of Normal/Borderline/Critical must sum to 100%.
 */
export interface RiskDistribution {
  testType: string;
  normalPercentage: number;
  borderlinePercentage: number;
  criticalPercentage: number;
  // normalPercentage + borderlinePercentage + criticalPercentage === 100
}

/**
 * Top health issue by patient count.
 * Requirement 16.1: Top 5 health issues.
 */
export interface HealthIssue {
  testType: string;
  patientCount: number;
  riskCategory: RiskCategory;
}

/**
 * Monthly appointment utilization.
 * Requirement 16.5: Scheduled vs completed per month (12 months).
 */
export interface MonthlyUtilization {
  month: string; // YYYY-MM
  scheduled: number;
  completed: number;
  utilizationRate: number; // completed / scheduled * 100, 0 if no scheduled
}

/**
 * Physician population health dashboard.
 * Requirement 16.1: Aggregated health scores and risk distributions.
 * Requirement 16.2: Percentage distribution per test type.
 * Requirement 16.3: Follow-up compliance (30-day rolling).
 * Requirement 16.4: Update within 1 hour of data entry.
 * Requirement 16.5: Appointment utilization (12 months).
 * Requirement 16.6: Export CSV/PDF (up to 10,000 records).
 * Requirement 16.7: Handle no-data scenario.
 */
export interface PhysicianDashboard {
  physicianId: string;
  aggregatedHealthScores: { average: number; median: number; min: number; max: number };
  riskDistribution: RiskDistribution[];
  topHealthIssues: HealthIssue[]; // top 5
  followUpCompliance: { completedCount: number; pendingCount: number; complianceRate: number };
  appointmentUtilization: MonthlyUtilization[]; // 12 months
  totalPatients: number;
  lastUpdatedAt: Date;
  noDataMessage?: string;
}

/**
 * Export request for physician dashboard data.
 * Requirement 16.6: CSV/PDF export, up to 10,000 records.
 */
export interface PhysicianExportRequest {
  physicianId: string;
  format: 'csv' | 'pdf';
  maxRecords?: number; // defaults to 10,000
}

/**
 * Follow-up record used for compliance calculation.
 */
export interface FollowUpRecord {
  id: string;
  status: 'completed' | 'pending' | 'overdue' | 'expired';
  assignedDate: Date;
  completionDate?: Date;
}

/**
 * Appointment record for utilization calculation.
 */
export interface AppointmentRecord {
  id: string;
  scheduledDate: Date;
  status: 'scheduled' | 'completed' | 'missed' | 'cancelled';
}


// ─── Admin Dashboard Types (Requirements 17.1–17.8) ──────────────────────────

/**
 * A metric value for a specific time period.
 * Requirement 17.1: Filterable by daily, weekly, monthly, quarterly, yearly.
 */
export interface PeriodMetric {
  period: string; // e.g., "2024-Q1", "2024-03", "2024-W12", "2024-03-15"
  value: number;
}

/**
 * Package popularity distribution.
 * Requirement 17.4: Count and percentage of Basic/Standard/Comprehensive.
 */
export interface PackageDistribution {
  tier: string;
  count: number;
  percentage: number;
}

/**
 * Multi-language usage distribution.
 * Requirement 17.6: Count and percentage of preferred languages.
 */
export interface LanguageDistribution {
  language: SupportedLanguage;
  count: number;
  percentage: number;
}

/**
 * Financial summary report.
 * Requirement 17.3: Generated within 30 seconds of request.
 */
export interface FinancialSummary {
  totalInvoices: number;
  paymentsReceived: number;
  outstandingBalances: number;
  insuranceClaimsStatus: {
    submitted: number;
    approved: number;
    rejected: number;
    pending: number;
  };
}

/**
 * Admin dashboard aggregate view.
 * Requirement 17.1, 17.2, 17.3, 17.4, 17.6, 17.8.
 */
export interface AdminDashboard {
  registrations: { total: number; byPeriod: PeriodMetric[] };
  activePatients: number;
  completedCheckups: { total: number; byPeriod: PeriodMetric[] };
  revenue: { total: number; byPeriod: PeriodMetric[] };
  resourceUtilization: {
    physicianWorkload: number; // percentage
    labCapacity: number; // percentage
    slotOccupancy: number; // percentage
  };
  financialSummary: FinancialSummary;
  packagePopularity: PackageDistribution[];
  languageUsage: LanguageDistribution[];
  lastRefreshTimestamp: Date;
  dataFreshnessMinutes: number;
}

/**
 * Scheduled automated report configuration.
 * Requirement 17.5: Daily/weekly/monthly with email delivery.
 * Requirement 17.7: Retry 3 times at 5-minute intervals on failure.
 */
export interface ReportSchedule {
  id: string;
  frequency: 'daily' | 'weekly' | 'monthly';
  recipients: string[];
  nextRunAt: Date;
  lastRunAt?: Date;
  status: 'active' | 'paused';
  retryCount?: number;
  lastError?: string;
}

/**
 * Time period granularity for admin reports.
 */
export type ReportPeriod = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly';

/**
 * Export data request for admin reports.
 */
export interface AdminExportRequest {
  format: 'csv' | 'pdf';
  reportType: 'registrations' | 'revenue' | 'utilization' | 'packages' | 'languages' | 'full';
  period?: ReportPeriod;
  startDate?: Date;
  endDate?: Date;
}

/**
 * Export data result.
 */
export interface AdminExportResult {
  data: string; // CSV content or base64-encoded PDF
  format: 'csv' | 'pdf';
  generatedAt: Date;
  recordCount: number;
}

/**
 * Data provider interface for admin dashboard data.
 */
export interface AdminDataProvider {
  /** Get total registration count and registrations by period. */
  getRegistrationMetrics(period: ReportPeriod, startDate?: Date, endDate?: Date): Promise<{ total: number; byPeriod: PeriodMetric[] }>;
  /** Get count of active patients (those with appointments in last 12 months). */
  getActivePatientCount(): Promise<number>;
  /** Get completed checkups count and by period. */
  getCompletedCheckupMetrics(period: ReportPeriod, startDate?: Date, endDate?: Date): Promise<{ total: number; byPeriod: PeriodMetric[] }>;
  /** Get revenue metrics by period. */
  getRevenueMetrics(period: ReportPeriod, startDate?: Date, endDate?: Date): Promise<{ total: number; byPeriod: PeriodMetric[] }>;
  /** Get physician workload percentage (scheduled vs available slots). */
  getPhysicianWorkloadPercentage(): Promise<number>;
  /** Get lab capacity percentage (tests processed vs daily capacity). */
  getLabCapacityPercentage(): Promise<number>;
  /** Get slot occupancy percentage (booked vs total slots). */
  getSlotOccupancyPercentage(): Promise<number>;
  /** Get financial summary: invoices, payments, balances, claims. */
  getFinancialSummary(): Promise<FinancialSummary>;
  /** Get package tier distribution. */
  getPackageDistribution(): Promise<PackageDistribution[]>;
  /** Get language usage distribution. */
  getLanguageDistribution(): Promise<LanguageDistribution[]>;
  /** Get last data refresh timestamp. */
  getLastRefreshTimestamp(): Promise<Date>;
  /** Get all scheduled reports. */
  getScheduledReports(): Promise<ReportSchedule[]>;
  /** Save a report schedule. */
  saveReportSchedule(schedule: ReportSchedule): Promise<ReportSchedule>;
  /** Update a report schedule. */
  updateReportSchedule(id: string, updates: Partial<ReportSchedule>): Promise<ReportSchedule>;
  /** Send email with report attachment. */
  sendReportEmail(recipients: string[], subject: string, attachmentData: string, format: 'csv' | 'pdf'): Promise<boolean>;
  /** Notify admin of report generation failure. */
  notifyAdminFailure(scheduleId: string, error: string): Promise<void>;
}

/**
 * Dependencies injected into the AdminAnalyticsService.
 */
export interface AdminAnalyticsDependencies {
  adminDataProvider: AdminDataProvider;
}

/**
 * Interface for the Admin Analytics Service.
 * Requirement 17.1–17.8.
 */
export interface IAdminAnalyticsService {
  getAdminDashboard(period: ReportPeriod, startDate?: Date, endDate?: Date): Promise<AdminDashboard>;
  exportData(request: AdminExportRequest): Promise<AdminExportResult>;
  scheduleAutomatedReport(frequency: 'daily' | 'weekly' | 'monthly', recipients: string[]): Promise<ReportSchedule>;
  executeScheduledReport(scheduleId: string): Promise<boolean>;
}
