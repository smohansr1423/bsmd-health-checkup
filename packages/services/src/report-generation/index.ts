/**
 * Report Generation Service barrel export
 */
export { ReportGenerationService } from './report-generation.service';
export { buildTrendData, determinePendingTestTypes, shouldRegenerateReport } from './report-generation.trends';
export {
  SessionNotFoundError,
  SessionNotCompleteError,
  ReportNotFoundError,
  ReportGenerationDeadlineError,
  NoTestResultsError,
} from './report-generation.errors';
export type {
  IReportGenerationService,
  ReportGenerationDependencies,
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
