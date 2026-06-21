/**
 * Report Generation Service Types
 * Request/response types and dependency interfaces for health report generation.
 * Validates: Requirements 7.1, 7.2, 7.5, 7.6, 7.7, 7.8
 */

import type {
  HealthReport,
  CheckupSession,
  TestResult,
  HealthScore,
  CategorizedTestResult,
  CriticalFinding,
  TrendDataPoint,
  ReportContent,
} from '@health-checkup/shared';
import type { SupportedLanguage } from '@health-checkup/shared';
import type { EventBus } from '@health-checkup/shared';

/**
 * Summary of a health report for listing purposes.
 */
export interface HealthReportSummary {
  id: string;
  checkupSessionId: string;
  seniorId: string;
  healthScore: number;
  criticalFindingsCount: number;
  generatedAt: Date;
  regeneratedAt?: Date;
  language: SupportedLanguage;
}

/**
 * Repository for persisting and retrieving health reports.
 */
export interface ReportRepository {
  save(report: HealthReport): Promise<HealthReport>;
  findById(id: string): Promise<HealthReport | null>;
  findBySessionId(sessionId: string): Promise<HealthReport | null>;
  findBySeniorId(seniorId: string): Promise<HealthReport[]>;
  update(report: HealthReport): Promise<HealthReport>;
}

/**
 * Repository for accessing checkup sessions.
 */
export interface ReportSessionRepository {
  findById(id: string): Promise<CheckupSession | null>;
}

/**
 * Repository for accessing test results.
 */
export interface ReportTestResultRepository {
  findBySessionId(sessionId: string): Promise<TestResult[]>;
  findBySeniorId(seniorId: string): Promise<TestResult[]>;
}

/**
 * Provider for the senior citizen's preferred language.
 */
export interface SeniorLanguageProvider {
  getPreferredLanguage(seniorId: string): Promise<SupportedLanguage | null>;
}

/**
 * Provider for risk assessment categorization (delegates to the Risk Assessment Engine).
 */
export interface ReportRiskAssessmentProvider {
  categorizeResults(results: TestResult[], seniorId: string): Promise<CategorizedTestResult[]>;
  computeHealthScore(results: TestResult[], seniorId: string): Promise<HealthScore>;
}

/**
 * Provider for PDF generation from report content.
 */
export interface PDFGenerator {
  generatePDF(report: HealthReport, format: 'clinical' | 'simplified'): Promise<Buffer>;
}

/**
 * Provider for sending notifications when reports are available.
 * Requirement 7.9: Notify senior citizen and caregiver when report is available.
 */
export interface ReportNotificationProvider {
  /**
   * Send a report availability notification to the senior citizen and their caregiver.
   * @param seniorId - The senior citizen's ID
   * @param reportId - The generated report's ID
   * @param isRegeneration - Whether this is a regenerated report
   */
  notifyReportAvailable(seniorId: string, reportId: string, isRegeneration: boolean): Promise<void>;
}

/**
 * Provider for retrieving expected test types from a checkup package.
 * Used to determine which tests are pending in partial reports (Requirement 7.8).
 */
export interface ReportPackageTestProvider {
  /**
   * Get the list of test types expected for a given package.
   * @param packageId - The checkup package ID
   * @returns Array of test type strings
   */
  getExpectedTestTypes(packageId: string): Promise<string[]>;
}

/**
 * Dependencies injected into the ReportGenerationService for testability.
 */
export interface ReportGenerationDependencies {
  reportRepository: ReportRepository;
  sessionRepository: ReportSessionRepository;
  testResultRepository: ReportTestResultRepository;
  seniorLanguageProvider: SeniorLanguageProvider;
  riskAssessmentProvider: ReportRiskAssessmentProvider;
  pdfGenerator: PDFGenerator;
  notificationProvider?: ReportNotificationProvider;
  packageTestProvider?: ReportPackageTestProvider;
  eventBus?: EventBus;
  idGenerator?: () => string;
  dateProvider?: () => Date;
}

/**
 * Interface for the Report Generation Service.
 */
export interface IReportGenerationService {
  /**
   * Generate a health report for a completed checkup session.
   * Must be generated within 24 hours of session completion.
   */
  generateReport(sessionId: string): Promise<HealthReport>;

  /**
   * Regenerate an existing report (e.g., when pending test results become available).
   */
  regenerateReport(reportId: string): Promise<HealthReport>;

  /**
   * Get a report by ID, returning the specified format version.
   */
  getReport(reportId: string, format: 'clinical' | 'simplified'): Promise<HealthReport>;

  /**
   * Download a report as a PDF buffer in the specified format.
   */
  downloadReportPDF(reportId: string, format: 'clinical' | 'simplified'): Promise<Buffer>;

  /**
   * Get all report summaries for a given senior citizen.
   */
  getReportHistory(seniorId: string): Promise<HealthReportSummary[]>;
}
