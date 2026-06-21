/**
 * Report Generation Service Errors
 * Custom error classes for report generation operations.
 * Validates: Requirements 7.1, 7.5, 7.8
 */

/**
 * Thrown when a checkup session is not found.
 */
export class SessionNotFoundError extends Error {
  constructor(public readonly sessionId: string) {
    super(`Checkup session "${sessionId}" not found.`);
    this.name = 'SessionNotFoundError';
  }
}

/**
 * Thrown when a session is not yet completed (report cannot be generated).
 */
export class SessionNotCompleteError extends Error {
  constructor(
    public readonly sessionId: string,
    public readonly currentStatus: string
  ) {
    super(
      `Cannot generate report for session "${sessionId}": session status is "${currentStatus}", expected "complete" or "pending_results".`
    );
    this.name = 'SessionNotCompleteError';
  }
}

/**
 * Thrown when a report is not found by ID.
 */
export class ReportNotFoundError extends Error {
  constructor(public readonly reportId: string) {
    super(`Health report "${reportId}" not found.`);
    this.name = 'ReportNotFoundError';
  }
}

/**
 * Thrown when report generation exceeds the 24-hour deadline.
 */
export class ReportGenerationDeadlineError extends Error {
  constructor(
    public readonly sessionId: string,
    public readonly completedAt: Date,
    public readonly currentTime: Date
  ) {
    super(
      `Report generation deadline exceeded for session "${sessionId}": session completed at ${completedAt.toISOString()}, current time is ${currentTime.toISOString()} (>24 hours).`
    );
    this.name = 'ReportGenerationDeadlineError';
  }
}

/**
 * Thrown when no test results are available for report generation.
 */
export class NoTestResultsError extends Error {
  constructor(public readonly sessionId: string) {
    super(`No test results available for session "${sessionId}". Cannot generate report.`);
    this.name = 'NoTestResultsError';
  }
}
