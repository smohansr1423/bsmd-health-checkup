/**
 * Report Generation Service Tests
 * Validates: Requirements 7.1, 7.2, 7.5, 7.6, 7.7, 7.8
 */

import type {
  HealthReport,
  CheckupSession,
  TestResult,
  HealthScore,
  CategorizedTestResult,
  CriticalFinding,
  ReferenceRange,
} from '@health-checkup/shared';
import { SupportedLanguage, RiskCategory, AgeGroup } from '@health-checkup/shared';
import { InMemoryEventBus } from '@health-checkup/shared';
import { ReportGenerationService } from './report-generation.service';
import type {
  ReportRepository,
  ReportSessionRepository,
  ReportTestResultRepository,
  SeniorLanguageProvider,
  ReportRiskAssessmentProvider,
  PDFGenerator,
} from './report-generation.types';
import {
  SessionNotFoundError,
  SessionNotCompleteError,
  ReportNotFoundError,
  ReportGenerationDeadlineError,
  NoTestResultsError,
} from './report-generation.errors';

// --- In-Memory Repositories ---

class InMemoryReportRepository implements ReportRepository {
  private reports: Map<string, HealthReport> = new Map();

  async save(report: HealthReport): Promise<HealthReport> {
    this.reports.set(report.id, { ...report });
    return { ...report };
  }

  async findById(id: string): Promise<HealthReport | null> {
    const report = this.reports.get(id);
    return report ? { ...report } : null;
  }

  async findBySessionId(sessionId: string): Promise<HealthReport | null> {
    for (const report of this.reports.values()) {
      if (report.checkupSessionId === sessionId) return { ...report };
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

// --- Mock Providers ---

class MockSeniorLanguageProvider implements SeniorLanguageProvider {
  private languages: Map<string, SupportedLanguage> = new Map();

  setLanguage(seniorId: string, language: SupportedLanguage): void {
    this.languages.set(seniorId, language);
  }

  async getPreferredLanguage(seniorId: string): Promise<SupportedLanguage | null> {
    return this.languages.get(seniorId) ?? null;
  }
}

class MockRiskAssessmentProvider implements ReportRiskAssessmentProvider {
  async categorizeResults(results: TestResult[], seniorId: string): Promise<CategorizedTestResult[]> {
    return results.map((r) => {
      let category = RiskCategory.Normal;
      if (r.riskCategory) {
        category = r.riskCategory;
      }
      return {
        testResult: r,
        category,
        interpretation: `${r.testType} result is ${category}`,
      };
    });
  }

  async computeHealthScore(results: TestResult[], seniorId: string): Promise<HealthScore> {
    const categorized = results.map((r) => r.riskCategory ?? RiskCategory.Normal);
    const normalCount = categorized.filter((c) => c === RiskCategory.Normal).length;
    const borderlineCount = categorized.filter((c) => c === RiskCategory.Borderline).length;
    const criticalCount = categorized.filter((c) => c === RiskCategory.Critical).length;

    let score = 100;
    if (results.length > 0) {
      score -= borderlineCount * ((100 / results.length) * 0.3);
      score -= criticalCount * ((100 / results.length) * 0.7);
    }
    score = Math.round(Math.max(0, Math.min(100, score)));

    return {
      score,
      breakdown: results.map((r) => ({
        testType: r.testType,
        category: r.riskCategory ?? RiskCategory.Normal,
        weightedScore: 0,
      })),
      normalCount,
      borderlineCount,
      criticalCount,
    };
  }
}

class MockPDFGenerator implements PDFGenerator {
  async generatePDF(report: HealthReport, format: 'clinical' | 'simplified'): Promise<Buffer> {
    const content = format === 'clinical' ? report.versions.clinical : report.versions.simplified;
    return Buffer.from(JSON.stringify(content), 'utf-8');
  }
}

// --- Test Helpers ---

function createTestResult(overrides: Partial<TestResult> = {}): TestResult {
  return {
    id: `TR_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
    checkupSessionId: 'session-1',
    seniorId: 'senior-1',
    testType: 'blood_sugar',
    measuredValue: 100,
    unit: 'mg/dL',
    collectionTimestamp: new Date(),
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
    createdAt: new Date(),
    ...overrides,
  };
}

function createCompletedSession(overrides: Partial<CheckupSession> = {}): CheckupSession {
  return {
    id: 'session-1',
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

// --- Tests ---

describe('ReportGenerationService', () => {
  let service: ReportGenerationService;
  let reportRepo: InMemoryReportRepository;
  let sessionRepo: InMemorySessionRepository;
  let testResultRepo: InMemoryTestResultRepository;
  let languageProvider: MockSeniorLanguageProvider;
  let riskProvider: MockRiskAssessmentProvider;
  let pdfGenerator: MockPDFGenerator;
  let eventBus: InMemoryEventBus;
  let idCounter: number;

  beforeEach(() => {
    reportRepo = new InMemoryReportRepository();
    sessionRepo = new InMemorySessionRepository();
    testResultRepo = new InMemoryTestResultRepository();
    languageProvider = new MockSeniorLanguageProvider();
    riskProvider = new MockRiskAssessmentProvider();
    pdfGenerator = new MockPDFGenerator();
    eventBus = new InMemoryEventBus();
    idCounter = 0;

    service = new ReportGenerationService({
      reportRepository: reportRepo,
      sessionRepository: sessionRepo,
      testResultRepository: testResultRepo,
      seniorLanguageProvider: languageProvider,
      riskAssessmentProvider: riskProvider,
      pdfGenerator,
      eventBus,
      idGenerator: () => `RPT_${++idCounter}`,
      dateProvider: () => new Date('2024-01-15T10:00:00Z'),
    });
  });

  describe('generateReport', () => {
    it('should generate a report for a completed session', async () => {
      const session = createCompletedSession();
      sessionRepo.addSession(session);
      testResultRepo.addResults([
        createTestResult({ checkupSessionId: 'session-1' }),
        createTestResult({ checkupSessionId: 'session-1', testType: 'lipid_profile', measuredValue: 180 }),
      ]);

      const report = await service.generateReport('session-1');

      expect(report.id).toBe('RPT_1');
      expect(report.checkupSessionId).toBe('session-1');
      expect(report.seniorId).toBe('senior-1');
      expect(report.testResults).toHaveLength(2);
      expect(report.generatedAt).toEqual(new Date('2024-01-15T10:00:00Z'));
      expect(report.versions.clinical).toBeDefined();
      expect(report.versions.simplified).toBeDefined();
    });

    it('should throw SessionNotFoundError when session does not exist', async () => {
      await expect(service.generateReport('non-existent')).rejects.toThrow(SessionNotFoundError);
    });

    it('should throw SessionNotCompleteError when session is in_progress', async () => {
      const session = createCompletedSession({ status: 'in_progress' });
      sessionRepo.addSession(session);

      await expect(service.generateReport('session-1')).rejects.toThrow(SessionNotCompleteError);
    });

    it('should allow report generation when session is pending_results', async () => {
      const session = createCompletedSession({
        status: 'pending_results',
        completedAt: new Date('2024-01-15T09:00:00Z'),
      });
      sessionRepo.addSession(session);
      testResultRepo.addResults([createTestResult()]);

      const report = await service.generateReport('session-1');
      expect(report).toBeDefined();
      expect(report.checkupSessionId).toBe('session-1');
    });

    it('should throw ReportGenerationDeadlineError when >24 hours since completion', async () => {
      const session = createCompletedSession({
        completedAt: new Date('2024-01-13T09:00:00Z'), // more than 24h before dateProvider
      });
      sessionRepo.addSession(session);
      testResultRepo.addResults([createTestResult()]);

      await expect(service.generateReport('session-1')).rejects.toThrow(
        ReportGenerationDeadlineError
      );
    });

    it('should throw NoTestResultsError when no results exist', async () => {
      const session = createCompletedSession();
      sessionRepo.addSession(session);

      await expect(service.generateReport('session-1')).rejects.toThrow(NoTestResultsError);
    });

    it('should generate report in senior preferred language (Requirement 7.7)', async () => {
      const session = createCompletedSession();
      sessionRepo.addSession(session);
      testResultRepo.addResults([createTestResult()]);
      languageProvider.setLanguage('senior-1', SupportedLanguage.Hindi);

      const report = await service.generateReport('session-1');
      expect(report.language).toBe(SupportedLanguage.Hindi);
    });

    it('should default to English when no language preference set (Requirement 7.7)', async () => {
      const session = createCompletedSession();
      sessionRepo.addSession(session);
      testResultRepo.addResults([createTestResult()]);

      const report = await service.generateReport('session-1');
      expect(report.language).toBe(SupportedLanguage.English);
    });

    it('should place critical findings at top of clinical version (Requirement 7.6)', async () => {
      const session = createCompletedSession();
      sessionRepo.addSession(session);
      testResultRepo.addResults([
        createTestResult({ riskCategory: RiskCategory.Critical, measuredValue: 300 }),
        createTestResult({ testType: 'lipid_profile', riskCategory: RiskCategory.Normal }),
      ]);

      const report = await service.generateReport('session-1');

      // Clinical version should have Critical Findings as the FIRST section
      expect(report.versions.clinical.sections[0].heading).toBe('Critical Findings');
    });

    it('should place critical findings at top of simplified version (Requirement 7.6)', async () => {
      const session = createCompletedSession();
      sessionRepo.addSession(session);
      testResultRepo.addResults([
        createTestResult({ riskCategory: RiskCategory.Critical, measuredValue: 300 }),
        createTestResult({ testType: 'lipid_profile', riskCategory: RiskCategory.Normal }),
      ]);

      const report = await service.generateReport('session-1');

      // Simplified version should have critical findings section first
      expect(report.versions.simplified.sections[0].heading).toBe(
        'Important Findings That Need Attention'
      );
    });

    it('should not include critical findings section when none exist', async () => {
      const session = createCompletedSession();
      sessionRepo.addSession(session);
      testResultRepo.addResults([
        createTestResult({ riskCategory: RiskCategory.Normal }),
      ]);

      const report = await service.generateReport('session-1');

      expect(report.criticalFindings).toHaveLength(0);
      expect(report.versions.clinical.sections[0].heading).not.toBe('Critical Findings');
    });

    it('should produce clinical version with all values, reference ranges, and diagnostic notes (Requirement 7.2)', async () => {
      const session = createCompletedSession();
      sessionRepo.addSession(session);
      testResultRepo.addResults([createTestResult()]);

      const report = await service.generateReport('session-1');
      const clinical = report.versions.clinical;

      expect(clinical.title).toBe('Clinical Health Report');
      // Should contain a detailed test results section
      const detailedSection = clinical.sections.find((s) => s.heading === 'Detailed Test Results');
      expect(detailedSection).toBeDefined();
      expect(detailedSection!.content).toContain('Reference:');
      expect(detailedSection!.content).toContain('Category:');
    });

    it('should produce simplified version with health score, risk categories, and plain language (Requirement 7.2)', async () => {
      const session = createCompletedSession();
      sessionRepo.addSession(session);
      testResultRepo.addResults([createTestResult()]);

      const report = await service.generateReport('session-1');
      const simplified = report.versions.simplified;

      expect(simplified.title).toBe('Your Health Summary');
      const scoreSection = simplified.sections.find((s) => s.heading === 'Your Health Score');
      expect(scoreSection).toBeDefined();
      expect(scoreSection!.content).toContain('out of 100');

      const summarySection = simplified.sections.find((s) => s.heading === 'Results Summary');
      expect(summarySection).toBeDefined();
      expect(summarySection!.content).toContain('Normal:');
    });

    it('should publish ReportGenerated event after generation', async () => {
      const session = createCompletedSession();
      sessionRepo.addSession(session);
      testResultRepo.addResults([createTestResult()]);

      let publishedEvent: any = null;
      eventBus.subscribe('ReportGenerated', (event) => {
        publishedEvent = event;
      });

      await service.generateReport('session-1');

      expect(publishedEvent).not.toBeNull();
      expect(publishedEvent.payload.checkupSessionId).toBe('session-1');
      expect(publishedEvent.payload.seniorId).toBe('senior-1');
      expect(publishedEvent.payload.isRegeneration).toBe(false);
    });
  });

  describe('regenerateReport', () => {
    it('should regenerate an existing report with updated data', async () => {
      // First, generate a report
      const session = createCompletedSession();
      sessionRepo.addSession(session);
      testResultRepo.addResults([createTestResult()]);
      const originalReport = await service.generateReport('session-1');

      // Add more test results
      testResultRepo.addResults([
        createTestResult({ testType: 'lipid_profile', measuredValue: 190 }),
      ]);

      const regenerated = await service.regenerateReport(originalReport.id);

      expect(regenerated.id).toBe(originalReport.id);
      expect(regenerated.regeneratedAt).toEqual(new Date('2024-01-15T10:00:00Z'));
      expect(regenerated.testResults).toHaveLength(2);
    });

    it('should throw ReportNotFoundError when report does not exist', async () => {
      await expect(service.regenerateReport('non-existent')).rejects.toThrow(ReportNotFoundError);
    });

    it('should publish ReportGenerated event with isRegeneration=true', async () => {
      const session = createCompletedSession();
      sessionRepo.addSession(session);
      testResultRepo.addResults([createTestResult()]);
      const report = await service.generateReport('session-1');

      let regenerationEvent: any = null;
      eventBus.subscribe('ReportGenerated', (event) => {
        regenerationEvent = event;
      });

      await service.regenerateReport(report.id);

      expect(regenerationEvent).not.toBeNull();
      expect(regenerationEvent.payload.isRegeneration).toBe(true);
    });
  });

  describe('getReport', () => {
    it('should return the report for a valid ID', async () => {
      const session = createCompletedSession();
      sessionRepo.addSession(session);
      testResultRepo.addResults([createTestResult()]);
      const generated = await service.generateReport('session-1');

      const report = await service.getReport(generated.id, 'clinical');
      expect(report.id).toBe(generated.id);
    });

    it('should throw ReportNotFoundError when report does not exist', async () => {
      await expect(service.getReport('non-existent', 'clinical')).rejects.toThrow(
        ReportNotFoundError
      );
    });
  });

  describe('downloadReportPDF', () => {
    it('should return a PDF buffer for clinical format (Requirement 7.5)', async () => {
      const session = createCompletedSession();
      sessionRepo.addSession(session);
      testResultRepo.addResults([createTestResult()]);
      const report = await service.generateReport('session-1');

      const pdf = await service.downloadReportPDF(report.id, 'clinical');
      expect(Buffer.isBuffer(pdf)).toBe(true);
      expect(pdf.length).toBeGreaterThan(0);
    });

    it('should return a PDF buffer for simplified format', async () => {
      const session = createCompletedSession();
      sessionRepo.addSession(session);
      testResultRepo.addResults([createTestResult()]);
      const report = await service.generateReport('session-1');

      const pdf = await service.downloadReportPDF(report.id, 'simplified');
      expect(Buffer.isBuffer(pdf)).toBe(true);
    });

    it('should throw ReportNotFoundError when report does not exist', async () => {
      await expect(service.downloadReportPDF('non-existent', 'clinical')).rejects.toThrow(
        ReportNotFoundError
      );
    });
  });

  describe('getReportHistory', () => {
    it('should return summaries for a senior citizen', async () => {
      const session = createCompletedSession();
      sessionRepo.addSession(session);
      testResultRepo.addResults([createTestResult()]);
      await service.generateReport('session-1');

      const history = await service.getReportHistory('senior-1');
      expect(history).toHaveLength(1);
      expect(history[0].seniorId).toBe('senior-1');
      expect(history[0].healthScore).toBeDefined();
      expect(typeof history[0].criticalFindingsCount).toBe('number');
    });

    it('should return empty array when no reports exist', async () => {
      const history = await service.getReportHistory('senior-unknown');
      expect(history).toHaveLength(0);
    });
  });

  describe('event-driven report generation', () => {
    it('should auto-generate report when CheckupSessionCompleted event is received (Requirement 7.1)', async () => {
      const session = createCompletedSession();
      sessionRepo.addSession(session);
      testResultRepo.addResults([createTestResult()]);

      // Publish the event
      await eventBus.publish({
        id: 'evt-1',
        type: 'CheckupSessionCompleted',
        occurredAt: new Date().toISOString(),
        sourceId: 'session-1',
        payload: {
          checkupSessionId: 'session-1',
          seniorId: 'senior-1',
          packageId: 'pkg-1',
          assignedPhysicianId: 'doc-1',
          completedAt: new Date().toISOString(),
        },
      });

      // Give the async handler time to run
      await new Promise((resolve) => setTimeout(resolve, 10));

      const history = await service.getReportHistory('senior-1');
      expect(history).toHaveLength(1);
    });
  });

  describe('critical findings extraction', () => {
    it('should correctly extract critical findings with urgency levels', async () => {
      const session = createCompletedSession();
      sessionRepo.addSession(session);

      const criticalResult = createTestResult({
        testType: 'blood_sugar',
        measuredValue: 250,
        riskCategory: RiskCategory.Critical,
        ageAdjustedRange: {
          min: 70,
          max: 130,
          borderlineLow: 60,
          borderlineHigh: 140,
          criticalLow: 40,
          criticalHigh: 200,
          ageGroup: AgeGroup.SixtyToSixtyNine,
        },
      });
      testResultRepo.addResults([criticalResult]);

      const report = await service.generateReport('session-1');

      expect(report.criticalFindings).toHaveLength(1);
      expect(report.criticalFindings[0].testType).toBe('blood_sugar');
      expect(report.criticalFindings[0].measuredValue).toBe(250);
      expect(report.criticalFindings[0].urgency).toBe('immediate');
    });

    it('should mark findings as urgent when not extremely out of range', async () => {
      const session = createCompletedSession();
      sessionRepo.addSession(session);

      const criticalResult = createTestResult({
        testType: 'blood_sugar',
        measuredValue: 210,
        riskCategory: RiskCategory.Critical,
        ageAdjustedRange: {
          min: 70,
          max: 130,
          borderlineLow: 60,
          borderlineHigh: 140,
          criticalLow: 40,
          criticalHigh: 200,
          ageGroup: AgeGroup.SixtyToSixtyNine,
        },
      });
      testResultRepo.addResults([criticalResult]);

      const report = await service.generateReport('session-1');

      expect(report.criticalFindings[0].urgency).toBe('urgent');
    });
  });

  describe('health score in report', () => {
    it('should include computed health score in the report', async () => {
      const session = createCompletedSession();
      sessionRepo.addSession(session);
      testResultRepo.addResults([
        createTestResult({ riskCategory: RiskCategory.Normal }),
        createTestResult({ testType: 'lipid_profile', riskCategory: RiskCategory.Borderline }),
      ]);

      const report = await service.generateReport('session-1');

      expect(report.healthScore.score).toBeDefined();
      expect(report.healthScore.score).toBeLessThanOrEqual(100);
      expect(report.healthScore.score).toBeGreaterThanOrEqual(0);
      expect(report.healthScore.normalCount).toBe(1);
      expect(report.healthScore.borderlineCount).toBe(1);
    });
  });
});
