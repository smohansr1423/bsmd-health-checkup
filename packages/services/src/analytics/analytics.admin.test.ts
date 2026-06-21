/**
 * Analytics Service - Admin Dashboard Tests
 * Unit tests for administrative reporting and operational analytics.
 *
 * Validates: Requirements 17.1, 17.2, 17.3, 17.4, 17.5, 17.6, 17.7, 17.8
 */

import { SupportedLanguage } from '@health-checkup/shared';
import { AdminAnalyticsService } from './analytics.admin';
import type {
  AdminDataProvider,
  ReportSchedule,
  FinancialSummary,
  PackageDistribution,
  LanguageDistribution,
  PeriodMetric,
} from './analytics.types';

/** Helper to create a mock admin data provider */
function createMockAdminDataProvider(
  overrides: Partial<AdminDataProvider> = {}
): AdminDataProvider {
  return {
    getRegistrationMetrics: jest.fn().mockResolvedValue({ total: 0, byPeriod: [] }),
    getActivePatientCount: jest.fn().mockResolvedValue(0),
    getCompletedCheckupMetrics: jest.fn().mockResolvedValue({ total: 0, byPeriod: [] }),
    getRevenueMetrics: jest.fn().mockResolvedValue({ total: 0, byPeriod: [] }),
    getPhysicianWorkloadPercentage: jest.fn().mockResolvedValue(0),
    getLabCapacityPercentage: jest.fn().mockResolvedValue(0),
    getSlotOccupancyPercentage: jest.fn().mockResolvedValue(0),
    getFinancialSummary: jest.fn().mockResolvedValue({
      totalInvoices: 0,
      paymentsReceived: 0,
      outstandingBalances: 0,
      insuranceClaimsStatus: { submitted: 0, approved: 0, rejected: 0, pending: 0 },
    }),
    getPackageDistribution: jest.fn().mockResolvedValue([]),
    getLanguageDistribution: jest.fn().mockResolvedValue([]),
    getLastRefreshTimestamp: jest.fn().mockResolvedValue(new Date()),
    getScheduledReports: jest.fn().mockResolvedValue([]),
    saveReportSchedule: jest.fn().mockImplementation((s: ReportSchedule) => Promise.resolve(s)),
    updateReportSchedule: jest.fn().mockImplementation((id: string, updates: Partial<ReportSchedule>) =>
      Promise.resolve({ id, ...updates } as ReportSchedule)
    ),
    sendReportEmail: jest.fn().mockResolvedValue(true),
    notifyAdminFailure: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('AdminAnalyticsService', () => {
  describe('getAdminDashboard', () => {
    describe('Requirement 17.1: Reports on registrations, active patients, checkups, revenue', () => {
      it('should return registration metrics by period', async () => {
        const byPeriod: PeriodMetric[] = [
          { period: '2024-01', value: 15 },
          { period: '2024-02', value: 22 },
          { period: '2024-03', value: 18 },
        ];
        const dataProvider = createMockAdminDataProvider({
          getRegistrationMetrics: jest.fn().mockResolvedValue({ total: 55, byPeriod }),
          getLastRefreshTimestamp: jest.fn().mockResolvedValue(new Date()),
        });
        const service = new AdminAnalyticsService({ adminDataProvider: dataProvider });

        const result = await service.getAdminDashboard('monthly');

        expect(result.registrations.total).toBe(55);
        expect(result.registrations.byPeriod).toHaveLength(3);
        expect(result.registrations.byPeriod[0].period).toBe('2024-01');
        expect(result.registrations.byPeriod[0].value).toBe(15);
      });

      it('should return active patient count', async () => {
        const dataProvider = createMockAdminDataProvider({
          getActivePatientCount: jest.fn().mockResolvedValue(142),
          getLastRefreshTimestamp: jest.fn().mockResolvedValue(new Date()),
        });
        const service = new AdminAnalyticsService({ adminDataProvider: dataProvider });

        const result = await service.getAdminDashboard('monthly');

        expect(result.activePatients).toBe(142);
      });

      it('should return completed checkup metrics by period', async () => {
        const byPeriod: PeriodMetric[] = [
          { period: '2024-Q1', value: 45 },
          { period: '2024-Q2', value: 52 },
        ];
        const dataProvider = createMockAdminDataProvider({
          getCompletedCheckupMetrics: jest.fn().mockResolvedValue({ total: 97, byPeriod }),
          getLastRefreshTimestamp: jest.fn().mockResolvedValue(new Date()),
        });
        const service = new AdminAnalyticsService({ adminDataProvider: dataProvider });

        const result = await service.getAdminDashboard('quarterly');

        expect(result.completedCheckups.total).toBe(97);
        expect(result.completedCheckups.byPeriod).toHaveLength(2);
      });

      it('should return revenue metrics by period', async () => {
        const byPeriod: PeriodMetric[] = [
          { period: '2024-01', value: 25000 },
          { period: '2024-02', value: 32000 },
        ];
        const dataProvider = createMockAdminDataProvider({
          getRevenueMetrics: jest.fn().mockResolvedValue({ total: 57000, byPeriod }),
          getLastRefreshTimestamp: jest.fn().mockResolvedValue(new Date()),
        });
        const service = new AdminAnalyticsService({ adminDataProvider: dataProvider });

        const result = await service.getAdminDashboard('monthly');

        expect(result.revenue.total).toBe(57000);
        expect(result.revenue.byPeriod).toHaveLength(2);
      });

      it('should pass period and date range to data provider', async () => {
        const startDate = new Date('2024-01-01');
        const endDate = new Date('2024-06-30');
        const mockGetRegistrations = jest.fn().mockResolvedValue({ total: 0, byPeriod: [] });
        const dataProvider = createMockAdminDataProvider({
          getRegistrationMetrics: mockGetRegistrations,
          getLastRefreshTimestamp: jest.fn().mockResolvedValue(new Date()),
        });
        const service = new AdminAnalyticsService({ adminDataProvider: dataProvider });

        await service.getAdminDashboard('weekly', startDate, endDate);

        expect(mockGetRegistrations).toHaveBeenCalledWith('weekly', startDate, endDate);
      });
    });

    describe('Requirement 17.2: Resource utilization metrics', () => {
      it('should return physician workload percentage', async () => {
        const dataProvider = createMockAdminDataProvider({
          getPhysicianWorkloadPercentage: jest.fn().mockResolvedValue(72.5),
          getLastRefreshTimestamp: jest.fn().mockResolvedValue(new Date()),
        });
        const service = new AdminAnalyticsService({ adminDataProvider: dataProvider });

        const result = await service.getAdminDashboard('monthly');

        expect(result.resourceUtilization.physicianWorkload).toBe(72.5);
      });

      it('should return lab capacity percentage', async () => {
        const dataProvider = createMockAdminDataProvider({
          getLabCapacityPercentage: jest.fn().mockResolvedValue(85.0),
          getLastRefreshTimestamp: jest.fn().mockResolvedValue(new Date()),
        });
        const service = new AdminAnalyticsService({ adminDataProvider: dataProvider });

        const result = await service.getAdminDashboard('monthly');

        expect(result.resourceUtilization.labCapacity).toBe(85.0);
      });

      it('should return slot occupancy percentage', async () => {
        const dataProvider = createMockAdminDataProvider({
          getSlotOccupancyPercentage: jest.fn().mockResolvedValue(63.2),
          getLastRefreshTimestamp: jest.fn().mockResolvedValue(new Date()),
        });
        const service = new AdminAnalyticsService({ adminDataProvider: dataProvider });

        const result = await service.getAdminDashboard('monthly');

        expect(result.resourceUtilization.slotOccupancy).toBe(63.2);
      });
    });

    describe('Requirement 17.3: Financial summary', () => {
      it('should return financial summary with invoices, payments, balances, and claims', async () => {
        const financialSummary: FinancialSummary = {
          totalInvoices: 150,
          paymentsReceived: 120000,
          outstandingBalances: 30000,
          insuranceClaimsStatus: {
            submitted: 80,
            approved: 60,
            rejected: 10,
            pending: 10,
          },
        };
        const dataProvider = createMockAdminDataProvider({
          getFinancialSummary: jest.fn().mockResolvedValue(financialSummary),
          getLastRefreshTimestamp: jest.fn().mockResolvedValue(new Date()),
        });
        const service = new AdminAnalyticsService({ adminDataProvider: dataProvider });

        const result = await service.getAdminDashboard('monthly');

        expect(result.financialSummary.totalInvoices).toBe(150);
        expect(result.financialSummary.paymentsReceived).toBe(120000);
        expect(result.financialSummary.outstandingBalances).toBe(30000);
        expect(result.financialSummary.insuranceClaimsStatus.submitted).toBe(80);
        expect(result.financialSummary.insuranceClaimsStatus.approved).toBe(60);
        expect(result.financialSummary.insuranceClaimsStatus.rejected).toBe(10);
        expect(result.financialSummary.insuranceClaimsStatus.pending).toBe(10);
      });
    });

    describe('Requirement 17.4: Package popularity statistics', () => {
      it('should return package distribution with count and percentage', async () => {
        const packages: PackageDistribution[] = [
          { tier: 'Basic', count: 40, percentage: 40 },
          { tier: 'Standard', count: 35, percentage: 35 },
          { tier: 'Comprehensive', count: 25, percentage: 25 },
        ];
        const dataProvider = createMockAdminDataProvider({
          getPackageDistribution: jest.fn().mockResolvedValue(packages),
          getLastRefreshTimestamp: jest.fn().mockResolvedValue(new Date()),
        });
        const service = new AdminAnalyticsService({ adminDataProvider: dataProvider });

        const result = await service.getAdminDashboard('monthly');

        expect(result.packagePopularity).toHaveLength(3);
        expect(result.packagePopularity[0].tier).toBe('Basic');
        expect(result.packagePopularity[0].count).toBe(40);
        expect(result.packagePopularity[0].percentage).toBe(40);
        // Verify percentages sum to 100
        const totalPercentage = result.packagePopularity.reduce((sum, p) => sum + p.percentage, 0);
        expect(totalPercentage).toBe(100);
      });
    });

    describe('Requirement 17.6: Multi-language usage statistics', () => {
      it('should return language distribution with count and percentage', async () => {
        const languages: LanguageDistribution[] = [
          { language: SupportedLanguage.English, count: 60, percentage: 60 },
          { language: SupportedLanguage.Hindi, count: 25, percentage: 25 },
          { language: SupportedLanguage.Spanish, count: 15, percentage: 15 },
        ];
        const dataProvider = createMockAdminDataProvider({
          getLanguageDistribution: jest.fn().mockResolvedValue(languages),
          getLastRefreshTimestamp: jest.fn().mockResolvedValue(new Date()),
        });
        const service = new AdminAnalyticsService({ adminDataProvider: dataProvider });

        const result = await service.getAdminDashboard('monthly');

        expect(result.languageUsage).toHaveLength(3);
        expect(result.languageUsage[0].language).toBe(SupportedLanguage.English);
        expect(result.languageUsage[0].count).toBe(60);
        expect(result.languageUsage[0].percentage).toBe(60);
        // Verify percentages sum to 100
        const totalPercentage = result.languageUsage.reduce((sum, l) => sum + l.percentage, 0);
        expect(totalPercentage).toBe(100);
      });
    });

    describe('Requirement 17.8: Data freshness ≤15 minutes', () => {
      it('should include last refresh timestamp', async () => {
        const refreshTime = new Date('2024-03-15T10:00:00Z');
        const dataProvider = createMockAdminDataProvider({
          getLastRefreshTimestamp: jest.fn().mockResolvedValue(refreshTime),
        });
        const service = new AdminAnalyticsService({ adminDataProvider: dataProvider });

        const result = await service.getAdminDashboard('monthly');

        expect(result.lastRefreshTimestamp).toEqual(refreshTime);
      });

      it('should calculate data freshness in minutes', async () => {
        const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
        const dataProvider = createMockAdminDataProvider({
          getLastRefreshTimestamp: jest.fn().mockResolvedValue(tenMinutesAgo),
        });
        const service = new AdminAnalyticsService({ adminDataProvider: dataProvider });

        const result = await service.getAdminDashboard('monthly');

        expect(result.dataFreshnessMinutes).toBeGreaterThanOrEqual(9);
        expect(result.dataFreshnessMinutes).toBeLessThanOrEqual(11);
      });

      it('should report data as fresh when within 15-minute threshold', () => {
        const dataProvider = createMockAdminDataProvider();
        const service = new AdminAnalyticsService({ adminDataProvider: dataProvider });

        const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
        expect(service.isDataFresh(fiveMinutesAgo)).toBe(true);
      });

      it('should report data as stale when exceeding 15-minute threshold', () => {
        const dataProvider = createMockAdminDataProvider();
        const service = new AdminAnalyticsService({ adminDataProvider: dataProvider });

        const twentyMinutesAgo = new Date(Date.now() - 20 * 60 * 1000);
        expect(service.isDataFresh(twentyMinutesAgo)).toBe(false);
      });
    });
  });

  describe('exportData', () => {
    it('should generate CSV export for registrations', async () => {
      const byPeriod: PeriodMetric[] = [
        { period: '2024-01', value: 15 },
        { period: '2024-02', value: 22 },
      ];
      const dataProvider = createMockAdminDataProvider({
        getRegistrationMetrics: jest.fn().mockResolvedValue({ total: 37, byPeriod }),
        getLastRefreshTimestamp: jest.fn().mockResolvedValue(new Date()),
      });
      const service = new AdminAnalyticsService({ adminDataProvider: dataProvider });

      const result = await service.exportData({
        format: 'csv',
        reportType: 'registrations',
        period: 'monthly',
      });

      expect(result.format).toBe('csv');
      expect(result.data).toContain('Period,Registrations');
      expect(result.data).toContain('2024-01,15');
      expect(result.data).toContain('2024-02,22');
      expect(result.recordCount).toBe(2);
      expect(result.generatedAt).toBeInstanceOf(Date);
    });

    it('should generate CSV export for utilization metrics', async () => {
      const dataProvider = createMockAdminDataProvider({
        getPhysicianWorkloadPercentage: jest.fn().mockResolvedValue(72),
        getLabCapacityPercentage: jest.fn().mockResolvedValue(85),
        getSlotOccupancyPercentage: jest.fn().mockResolvedValue(63),
        getLastRefreshTimestamp: jest.fn().mockResolvedValue(new Date()),
      });
      const service = new AdminAnalyticsService({ adminDataProvider: dataProvider });

      const result = await service.exportData({
        format: 'csv',
        reportType: 'utilization',
      });

      expect(result.format).toBe('csv');
      expect(result.data).toContain('Metric,Percentage');
      expect(result.data).toContain('Physician Workload,72');
      expect(result.data).toContain('Lab Capacity,85');
      expect(result.data).toContain('Slot Occupancy,63');
      expect(result.recordCount).toBe(3);
    });

    it('should generate PDF export as base64-encoded JSON', async () => {
      const packages: PackageDistribution[] = [
        { tier: 'Basic', count: 40, percentage: 40 },
        { tier: 'Standard', count: 60, percentage: 60 },
      ];
      const dataProvider = createMockAdminDataProvider({
        getPackageDistribution: jest.fn().mockResolvedValue(packages),
        getLastRefreshTimestamp: jest.fn().mockResolvedValue(new Date()),
      });
      const service = new AdminAnalyticsService({ adminDataProvider: dataProvider });

      const result = await service.exportData({
        format: 'pdf',
        reportType: 'packages',
      });

      expect(result.format).toBe('pdf');
      expect(result.recordCount).toBe(2);
      // Verify it's valid base64
      const decoded = JSON.parse(Buffer.from(result.data, 'base64').toString());
      expect(decoded.packagePopularity).toHaveLength(2);
    });

    it('should generate full CSV export with all metrics', async () => {
      const dataProvider = createMockAdminDataProvider({
        getRegistrationMetrics: jest.fn().mockResolvedValue({ total: 100, byPeriod: [] }),
        getActivePatientCount: jest.fn().mockResolvedValue(80),
        getCompletedCheckupMetrics: jest.fn().mockResolvedValue({ total: 50, byPeriod: [] }),
        getRevenueMetrics: jest.fn().mockResolvedValue({ total: 75000, byPeriod: [] }),
        getPhysicianWorkloadPercentage: jest.fn().mockResolvedValue(70),
        getLabCapacityPercentage: jest.fn().mockResolvedValue(65),
        getSlotOccupancyPercentage: jest.fn().mockResolvedValue(80),
        getFinancialSummary: jest.fn().mockResolvedValue({
          totalInvoices: 50,
          paymentsReceived: 60000,
          outstandingBalances: 15000,
          insuranceClaimsStatus: { submitted: 30, approved: 20, rejected: 5, pending: 5 },
        }),
        getPackageDistribution: jest.fn().mockResolvedValue([
          { tier: 'Basic', count: 30, percentage: 30 },
        ]),
        getLanguageDistribution: jest.fn().mockResolvedValue([
          { language: SupportedLanguage.English, count: 80, percentage: 80 },
        ]),
        getLastRefreshTimestamp: jest.fn().mockResolvedValue(new Date()),
      });
      const service = new AdminAnalyticsService({ adminDataProvider: dataProvider });

      const result = await service.exportData({
        format: 'csv',
        reportType: 'full',
      });

      expect(result.format).toBe('csv');
      expect(result.data).toContain('Total Registrations,100');
      expect(result.data).toContain('Active Patients,80');
      expect(result.data).toContain('Completed Checkups,50');
      expect(result.data).toContain('Total Revenue,75000');
      expect(result.data).toContain('Package: Basic,30 (30%)');
      expect(result.data).toContain(`Language: ${SupportedLanguage.English},80 (80%)`);
    });
  });

  describe('scheduleAutomatedReport', () => {
    describe('Requirement 17.5: Schedule automated report generation', () => {
      it('should create a daily report schedule', async () => {
        const mockSave = jest.fn().mockImplementation((s: ReportSchedule) => Promise.resolve(s));
        const dataProvider = createMockAdminDataProvider({
          saveReportSchedule: mockSave,
        });
        const service = new AdminAnalyticsService({ adminDataProvider: dataProvider });

        const result = await service.scheduleAutomatedReport('daily', ['admin@hospital.com']);

        expect(result.frequency).toBe('daily');
        expect(result.recipients).toEqual(['admin@hospital.com']);
        expect(result.status).toBe('active');
        expect(result.id).toBeDefined();
        expect(result.nextRunAt).toBeInstanceOf(Date);
        expect(result.nextRunAt.getTime()).toBeGreaterThan(Date.now());
      });

      it('should create a weekly report schedule', async () => {
        const mockSave = jest.fn().mockImplementation((s: ReportSchedule) => Promise.resolve(s));
        const dataProvider = createMockAdminDataProvider({
          saveReportSchedule: mockSave,
        });
        const service = new AdminAnalyticsService({ adminDataProvider: dataProvider });

        const result = await service.scheduleAutomatedReport('weekly', [
          'admin@hospital.com',
          'manager@hospital.com',
        ]);

        expect(result.frequency).toBe('weekly');
        expect(result.recipients).toHaveLength(2);
        expect(result.status).toBe('active');
      });

      it('should create a monthly report schedule', async () => {
        const mockSave = jest.fn().mockImplementation((s: ReportSchedule) => Promise.resolve(s));
        const dataProvider = createMockAdminDataProvider({
          saveReportSchedule: mockSave,
        });
        const service = new AdminAnalyticsService({ adminDataProvider: dataProvider });

        const result = await service.scheduleAutomatedReport('monthly', ['admin@hospital.com']);

        expect(result.frequency).toBe('monthly');
        expect(result.status).toBe('active');
      });

      it('should reject schedule with no recipients', async () => {
        const dataProvider = createMockAdminDataProvider();
        const service = new AdminAnalyticsService({ adminDataProvider: dataProvider });

        await expect(
          service.scheduleAutomatedReport('daily', [])
        ).rejects.toThrow('At least one recipient email is required');
      });
    });
  });

  describe('executeScheduledReport', () => {
    describe('Requirement 17.7: Retry logic and failure notification', () => {
      it('should execute report and send email on first attempt success', async () => {
        const schedule: ReportSchedule = {
          id: 'rpt-1',
          frequency: 'daily',
          recipients: ['admin@hospital.com'],
          nextRunAt: new Date(),
          status: 'active',
        };
        const mockSendEmail = jest.fn().mockResolvedValue(true);
        const mockUpdate = jest.fn().mockResolvedValue(schedule);
        const dataProvider = createMockAdminDataProvider({
          getScheduledReports: jest.fn().mockResolvedValue([schedule]),
          sendReportEmail: mockSendEmail,
          updateReportSchedule: mockUpdate,
          getLastRefreshTimestamp: jest.fn().mockResolvedValue(new Date()),
        });
        const service = new AdminAnalyticsService({ adminDataProvider: dataProvider });

        const result = await service.executeScheduledReport('rpt-1');

        expect(result).toBe(true);
        expect(mockSendEmail).toHaveBeenCalledTimes(1);
        expect(mockUpdate).toHaveBeenCalledWith('rpt-1', expect.objectContaining({
          retryCount: 0,
        }));
      });

      it('should return false for paused schedules', async () => {
        const schedule: ReportSchedule = {
          id: 'rpt-1',
          frequency: 'daily',
          recipients: ['admin@hospital.com'],
          nextRunAt: new Date(),
          status: 'paused',
        };
        const dataProvider = createMockAdminDataProvider({
          getScheduledReports: jest.fn().mockResolvedValue([schedule]),
        });
        const service = new AdminAnalyticsService({ adminDataProvider: dataProvider });

        const result = await service.executeScheduledReport('rpt-1');

        expect(result).toBe(false);
      });

      it('should throw for non-existent schedule', async () => {
        const dataProvider = createMockAdminDataProvider({
          getScheduledReports: jest.fn().mockResolvedValue([]),
        });
        const service = new AdminAnalyticsService({ adminDataProvider: dataProvider });

        await expect(
          service.executeScheduledReport('non-existent')
        ).rejects.toThrow('Report schedule not found');
      });

      it('should retry up to 3 times and notify admin on total failure', async () => {
        const schedule: ReportSchedule = {
          id: 'rpt-1',
          frequency: 'daily',
          recipients: ['admin@hospital.com'],
          nextRunAt: new Date(),
          status: 'active',
        };
        const mockSendEmail = jest.fn().mockResolvedValue(false);
        const mockNotify = jest.fn().mockResolvedValue(undefined);
        const mockUpdate = jest.fn().mockResolvedValue(schedule);
        const dataProvider = createMockAdminDataProvider({
          getScheduledReports: jest.fn().mockResolvedValue([schedule]),
          sendReportEmail: mockSendEmail,
          notifyAdminFailure: mockNotify,
          updateReportSchedule: mockUpdate,
          getLastRefreshTimestamp: jest.fn().mockResolvedValue(new Date()),
        });
        const service = new AdminAnalyticsService({ adminDataProvider: dataProvider });

        // Override delay to avoid waiting in tests
        (service as any).delay = jest.fn().mockResolvedValue(undefined);

        const result = await service.executeScheduledReport('rpt-1');

        expect(result).toBe(false);
        expect(mockSendEmail).toHaveBeenCalledTimes(3);
        expect(mockNotify).toHaveBeenCalledWith('rpt-1', 'Email delivery failed');
        expect(mockUpdate).toHaveBeenCalledWith('rpt-1', expect.objectContaining({
          retryCount: 3,
          lastError: 'Email delivery failed',
        }));
      });

      it('should retry on exceptions and notify admin with error message', async () => {
        const schedule: ReportSchedule = {
          id: 'rpt-1',
          frequency: 'daily',
          recipients: ['admin@hospital.com'],
          nextRunAt: new Date(),
          status: 'active',
        };
        const mockSendEmail = jest.fn().mockRejectedValue(new Error('Network timeout'));
        const mockNotify = jest.fn().mockResolvedValue(undefined);
        const mockUpdate = jest.fn().mockResolvedValue(schedule);
        const dataProvider = createMockAdminDataProvider({
          getScheduledReports: jest.fn().mockResolvedValue([schedule]),
          sendReportEmail: mockSendEmail,
          notifyAdminFailure: mockNotify,
          updateReportSchedule: mockUpdate,
          getLastRefreshTimestamp: jest.fn().mockResolvedValue(new Date()),
        });
        const service = new AdminAnalyticsService({ adminDataProvider: dataProvider });

        // Override delay to avoid waiting in tests
        (service as any).delay = jest.fn().mockResolvedValue(undefined);

        const result = await service.executeScheduledReport('rpt-1');

        expect(result).toBe(false);
        expect(mockSendEmail).toHaveBeenCalledTimes(3);
        expect(mockNotify).toHaveBeenCalledWith('rpt-1', 'Network timeout');
      });

      it('should succeed on second retry after first failure', async () => {
        const schedule: ReportSchedule = {
          id: 'rpt-1',
          frequency: 'weekly',
          recipients: ['admin@hospital.com'],
          nextRunAt: new Date(),
          status: 'active',
        };
        const mockSendEmail = jest.fn()
          .mockResolvedValueOnce(false)
          .mockResolvedValueOnce(true);
        const mockUpdate = jest.fn().mockResolvedValue(schedule);
        const dataProvider = createMockAdminDataProvider({
          getScheduledReports: jest.fn().mockResolvedValue([schedule]),
          sendReportEmail: mockSendEmail,
          updateReportSchedule: mockUpdate,
          getLastRefreshTimestamp: jest.fn().mockResolvedValue(new Date()),
        });
        const service = new AdminAnalyticsService({ adminDataProvider: dataProvider });

        // Override delay to avoid waiting in tests
        (service as any).delay = jest.fn().mockResolvedValue(undefined);

        const result = await service.executeScheduledReport('rpt-1');

        expect(result).toBe(true);
        expect(mockSendEmail).toHaveBeenCalledTimes(2);
      });
    });
  });
});
