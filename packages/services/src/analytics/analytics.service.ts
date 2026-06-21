/**
 * Analytics Service
 * Provides patient health trends, summary cards, and comparative benchmarks.
 *
 * Validates: Requirements 15.1, 15.2, 15.3, 15.4, 15.5, 15.6, 15.7
 */

import type { AgeGroup, RiskCategory, TestCategory } from '@health-checkup/shared';
import type { TestResult } from '@health-checkup/shared';
import { RiskCategory as RiskCategoryEnum } from '@health-checkup/shared';
import type {
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
} from './analytics.types';

/** Maximum data points per parameter trend line. Requirement 15.1. */
const MAX_DATA_POINTS_PER_PARAMETER = 50;

/** Minimum checkups required for trend display. Requirement 15.6. */
const MIN_CHECKUPS_FOR_TRENDS = 2;

/** Consecutive abnormal threshold for warning. Requirement 15.4. */
const CONSECUTIVE_ABNORMAL_THRESHOLD = 3;

/** Minimum date range filter: 1 month. Requirement 15.3. */
const MIN_DATE_RANGE_MONTHS = 1;

/** Maximum date range filter: 5 years. Requirement 15.3. */
const MAX_DATE_RANGE_YEARS = 5;

/**
 * Determines if a risk category is considered "abnormal" (not Normal).
 */
function isAbnormal(category: RiskCategory): boolean {
  return category !== RiskCategoryEnum.Normal;
}

/**
 * Determines if a risk category is "high" (Borderline).
 */
function isHighRisk(category: RiskCategory): boolean {
  return category === RiskCategoryEnum.Borderline;
}

/**
 * Determines if a risk category is "critical".
 */
function isCritical(category: RiskCategory): boolean {
  return category === RiskCategoryEnum.Critical;
}

/**
 * Counts the maximum number of consecutive abnormal readings at the tail
 * of the data points array for a given parameter.
 */
function countConsecutiveAbnormalFromEnd(dataPoints: TrendDataPoint[]): number {
  let count = 0;
  for (let i = dataPoints.length - 1; i >= 0; i--) {
    if (isAbnormal(dataPoints[i].riskCategory)) {
      count++;
    } else {
      break;
    }
  }
  return count;
}

/**
 * Validates and clamps a date range to the allowed bounds.
 * Requirement 15.3: 1 month minimum, 5 years maximum.
 */
function getEffectiveDateRange(
  startDate?: Date,
  endDate?: Date
): { effectiveStart: Date; effectiveEnd: Date } {
  const now = new Date();
  const effectiveEnd = endDate ?? now;

  // Default start: 5 years ago
  const fiveYearsAgo = new Date(effectiveEnd);
  fiveYearsAgo.setFullYear(fiveYearsAgo.getFullYear() - MAX_DATE_RANGE_YEARS);

  let effectiveStart = startDate ?? fiveYearsAgo;

  // Clamp: ensure the range is at least 1 month
  const oneMonthBeforeEnd = new Date(effectiveEnd);
  oneMonthBeforeEnd.setMonth(oneMonthBeforeEnd.getMonth() - MIN_DATE_RANGE_MONTHS);
  if (effectiveStart.getTime() > oneMonthBeforeEnd.getTime()) {
    effectiveStart = oneMonthBeforeEnd;
  }

  // Clamp: ensure the range is at most 5 years
  const maxStart = new Date(effectiveEnd);
  maxStart.setFullYear(maxStart.getFullYear() - MAX_DATE_RANGE_YEARS);
  if (effectiveStart.getTime() < maxStart.getTime()) {
    effectiveStart = maxStart;
  }

  return { effectiveStart, effectiveEnd };
}

/**
 * AnalyticsService implementation.
 *
 * Business rules:
 * - Max 50 data points per parameter (Requirement 15.1)
 * - "insufficient data" if <2 checkups (Requirement 15.6)
 * - 3+ consecutive abnormal readings → visual warning flag (Requirement 15.4)
 * - Benchmarks by age group 10-year brackets (Requirement 15.5)
 * - "benchmark unavailable" when no data for age group (Requirement 15.7)
 * - Filters: date range (1 month–5 years), test category, risk level (Requirement 15.3)
 */
export class AnalyticsService implements IAnalyticsService {
  private readonly dataProvider: AnalyticsDataProvider;

  constructor(deps: AnalyticsDependencies) {
    this.dataProvider = deps.dataProvider;
  }

  /**
   * Get patient health trends with filtering.
   *
   * Requirement 15.1: Display trend lines per parameter, max 50 data points.
   * Requirement 15.3: Filter by date range, test category, risk level.
   * Requirement 15.4: Highlight parameters with 3+ consecutive abnormal.
   * Requirement 15.6: "insufficient data" if <2 checkups.
   */
  async getPatientTrends(seniorId: string, filters: TrendFilters): Promise<PatientTrends> {
    const sessionIds = await this.dataProvider.getCheckupSessionIds(seniorId);

    // Requirement 15.6: insufficient data if <2 checkups
    if (sessionIds.length < MIN_CHECKUPS_FOR_TRENDS) {
      return {
        parameters: [],
        insufficientData: true,
        message: 'Insufficient data available to generate trend lines. At least 2 checkups are required.',
      };
    }

    const allResults = await this.dataProvider.getTestResults(seniorId);

    // Apply date range filter (Requirement 15.3)
    const { effectiveStart, effectiveEnd } = getEffectiveDateRange(
      filters.startDate,
      filters.endDate
    );

    let filteredResults = allResults.filter((r) => {
      const timestamp = new Date(r.collectionTimestamp);
      return timestamp >= effectiveStart && timestamp <= effectiveEnd;
    });

    // Apply test category filter (Requirement 15.3)
    if (filters.testCategory) {
      filteredResults = filteredResults.filter((r) =>
        this.getTestCategory(r.testType) === filters.testCategory
      );
    }

    // Apply risk level filter (Requirement 15.3)
    if (filters.riskLevel) {
      filteredResults = filteredResults.filter((r) =>
        r.riskCategory === filters.riskLevel
      );
    }

    // Group results by test type
    const groupedByTestType = new Map<string, TestResult[]>();
    for (const result of filteredResults) {
      const existing = groupedByTestType.get(result.testType) ?? [];
      existing.push(result);
      groupedByTestType.set(result.testType, existing);
    }

    // Build parameter trends
    const parameters: ParameterTrend[] = [];

    for (const [testType, results] of groupedByTestType.entries()) {
      // Sort by collection timestamp ascending
      const sorted = [...results].sort(
        (a, b) =>
          new Date(a.collectionTimestamp).getTime() - new Date(b.collectionTimestamp).getTime()
      );

      // Limit to most recent 50 data points (Requirement 15.1)
      const limited = sorted.length > MAX_DATA_POINTS_PER_PARAMETER
        ? sorted.slice(sorted.length - MAX_DATA_POINTS_PER_PARAMETER)
        : sorted;

      const dataPoints: TrendDataPoint[] = limited.map((r) => ({
        date: new Date(r.collectionTimestamp),
        value: r.measuredValue,
        unit: r.unit,
        riskCategory: r.riskCategory ?? RiskCategoryEnum.Uncategorized,
        checkupSessionId: r.checkupSessionId,
      }));

      // Check for consecutive abnormal readings (Requirement 15.4)
      const consecutiveAbnormalCount = countConsecutiveAbnormalFromEnd(dataPoints);
      const hasConsecutiveAbnormal = consecutiveAbnormalCount >= CONSECUTIVE_ABNORMAL_THRESHOLD;

      parameters.push({
        testType,
        testCategory: this.getTestCategory(testType),
        dataPoints,
        hasConsecutiveAbnormal,
        consecutiveAbnormalCount,
      });
    }

    return {
      parameters,
      insufficientData: false,
    };
  }

  /**
   * Get the patient summary card.
   *
   * Requirement 15.2: Current health score 0–100, point change from previous,
   * count of high/critical parameters.
   */
  async getPatientSummaryCard(seniorId: string): Promise<SummaryCard> {
    const sessionIds = await this.dataProvider.getCheckupSessionIds(seniorId);

    if (sessionIds.length === 0) {
      return {
        healthScore: 0,
        previousScore: null,
        scoreChange: null,
        highRiskCount: 0,
        criticalCount: 0,
        totalParameters: 0,
        lastCheckupDate: null,
        consecutiveAbnormalWarnings: [],
      };
    }

    // Get the most recent session's health score
    const latestSessionId = sessionIds[sessionIds.length - 1];
    const currentScore = await this.dataProvider.getHealthScore(latestSessionId) ?? 0;

    // Get previous session's score if available
    let previousScore: number | null = null;
    let scoreChange: number | null = null;
    if (sessionIds.length >= 2) {
      const prevSessionId = sessionIds[sessionIds.length - 2];
      previousScore = await this.dataProvider.getHealthScore(prevSessionId);
      if (previousScore !== null) {
        scoreChange = currentScore - previousScore;
      }
    }

    // Get all test results to compute risk counts and consecutive abnormal warnings
    const allResults = await this.dataProvider.getTestResults(seniorId);

    // Get results from the latest session for risk counts
    const latestResults = allResults.filter((r) => r.checkupSessionId === latestSessionId);

    let highRiskCount = 0;
    let criticalCount = 0;
    for (const result of latestResults) {
      const category = result.riskCategory ?? RiskCategoryEnum.Uncategorized;
      if (isHighRisk(category)) highRiskCount++;
      if (isCritical(category)) criticalCount++;
    }

    // Find last checkup date
    const lastCheckupDate = latestResults.length > 0
      ? new Date(
          Math.max(...latestResults.map((r) => new Date(r.collectionTimestamp).getTime()))
        )
      : null;

    // Determine parameters with 3+ consecutive abnormal readings (Requirement 15.4)
    const consecutiveAbnormalWarnings = this.findConsecutiveAbnormalParameters(allResults);

    return {
      healthScore: currentScore,
      previousScore,
      scoreChange,
      highRiskCount,
      criticalCount,
      totalParameters: latestResults.length,
      lastCheckupDate,
      consecutiveAbnormalWarnings,
    };
  }

  /**
   * Get comparative benchmarks for an age group and test type.
   *
   * Requirement 15.5: Show benchmarks by age group (10-year brackets).
   * Requirement 15.7: Return null if benchmark data unavailable.
   */
  async getBenchmarks(ageGroup: AgeGroup, testType: string): Promise<Benchmark | null> {
    return this.dataProvider.getBenchmarkData(ageGroup, testType);
  }

  /**
   * Get physician population health dashboard.
   *
   * Requirement 16.1: Aggregated health scores, risk distributions, top 5 health issues.
   * Requirement 16.2: Percentage of Normal/Borderline/Critical per test type (sum to 100%).
   * Requirement 16.3: Follow-up compliance rate (30-day rolling).
   * Requirement 16.4: Update aggregated statistics within 1 hour of data entry.
   * Requirement 16.5: Appointment utilization: scheduled vs completed per month (12 months).
   * Requirement 16.6: Export CSV/PDF (up to 10,000 records).
   * Requirement 16.7: Handle no-data scenario: display message, metrics at zero/empty.
   */
  async getPhysicianDashboard(physicianId: string): Promise<PhysicianDashboard> {
    const patientIds = await this.dataProvider.getPhysicianPatientIds(physicianId);

    // Requirement 16.7: Handle no-data scenario
    if (patientIds.length === 0) {
      return {
        physicianId,
        aggregatedHealthScores: { average: 0, median: 0, min: 0, max: 0 },
        riskDistribution: [],
        topHealthIssues: [],
        followUpCompliance: { completedCount: 0, pendingCount: 0, complianceRate: 0 },
        appointmentUtilization: [],
        totalPatients: 0,
        lastUpdatedAt: new Date(),
        noDataMessage: 'No patient data available for this physician.',
      };
    }

    // Requirement 16.1: Aggregated health scores
    const healthScores = await this.dataProvider.getLatestHealthScoresForPhysician(physicianId);
    const aggregatedHealthScores = this.computeAggregatedHealthScores(healthScores);

    // Requirement 16.1/16.2: Risk distributions and top health issues
    const testResults = await this.dataProvider.getTestResultsForPatients(patientIds);
    const riskDistribution = this.computeRiskDistribution(testResults);
    const topHealthIssues = this.computeTopHealthIssues(testResults);

    // Requirement 16.3: Follow-up compliance (30-day rolling)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const followUpRecords = await this.dataProvider.getFollowUpRecords(physicianId, thirtyDaysAgo);
    const followUpCompliance = this.computeFollowUpCompliance(followUpRecords);

    // Requirement 16.5: Appointment utilization (12 months)
    const twelveMonthsAgo = new Date();
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);
    const appointmentRecords = await this.dataProvider.getAppointmentRecords(physicianId, twelveMonthsAgo);
    const appointmentUtilization = this.computeAppointmentUtilization(appointmentRecords);

    return {
      physicianId,
      aggregatedHealthScores,
      riskDistribution,
      topHealthIssues,
      followUpCompliance,
      appointmentUtilization,
      totalPatients: patientIds.length,
      lastUpdatedAt: new Date(),
    };
  }

  /**
   * Compute aggregated health scores: average, median, min, max.
   */
  private computeAggregatedHealthScores(scores: number[]): { average: number; median: number; min: number; max: number } {
    if (scores.length === 0) {
      return { average: 0, median: 0, min: 0, max: 0 };
    }

    const sorted = [...scores].sort((a, b) => a - b);
    const sum = sorted.reduce((acc, val) => acc + val, 0);
    const average = Math.round((sum / sorted.length) * 100) / 100;
    const min = sorted[0];
    const max = sorted[sorted.length - 1];

    let median: number;
    const mid = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 0) {
      median = Math.round(((sorted[mid - 1] + sorted[mid]) / 2) * 100) / 100;
    } else {
      median = sorted[mid];
    }

    return { average, median, min, max };
  }

  /**
   * Compute risk distribution percentages per test type.
   * Requirement 16.2: Normal + Borderline + Critical must sum to 100%.
   */
  private computeRiskDistribution(testResults: TestResult[]): RiskDistribution[] {
    const grouped = new Map<string, { normal: number; borderline: number; critical: number }>();

    for (const result of testResults) {
      const category = result.riskCategory ?? RiskCategoryEnum.Uncategorized;
      // Skip uncategorized results for percentage calculation
      if (category === RiskCategoryEnum.Uncategorized) continue;

      if (!grouped.has(result.testType)) {
        grouped.set(result.testType, { normal: 0, borderline: 0, critical: 0 });
      }
      const counts = grouped.get(result.testType)!;
      if (category === RiskCategoryEnum.Normal) counts.normal++;
      else if (category === RiskCategoryEnum.Borderline) counts.borderline++;
      else if (category === RiskCategoryEnum.Critical) counts.critical++;
    }

    const distributions: RiskDistribution[] = [];
    for (const [testType, counts] of grouped.entries()) {
      const total = counts.normal + counts.borderline + counts.critical;
      if (total === 0) continue;

      const normalPercentage = Math.round((counts.normal / total) * 10000) / 100;
      const borderlinePercentage = Math.round((counts.borderline / total) * 10000) / 100;
      // Ensure sums to exactly 100%
      const criticalPercentage = Math.round((100 - normalPercentage - borderlinePercentage) * 100) / 100;

      distributions.push({
        testType,
        normalPercentage,
        borderlinePercentage,
        criticalPercentage,
      });
    }

    return distributions;
  }

  /**
   * Compute top 5 health issues by patient count.
   * Only counts Borderline and Critical results, grouped by test type.
   */
  private computeTopHealthIssues(testResults: TestResult[]): HealthIssue[] {
    const issueMap = new Map<string, Set<string>>();
    const categoryMap = new Map<string, RiskCategory>();

    for (const result of testResults) {
      const category = result.riskCategory ?? RiskCategoryEnum.Uncategorized;
      if (category === RiskCategoryEnum.Borderline || category === RiskCategoryEnum.Critical) {
        if (!issueMap.has(result.testType)) {
          issueMap.set(result.testType, new Set());
        }
        issueMap.get(result.testType)!.add(result.seniorId);

        // Keep the most severe category per test type
        const existing = categoryMap.get(result.testType);
        if (!existing || category === RiskCategoryEnum.Critical) {
          categoryMap.set(result.testType, category);
        }
      }
    }

    const issues: HealthIssue[] = [];
    for (const [testType, patients] of issueMap.entries()) {
      issues.push({
        testType,
        patientCount: patients.size,
        riskCategory: categoryMap.get(testType) ?? RiskCategoryEnum.Borderline,
      });
    }

    // Sort by patient count descending and take top 5
    issues.sort((a, b) => b.patientCount - a.patientCount);
    return issues.slice(0, 5);
  }

  /**
   * Compute follow-up compliance rate (30-day rolling).
   * Requirement 16.3: completed vs pending.
   */
  private computeFollowUpCompliance(records: { status: string }[]): { completedCount: number; pendingCount: number; complianceRate: number } {
    let completedCount = 0;
    let pendingCount = 0;

    for (const record of records) {
      if (record.status === 'completed') {
        completedCount++;
      } else {
        pendingCount++;
      }
    }

    const total = completedCount + pendingCount;
    const complianceRate = total > 0
      ? Math.round((completedCount / total) * 10000) / 100
      : 0;

    return { completedCount, pendingCount, complianceRate };
  }

  /**
   * Compute appointment utilization per month (12 months).
   * Requirement 16.5: scheduled vs completed, utilization rate.
   */
  private computeAppointmentUtilization(records: { scheduledDate: Date; status: string }[]): MonthlyUtilization[] {
    const monthMap = new Map<string, { scheduled: number; completed: number }>();

    for (const record of records) {
      const date = new Date(record.scheduledDate);
      const month = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

      if (!monthMap.has(month)) {
        monthMap.set(month, { scheduled: 0, completed: 0 });
      }
      const counts = monthMap.get(month)!;
      counts.scheduled++;
      if (record.status === 'completed') {
        counts.completed++;
      }
    }

    const utilization: MonthlyUtilization[] = [];
    for (const [month, counts] of monthMap.entries()) {
      const utilizationRate = counts.scheduled > 0
        ? Math.round((counts.completed / counts.scheduled) * 10000) / 100
        : 0;
      utilization.push({
        month,
        scheduled: counts.scheduled,
        completed: counts.completed,
        utilizationRate,
      });
    }

    // Sort by month ascending
    utilization.sort((a, b) => a.month.localeCompare(b.month));
    return utilization;
  }

  /**
   * Find all test types that have 3+ consecutive abnormal readings
   * at the end of their history.
   */
  private findConsecutiveAbnormalParameters(results: TestResult[]): string[] {
    const warnings: string[] = [];

    // Group by test type
    const groupedByTestType = new Map<string, TestResult[]>();
    for (const result of results) {
      const existing = groupedByTestType.get(result.testType) ?? [];
      existing.push(result);
      groupedByTestType.set(result.testType, existing);
    }

    for (const [testType, testResults] of groupedByTestType.entries()) {
      // Sort by timestamp ascending
      const sorted = [...testResults].sort(
        (a, b) =>
          new Date(a.collectionTimestamp).getTime() - new Date(b.collectionTimestamp).getTime()
      );

      // Count consecutive abnormal from end
      let count = 0;
      for (let i = sorted.length - 1; i >= 0; i--) {
        const category = sorted[i].riskCategory ?? RiskCategoryEnum.Uncategorized;
        if (isAbnormal(category)) {
          count++;
        } else {
          break;
        }
      }

      if (count >= CONSECUTIVE_ABNORMAL_THRESHOLD) {
        warnings.push(testType);
      }
    }

    return warnings;
  }

  /**
   * Map a test type string to its category.
   * Uses naming conventions to determine category.
   */
  private getTestCategory(testType: string): TestCategory {
    const categoryMap: Record<string, TestCategory> = {
      ecg: 'cardiac' as TestCategory,
      cardiac_stress_test: 'cardiac' as TestCategory,
      eye_exam: 'vision' as TestCategory,
      hearing_test: 'hearing' as TestCategory,
      bone_density_scan: 'musculoskeletal' as TestCategory,
      complete_blood_count: 'blood' as TestCategory,
      blood_sugar: 'blood' as TestCategory,
      lipid_profile: 'blood' as TestCategory,
      urine_analysis: 'urine' as TestCategory,
      chest_xray: 'imaging' as TestCategory,
      cognitive_screening: 'cognitive' as TestCategory,
      thyroid_function: 'endocrine' as TestCategory,
      kidney_function: 'organ_function' as TestCategory,
      liver_function: 'organ_function' as TestCategory,
    };

    return categoryMap[testType] ?? ('blood' as TestCategory);
  }
}
