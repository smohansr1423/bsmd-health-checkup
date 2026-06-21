// @ts-nocheck
/**
 * Analytics Service Tests
 * Unit tests for patient health trends, summary cards, and benchmarks.
 *
 * Validates: Requirements 15.1, 15.2, 15.3, 15.4, 15.5, 15.6, 15.7
 */

import { AgeGroup, RiskCategory, TestCategory } from '@health-checkup/shared';
import type { TestResult } from '@health-checkup/shared';
import { AnalyticsService } from './analytics.service';
import type { AnalyticsDataProvider, Benchmark, TrendFilters } from './analytics.types';

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

/** Helper to create a mock data provider */
function createMockDataProvider(overrides: Partial<AnalyticsDataProvider> = {}): any {
  return {
    getTestResults: jest.fn().mockResolvedValue([]),
    getCheckupSessionIds: jest.fn().mockResolvedValue([]),
    getAgeGroup: jest.fn().mockResolvedValue(AgeGroup.SixtyToSixtyNine),
    getBenchmarkData: jest.fn().mockResolvedValue(null),
    getHealthScore: jest.fn().mockResolvedValue(85),
    ...overrides,
  };
}

describe('AnalyticsService', () => {
  describe('getPatientTrends', () => {
    it('should return insufficient data when fewer than 2 checkup sessions exist (Requirement 15.6)', async () => {
      const dataProvider = createMockDataProvider({
        getCheckupSessionIds: jest.fn().mockResolvedValue(['session-1']),
      });
      const service = new AnalyticsService({ dataProvider });

      const result = await service.getPatientTrends('senior-1', {});

      expect(result.insufficientData).toBe(true);
      expect(result.message).toContain('Insufficient data');
      expect(result.parameters).toHaveLength(0);
    });

    it('should return insufficient data when no checkup sessions exist (Requirement 15.6)', async () => {
      const dataProvider = createMockDataProvider({
        getCheckupSessionIds: jest.fn().mockResolvedValue([]),
      });
      const service = new AnalyticsService({ dataProvider });

      const result = await service.getPatientTrends('senior-1', {});

      expect(result.insufficientData).toBe(true);
      expect(result.parameters).toHaveLength(0);
    });

    it('should return trends when 2+ checkup sessions exist', async () => {
      const testResults: TestResult[] = [
        makeTestResult({ checkupSessionId: 'session-1', collectionTimestamp: new Date('2024-01-01') }),
        makeTestResult({ checkupSessionId: 'session-2', collectionTimestamp: new Date('2024-02-01') }),
      ];
      const dataProvider = createMockDataProvider({
        getCheckupSessionIds: jest.fn().mockResolvedValue(['session-1', 'session-2']),
        getTestResults: jest.fn().mockResolvedValue(testResults),
      });
      const service = new AnalyticsService({ dataProvider });

      const result = await service.getPatientTrends('senior-1', {});

      expect(result.insufficientData).toBe(false);
      expect(result.parameters).toHaveLength(1);
      expect(result.parameters[0].testType).toBe('blood_sugar');
      expect(result.parameters[0].dataPoints).toHaveLength(2);
    });

    it('should limit data points to max 50 per parameter (Requirement 15.1)', async () => {
      // Create 60 results for a single parameter with recent dates
      const testResults: TestResult[] = Array.from({ length: 60 }, (_, i) =>
        makeTestResult({
          checkupSessionId: `session-${i + 1}`,
          collectionTimestamp: new Date(2024, 0, i + 1),
          measuredValue: 90 + i,
        })
      );
      const sessionIds = Array.from({ length: 60 }, (_, i) => `session-${i + 1}`);

      const dataProvider = createMockDataProvider({
        getCheckupSessionIds: jest.fn().mockResolvedValue(sessionIds),
        getTestResults: jest.fn().mockResolvedValue(testResults),
      });
      const service = new AnalyticsService({ dataProvider });

      const result = await service.getPatientTrends('senior-1', {
        startDate: new Date(2024, 0, 1),
        endDate: new Date(2024, 2, 30),
      });

      expect(result.parameters[0].dataPoints).toHaveLength(50);
      // Should keep the most recent 50
      expect(result.parameters[0].dataPoints[49].value).toBe(90 + 59);
    });

    it('should filter by date range (Requirement 15.3)', async () => {
      const testResults: TestResult[] = [
        makeTestResult({ checkupSessionId: 'session-1', collectionTimestamp: new Date('2023-01-01') }),
        makeTestResult({ checkupSessionId: 'session-2', collectionTimestamp: new Date('2024-06-01') }),
        makeTestResult({ checkupSessionId: 'session-3', collectionTimestamp: new Date('2024-09-01') }),
      ];
      const dataProvider = createMockDataProvider({
        getCheckupSessionIds: jest.fn().mockResolvedValue(['session-1', 'session-2', 'session-3']),
        getTestResults: jest.fn().mockResolvedValue(testResults),
      });
      const service = new AnalyticsService({ dataProvider });

      const filters: TrendFilters = {
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-12-31'),
      };
      const result = await service.getPatientTrends('senior-1', filters);

      expect(result.parameters[0].dataPoints).toHaveLength(2);
    });

    it('should filter by test category (Requirement 15.3)', async () => {
      const testResults: TestResult[] = [
        makeTestResult({ checkupSessionId: 'session-1', testType: 'blood_sugar', collectionTimestamp: new Date('2024-01-01') }),
        makeTestResult({ checkupSessionId: 'session-2', testType: 'blood_sugar', collectionTimestamp: new Date('2024-02-01') }),
        makeTestResult({ checkupSessionId: 'session-1', testType: 'ecg', collectionTimestamp: new Date('2024-01-01') }),
        makeTestResult({ checkupSessionId: 'session-2', testType: 'ecg', collectionTimestamp: new Date('2024-02-01') }),
      ];
      const dataProvider = createMockDataProvider({
        getCheckupSessionIds: jest.fn().mockResolvedValue(['session-1', 'session-2']),
        getTestResults: jest.fn().mockResolvedValue(testResults),
      });
      const service = new AnalyticsService({ dataProvider });

      const filters: TrendFilters = { testCategory: TestCategory.Cardiac };
      const result = await service.getPatientTrends('senior-1', filters);

      expect(result.parameters).toHaveLength(1);
      expect(result.parameters[0].testType).toBe('ecg');
    });

    it('should filter by risk level (Requirement 15.3)', async () => {
      const testResults: TestResult[] = [
        makeTestResult({
          checkupSessionId: 'session-1',
          riskCategory: RiskCategory.Normal,
          collectionTimestamp: new Date('2024-01-01'),
        }),
        makeTestResult({
          checkupSessionId: 'session-2',
          riskCategory: RiskCategory.Critical,
          collectionTimestamp: new Date('2024-02-01'),
        }),
      ];
      const dataProvider = createMockDataProvider({
        getCheckupSessionIds: jest.fn().mockResolvedValue(['session-1', 'session-2']),
        getTestResults: jest.fn().mockResolvedValue(testResults),
      });
      const service = new AnalyticsService({ dataProvider });

      const filters: TrendFilters = { riskLevel: RiskCategory.Critical };
      const result = await service.getPatientTrends('senior-1', filters);

      expect(result.parameters[0].dataPoints).toHaveLength(1);
      expect(result.parameters[0].dataPoints[0].riskCategory).toBe(RiskCategory.Critical);
    });

    it('should flag parameters with 3+ consecutive abnormal readings (Requirement 15.4)', async () => {
      const testResults: TestResult[] = [
        makeTestResult({ checkupSessionId: 'session-1', riskCategory: RiskCategory.Normal, collectionTimestamp: new Date('2024-01-01') }),
        makeTestResult({ checkupSessionId: 'session-2', riskCategory: RiskCategory.Borderline, collectionTimestamp: new Date('2024-02-01') }),
        makeTestResult({ checkupSessionId: 'session-3', riskCategory: RiskCategory.Critical, collectionTimestamp: new Date('2024-03-01') }),
        makeTestResult({ checkupSessionId: 'session-4', riskCategory: RiskCategory.Borderline, collectionTimestamp: new Date('2024-04-01') }),
      ];
      const dataProvider = createMockDataProvider({
        getCheckupSessionIds: jest.fn().mockResolvedValue(['session-1', 'session-2', 'session-3', 'session-4']),
        getTestResults: jest.fn().mockResolvedValue(testResults),
      });
      const service = new AnalyticsService({ dataProvider });

      const result = await service.getPatientTrends('senior-1', {});

      expect(result.parameters[0].hasConsecutiveAbnormal).toBe(true);
      expect(result.parameters[0].consecutiveAbnormalCount).toBe(3);
    });

    it('should not flag parameters with fewer than 3 consecutive abnormal readings (Requirement 15.4)', async () => {
      const testResults: TestResult[] = [
        makeTestResult({ checkupSessionId: 'session-1', riskCategory: RiskCategory.Borderline, collectionTimestamp: new Date('2024-01-01') }),
        makeTestResult({ checkupSessionId: 'session-2', riskCategory: RiskCategory.Normal, collectionTimestamp: new Date('2024-02-01') }),
        makeTestResult({ checkupSessionId: 'session-3', riskCategory: RiskCategory.Critical, collectionTimestamp: new Date('2024-03-01') }),
      ];
      const dataProvider = createMockDataProvider({
        getCheckupSessionIds: jest.fn().mockResolvedValue(['session-1', 'session-2', 'session-3']),
        getTestResults: jest.fn().mockResolvedValue(testResults),
      });
      const service = new AnalyticsService({ dataProvider });

      const result = await service.getPatientTrends('senior-1', {});

      expect(result.parameters[0].hasConsecutiveAbnormal).toBe(false);
      expect(result.parameters[0].consecutiveAbnormalCount).toBe(1);
    });

    it('should sort data points by timestamp ascending', async () => {
      const testResults: TestResult[] = [
        makeTestResult({ checkupSessionId: 'session-2', collectionTimestamp: new Date('2024-03-01'), measuredValue: 110 }),
        makeTestResult({ checkupSessionId: 'session-1', collectionTimestamp: new Date('2024-01-01'), measuredValue: 100 }),
        makeTestResult({ checkupSessionId: 'session-3', collectionTimestamp: new Date('2024-05-01'), measuredValue: 120 }),
      ];
      const dataProvider = createMockDataProvider({
        getCheckupSessionIds: jest.fn().mockResolvedValue(['session-1', 'session-2', 'session-3']),
        getTestResults: jest.fn().mockResolvedValue(testResults),
      });
      const service = new AnalyticsService({ dataProvider });

      const result = await service.getPatientTrends('senior-1', {});

      expect(result.parameters[0].dataPoints[0].value).toBe(100);
      expect(result.parameters[0].dataPoints[1].value).toBe(110);
      expect(result.parameters[0].dataPoints[2].value).toBe(120);
    });
  });

  describe('getPatientSummaryCard', () => {
    it('should return empty summary card when no sessions exist', async () => {
      const dataProvider = createMockDataProvider({
        getCheckupSessionIds: jest.fn().mockResolvedValue([]),
      });
      const service = new AnalyticsService({ dataProvider });

      const result = await service.getPatientSummaryCard('senior-1');

      expect(result.healthScore).toBe(0);
      expect(result.previousScore).toBeNull();
      expect(result.scoreChange).toBeNull();
      expect(result.highRiskCount).toBe(0);
      expect(result.criticalCount).toBe(0);
      expect(result.totalParameters).toBe(0);
      expect(result.lastCheckupDate).toBeNull();
      expect(result.consecutiveAbnormalWarnings).toHaveLength(0);
    });

    it('should return health score and counts for single session (Requirement 15.2)', async () => {
      const testResults: TestResult[] = [
        makeTestResult({ checkupSessionId: 'session-1', riskCategory: RiskCategory.Normal }),
        makeTestResult({ checkupSessionId: 'session-1', testType: 'lipid_profile', riskCategory: RiskCategory.Borderline }),
        makeTestResult({ checkupSessionId: 'session-1', testType: 'ecg', riskCategory: RiskCategory.Critical }),
      ];
      const dataProvider = createMockDataProvider({
        getCheckupSessionIds: jest.fn().mockResolvedValue(['session-1']),
        getTestResults: jest.fn().mockResolvedValue(testResults),
        getHealthScore: jest.fn().mockResolvedValue(72),
      });
      const service = new AnalyticsService({ dataProvider });

      const result = await service.getPatientSummaryCard('senior-1');

      expect(result.healthScore).toBe(72);
      expect(result.previousScore).toBeNull();
      expect(result.scoreChange).toBeNull();
      expect(result.highRiskCount).toBe(1); // Borderline
      expect(result.criticalCount).toBe(1); // Critical
      expect(result.totalParameters).toBe(3);
    });

    it('should compute score change from previous session (Requirement 15.2)', async () => {
      const testResults: TestResult[] = [
        makeTestResult({ checkupSessionId: 'session-1', collectionTimestamp: new Date('2024-01-01') }),
        makeTestResult({ checkupSessionId: 'session-2', collectionTimestamp: new Date('2024-02-01') }),
      ];
      const dataProvider = createMockDataProvider({
        getCheckupSessionIds: jest.fn().mockResolvedValue(['session-1', 'session-2']),
        getTestResults: jest.fn().mockResolvedValue(testResults),
        getHealthScore: jest.fn()
          .mockResolvedValueOnce(85) // latest session score
          .mockResolvedValueOnce(90), // previous session score
      });
      const service = new AnalyticsService({ dataProvider });

      const result = await service.getPatientSummaryCard('senior-1');

      expect(result.healthScore).toBe(85);
      expect(result.previousScore).toBe(90);
      expect(result.scoreChange).toBe(-5);
    });

    it('should include consecutive abnormal warnings in summary card (Requirement 15.4)', async () => {
      const testResults: TestResult[] = [
        makeTestResult({ checkupSessionId: 'session-1', testType: 'blood_sugar', riskCategory: RiskCategory.Borderline, collectionTimestamp: new Date('2024-01-01') }),
        makeTestResult({ checkupSessionId: 'session-2', testType: 'blood_sugar', riskCategory: RiskCategory.Critical, collectionTimestamp: new Date('2024-02-01') }),
        makeTestResult({ checkupSessionId: 'session-3', testType: 'blood_sugar', riskCategory: RiskCategory.Borderline, collectionTimestamp: new Date('2024-03-01') }),
        makeTestResult({ checkupSessionId: 'session-1', testType: 'lipid_profile', riskCategory: RiskCategory.Normal, collectionTimestamp: new Date('2024-01-01') }),
        makeTestResult({ checkupSessionId: 'session-2', testType: 'lipid_profile', riskCategory: RiskCategory.Normal, collectionTimestamp: new Date('2024-02-01') }),
        makeTestResult({ checkupSessionId: 'session-3', testType: 'lipid_profile', riskCategory: RiskCategory.Normal, collectionTimestamp: new Date('2024-03-01') }),
      ];
      const dataProvider = createMockDataProvider({
        getCheckupSessionIds: jest.fn().mockResolvedValue(['session-1', 'session-2', 'session-3']),
        getTestResults: jest.fn().mockResolvedValue(testResults),
        getHealthScore: jest.fn().mockResolvedValue(75),
      });
      const service = new AnalyticsService({ dataProvider });

      const result = await service.getPatientSummaryCard('senior-1');

      expect(result.consecutiveAbnormalWarnings).toContain('blood_sugar');
      expect(result.consecutiveAbnormalWarnings).not.toContain('lipid_profile');
    });
  });

  describe('getBenchmarks', () => {
    it('should return benchmark data when available (Requirement 15.5)', async () => {
      const benchmarkData: Benchmark = {
        ageGroup: AgeGroup.SixtyToSixtyNine,
        testType: 'blood_sugar',
        averageValue: 105,
        normalRangeMin: 70,
        normalRangeMax: 130,
        sampleSize: 500,
      };
      const dataProvider = createMockDataProvider({
        getBenchmarkData: jest.fn().mockResolvedValue(benchmarkData),
      });
      const service = new AnalyticsService({ dataProvider });

      const result = await service.getBenchmarks(AgeGroup.SixtyToSixtyNine, 'blood_sugar');

      expect(result).not.toBeNull();
      expect(result!.ageGroup).toBe(AgeGroup.SixtyToSixtyNine);
      expect(result!.testType).toBe('blood_sugar');
      expect(result!.averageValue).toBe(105);
      expect(result!.sampleSize).toBe(500);
    });

    it('should return null when benchmark data unavailable (Requirement 15.7)', async () => {
      const dataProvider = createMockDataProvider({
        getBenchmarkData: jest.fn().mockResolvedValue(null),
      });
      const service = new AnalyticsService({ dataProvider });

      const result = await service.getBenchmarks(AgeGroup.NinetyPlus, 'rare_test');

      expect(result).toBeNull();
    });

    it('should query benchmarks for correct age group brackets (Requirement 15.5)', async () => {
      const getBenchmarkData = jest.fn().mockResolvedValue(null);
      const dataProvider = createMockDataProvider({ getBenchmarkData });
      const service = new AnalyticsService({ dataProvider });

      await service.getBenchmarks(AgeGroup.SeventyToSeventyNine, 'lipid_profile');

      expect(getBenchmarkData).toHaveBeenCalledWith(
        AgeGroup.SeventyToSeventyNine,
        'lipid_profile'
      );
    });
  });
});
