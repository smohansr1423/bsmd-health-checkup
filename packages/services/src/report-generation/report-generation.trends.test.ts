/**
 * Report Generation - Trend Chart Data Logic Tests
 * Validates: Requirements 7.3, 7.4, 7.8, 7.9
 */

import type { TestResult, HealthReport, CheckupSession } from '@health-checkup/shared';
import { RiskCategory, AgeGroup, SupportedLanguage } from '@health-checkup/shared';
import { InMemoryEventBus } from '@health-checkup/shared';
import { buildTrendData, determinePendingTestTypes, shouldRegenerateReport } from './report-generation.trends';
import { ReportGenerationService } from './report-generation.service';
import type {
  ReportRepository,
  ReportSessionRepository,
  ReportTestResultRepository,
  SeniorLanguageProvider,
  ReportRiskAssessmentProvider,
  PDFGenerator,
  ReportNotificationProvider,
  ReportPackageTestProvider,
  HealthReportSummary,
} from './report-generation.types';

// --- Test Helpers ---

function createTestResult(overrides: Partial<TestResult> = {}): TestResult {
  return {
    id: `TR_${Math.random().toString(36).substring(2, 11)}`,
    checkupSessionId: 'session-current',
    seniorId: 'senior-1',
    testType: 'blood_sugar',
    measuredValue: 100,
    unit: 'mg/dL',
    collectionTimestamp: new Date('2024-01-15T10:00:00Z'),
    technicianId: 'tech-1',
    riskCategory: RiskCategory.Normal,
    ageAdjustedRange: {
      min: 70,
      max: 130,
      borderlineLow: 60,
      borderlineHigh: 140,
      criticalLow: 40,
      criticalHigh: 200,
      ageGroup: AgeGroup.SixtyToSixtyNine,
    },
    amendmentHistory: [],
    createdAt: new Date('2024-01-15T10:00:00Z'),
    ...overrides,
  };
}

function createCompletedSession(overrides: Partial<CheckupSession> = {}): CheckupSession {
  return {
    id: 'session-current',
    appointmentId: 'appt-1',
    seniorId: 'senior-1',
    packageId: 'pkg-1',
    assignedPhysicianId: 'doc-1',
    assignedSpecialists: [],
    status: 'complete',
    startedAt: new Date(Date.now() - 3600000),
    completedAt: new Date(Date.now() - 1800000),
    ...overrides,
  };
}

// --- Unit Tests for buildTrendData ---

describe('buildTrendData', () => {
  describe('Requirement 7.3: Omit trends if <2 previous sessions', () => {
    it('should return empty array when no previous sessions exist', () => {
      const currentResults = [createTestResult({ checkupSessionId: 'session-current' })];
      const result = buildTrendData(currentResults, 'session-current');
      expect(result).toEqual([]);
    });

    it('should return empty array when only 1 previous session exists', () => {
      const allResults = [
        createTestResult({ checkupSessionId: 'session-current' }),
        createTestResult({
          checkupSessionId: 'session-prev-1',
          collectionTimestamp: new Date('2023-12-01T10:00:00Z'),
        }),
      ];
      const result = buildTrendData(allResults, 'session-current');
      expect(result).toEqual([]);
    });

    it('should return trend data when exactly 2 previous sessions exist', () => {
      const allResults = [
        createTestResult({ checkupSessionId: 'session-current' }),
        createTestResult({
          checkupSessionId: 'session-prev-1',
          collectionTimestamp: new Date('2023-11-01T10:00:00Z'),
        }),
        createTestResult({
          checkupSessionId: 'session-prev-2',
          collectionTimestamp: new Date('2023-12-01T10:00:00Z'),
        }),
      ];
      const result = buildTrendData(allResults, 'session-current');
      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe('Requirement 7.4: Include up to 5 most recent sessions', () => {
    it('should include data from up to 5 most recent previous sessions', () => {
      const allResults = [
        createTestResult({ checkupSessionId: 'session-current' }),
        // 6 previous sessions
        createTestResult({ checkupSessionId: 'session-1', collectionTimestamp: new Date('2023-07-01T10:00:00Z') }),
        createTestResult({ checkupSessionId: 'session-2', collectionTimestamp: new Date('2023-08-01T10:00:00Z') }),
        createTestResult({ checkupSessionId: 'session-3', collectionTimestamp: new Date('2023-09-01T10:00:00Z') }),
        createTestResult({ checkupSessionId: 'session-4', collectionTimestamp: new Date('2023-10-01T10:00:00Z') }),
        createTestResult({ checkupSessionId: 'session-5', collectionTimestamp: new Date('2023-11-01T10:00:00Z') }),
        createTestResult({ checkupSessionId: 'session-6', collectionTimestamp: new Date('2023-12-01T10:00:00Z') }),
      ];

      const result = buildTrendData(allResults, 'session-current');

      // Should only have data from 5 most recent sessions (session-2 through session-6)
      const sessionIds = new Set(result.map((r) => {
        // We can't directly get session IDs from TrendDataPoint, but we can check count
        return r.sessionDate.toISOString();
      }));
      // 5 unique dates means 5 sessions included
      expect(sessionIds.size).toBeLessThanOrEqual(5);
      // Should NOT include the oldest session (session-1 from July)
      const hasJulyData = result.some(
        (r) => r.sessionDate.getTime() === new Date('2023-07-01T10:00:00Z').getTime()
      );
      expect(hasJulyData).toBe(false);
    });

    it('should include the 5 most recent sessions, not older ones', () => {
      const allResults: TestResult[] = [];
      // Current session
      allResults.push(createTestResult({ checkupSessionId: 'session-current' }));
      // 7 previous sessions with distinct dates
      for (let i = 1; i <= 7; i++) {
        allResults.push(
          createTestResult({
            checkupSessionId: `session-prev-${i}`,
            collectionTimestamp: new Date(`2023-${String(i).padStart(2, '0')}-15T10:00:00Z`),
          })
        );
      }

      const result = buildTrendData(allResults, 'session-current');

      // Should have exactly 5 data points (one per session from the 5 most recent)
      expect(result).toHaveLength(5);

      // Verify the oldest included is session-prev-3 (March) not session-prev-1 (Jan) or session-prev-2 (Feb)
      const dates = result.map((r) => r.sessionDate.getTime());
      const janDate = new Date('2023-01-15T10:00:00Z').getTime();
      const febDate = new Date('2023-02-15T10:00:00Z').getTime();
      expect(dates).not.toContain(janDate);
      expect(dates).not.toContain(febDate);
    });

    it('should include all sessions when fewer than 5 previous sessions exist (but ≥2)', () => {
      const allResults = [
        createTestResult({ checkupSessionId: 'session-current' }),
        createTestResult({ checkupSessionId: 'session-prev-1', collectionTimestamp: new Date('2023-11-01T10:00:00Z') }),
        createTestResult({ checkupSessionId: 'session-prev-2', collectionTimestamp: new Date('2023-12-01T10:00:00Z') }),
        createTestResult({ checkupSessionId: 'session-prev-3', collectionTimestamp: new Date('2024-01-01T10:00:00Z') }),
      ];

      const result = buildTrendData(allResults, 'session-current');
      expect(result).toHaveLength(3);
    });
  });

  describe('TrendDataPoint structure', () => {
    it('should produce TrendDataPoints with correct fields', () => {
      const allResults = [
        createTestResult({ checkupSessionId: 'session-current' }),
        createTestResult({
          checkupSessionId: 'session-prev-1',
          testType: 'blood_sugar',
          measuredValue: 110,
          riskCategory: RiskCategory.Normal,
          collectionTimestamp: new Date('2023-11-01T10:00:00Z'),
        }),
        createTestResult({
          checkupSessionId: 'session-prev-2',
          testType: 'blood_sugar',
          measuredValue: 145,
          riskCategory: RiskCategory.Borderline,
          collectionTimestamp: new Date('2023-12-01T10:00:00Z'),
        }),
      ];

      const result = buildTrendData(allResults, 'session-current');

      expect(result).toHaveLength(2);
      // Check first data point (oldest - session-prev-1)
      expect(result[0]).toMatchObject({
        testType: 'blood_sugar',
        value: 110,
        category: RiskCategory.Normal,
      });
      expect(result[0].sessionDate).toEqual(new Date('2023-11-01T10:00:00Z'));

      // Check second data point (more recent - session-prev-2)
      expect(result[1]).toMatchObject({
        testType: 'blood_sugar',
        value: 145,
        category: RiskCategory.Borderline,
      });
      expect(result[1].sessionDate).toEqual(new Date('2023-12-01T10:00:00Z'));
    });

    it('should sort trend data by session date ascending (oldest first)', () => {
      const allResults = [
        createTestResult({ checkupSessionId: 'session-current' }),
        createTestResult({
          checkupSessionId: 'session-prev-1',
          collectionTimestamp: new Date('2023-12-01T10:00:00Z'),
        }),
        createTestResult({
          checkupSessionId: 'session-prev-2',
          collectionTimestamp: new Date('2023-11-01T10:00:00Z'),
        }),
      ];

      const result = buildTrendData(allResults, 'session-current');

      // Should be sorted oldest first
      expect(result[0].sessionDate.getTime()).toBeLessThan(result[1].sessionDate.getTime());
    });

    it('should use Uncategorized when riskCategory is not set', () => {
      const allResults = [
        createTestResult({ checkupSessionId: 'session-current' }),
        createTestResult({
          checkupSessionId: 'session-prev-1',
          riskCategory: undefined,
          collectionTimestamp: new Date('2023-11-01T10:00:00Z'),
        }),
        createTestResult({
          checkupSessionId: 'session-prev-2',
          collectionTimestamp: new Date('2023-12-01T10:00:00Z'),
        }),
      ];

      const result = buildTrendData(allResults, 'session-current');
      const uncategorizedPoints = result.filter((r) => r.category === RiskCategory.Uncategorized);
      expect(uncategorizedPoints).toHaveLength(1);
    });
  });

  describe('current session exclusion', () => {
    it('should not include the current session in trend data', () => {
      const allResults = [
        createTestResult({ checkupSessionId: 'session-current', measuredValue: 999 }),
        createTestResult({
          checkupSessionId: 'session-prev-1',
          collectionTimestamp: new Date('2023-11-01T10:00:00Z'),
        }),
        createTestResult({
          checkupSessionId: 'session-prev-2',
          collectionTimestamp: new Date('2023-12-01T10:00:00Z'),
        }),
      ];

      const result = buildTrendData(allResults, 'session-current');
      const currentSessionData = result.filter((r) => r.value === 999);
      expect(currentSessionData).toHaveLength(0);
    });
  });
});

// --- Unit Tests for determinePendingTestTypes ---

describe('determinePendingTestTypes', () => {
  it('should return empty array when all expected tests are recorded', () => {
    const expectedTests = ['blood_sugar', 'lipid_profile'];
    const results = [
      createTestResult({ testType: 'blood_sugar' }),
      createTestResult({ testType: 'lipid_profile' }),
    ];

    const pending = determinePendingTestTypes(expectedTests, results);
    expect(pending).toEqual([]);
  });

  it('should return pending test types when some are missing', () => {
    const expectedTests = ['blood_sugar', 'lipid_profile', 'ecg'];
    const results = [createTestResult({ testType: 'blood_sugar' })];

    const pending = determinePendingTestTypes(expectedTests, results);
    expect(pending).toEqual(['lipid_profile', 'ecg']);
  });

  it('should return all expected types when no results are recorded', () => {
    const expectedTests = ['blood_sugar', 'lipid_profile'];
    const results: TestResult[] = [];

    const pending = determinePendingTestTypes(expectedTests, results);
    expect(pending).toEqual(['blood_sugar', 'lipid_profile']);
  });

  it('should return empty array when expected tests list is empty', () => {
    const results = [createTestResult({ testType: 'blood_sugar' })];

    const pending = determinePendingTestTypes([], results);
    expect(pending).toEqual([]);
  });
});

// --- Unit Tests for shouldRegenerateReport ---

describe('shouldRegenerateReport', () => {
  it('should return false when no pending tests exist', () => {
    const results = [createTestResult({ testType: 'blood_sugar' })];
    expect(shouldRegenerateReport([], results)).toBe(false);
  });

  it('should return true when a previously pending test now has a result', () => {
    const previousPendingTests = ['lipid_profile', 'ecg'];
    const currentResults = [
      createTestResult({ testType: 'blood_sugar' }),
      createTestResult({ testType: 'lipid_profile' }),
    ];

    expect(shouldRegenerateReport(previousPendingTests, currentResults)).toBe(true);
  });

  it('should return false when no pending tests have been resolved', () => {
    const previousPendingTests = ['lipid_profile', 'ecg'];
    const currentResults = [createTestResult({ testType: 'blood_sugar' })];

    expect(shouldRegenerateReport(previousPendingTests, currentResults)).toBe(false);
  });

  it('should return true when all pending tests are resolved', () => {
    const previousPendingTests = ['lipid_profile'];
    const currentResults = [
      createTestResult({ testType: 'blood_sugar' }),
      createTestResult({ testType: 'lipid_profile' }),
    ];

    expect(shouldRegenerateReport(previousPendingTests, currentResults)).toBe(true);
  });
});

// --- Integration Tests for service with trends and notifications ---

describe('ReportGenerationService - Trend Charts and Notifications', () => {
  // In-memory repositories (same pattern as main test file)
  class InMemoryReportRepository implements ReportRepository {
    private reports: Map<string, HealthReport> = new Map();

    async save(report: HealthReport): Promise<HealthReport> {
      this.reports.set(report.id, { ...report });
      return { ...report };
    }
    async findById(id: string): Promise<HealthReport | null> {
      const r = this.reports.get(id);
      return r ? { ...r } : null;
    }
    async findBySessionId(sessionId: string): Promise<HealthReport | null> {
      for (const r of this.reports.values()) {
        if (r.checkupSessionId === sessionId) return { ...r };
      }
      return null;
    }
    async findBySeniorId(seniorId: string): Promise<HealthReport[]> {
      return Array.from(this.reports.values())
        .filter((r) => r.seniorId === seniorId)
        .map((r) => ({ ...r }));
    }
    async update(report: HealthReport): Promise<HealthReport> {
      this.reports.set(report.id, { ...report });
      return { ...report };
    }
  }

  class InMemorySessionRepository implements ReportSessionRepository {
    private sessions: Map<string, CheckupSession> = new Map();
    addSession(session: CheckupSession): void {
      this.sessions.set(session.id, session);
    }
    async findById(id: string): Promise<CheckupSession | null> {
      return this.sessions.get(id) ?? null;
    }
  }

  class InMemoryTestResultRepository implements ReportTestResultRepository {
    private results: TestResult[] = [];
    addResults(results: TestResult[]): void {
      this.results.push(...results);
    }
    async findBySessionId(sessionId: string): Promise<TestResult[]> {
      return this.results.filter((r) => r.checkupSessionId === sessionId);
    }
    async findBySeniorId(seniorId: string): Promise<TestResult[]> {
      return this.results.filter((r) => r.seniorId === seniorId);
    }
  }

  class MockLanguageProvider implements SeniorLanguageProvider {
    async getPreferredLanguage(): Promise<SupportedLanguage | null> {
      return SupportedLanguage.English;
    }
  }

  class MockRiskAssessmentProvider implements ReportRiskAssessmentProvider {
    async categorizeResults(results: TestResult[]): Promise<any[]> {
      return results.map((r) => ({
        testResult: r,
        category: r.riskCategory ?? RiskCategory.Normal,
        interpretation: `${r.testType} is ${r.riskCategory ?? RiskCategory.Normal}`,
      }));
    }
    async computeHealthScore(results: TestResult[]): Promise<any> {
      return { score: 85, breakdown: [], normalCount: results.length, borderlineCount: 0, criticalCount: 0 };
    }
  }

  class MockPDFGenerator implements PDFGenerator {
    async generatePDF(): Promise<Buffer> {
      return Buffer.from('pdf');
    }
  }

  class MockNotificationProvider implements ReportNotificationProvider {
    public notifications: Array<{ seniorId: string; reportId: string; isRegeneration: boolean }> = [];
    async notifyReportAvailable(seniorId: string, reportId: string, isRegeneration: boolean): Promise<void> {
      this.notifications.push({ seniorId, reportId, isRegeneration });
    }
  }

  class MockPackageTestProvider implements ReportPackageTestProvider {
    private packages: Map<string, string[]> = new Map();
    setPackageTests(packageId: string, tests: string[]): void {
      this.packages.set(packageId, tests);
    }
    async getExpectedTestTypes(packageId: string): Promise<string[]> {
      return this.packages.get(packageId) ?? [];
    }
  }

  let service: ReportGenerationService;
  let reportRepo: InMemoryReportRepository;
  let sessionRepo: InMemorySessionRepository;
  let testResultRepo: InMemoryTestResultRepository;
  let notificationProvider: MockNotificationProvider;
  let packageTestProvider: MockPackageTestProvider;
  let eventBus: InMemoryEventBus;
  let idCounter: number;

  beforeEach(() => {
    reportRepo = new InMemoryReportRepository();
    sessionRepo = new InMemorySessionRepository();
    testResultRepo = new InMemoryTestResultRepository();
    notificationProvider = new MockNotificationProvider();
    packageTestProvider = new MockPackageTestProvider();
    eventBus = new InMemoryEventBus();
    idCounter = 0;

    service = new ReportGenerationService({
      reportRepository: reportRepo,
      sessionRepository: sessionRepo,
      testResultRepository: testResultRepo,
      seniorLanguageProvider: new MockLanguageProvider(),
      riskAssessmentProvider: new MockRiskAssessmentProvider(),
      pdfGenerator: new MockPDFGenerator(),
      notificationProvider,
      packageTestProvider,
      eventBus,
      idGenerator: () => `RPT_${++idCounter}`,
      dateProvider: () => new Date('2024-01-15T10:00:00Z'),
    });
  });

  describe('Trend data inclusion in reports (Requirements 7.3, 7.4)', () => {
    it('should omit trendData when <2 previous sessions exist', async () => {
      const session = createCompletedSession();
      sessionRepo.addSession(session);
      testResultRepo.addResults([createTestResult({ checkupSessionId: 'session-current' })]);

      const report = await service.generateReport('session-current');
      expect(report.trendData).toBeUndefined();
    });

    it('should omit trendData when exactly 1 previous session exists', async () => {
      const session = createCompletedSession();
      sessionRepo.addSession(session);
      testResultRepo.addResults([
        createTestResult({ checkupSessionId: 'session-current' }),
        createTestResult({
          checkupSessionId: 'session-prev-1',
          collectionTimestamp: new Date('2023-12-01T10:00:00Z'),
        }),
      ]);

      const report = await service.generateReport('session-current');
      expect(report.trendData).toBeUndefined();
    });

    it('should include trendData when ≥2 previous sessions exist', async () => {
      const session = createCompletedSession();
      sessionRepo.addSession(session);
      testResultRepo.addResults([
        createTestResult({ checkupSessionId: 'session-current' }),
        createTestResult({
          checkupSessionId: 'session-prev-1',
          collectionTimestamp: new Date('2023-11-01T10:00:00Z'),
        }),
        createTestResult({
          checkupSessionId: 'session-prev-2',
          collectionTimestamp: new Date('2023-12-01T10:00:00Z'),
        }),
      ]);

      const report = await service.generateReport('session-current');
      expect(report.trendData).toBeDefined();
      expect(report.trendData!.length).toBe(2);
    });

    it('should limit trend data to 5 most recent sessions', async () => {
      const session = createCompletedSession();
      sessionRepo.addSession(session);

      const results: TestResult[] = [createTestResult({ checkupSessionId: 'session-current' })];
      for (let i = 1; i <= 7; i++) {
        results.push(
          createTestResult({
            checkupSessionId: `session-prev-${i}`,
            collectionTimestamp: new Date(`2023-${String(i).padStart(2, '0')}-15T10:00:00Z`),
          })
        );
      }
      testResultRepo.addResults(results);

      const report = await service.generateReport('session-current');
      expect(report.trendData).toBeDefined();
      // Only 5 most recent out of 7 sessions
      expect(report.trendData!.length).toBe(5);
    });
  });

  describe('Partial report handling (Requirement 7.8)', () => {
    it('should generate report with available results when session is pending_results', async () => {
      const session = createCompletedSession({
        status: 'pending_results',
        completedAt: new Date('2024-01-15T09:00:00Z'),
      });
      sessionRepo.addSession(session);
      packageTestProvider.setPackageTests('pkg-1', ['blood_sugar', 'lipid_profile', 'ecg']);
      testResultRepo.addResults([createTestResult({ checkupSessionId: 'session-current', testType: 'blood_sugar' })]);

      const report = await service.generateReport('session-current');
      expect(report).toBeDefined();
      expect(report.testResults).toHaveLength(1);
    });

    it('should indicate pending tests when session is pending_results', async () => {
      const session = createCompletedSession({
        status: 'pending_results',
        completedAt: new Date('2024-01-15T09:00:00Z'),
      });
      sessionRepo.addSession(session);
      packageTestProvider.setPackageTests('pkg-1', ['blood_sugar', 'lipid_profile', 'ecg']);
      testResultRepo.addResults([createTestResult({ checkupSessionId: 'session-current', testType: 'blood_sugar' })]);

      const report = await service.generateReport('session-current');
      expect(report.pendingTests).toContain('lipid_profile');
      expect(report.pendingTests).toContain('ecg');
      expect(report.pendingTests).not.toContain('blood_sugar');
    });

    it('should have empty pendingTests when session is complete', async () => {
      const session = createCompletedSession({ status: 'complete' });
      sessionRepo.addSession(session);
      packageTestProvider.setPackageTests('pkg-1', ['blood_sugar', 'lipid_profile']);
      testResultRepo.addResults([
        createTestResult({ checkupSessionId: 'session-current', testType: 'blood_sugar' }),
        createTestResult({ checkupSessionId: 'session-current', testType: 'lipid_profile' }),
      ]);

      const report = await service.generateReport('session-current');
      expect(report.pendingTests).toEqual([]);
    });

    it('should regenerate report when TestResultRecorded event arrives for pending results', async () => {
      // Generate initial report with pending results
      const session = createCompletedSession({
        status: 'pending_results',
        completedAt: new Date('2024-01-15T09:00:00Z'),
      });
      sessionRepo.addSession(session);
      packageTestProvider.setPackageTests('pkg-1', ['blood_sugar', 'lipid_profile']);
      testResultRepo.addResults([createTestResult({ checkupSessionId: 'session-current', testType: 'blood_sugar' })]);

      const initialReport = await service.generateReport('session-current');
      expect(initialReport.pendingTests).toContain('lipid_profile');

      // Simulate new test result arriving
      testResultRepo.addResults([
        createTestResult({ checkupSessionId: 'session-current', testType: 'lipid_profile', measuredValue: 180 }),
      ]);

      // Publish event
      await eventBus.publish({
        id: 'evt-1',
        type: 'TestResultRecorded',
        occurredAt: new Date().toISOString(),
        sourceId: 'tr-new',
        payload: {
          testResultId: 'tr-new',
          checkupSessionId: 'session-current',
          seniorId: 'senior-1',
          testType: 'lipid_profile',
          measuredValue: 180,
          unit: 'mg/dL',
          technicianId: 'tech-1',
          collectionTimestamp: new Date().toISOString(),
        },
      });

      // Give the async handler time to run
      await new Promise((resolve) => setTimeout(resolve, 50));

      // The report should have been regenerated with the new result
      const updatedReport = await reportRepo.findById(initialReport.id);
      expect(updatedReport).toBeDefined();
      expect(updatedReport!.regeneratedAt).toBeDefined();
      expect(updatedReport!.testResults).toHaveLength(2);
    });
  });

  describe('Report availability notification (Requirement 7.9)', () => {
    it('should send notification to senior citizen when report is generated', async () => {
      const session = createCompletedSession();
      sessionRepo.addSession(session);
      testResultRepo.addResults([createTestResult({ checkupSessionId: 'session-current' })]);

      await service.generateReport('session-current');

      expect(notificationProvider.notifications).toHaveLength(1);
      expect(notificationProvider.notifications[0].seniorId).toBe('senior-1');
      expect(notificationProvider.notifications[0].isRegeneration).toBe(false);
    });

    it('should send notification when report is regenerated', async () => {
      const session = createCompletedSession();
      sessionRepo.addSession(session);
      testResultRepo.addResults([createTestResult({ checkupSessionId: 'session-current' })]);

      const report = await service.generateReport('session-current');

      // Add more results and regenerate
      testResultRepo.addResults([
        createTestResult({ checkupSessionId: 'session-current', testType: 'lipid_profile' }),
      ]);
      await service.regenerateReport(report.id);

      // Should have 2 notifications: one for generation, one for regeneration
      expect(notificationProvider.notifications).toHaveLength(2);
      expect(notificationProvider.notifications[1].isRegeneration).toBe(true);
    });

    it('should include correct reportId in notification', async () => {
      const session = createCompletedSession();
      sessionRepo.addSession(session);
      testResultRepo.addResults([createTestResult({ checkupSessionId: 'session-current' })]);

      const report = await service.generateReport('session-current');

      expect(notificationProvider.notifications[0].reportId).toBe(report.id);
    });

    it('should not fail report generation if notification fails', async () => {
      // Create a provider that throws
      const failingProvider: ReportNotificationProvider = {
        async notifyReportAvailable() {
          throw new Error('Notification service unavailable');
        },
      };

      const failingService = new ReportGenerationService({
        reportRepository: reportRepo,
        sessionRepository: sessionRepo,
        testResultRepository: testResultRepo,
        seniorLanguageProvider: new MockLanguageProvider(),
        riskAssessmentProvider: new MockRiskAssessmentProvider(),
        pdfGenerator: new MockPDFGenerator(),
        notificationProvider: failingProvider,
        eventBus,
        idGenerator: () => `RPT_${++idCounter}`,
        dateProvider: () => new Date('2024-01-15T10:00:00Z'),
      });

      const session = createCompletedSession();
      sessionRepo.addSession(session);
      testResultRepo.addResults([createTestResult({ checkupSessionId: 'session-current' })]);

      // Should not throw even if notification fails
      const report = await failingService.generateReport('session-current');
      expect(report).toBeDefined();
    });
  });
});
