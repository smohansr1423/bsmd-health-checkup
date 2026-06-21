/**
 * Analytics Service - Physician Dashboard Tests
 * Unit tests for physician population health dashboard.
 *
 * Validates: Requirements 16.1, 16.2, 16.3, 16.4, 16.5, 16.6, 16.7
 */

import { RiskCategory } from '@health-checkup/shared';
import type { TestResult } from '@health-checkup/shared';
import { AnalyticsService } from './analytics.service';
import type {
  AnalyticsDataProvider,
  FollowUpRecord,
  AppointmentRecord,
} from './analytics.types';
import { AgeGroup } from '@health-checkup/shared';

/** Helper to create a minimal TestResult */
function makeTestResult(overrides: Partial<TestResult> = {}): TestResult {
  return {
    id: `tr-${Math.random().toString(36).slice(2)}`,
    checkupSessionId: 'session-1',
    seniorId: 'senior-1',
    testType: 'blood_sugar',
    measuredValue: 100,
    unit: 'mg/dL',
    collectionTimestamp: new Date('2024-01-15T10:00:00Z'),
    technicianId: 'tech-1',
    riskCategory: RiskCategory.Normal,
    amendmentHistory: [],
    createdAt: new Date('2024-01-15T10:00:00Z'),
    ...overrides,
  };
}

/** Helper to create a mock data provider with physician methods */
function createMockDataProvider(overrides: Partial<AnalyticsDataProvider> = {}): AnalyticsDataProvider {
  return {
    getTestResults: jest.fn().mockResolvedValue([]),
    getCheckupSessionIds: jest.fn().mockResolvedValue([]),
    getAgeGroup: jest.fn().mockResolvedValue(AgeGroup.SixtyToSixtyNine),
    getBenchmarkData: jest.fn().mockResolvedValue(null),
    getHealthScore: jest.fn().mockResolvedValue(85),
    getPhysicianPatientIds: jest.fn().mockResolvedValue([]),
    getTestResultsForPatients: jest.fn().mockResolvedValue([]),
    getLatestHealthScoresForPhysician: jest.fn().mockResolvedValue([]),
    getFollowUpRecords: jest.fn().mockResolvedValue([]),
    getAppointmentRecords: jest.fn().mockResolvedValue([]),
    ...overrides,
  };
}

describe('AnalyticsService - Physician Dashboard', () => {
  describe('getPhysicianDashboard', () => {
    describe('Requirement 16.7: No-data scenario', () => {
      it('should return no-data message when physician has no patients', async () => {
        const dataProvider = createMockDataProvider({
          getPhysicianPatientIds: jest.fn().mockResolvedValue([]),
        });
        const service = new AnalyticsService({ dataProvider });

        const result = await service.getPhysicianDashboard('physician-1');

        expect(result.physicianId).toBe('physician-1');
        expect(result.noDataMessage).toBeDefined();
        expect(result.noDataMessage).toContain('No patient data');
        expect(result.totalPatients).toBe(0);
        expect(result.aggregatedHealthScores).toEqual({ average: 0, median: 0, min: 0, max: 0 });
        expect(result.riskDistribution).toHaveLength(0);
        expect(result.topHealthIssues).toHaveLength(0);
        expect(result.followUpCompliance).toEqual({ completedCount: 0, pendingCount: 0, complianceRate: 0 });
        expect(result.appointmentUtilization).toHaveLength(0);
      });
    });

    describe('Requirement 16.1: Aggregated health scores', () => {
      it('should compute average, median, min, and max health scores', async () => {
        const dataProvider = createMockDataProvider({
          getPhysicianPatientIds: jest.fn().mockResolvedValue(['p1', 'p2', 'p3', 'p4', 'p5']),
          getLatestHealthScoresForPhysician: jest.fn().mockResolvedValue([60, 70, 80, 90, 100]),
          getTestResultsForPatients: jest.fn().mockResolvedValue([]),
          getFollowUpRecords: jest.fn().mockResolvedValue([]),
          getAppointmentRecords: jest.fn().mockResolvedValue([]),
        });
        const service = new AnalyticsService({ dataProvider });

        const result = await service.getPhysicianDashboard('physician-1');

        expect(result.aggregatedHealthScores.average).toBe(80);
        expect(result.aggregatedHealthScores.median).toBe(80);
        expect(result.aggregatedHealthScores.min).toBe(60);
        expect(result.aggregatedHealthScores.max).toBe(100);
      });

      it('should compute median correctly for even number of scores', async () => {
        const dataProvider = createMockDataProvider({
          getPhysicianPatientIds: jest.fn().mockResolvedValue(['p1', 'p2', 'p3', 'p4']),
          getLatestHealthScoresForPhysician: jest.fn().mockResolvedValue([60, 70, 80, 90]),
          getTestResultsForPatients: jest.fn().mockResolvedValue([]),
          getFollowUpRecords: jest.fn().mockResolvedValue([]),
          getAppointmentRecords: jest.fn().mockResolvedValue([]),
        });
        const service = new AnalyticsService({ dataProvider });

        const result = await service.getPhysicianDashboard('physician-1');

        expect(result.aggregatedHealthScores.median).toBe(75);
      });

      it('should handle single patient score', async () => {
        const dataProvider = createMockDataProvider({
          getPhysicianPatientIds: jest.fn().mockResolvedValue(['p1']),
          getLatestHealthScoresForPhysician: jest.fn().mockResolvedValue([85]),
          getTestResultsForPatients: jest.fn().mockResolvedValue([]),
          getFollowUpRecords: jest.fn().mockResolvedValue([]),
          getAppointmentRecords: jest.fn().mockResolvedValue([]),
        });
        const service = new AnalyticsService({ dataProvider });

        const result = await service.getPhysicianDashboard('physician-1');

        expect(result.aggregatedHealthScores.average).toBe(85);
        expect(result.aggregatedHealthScores.median).toBe(85);
        expect(result.aggregatedHealthScores.min).toBe(85);
        expect(result.aggregatedHealthScores.max).toBe(85);
      });
    });

    describe('Requirement 16.2: Risk distribution percentages', () => {
      it('should compute percentage distribution that sums to 100%', async () => {
        const testResults: TestResult[] = [
          makeTestResult({ seniorId: 'p1', testType: 'blood_sugar', riskCategory: RiskCategory.Normal }),
          makeTestResult({ seniorId: 'p2', testType: 'blood_sugar', riskCategory: RiskCategory.Normal }),
          makeTestResult({ seniorId: 'p3', testType: 'blood_sugar', riskCategory: RiskCategory.Borderline }),
          makeTestResult({ seniorId: 'p4', testType: 'blood_sugar', riskCategory: RiskCategory.Critical }),
        ];
        const dataProvider = createMockDataProvider({
          getPhysicianPatientIds: jest.fn().mockResolvedValue(['p1', 'p2', 'p3', 'p4']),
          getLatestHealthScoresForPhysician: jest.fn().mockResolvedValue([80, 80, 80, 80]),
          getTestResultsForPatients: jest.fn().mockResolvedValue(testResults),
          getFollowUpRecords: jest.fn().mockResolvedValue([]),
          getAppointmentRecords: jest.fn().mockResolvedValue([]),
        });
        const service = new AnalyticsService({ dataProvider });

        const result = await service.getPhysicianDashboard('physician-1');

        expect(result.riskDistribution).toHaveLength(1);
        const dist = result.riskDistribution[0];
        expect(dist.testType).toBe('blood_sugar');
        expect(dist.normalPercentage).toBe(50);
        expect(dist.borderlinePercentage).toBe(25);
        expect(dist.criticalPercentage).toBe(25);
        expect(dist.normalPercentage + dist.borderlinePercentage + dist.criticalPercentage).toBe(100);
      });

      it('should handle multiple test types', async () => {
        const testResults: TestResult[] = [
          makeTestResult({ seniorId: 'p1', testType: 'blood_sugar', riskCategory: RiskCategory.Normal }),
          makeTestResult({ seniorId: 'p2', testType: 'blood_sugar', riskCategory: RiskCategory.Borderline }),
          makeTestResult({ seniorId: 'p1', testType: 'lipid_profile', riskCategory: RiskCategory.Critical }),
          makeTestResult({ seniorId: 'p2', testType: 'lipid_profile', riskCategory: RiskCategory.Critical }),
        ];
        const dataProvider = createMockDataProvider({
          getPhysicianPatientIds: jest.fn().mockResolvedValue(['p1', 'p2']),
          getLatestHealthScoresForPhysician: jest.fn().mockResolvedValue([70, 75]),
          getTestResultsForPatients: jest.fn().mockResolvedValue(testResults),
          getFollowUpRecords: jest.fn().mockResolvedValue([]),
          getAppointmentRecords: jest.fn().mockResolvedValue([]),
        });
        const service = new AnalyticsService({ dataProvider });

        const result = await service.getPhysicianDashboard('physician-1');

        expect(result.riskDistribution).toHaveLength(2);

        const bloodSugarDist = result.riskDistribution.find(d => d.testType === 'blood_sugar');
        expect(bloodSugarDist).toBeDefined();
        expect(bloodSugarDist!.normalPercentage + bloodSugarDist!.borderlinePercentage + bloodSugarDist!.criticalPercentage).toBe(100);

        const lipidDist = result.riskDistribution.find(d => d.testType === 'lipid_profile');
        expect(lipidDist).toBeDefined();
        expect(lipidDist!.criticalPercentage).toBe(100);
        expect(lipidDist!.normalPercentage + lipidDist!.borderlinePercentage + lipidDist!.criticalPercentage).toBe(100);
      });

      it('should skip uncategorized results in risk distribution', async () => {
        const testResults: TestResult[] = [
          makeTestResult({ seniorId: 'p1', testType: 'blood_sugar', riskCategory: RiskCategory.Normal }),
          makeTestResult({ seniorId: 'p2', testType: 'blood_sugar', riskCategory: RiskCategory.Uncategorized }),
        ];
        const dataProvider = createMockDataProvider({
          getPhysicianPatientIds: jest.fn().mockResolvedValue(['p1', 'p2']),
          getLatestHealthScoresForPhysician: jest.fn().mockResolvedValue([80, 80]),
          getTestResultsForPatients: jest.fn().mockResolvedValue(testResults),
          getFollowUpRecords: jest.fn().mockResolvedValue([]),
          getAppointmentRecords: jest.fn().mockResolvedValue([]),
        });
        const service = new AnalyticsService({ dataProvider });

        const result = await service.getPhysicianDashboard('physician-1');

        const dist = result.riskDistribution.find(d => d.testType === 'blood_sugar');
        expect(dist).toBeDefined();
        expect(dist!.normalPercentage).toBe(100);
      });
    });

    describe('Requirement 16.1: Top 5 health issues', () => {
      it('should return top 5 health issues by patient count', async () => {
        const testResults: TestResult[] = [
          // 6 different test types with varying patient counts
          makeTestResult({ seniorId: 'p1', testType: 'blood_sugar', riskCategory: RiskCategory.Critical }),
          makeTestResult({ seniorId: 'p2', testType: 'blood_sugar', riskCategory: RiskCategory.Critical }),
          makeTestResult({ seniorId: 'p3', testType: 'blood_sugar', riskCategory: RiskCategory.Borderline }),
          makeTestResult({ seniorId: 'p4', testType: 'blood_sugar', riskCategory: RiskCategory.Borderline }),
          makeTestResult({ seniorId: 'p5', testType: 'blood_sugar', riskCategory: RiskCategory.Borderline }),
          makeTestResult({ seniorId: 'p1', testType: 'lipid_profile', riskCategory: RiskCategory.Critical }),
          makeTestResult({ seniorId: 'p2', testType: 'lipid_profile', riskCategory: RiskCategory.Borderline }),
          makeTestResult({ seniorId: 'p3', testType: 'lipid_profile', riskCategory: RiskCategory.Critical }),
          makeTestResult({ seniorId: 'p4', testType: 'lipid_profile', riskCategory: RiskCategory.Borderline }),
          makeTestResult({ seniorId: 'p1', testType: 'ecg', riskCategory: RiskCategory.Critical }),
          makeTestResult({ seniorId: 'p2', testType: 'ecg', riskCategory: RiskCategory.Critical }),
          makeTestResult({ seniorId: 'p3', testType: 'ecg', riskCategory: RiskCategory.Critical }),
          makeTestResult({ seniorId: 'p1', testType: 'thyroid_function', riskCategory: RiskCategory.Borderline }),
          makeTestResult({ seniorId: 'p2', testType: 'thyroid_function', riskCategory: RiskCategory.Borderline }),
          makeTestResult({ seniorId: 'p1', testType: 'kidney_function', riskCategory: RiskCategory.Critical }),
          makeTestResult({ seniorId: 'p1', testType: 'bone_density_scan', riskCategory: RiskCategory.Borderline }),
        ];
        const dataProvider = createMockDataProvider({
          getPhysicianPatientIds: jest.fn().mockResolvedValue(['p1', 'p2', 'p3', 'p4', 'p5']),
          getLatestHealthScoresForPhysician: jest.fn().mockResolvedValue([70, 75, 80, 85, 90]),
          getTestResultsForPatients: jest.fn().mockResolvedValue(testResults),
          getFollowUpRecords: jest.fn().mockResolvedValue([]),
          getAppointmentRecords: jest.fn().mockResolvedValue([]),
        });
        const service = new AnalyticsService({ dataProvider });

        const result = await service.getPhysicianDashboard('physician-1');

        expect(result.topHealthIssues).toHaveLength(5);
        // blood_sugar: 5 patients, lipid_profile: 4, ecg: 3, thyroid: 2, kidney: 1
        expect(result.topHealthIssues[0].testType).toBe('blood_sugar');
        expect(result.topHealthIssues[0].patientCount).toBe(5);
        expect(result.topHealthIssues[1].testType).toBe('lipid_profile');
        expect(result.topHealthIssues[1].patientCount).toBe(4);
      });

      it('should not count Normal results as health issues', async () => {
        const testResults: TestResult[] = [
          makeTestResult({ seniorId: 'p1', testType: 'blood_sugar', riskCategory: RiskCategory.Normal }),
          makeTestResult({ seniorId: 'p2', testType: 'blood_sugar', riskCategory: RiskCategory.Normal }),
        ];
        const dataProvider = createMockDataProvider({
          getPhysicianPatientIds: jest.fn().mockResolvedValue(['p1', 'p2']),
          getLatestHealthScoresForPhysician: jest.fn().mockResolvedValue([90, 95]),
          getTestResultsForPatients: jest.fn().mockResolvedValue(testResults),
          getFollowUpRecords: jest.fn().mockResolvedValue([]),
          getAppointmentRecords: jest.fn().mockResolvedValue([]),
        });
        const service = new AnalyticsService({ dataProvider });

        const result = await service.getPhysicianDashboard('physician-1');

        expect(result.topHealthIssues).toHaveLength(0);
      });
    });

    describe('Requirement 16.3: Follow-up compliance', () => {
      it('should compute compliance rate from completed vs pending', async () => {
        const followUpRecords: FollowUpRecord[] = [
          { id: 'fu-1', status: 'completed', assignedDate: new Date(), completionDate: new Date() },
          { id: 'fu-2', status: 'completed', assignedDate: new Date(), completionDate: new Date() },
          { id: 'fu-3', status: 'completed', assignedDate: new Date(), completionDate: new Date() },
          { id: 'fu-4', status: 'pending', assignedDate: new Date() },
        ];
        const dataProvider = createMockDataProvider({
          getPhysicianPatientIds: jest.fn().mockResolvedValue(['p1', 'p2']),
          getLatestHealthScoresForPhysician: jest.fn().mockResolvedValue([80, 80]),
          getTestResultsForPatients: jest.fn().mockResolvedValue([]),
          getFollowUpRecords: jest.fn().mockResolvedValue(followUpRecords),
          getAppointmentRecords: jest.fn().mockResolvedValue([]),
        });
        const service = new AnalyticsService({ dataProvider });

        const result = await service.getPhysicianDashboard('physician-1');

        expect(result.followUpCompliance.completedCount).toBe(3);
        expect(result.followUpCompliance.pendingCount).toBe(1);
        expect(result.followUpCompliance.complianceRate).toBe(75);
      });

      it('should return 0% compliance when no follow-ups exist', async () => {
        const dataProvider = createMockDataProvider({
          getPhysicianPatientIds: jest.fn().mockResolvedValue(['p1']),
          getLatestHealthScoresForPhysician: jest.fn().mockResolvedValue([80]),
          getTestResultsForPatients: jest.fn().mockResolvedValue([]),
          getFollowUpRecords: jest.fn().mockResolvedValue([]),
          getAppointmentRecords: jest.fn().mockResolvedValue([]),
        });
        const service = new AnalyticsService({ dataProvider });

        const result = await service.getPhysicianDashboard('physician-1');

        expect(result.followUpCompliance.completedCount).toBe(0);
        expect(result.followUpCompliance.pendingCount).toBe(0);
        expect(result.followUpCompliance.complianceRate).toBe(0);
      });

      it('should treat overdue follow-ups as non-completed', async () => {
        const followUpRecords: FollowUpRecord[] = [
          { id: 'fu-1', status: 'completed', assignedDate: new Date(), completionDate: new Date() },
          { id: 'fu-2', status: 'overdue', assignedDate: new Date() },
          { id: 'fu-3', status: 'expired', assignedDate: new Date() },
        ];
        const dataProvider = createMockDataProvider({
          getPhysicianPatientIds: jest.fn().mockResolvedValue(['p1']),
          getLatestHealthScoresForPhysician: jest.fn().mockResolvedValue([80]),
          getTestResultsForPatients: jest.fn().mockResolvedValue([]),
          getFollowUpRecords: jest.fn().mockResolvedValue(followUpRecords),
          getAppointmentRecords: jest.fn().mockResolvedValue([]),
        });
        const service = new AnalyticsService({ dataProvider });

        const result = await service.getPhysicianDashboard('physician-1');

        expect(result.followUpCompliance.completedCount).toBe(1);
        expect(result.followUpCompliance.pendingCount).toBe(2);
        expect(result.followUpCompliance.complianceRate).toBeCloseTo(33.33, 1);
      });
    });

    describe('Requirement 16.5: Appointment utilization', () => {
      it('should compute monthly utilization rates', async () => {
        const appointmentRecords: AppointmentRecord[] = [
          { id: 'a1', scheduledDate: new Date('2024-01-15'), status: 'completed' },
          { id: 'a2', scheduledDate: new Date('2024-01-20'), status: 'completed' },
          { id: 'a3', scheduledDate: new Date('2024-01-25'), status: 'scheduled' },
          { id: 'a4', scheduledDate: new Date('2024-02-10'), status: 'completed' },
          { id: 'a5', scheduledDate: new Date('2024-02-15'), status: 'missed' },
        ];
        const dataProvider = createMockDataProvider({
          getPhysicianPatientIds: jest.fn().mockResolvedValue(['p1', 'p2']),
          getLatestHealthScoresForPhysician: jest.fn().mockResolvedValue([80, 80]),
          getTestResultsForPatients: jest.fn().mockResolvedValue([]),
          getFollowUpRecords: jest.fn().mockResolvedValue([]),
          getAppointmentRecords: jest.fn().mockResolvedValue(appointmentRecords),
        });
        const service = new AnalyticsService({ dataProvider });

        const result = await service.getPhysicianDashboard('physician-1');

        expect(result.appointmentUtilization).toHaveLength(2);

        const jan = result.appointmentUtilization.find(u => u.month === '2024-01');
        expect(jan).toBeDefined();
        expect(jan!.scheduled).toBe(3);
        expect(jan!.completed).toBe(2);
        expect(jan!.utilizationRate).toBeCloseTo(66.67, 1);

        const feb = result.appointmentUtilization.find(u => u.month === '2024-02');
        expect(feb).toBeDefined();
        expect(feb!.scheduled).toBe(2);
        expect(feb!.completed).toBe(1);
        expect(feb!.utilizationRate).toBe(50);
      });

      it('should sort utilization by month ascending', async () => {
        const appointmentRecords: AppointmentRecord[] = [
          { id: 'a1', scheduledDate: new Date('2024-03-10'), status: 'completed' },
          { id: 'a2', scheduledDate: new Date('2024-01-10'), status: 'completed' },
          { id: 'a3', scheduledDate: new Date('2024-02-10'), status: 'completed' },
        ];
        const dataProvider = createMockDataProvider({
          getPhysicianPatientIds: jest.fn().mockResolvedValue(['p1']),
          getLatestHealthScoresForPhysician: jest.fn().mockResolvedValue([80]),
          getTestResultsForPatients: jest.fn().mockResolvedValue([]),
          getFollowUpRecords: jest.fn().mockResolvedValue([]),
          getAppointmentRecords: jest.fn().mockResolvedValue(appointmentRecords),
        });
        const service = new AnalyticsService({ dataProvider });

        const result = await service.getPhysicianDashboard('physician-1');

        expect(result.appointmentUtilization[0].month).toBe('2024-01');
        expect(result.appointmentUtilization[1].month).toBe('2024-02');
        expect(result.appointmentUtilization[2].month).toBe('2024-03');
      });
    });

    describe('General dashboard behavior', () => {
      it('should return total patients count', async () => {
        const dataProvider = createMockDataProvider({
          getPhysicianPatientIds: jest.fn().mockResolvedValue(['p1', 'p2', 'p3']),
          getLatestHealthScoresForPhysician: jest.fn().mockResolvedValue([80, 85, 90]),
          getTestResultsForPatients: jest.fn().mockResolvedValue([]),
          getFollowUpRecords: jest.fn().mockResolvedValue([]),
          getAppointmentRecords: jest.fn().mockResolvedValue([]),
        });
        const service = new AnalyticsService({ dataProvider });

        const result = await service.getPhysicianDashboard('physician-1');

        expect(result.totalPatients).toBe(3);
      });

      it('should include lastUpdatedAt timestamp', async () => {
        const beforeTest = new Date();
        const dataProvider = createMockDataProvider({
          getPhysicianPatientIds: jest.fn().mockResolvedValue(['p1']),
          getLatestHealthScoresForPhysician: jest.fn().mockResolvedValue([80]),
          getTestResultsForPatients: jest.fn().mockResolvedValue([]),
          getFollowUpRecords: jest.fn().mockResolvedValue([]),
          getAppointmentRecords: jest.fn().mockResolvedValue([]),
        });
        const service = new AnalyticsService({ dataProvider });

        const result = await service.getPhysicianDashboard('physician-1');

        expect(result.lastUpdatedAt).toBeInstanceOf(Date);
        expect(result.lastUpdatedAt.getTime()).toBeGreaterThanOrEqual(beforeTest.getTime());
      });

      it('should not set noDataMessage when patients exist', async () => {
        const dataProvider = createMockDataProvider({
          getPhysicianPatientIds: jest.fn().mockResolvedValue(['p1']),
          getLatestHealthScoresForPhysician: jest.fn().mockResolvedValue([80]),
          getTestResultsForPatients: jest.fn().mockResolvedValue([]),
          getFollowUpRecords: jest.fn().mockResolvedValue([]),
          getAppointmentRecords: jest.fn().mockResolvedValue([]),
        });
        const service = new AnalyticsService({ dataProvider });

        const result = await service.getPhysicianDashboard('physician-1');

        expect(result.noDataMessage).toBeUndefined();
      });
    });
  });
});
