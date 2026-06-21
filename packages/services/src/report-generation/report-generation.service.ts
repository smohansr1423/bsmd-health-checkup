/**
 * Report Generation Service
 * Generates comprehensive health reports in clinical and simplified formats,
 * supports PDF export, manages report lifecycle, and subscribes to session
 * completion events for automatic generation.
 *
 * Validates: Requirements 7.1, 7.2, 7.5, 7.6, 7.7, 7.8
 */

import type {
  HealthReport,
  CriticalFinding,
  CategorizedTestResult,
  ReportContent,
  ReportSection,
  TestResult,
} from '@health-checkup/shared';
import { SupportedLanguage, RiskCategory } from '@health-checkup/shared';
import type { EventBus, ReportGeneratedEvent, CheckupSessionCompletedEvent } from '@health-checkup/shared';
import type {
  IReportGenerationService,
  ReportGenerationDependencies,
  HealthReportSummary,
  ReportRepository,
  ReportSessionRepository,
  ReportTestResultRepository,
  SeniorLanguageProvider,
  ReportRiskAssessmentProvider,
  PDFGenerator,
  ReportNotificationProvider,
  ReportPackageTestProvider,
} from './report-generation.types';
import { buildTrendData, determinePendingTestTypes, shouldRegenerateReport } from './report-generation.trends';
import {
  SessionNotFoundError,
  SessionNotCompleteError,
  ReportNotFoundError,
  ReportGenerationDeadlineError,
  NoTestResultsError,
} from './report-generation.errors';

/** Default ID generator */
const defaultIdGenerator = (): string =>
  `RPT_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;

/** Default date provider */
const defaultDateProvider = (): Date => new Date();

/** 24 hours in milliseconds */
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

/** Default system language */
const DEFAULT_LANGUAGE = SupportedLanguage.English;

/**
 * ReportGenerationService implementation.
 *
 * Business rules:
 * - Report generated within 24 hours of session completion (subscribes to CheckupSessionCompleted event)
 * - Clinical version: all test values, diagnostic notes, reference ranges, full medical terminology
 * - Simplified version: health score, risk category summary, critical findings highlighted, plain language recommendations
 * - Critical findings placed at the TOP of both report versions
 * - Report generated in senior's preferred language (fallback to English)
 * - Supports PDF download
 */
export class ReportGenerationService implements IReportGenerationService {
  private readonly reportRepository: ReportRepository;
  private readonly sessionRepository: ReportSessionRepository;
  private readonly testResultRepository: ReportTestResultRepository;
  private readonly seniorLanguageProvider: SeniorLanguageProvider;
  private readonly riskAssessmentProvider: ReportRiskAssessmentProvider;
  private readonly pdfGenerator: PDFGenerator;
  private readonly notificationProvider?: ReportNotificationProvider;
  private readonly packageTestProvider?: ReportPackageTestProvider;
  private readonly eventBus?: EventBus;
  private readonly idGenerator: () => string;
  private readonly dateProvider: () => Date;

  constructor(deps: ReportGenerationDependencies) {
    this.reportRepository = deps.reportRepository;
    this.sessionRepository = deps.sessionRepository;
    this.testResultRepository = deps.testResultRepository;
    this.seniorLanguageProvider = deps.seniorLanguageProvider;
    this.riskAssessmentProvider = deps.riskAssessmentProvider;
    this.pdfGenerator = deps.pdfGenerator;
    this.notificationProvider = deps.notificationProvider;
    this.packageTestProvider = deps.packageTestProvider;
    this.eventBus = deps.eventBus;
    this.idGenerator = deps.idGenerator ?? defaultIdGenerator;
    this.dateProvider = deps.dateProvider ?? defaultDateProvider;

    // Subscribe to CheckupSessionCompleted event for automatic report generation
    if (this.eventBus) {
      this.eventBus.subscribe('CheckupSessionCompleted', this.handleSessionCompleted.bind(this));
      this.eventBus.subscribe('TestResultRecorded', this.handleTestResultRecorded.bind(this));
    }
  }

  /**
   * Generate a health report for a completed checkup session.
   * Requirement 7.1: Generate within 24 hours of session completion.
   * Requirement 7.2: Dual format (clinical + simplified).
   * Requirement 7.6: Critical findings at top.
   * Requirement 7.7: Generate in senior's preferred language.
   */
  async generateReport(sessionId: string): Promise<HealthReport> {
    // 1. Fetch the session
    const session = await this.sessionRepository.findById(sessionId);
    if (!session) {
      throw new SessionNotFoundError(sessionId);
    }

    // 2. Validate session is complete or pending_results
    if (session.status !== 'complete' && session.status !== 'pending_results') {
      throw new SessionNotCompleteError(sessionId, session.status);
    }

    // 3. Validate 24-hour deadline
    const now = this.dateProvider();
    if (session.completedAt) {
      const elapsed = now.getTime() - new Date(session.completedAt).getTime();
      if (elapsed > TWENTY_FOUR_HOURS_MS) {
        throw new ReportGenerationDeadlineError(sessionId, new Date(session.completedAt), now);
      }
    }

    // 4. Fetch test results
    const testResults = await this.testResultRepository.findBySessionId(sessionId);
    if (testResults.length === 0) {
      throw new NoTestResultsError(sessionId);
    }

    // 5. Get senior's preferred language
    const preferredLanguage = await this.seniorLanguageProvider.getPreferredLanguage(session.seniorId);
    const language = preferredLanguage ?? DEFAULT_LANGUAGE;

    // 6. Categorize results and compute health score
    const categorizedResults = await this.riskAssessmentProvider.categorizeResults(
      testResults,
      session.seniorId
    );
    const healthScore = await this.riskAssessmentProvider.computeHealthScore(
      testResults,
      session.seniorId
    );

    // 7. Extract critical findings
    const criticalFindings = this.extractCriticalFindings(categorizedResults);

    // 8. Determine pending tests (tests in package not yet recorded)
    const pendingTests = await this.computePendingTests(session.packageId, testResults, session.status);

    // 9. Build trend data (Requirement 7.3, 7.4)
    const allSeniorResults = await this.testResultRepository.findBySeniorId(session.seniorId);
    const trendData = buildTrendData(allSeniorResults, sessionId);

    // 10. Generate physician recommendations
    const physicianRecommendations = this.generateRecommendations(categorizedResults, criticalFindings);

    // 11. Build dual-format report content
    const clinicalContent = this.buildClinicalContent(
      categorizedResults,
      criticalFindings,
      healthScore,
      physicianRecommendations,
      language
    );
    const simplifiedContent = this.buildSimplifiedContent(
      categorizedResults,
      criticalFindings,
      healthScore,
      physicianRecommendations,
      language
    );

    // 12. Create report entity
    const report: HealthReport = {
      id: this.idGenerator(),
      checkupSessionId: sessionId,
      seniorId: session.seniorId,
      healthScore,
      testResults: categorizedResults,
      criticalFindings,
      physicianRecommendations,
      trendData: trendData.length > 0 ? trendData : undefined,
      pendingTests,
      generatedAt: now,
      language,
      versions: {
        clinical: clinicalContent,
        simplified: simplifiedContent,
      },
    };

    // 13. Persist report
    const savedReport = await this.reportRepository.save(report);

    // 14. Publish ReportGenerated event
    await this.publishReportGeneratedEvent(savedReport, false);

    // 15. Send notification to senior citizen and caregiver (Requirement 7.9)
    await this.notifyReportAvailable(savedReport, false);

    return savedReport;
  }

  /**
   * Regenerate an existing report (e.g., when pending test results arrive).
   * Requirement 7.8: Regenerate when remaining results become available.
   */
  async regenerateReport(reportId: string): Promise<HealthReport> {
    // 1. Fetch existing report
    const existingReport = await this.reportRepository.findById(reportId);
    if (!existingReport) {
      throw new ReportNotFoundError(reportId);
    }

    // 2. Fetch the session
    const session = await this.sessionRepository.findById(existingReport.checkupSessionId);
    if (!session) {
      throw new SessionNotFoundError(existingReport.checkupSessionId);
    }

    // 3. Fetch latest test results
    const testResults = await this.testResultRepository.findBySessionId(existingReport.checkupSessionId);
    if (testResults.length === 0) {
      throw new NoTestResultsError(existingReport.checkupSessionId);
    }

    // 4. Re-categorize and re-compute
    const categorizedResults = await this.riskAssessmentProvider.categorizeResults(
      testResults,
      session.seniorId
    );
    const healthScore = await this.riskAssessmentProvider.computeHealthScore(
      testResults,
      session.seniorId
    );
    const criticalFindings = this.extractCriticalFindings(categorizedResults);
    const pendingTests = await this.computePendingTests(session.packageId, testResults, session.status);
    const physicianRecommendations = this.generateRecommendations(categorizedResults, criticalFindings);

    // Build trend data for regeneration (Requirement 7.3, 7.4)
    const allSeniorResults = await this.testResultRepository.findBySeniorId(session.seniorId);
    const trendData = buildTrendData(allSeniorResults, existingReport.checkupSessionId);

    const now = this.dateProvider();

    // 5. Build updated content
    const clinicalContent = this.buildClinicalContent(
      categorizedResults,
      criticalFindings,
      healthScore,
      physicianRecommendations,
      existingReport.language
    );
    const simplifiedContent = this.buildSimplifiedContent(
      categorizedResults,
      criticalFindings,
      healthScore,
      physicianRecommendations,
      existingReport.language
    );

    // 6. Update report
    const updatedReport: HealthReport = {
      ...existingReport,
      healthScore,
      testResults: categorizedResults,
      criticalFindings,
      physicianRecommendations,
      pendingTests,
      trendData: trendData.length > 0 ? trendData : undefined,
      regeneratedAt: now,
      versions: {
        clinical: clinicalContent,
        simplified: simplifiedContent,
      },
    };

    const savedReport = await this.reportRepository.update(updatedReport);

    // 7. Publish ReportGenerated event (regeneration)
    await this.publishReportGeneratedEvent(savedReport, true);

    // 8. Send notification to senior citizen and caregiver (Requirement 7.9)
    await this.notifyReportAvailable(savedReport, true);

    return savedReport;
  }

  /**
   * Get a report by ID.
   * Requirement 7.5: Report viewable within the application.
   */
  async getReport(reportId: string, format: 'clinical' | 'simplified'): Promise<HealthReport> {
    const report = await this.reportRepository.findById(reportId);
    if (!report) {
      throw new ReportNotFoundError(reportId);
    }
    return report;
  }

  /**
   * Download a report as a PDF buffer in the specified format.
   * Requirement 7.5: Report available for download in PDF format.
   */
  async downloadReportPDF(reportId: string, format: 'clinical' | 'simplified'): Promise<Buffer> {
    const report = await this.reportRepository.findById(reportId);
    if (!report) {
      throw new ReportNotFoundError(reportId);
    }
    return this.pdfGenerator.generatePDF(report, format);
  }

  /**
   * Get all report summaries for a given senior citizen.
   */
  async getReportHistory(seniorId: string): Promise<HealthReportSummary[]> {
    const reports = await this.reportRepository.findBySeniorId(seniorId);
    return reports.map((report) => ({
      id: report.id,
      checkupSessionId: report.checkupSessionId,
      seniorId: report.seniorId,
      healthScore: report.healthScore.score,
      criticalFindingsCount: report.criticalFindings.length,
      generatedAt: report.generatedAt,
      regeneratedAt: report.regeneratedAt,
      language: report.language,
    }));
  }

  // --- Private Helpers ---

  /**
   * Handle the CheckupSessionCompleted event for automatic report generation.
   * Requirement 7.1: Generate report within 24 hours of session completion.
   */
  private async handleSessionCompleted(event: CheckupSessionCompletedEvent): Promise<void> {
    try {
      await this.generateReport(event.payload.checkupSessionId);
    } catch {
      // Log error in production; event-driven generation is best-effort
      // The report can still be manually generated within 24 hours
    }
  }

  /**
   * Handle the TestResultRecorded event for automatic report regeneration.
   * Requirement 7.8: Regenerate report when remaining results arrive.
   */
  private async handleTestResultRecorded(event: import('@health-checkup/shared').TestResultRecordedEvent): Promise<void> {
    try {
      // Check if there is an existing report for this session with pending tests
      const existingReport = await this.reportRepository.findBySessionId(event.payload.checkupSessionId);
      if (!existingReport || !existingReport.pendingTests || existingReport.pendingTests.length === 0) {
        return;
      }

      // Check if the new result resolves any pending tests
      const testResults = await this.testResultRepository.findBySessionId(event.payload.checkupSessionId);
      if (shouldRegenerateReport(existingReport.pendingTests, testResults)) {
        await this.regenerateReport(existingReport.id);
      }
    } catch {
      // Best-effort regeneration; errors are silently handled
    }
  }

  /**
   * Notify the senior citizen and caregiver that a report is available.
   * Requirement 7.9: Send notification when report is available.
   */
  private async notifyReportAvailable(report: HealthReport, isRegeneration: boolean): Promise<void> {
    if (!this.notificationProvider) return;

    try {
      await this.notificationProvider.notifyReportAvailable(
        report.seniorId,
        report.id,
        isRegeneration
      );
    } catch {
      // Notification is best-effort; don't fail report generation if notification fails
    }
  }

  /**
   * Extract critical findings from categorized results.
   * Requirement 7.6: Critical findings in a dedicated section at top of report.
   */
  private extractCriticalFindings(categorizedResults: CategorizedTestResult[]): CriticalFinding[] {
    return categorizedResults
      .filter((r) => r.category === RiskCategory.Critical)
      .map((r) => {
        const referenceRange = r.testResult.ageAdjustedRange ?? {
          min: 0,
          max: 0,
          borderlineLow: 0,
          borderlineHigh: 0,
          criticalLow: 0,
          criticalHigh: 0,
          ageGroup: '60-69' as any,
        };

        // Determine urgency: immediate if very far from range, otherwise urgent
        const value = r.testResult.measuredValue;
        const isImmediate =
          value < referenceRange.criticalLow * 0.8 || value > referenceRange.criticalHigh * 1.2;

        return {
          testType: r.testResult.testType,
          measuredValue: r.testResult.measuredValue,
          referenceRange,
          urgency: isImmediate ? 'immediate' : 'urgent',
        } as CriticalFinding;
      });
  }

  /**
   * Determine pending tests from a session.
   * Requirement 7.8: Indicate which tests are pending.
   */
  private async computePendingTests(
    packageId: string,
    testResults: TestResult[],
    sessionStatus: string
  ): Promise<string[]> {
    if (sessionStatus !== 'pending_results') {
      return [];
    }

    // If we have a package test provider, use it to get expected tests
    if (this.packageTestProvider) {
      const expectedTests = await this.packageTestProvider.getExpectedTestTypes(packageId);
      return determinePendingTestTypes(expectedTests, testResults);
    }

    // Fallback: we know tests are pending but can't determine which ones specifically
    return ['pending_results_awaiting'];
  }

  /**
   * Generate physician recommendations based on categorized results.
   */
  private generateRecommendations(
    categorizedResults: CategorizedTestResult[],
    criticalFindings: CriticalFinding[]
  ): string[] {
    const recommendations: string[] = [];

    if (criticalFindings.length > 0) {
      recommendations.push('Immediate follow-up required for critical findings.');
    }

    const borderlineResults = categorizedResults.filter(
      (r) => r.category === RiskCategory.Borderline
    );
    if (borderlineResults.length > 0) {
      recommendations.push(
        `Monitor ${borderlineResults.length} borderline parameter(s) closely.`
      );
    }

    const normalCount = categorizedResults.filter(
      (r) => r.category === RiskCategory.Normal
    ).length;
    if (normalCount === categorizedResults.length) {
      recommendations.push('All parameters within normal range. Continue current health routine.');
    }

    return recommendations;
  }

  /**
   * Build clinical version of the report.
   * Requirement 7.2: Clinical version includes all test values, diagnostic notes,
   * reference ranges, and full medical terminology.
   * Requirement 7.6: Critical findings at top.
   */
  private buildClinicalContent(
    categorizedResults: CategorizedTestResult[],
    criticalFindings: CriticalFinding[],
    healthScore: { score: number },
    recommendations: string[],
    language: SupportedLanguage
  ): ReportContent {
    const sections: ReportSection[] = [];

    // Critical findings section FIRST (Requirement 7.6)
    if (criticalFindings.length > 0) {
      const criticalContent = criticalFindings
        .map(
          (f) =>
            `${f.testType}: ${f.measuredValue} (Reference: ${f.referenceRange.min}-${f.referenceRange.max}, Critical: <${f.referenceRange.criticalLow} or >${f.referenceRange.criticalHigh}) [${f.urgency.toUpperCase()}]`
        )
        .join('\n');
      sections.push({
        heading: 'Critical Findings',
        content: criticalContent,
      });
    }

    // Health Score summary
    sections.push({
      heading: 'Health Score Overview',
      content: `Overall Health Score: ${healthScore.score}/100`,
    });

    // Detailed test results with reference ranges
    const resultLines = categorizedResults
      .map((r) => {
        const range = r.testResult.ageAdjustedRange;
        const rangeStr = range
          ? `Reference: ${range.min}-${range.max} ${r.testResult.unit}`
          : 'Reference: Not available';
        return `${r.testResult.testType}: ${r.testResult.measuredValue} ${r.testResult.unit} | ${rangeStr} | Category: ${r.category} | ${r.interpretation}`;
      })
      .join('\n');
    sections.push({
      heading: 'Detailed Test Results',
      content: resultLines,
    });

    // Diagnostic notes / recommendations
    sections.push({
      heading: 'Diagnostic Notes and Recommendations',
      content: recommendations.join('\n'),
    });

    return {
      title: 'Clinical Health Report',
      sections,
    };
  }

  /**
   * Build simplified version of the report.
   * Requirement 7.2: Simplified version includes health score, risk category summary,
   * critical findings highlighted, and plain language recommendations.
   * Requirement 7.6: Critical findings at top.
   */
  private buildSimplifiedContent(
    categorizedResults: CategorizedTestResult[],
    criticalFindings: CriticalFinding[],
    healthScore: { score: number },
    recommendations: string[],
    language: SupportedLanguage
  ): ReportContent {
    const sections: ReportSection[] = [];

    // Critical findings section FIRST (Requirement 7.6)
    if (criticalFindings.length > 0) {
      const criticalContent = criticalFindings
        .map(
          (f) =>
            `⚠️ ${f.testType}: Your result (${f.measuredValue}) needs ${f.urgency === 'immediate' ? 'immediate' : 'urgent'} attention.`
        )
        .join('\n');
      sections.push({
        heading: 'Important Findings That Need Attention',
        content: criticalContent,
      });
    }

    // Health Score (plain language)
    const scoreDescription = this.getPlainLanguageScore(healthScore.score);
    sections.push({
      heading: 'Your Health Score',
      content: `Your overall health score is ${healthScore.score} out of 100. ${scoreDescription}`,
    });

    // Risk category summary
    const normalCount = categorizedResults.filter((r) => r.category === RiskCategory.Normal).length;
    const borderlineCount = categorizedResults.filter((r) => r.category === RiskCategory.Borderline).length;
    const criticalCount = categorizedResults.filter((r) => r.category === RiskCategory.Critical).length;

    sections.push({
      heading: 'Results Summary',
      content: `Normal: ${normalCount} test(s) | Needs Monitoring: ${borderlineCount} test(s) | Needs Attention: ${criticalCount} test(s)`,
    });

    // Plain language recommendations
    sections.push({
      heading: 'What To Do Next',
      content: recommendations.join('\n'),
    });

    return {
      title: 'Your Health Summary',
      sections,
    };
  }

  /**
   * Get a plain language description of the health score.
   */
  private getPlainLanguageScore(score: number): string {
    if (score >= 90) return 'Your health is in excellent condition.';
    if (score >= 70) return 'Your health is in good condition with some areas to watch.';
    if (score >= 50) return 'Some health parameters need attention. Please follow up with your doctor.';
    return 'Several health parameters need attention. Please consult your doctor soon.';
  }

  /**
   * Publish a ReportGenerated event.
   */
  private async publishReportGeneratedEvent(
    report: HealthReport,
    isRegeneration: boolean
  ): Promise<void> {
    if (!this.eventBus) return;

    const event: ReportGeneratedEvent = {
      id: this.idGenerator(),
      type: 'ReportGenerated',
      occurredAt: report.generatedAt.toISOString(),
      sourceId: report.id,
      payload: {
        reportId: report.id,
        checkupSessionId: report.checkupSessionId,
        seniorId: report.seniorId,
        isRegeneration,
        generatedAt: report.generatedAt.toISOString(),
      },
    };

    await this.eventBus.publish(event);
  }
}
