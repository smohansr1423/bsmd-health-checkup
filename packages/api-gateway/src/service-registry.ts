/**
 * Service Registry — Composition Root
 *
 * Creates and wires all service instances with their dependencies.
 * Uses the InMemoryEventBus from @health-checkup/shared as the event bus backbone.
 * This is the single place where all services are instantiated and connected.
 *
 * Validates: Requirements All (integration)
 */

import { InMemoryEventBus } from '@health-checkup/shared';
import type { EventBus, HealthReport, CheckupSession, TestResult } from '@health-checkup/shared';
import { AgeGroup, RiskCategory, SupportedLanguage } from '@health-checkup/shared';

import {
  RegistrationService,
  SchedulingService,
  CheckupPackageService,
  TestExecutionService,
  RiskAssessmentEngine,
  RiskDefaultReferenceRangeProvider,
  ReportGenerationService,
  FollowUpTrackerService,
  BillingEngineService,
  PaymentProcessingService,
  InsuranceIntegrationService,
  NotificationService,
  CriticalAlertService,
  AnalyticsService,
  DeviceRegistrationService,
  DeviceIntegrationService,
  InMemoryDeviceRepository,
  InMemoryHealthReadingRepository,
  InMemoryDailyHealthRecordRepository,
  NormalRangeService,
  InMemoryNormalRangeRepository,
  ReadingAlertEngine,
  InMemoryReadingAlertRepository,
  TrendAnalyzer,
  InMemoryReadingsDataSource,
} from '@health-checkup/services';

import type {
  ReportRepository,
  ReportSessionRepository,
  ReportTestResultRepository,
  SeniorLanguageProvider,
  ReportRiskAssessmentProvider,
  PDFGenerator,
} from '@health-checkup/services';

import type { HealthScore as SharedHealthScore } from '@health-checkup/shared';
import type { AnalyticsDataProvider } from '@health-checkup/services';

import { wireEventSubscriptions } from './event-wiring';

/**
 * Container holding all instantiated services and the shared event bus.
 */
export interface ServiceRegistry {
  eventBus: EventBus;

  // Domain services
  registrationService: RegistrationService;
  schedulingService: SchedulingService;
  checkupPackageService: CheckupPackageService;
  testExecutionService: TestExecutionService;
  riskAssessmentEngine: RiskAssessmentEngine;
  reportGenerationService: ReportGenerationService;
  followUpTrackerService: FollowUpTrackerService;
  billingEngineService: BillingEngineService;
  paymentProcessingService: PaymentProcessingService;
  insuranceIntegrationService: InsuranceIntegrationService;
  notificationService: NotificationService;
  criticalAlertService: CriticalAlertService;
  analyticsService: AnalyticsService;

  // Device Integration services
  deviceRegistrationService: DeviceRegistrationService;
  deviceIntegrationService: DeviceIntegrationService;
  normalRangeService: NormalRangeService;
  trendAnalyzer: TrendAnalyzer;
}

/**
 * Creates the full service registry with all services wired together.
 *
 * Each service is instantiated with its in-memory repositories (suitable for
 * development/testing). In production, swap these for database-backed repositories.
 *
 * The shared InMemoryEventBus connects services for asynchronous communication.
 */
export function createServiceRegistry(): ServiceRegistry {
  // --- Shared infrastructure ---
  const eventBus = new InMemoryEventBus();

  // --- Service instantiation ---

  // Registration Service
  const registrationService = new RegistrationService();

  // Scheduling Service
  const schedulingService = new SchedulingService();

  // Checkup Package Service
  const checkupPackageService = new CheckupPackageService();

  // Test Execution Service — connected to event bus for session completion events
  const testExecutionService = new TestExecutionService({ eventBus });

  // Risk Assessment Engine — connected to event bus for critical alert publishing
  const riskAssessmentEngine = new RiskAssessmentEngine({
    referenceRangeProvider: new RiskDefaultReferenceRangeProvider(),
    eventBus,
  });

  // Report Generation Service — requires explicit dependencies
  const reportGenerationService = new ReportGenerationService({
    reportRepository: createInMemoryReportRepository(),
    sessionRepository: createInMemoryReportSessionRepository(),
    testResultRepository: createInMemoryReportTestResultRepository(),
    seniorLanguageProvider: createDefaultSeniorLanguageProvider(),
    riskAssessmentProvider: createRiskAssessmentProvider(riskAssessmentEngine),
    pdfGenerator: createDefaultPDFGenerator(),
    eventBus,
  });

  // Follow-Up Tracker Service
  const followUpTrackerService = new FollowUpTrackerService();

  // Billing Engine Service
  const billingEngineService = new BillingEngineService();

  // Payment Processing Service
  const paymentProcessingService = new PaymentProcessingService();

  // Insurance Integration Service
  const insuranceIntegrationService = new InsuranceIntegrationService();

  // Notification Service
  const notificationService = new NotificationService();

  // Critical Alert Service
  const criticalAlertService = new CriticalAlertService();

  // Analytics Service — requires explicit data provider dependency
  const analyticsService = new AnalyticsService({
    dataProvider: createDefaultAnalyticsDataProvider(),
  });

  // --- Device Integration Services ---

  // Shared in-memory repositories for device integration
  const deviceRepository = new InMemoryDeviceRepository();
  const healthReadingRepository = new InMemoryHealthReadingRepository();
  const dailyHealthRecordRepository = new InMemoryDailyHealthRecordRepository();
  const normalRangeRepository = new InMemoryNormalRangeRepository();
  const readingAlertRepository = new InMemoryReadingAlertRepository();
  const readingsDataSource = new InMemoryReadingsDataSource();

  // Device Registration Service
  const deviceRegistrationService = new DeviceRegistrationService({
    repository: deviceRepository,
  });

  // Normal Range Service
  const normalRangeService = new NormalRangeService({
    repository: normalRangeRepository,
  });

  // Reading Alert Engine — connected to event bus for critical alert publishing
  const readingAlertEngine = new ReadingAlertEngine({
    normalRangeRepository,
    alertRepository: readingAlertRepository,
    eventPublisher: eventBus,
    idGenerator: () => `ALT_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
    dateProvider: () => new Date(),
  });

  // Device Integration Service — core orchestration service
  const deviceIntegrationService = new DeviceIntegrationService({
    deviceRepository,
    readingRepository: healthReadingRepository,
    dailyRecordRepository: dailyHealthRecordRepository,
    alertEngine: readingAlertEngine,
    idGenerator: () => `RDG_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
    dateProvider: () => new Date(),
  });

  // Trend Analyzer
  const trendAnalyzer = new TrendAnalyzer(readingsDataSource);

  // --- Wire event subscriptions for inter-service communication ---
  wireEventSubscriptions(eventBus, {
    riskAssessmentEngine,
    reportGenerationService,
    notificationService,
    criticalAlertService,
    paymentProcessingService,
  });

  return {
    eventBus,
    registrationService,
    schedulingService,
    checkupPackageService,
    testExecutionService,
    riskAssessmentEngine,
    reportGenerationService,
    followUpTrackerService,
    billingEngineService,
    paymentProcessingService,
    insuranceIntegrationService,
    notificationService,
    criticalAlertService,
    analyticsService,
    deviceRegistrationService,
    deviceIntegrationService,
    normalRangeService,
    trendAnalyzer,
  };
}

// ─── Factory helpers for ReportGenerationService dependencies ─────────────────

/**
 * In-memory report repository for development use.
 */
function createInMemoryReportRepository(): ReportRepository {
  const reports: HealthReport[] = [];

  return {
    async save(report: HealthReport) {
      reports.push(report);
      return report;
    },
    async findById(id: string) {
      return reports.find((r) => r.id === id) ?? null;
    },
    async findBySessionId(sessionId: string) {
      return reports.find((r) => r.checkupSessionId === sessionId) ?? null;
    },
    async findBySeniorId(seniorId: string) {
      return reports.filter((r) => r.seniorId === seniorId);
    },
    async update(report: HealthReport) {
      const index = reports.findIndex((r) => r.id === report.id);
      if (index >= 0) reports[index] = report;
      return report;
    },
  };
}

/**
 * In-memory session repository for report generation.
 */
function createInMemoryReportSessionRepository(): ReportSessionRepository {
  const sessions: CheckupSession[] = [];

  return {
    async findById(id: string) {
      return sessions.find((s) => s.id === id) ?? null;
    },
  };
}

/**
 * In-memory test result repository for report generation.
 */
function createInMemoryReportTestResultRepository(): ReportTestResultRepository {
  const results: TestResult[] = [];

  return {
    async findBySessionId(sessionId: string) {
      return results.filter((r) => r.checkupSessionId === sessionId);
    },
    async findBySeniorId(seniorId: string) {
      return results.filter((r) => r.seniorId === seniorId);
    },
  };
}

/**
 * Default language provider — returns English as fallback.
 */
function createDefaultSeniorLanguageProvider(): SeniorLanguageProvider {
  return {
    async getPreferredLanguage(_seniorId: string): Promise<SupportedLanguage | null> {
      return SupportedLanguage.English;
    },
  };
}

/**
 * Wraps the RiskAssessmentEngine to implement the ReportRiskAssessmentProvider interface.
 */
function createRiskAssessmentProvider(engine: RiskAssessmentEngine): ReportRiskAssessmentProvider {
  return {
    async categorizeResults(results: TestResult[], _seniorId: string) {
      // Default to '60-69' age group — in production this would look up the senior's age
      const ageGroup = AgeGroup.SixtyToSixtyNine;
      return results.map((result) => {
        const category = engine.categorizeResult(result, ageGroup);
        return {
          testResult: result,
          category,
          interpretation: getInterpretation(category),
        };
      });
    },
    async computeHealthScore(results: TestResult[], _seniorId: string): Promise<SharedHealthScore> {
      const ageGroup = AgeGroup.SixtyToSixtyNine;
      const engineScore = engine.computeHealthScore(results, ageGroup);
      // Map from engine's ScoreBreakdown (riskCategory, penalty) to shared ScoreBreakdown (category, weightedScore)
      return {
        score: engineScore.score,
        breakdown: engineScore.breakdown.map((b) => ({
          testType: b.testType,
          category: b.riskCategory,
          weightedScore: b.penalty,
        })),
        normalCount: engineScore.normalCount,
        borderlineCount: engineScore.borderlineCount,
        criticalCount: engineScore.criticalCount,
      };
    },
  };
}

function getInterpretation(category: RiskCategory): string {
  switch (category) {
    case RiskCategory.Normal:
      return 'Within normal range';
    case RiskCategory.Borderline:
      return 'Slightly outside normal range — monitoring recommended';
    case RiskCategory.Critical:
      return 'Significantly outside normal range — immediate attention required';
    case RiskCategory.Uncategorized:
      return 'No reference range available for categorization';
    default:
      return 'Assessment pending';
  }
}

/**
 * Default PDF generator — returns a text-based representation.
 * In production, use a real PDF library (pdfkit, puppeteer, etc.).
 */
function createDefaultPDFGenerator(): PDFGenerator {
  return {
    async generatePDF(report: HealthReport, format: 'clinical' | 'simplified'): Promise<Buffer> {
      const content = report.versions[format];
      const text = `[PDF] ${content.title}\n\n` +
        content.sections.map((s) => `## ${s.heading}\n${s.content}`).join('\n\n');
      return Buffer.from(text, 'utf-8');
    },
  };
}

// ─── Factory helper for AnalyticsService data provider ───────────────────────

/**
 * Default in-memory analytics data provider.
 * Returns empty data sets — in production this would query the analytics read store.
 */
function createDefaultAnalyticsDataProvider(): AnalyticsDataProvider {
  return {
    async getTestResults(_seniorId: string) { return []; },
    async getCheckupSessionIds(_seniorId: string) { return []; },
    async getAgeGroup(_seniorId: string) { return AgeGroup.SixtyToSixtyNine; },
    async getBenchmarkData(_ageGroup, _testType) { return null; },
    async getHealthScore(_sessionId: string) { return null; },
    async getPhysicianPatientIds(_physicianId: string) { return []; },
    async getTestResultsForPatients(_patientIds: string[]) { return []; },
    async getLatestHealthScoresForPhysician(_physicianId: string) { return []; },
    async getFollowUpRecords(_physicianId: string, _since: Date) { return []; },
    async getAppointmentRecords(_physicianId: string, _since: Date) { return []; },
  };
}
