/**
 * Admin Analytics Service
 * Provides administrative reporting and operational analytics.
 *
 * Validates: Requirements 17.1, 17.2, 17.3, 17.4, 17.5, 17.6, 17.7, 17.8
 */

import type {
  IAdminAnalyticsService,
  AdminAnalyticsDependencies,
  AdminDataProvider,
  AdminDashboard,
  AdminExportRequest,
  AdminExportResult,
  ReportSchedule,
  ReportPeriod,
} from './analytics.types';

/** Maximum data freshness in minutes. Requirement 17.8. */
const MAX_DATA_FRESHNESS_MINUTES = 15;

/** Maximum retry attempts for report generation. Requirement 17.7. */
const MAX_RETRY_ATTEMPTS = 3;

/** Retry interval in milliseconds (5 minutes). Requirement 17.7. */
const RETRY_INTERVAL_MS = 5 * 60 * 1000;

/**
 * AdminAnalyticsService implementation.
 *
 * Business rules:
 * - Reports filterable by daily/weekly/monthly/quarterly/yearly (Requirement 17.1)
 * - Resource utilization: physician workload %, lab capacity %, slot occupancy % (Requirement 17.2)
 * - Financial summary within 30 seconds (Requirement 17.3)
 * - Package popularity: count and % distribution (Requirement 17.4)
 * - Scheduled automated reports with email delivery (Requirement 17.5)
 * - Multi-language usage statistics (Requirement 17.6)
 * - Retry generation 3 times at 5-minute intervals on failure (Requirement 17.7)
 * - Data freshness ≤15 minutes with last refresh timestamp (Requirement 17.8)
 */
export class AdminAnalyticsService implements IAdminAnalyticsService {
  private readonly dataProvider: AdminDataProvider;

  constructor(deps: AdminAnalyticsDependencies) {
    this.dataProvider = deps.adminDataProvider;
  }

  /**
   * Get the admin dashboard with all operational metrics.
   *
   * Requirement 17.1: Reports on registrations, active patients, completed checkups, revenue.
   * Requirement 17.2: Resource utilization metrics.
   * Requirement 17.3: Financial summary (target: under 30 seconds).
   * Requirement 17.4: Package popularity statistics.
   * Requirement 17.6: Multi-language usage statistics.
   * Requirement 17.8: Data freshness ≤15 minutes with timestamp.
   */
  async getAdminDashboard(
    period: ReportPeriod = 'monthly',
    startDate?: Date,
    endDate?: Date
  ): Promise<AdminDashboard> {
    // Gather all metrics in parallel for performance (Requirement 17.3: under 30s)
    const [
      registrations,
      activePatients,
      completedCheckups,
      revenue,
      physicianWorkload,
      labCapacity,
      slotOccupancy,
      financialSummary,
      packagePopularity,
      languageUsage,
      lastRefreshTimestamp,
    ] = await Promise.all([
      this.dataProvider.getRegistrationMetrics(period, startDate, endDate),
      this.dataProvider.getActivePatientCount(),
      this.dataProvider.getCompletedCheckupMetrics(period, startDate, endDate),
      this.dataProvider.getRevenueMetrics(period, startDate, endDate),
      this.dataProvider.getPhysicianWorkloadPercentage(),
      this.dataProvider.getLabCapacityPercentage(),
      this.dataProvider.getSlotOccupancyPercentage(),
      this.dataProvider.getFinancialSummary(),
      this.dataProvider.getPackageDistribution(),
      this.dataProvider.getLanguageDistribution(),
      this.dataProvider.getLastRefreshTimestamp(),
    ]);

    // Requirement 17.8: Calculate data freshness
    const now = new Date();
    const dataFreshnessMinutes = Math.round(
      (now.getTime() - lastRefreshTimestamp.getTime()) / (1000 * 60)
    );

    return {
      registrations,
      activePatients,
      completedCheckups,
      revenue,
      resourceUtilization: {
        physicianWorkload,
        labCapacity,
        slotOccupancy,
      },
      financialSummary,
      packagePopularity,
      languageUsage,
      lastRefreshTimestamp,
      dataFreshnessMinutes,
    };
  }

  /**
   * Export dashboard data in the requested format.
   *
   * Requirement 17.1: Reports filterable by period.
   */
  async exportData(request: AdminExportRequest): Promise<AdminExportResult> {
    const dashboard = await this.getAdminDashboard(
      request.period ?? 'monthly',
      request.startDate,
      request.endDate
    );

    let data: string;
    let recordCount: number;

    if (request.format === 'csv') {
      const result = this.generateCsvExport(dashboard, request.reportType);
      data = result.data;
      recordCount = result.recordCount;
    } else {
      // PDF generation: encode dashboard data as base64 JSON representation
      const result = this.generatePdfExport(dashboard, request.reportType);
      data = result.data;
      recordCount = result.recordCount;
    }

    return {
      data,
      format: request.format,
      generatedAt: new Date(),
      recordCount,
    };
  }

  /**
   * Schedule an automated report with email delivery.
   *
   * Requirement 17.5: Daily/weekly/monthly automated reports with email delivery.
   */
  async scheduleAutomatedReport(
    frequency: 'daily' | 'weekly' | 'monthly',
    recipients: string[]
  ): Promise<ReportSchedule> {
    if (recipients.length === 0) {
      throw new Error('At least one recipient email is required');
    }

    const nextRunAt = this.calculateNextRunTime(frequency);

    const schedule: ReportSchedule = {
      id: this.generateId(),
      frequency,
      recipients,
      nextRunAt,
      status: 'active',
      retryCount: 0,
    };

    return this.dataProvider.saveReportSchedule(schedule);
  }

  /**
   * Execute a scheduled report with retry logic.
   *
   * Requirement 17.7: Retry generation 3 times at 5-minute intervals on failure;
   * notify admin if all retries fail.
   */
  async executeScheduledReport(scheduleId: string): Promise<boolean> {
    const schedules = await this.dataProvider.getScheduledReports();
    const schedule = schedules.find((s) => s.id === scheduleId);

    if (!schedule) {
      throw new Error(`Report schedule not found: ${scheduleId}`);
    }

    if (schedule.status !== 'active') {
      return false;
    }

    let lastError = '';

    for (let attempt = 1; attempt <= MAX_RETRY_ATTEMPTS; attempt++) {
      try {
        // Generate report data
        const dashboard = await this.getAdminDashboard('monthly');
        const exportResult = await this.exportData({
          format: 'pdf',
          reportType: 'full',
        });

        // Send email to all recipients
        const subject = `Automated ${schedule.frequency} report - ${new Date().toISOString().split('T')[0]}`;
        const sent = await this.dataProvider.sendReportEmail(
          schedule.recipients,
          subject,
          exportResult.data,
          exportResult.format
        );

        if (sent) {
          // Update schedule with success
          const nextRunAt = this.calculateNextRunTime(schedule.frequency);
          await this.dataProvider.updateReportSchedule(scheduleId, {
            lastRunAt: new Date(),
            nextRunAt,
            retryCount: 0,
            lastError: undefined,
          });
          return true;
        }

        lastError = 'Email delivery failed';
      } catch (error) {
        lastError = error instanceof Error ? error.message : 'Unknown error';
      }

      // Wait before retry (except on the last attempt)
      if (attempt < MAX_RETRY_ATTEMPTS) {
        await this.delay(RETRY_INTERVAL_MS);
      }
    }

    // All retries exhausted - notify admin (Requirement 17.7)
    await this.dataProvider.notifyAdminFailure(scheduleId, lastError);
    await this.dataProvider.updateReportSchedule(scheduleId, {
      retryCount: MAX_RETRY_ATTEMPTS,
      lastError,
    });

    return false;
  }

  /**
   * Check if dashboard data is within freshness threshold.
   * Requirement 17.8: Data freshness ≤15 minutes.
   */
  isDataFresh(lastRefreshTimestamp: Date): boolean {
    const now = new Date();
    const minutesSinceRefresh = (now.getTime() - lastRefreshTimestamp.getTime()) / (1000 * 60);
    return minutesSinceRefresh <= MAX_DATA_FRESHNESS_MINUTES;
  }

  /**
   * Generate CSV export from dashboard data.
   */
  private generateCsvExport(
    dashboard: AdminDashboard,
    reportType: AdminExportRequest['reportType']
  ): { data: string; recordCount: number } {
    const lines: string[] = [];

    switch (reportType) {
      case 'registrations':
        lines.push('Period,Registrations');
        for (const metric of dashboard.registrations.byPeriod) {
          lines.push(`${metric.period},${metric.value}`);
        }
        break;

      case 'revenue':
        lines.push('Period,Revenue');
        for (const metric of dashboard.revenue.byPeriod) {
          lines.push(`${metric.period},${metric.value}`);
        }
        break;

      case 'utilization':
        lines.push('Metric,Percentage');
        lines.push(`Physician Workload,${dashboard.resourceUtilization.physicianWorkload}`);
        lines.push(`Lab Capacity,${dashboard.resourceUtilization.labCapacity}`);
        lines.push(`Slot Occupancy,${dashboard.resourceUtilization.slotOccupancy}`);
        break;

      case 'packages':
        lines.push('Tier,Count,Percentage');
        for (const pkg of dashboard.packagePopularity) {
          lines.push(`${pkg.tier},${pkg.count},${pkg.percentage}`);
        }
        break;

      case 'languages':
        lines.push('Language,Count,Percentage');
        for (const lang of dashboard.languageUsage) {
          lines.push(`${lang.language},${lang.count},${lang.percentage}`);
        }
        break;

      case 'full':
      default:
        lines.push('Metric,Value');
        lines.push(`Total Registrations,${dashboard.registrations.total}`);
        lines.push(`Active Patients,${dashboard.activePatients}`);
        lines.push(`Completed Checkups,${dashboard.completedCheckups.total}`);
        lines.push(`Total Revenue,${dashboard.revenue.total}`);
        lines.push(`Physician Workload %,${dashboard.resourceUtilization.physicianWorkload}`);
        lines.push(`Lab Capacity %,${dashboard.resourceUtilization.labCapacity}`);
        lines.push(`Slot Occupancy %,${dashboard.resourceUtilization.slotOccupancy}`);
        lines.push(`Total Invoices,${dashboard.financialSummary.totalInvoices}`);
        lines.push(`Payments Received,${dashboard.financialSummary.paymentsReceived}`);
        lines.push(`Outstanding Balances,${dashboard.financialSummary.outstandingBalances}`);
        for (const pkg of dashboard.packagePopularity) {
          lines.push(`Package: ${pkg.tier},${pkg.count} (${pkg.percentage}%)`);
        }
        for (const lang of dashboard.languageUsage) {
          lines.push(`Language: ${lang.language},${lang.count} (${lang.percentage}%)`);
        }
        break;
    }

    // recordCount excludes the header row
    return { data: lines.join('\n'), recordCount: Math.max(0, lines.length - 1) };
  }

  /**
   * Generate PDF export (returns base64-encoded JSON representation of the data).
   */
  private generatePdfExport(
    dashboard: AdminDashboard,
    reportType: AdminExportRequest['reportType']
  ): { data: string; recordCount: number } {
    let reportData: Record<string, unknown>;
    let recordCount: number;

    switch (reportType) {
      case 'registrations':
        reportData = { registrations: dashboard.registrations };
        recordCount = dashboard.registrations.byPeriod.length;
        break;
      case 'revenue':
        reportData = { revenue: dashboard.revenue };
        recordCount = dashboard.revenue.byPeriod.length;
        break;
      case 'utilization':
        reportData = { resourceUtilization: dashboard.resourceUtilization };
        recordCount = 3;
        break;
      case 'packages':
        reportData = { packagePopularity: dashboard.packagePopularity };
        recordCount = dashboard.packagePopularity.length;
        break;
      case 'languages':
        reportData = { languageUsage: dashboard.languageUsage };
        recordCount = dashboard.languageUsage.length;
        break;
      case 'full':
      default:
        reportData = {
          registrations: dashboard.registrations,
          activePatients: dashboard.activePatients,
          completedCheckups: dashboard.completedCheckups,
          revenue: dashboard.revenue,
          resourceUtilization: dashboard.resourceUtilization,
          financialSummary: dashboard.financialSummary,
          packagePopularity: dashboard.packagePopularity,
          languageUsage: dashboard.languageUsage,
        };
        recordCount =
          dashboard.registrations.byPeriod.length +
          dashboard.completedCheckups.byPeriod.length +
          dashboard.revenue.byPeriod.length +
          dashboard.packagePopularity.length +
          dashboard.languageUsage.length + 3; // +3 for utilization metrics
        break;
    }

    const data = Buffer.from(JSON.stringify(reportData)).toString('base64');
    return { data, recordCount };
  }

  /**
   * Calculate the next run time for a scheduled report.
   */
  private calculateNextRunTime(frequency: 'daily' | 'weekly' | 'monthly'): Date {
    const now = new Date();
    const next = new Date(now);

    switch (frequency) {
      case 'daily':
        next.setDate(next.getDate() + 1);
        next.setHours(6, 0, 0, 0); // Default: 6 AM next day
        break;
      case 'weekly':
        next.setDate(next.getDate() + (7 - next.getDay() + 1)); // Next Monday
        next.setHours(6, 0, 0, 0);
        break;
      case 'monthly':
        next.setMonth(next.getMonth() + 1);
        next.setDate(1);
        next.setHours(6, 0, 0, 0);
        break;
    }

    return next;
  }

  /**
   * Generate a unique ID for a report schedule.
   */
  private generateId(): string {
    return `rpt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  /**
   * Delay helper for retry intervals.
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
