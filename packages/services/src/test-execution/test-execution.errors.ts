/**
 * Test Execution Errors
 * Custom error types for test result recording and session management.
 * Validates: Requirements 5.1, 5.2, 5.3, 5.7
 */

/**
 * Thrown when a test result recording is attempted on a session that is not in-progress.
 *
 * Requirement 5.1: Only allow recording when session is "in-progress".
 */
export class SessionNotInProgressError extends Error {
  public readonly sessionId: string;
  public readonly currentStatus: string;

  constructor(sessionId: string, currentStatus: string) {
    super(
      `Cannot record test result: session "${sessionId}" is not in-progress (current status: "${currentStatus}").`
    );
    this.name = 'SessionNotInProgressError';
    this.sessionId = sessionId;
    this.currentStatus = currentStatus;
  }
}

/**
 * Thrown when the test type does not belong to the session's assigned package.
 *
 * Requirement 5.1: Test must belong to the assigned Checkup_Package.
 */
export class TestNotInPackageError extends Error {
  public readonly testType: string;
  public readonly packageId: string;

  constructor(testType: string, packageId: string) {
    super(
      `Cannot record test result: test type "${testType}" is not part of the assigned package "${packageId}".`
    );
    this.name = 'TestNotInPackageError';
    this.testType = testType;
    this.packageId = packageId;
  }
}

/**
 * Thrown when a value is outside the plausible range and confirmOutOfRange is not set.
 *
 * Requirement 5.2, 5.3: Validate plausible range; require explicit confirmation for out-of-range values.
 */
export class OutOfRangeNotConfirmedError extends Error {
  public readonly testType: string;
  public readonly measuredValue: number;
  public readonly plausibleMin: number;
  public readonly plausibleMax: number;

  constructor(testType: string, measuredValue: number, plausibleMin: number, plausibleMax: number) {
    super(
      `Value ${measuredValue} for test "${testType}" is outside plausible range [${plausibleMin}, ${plausibleMax}]. ` +
        `Set confirmOutOfRange to true to save this value.`
    );
    this.name = 'OutOfRangeNotConfirmedError';
    this.testType = testType;
    this.measuredValue = measuredValue;
    this.plausibleMin = plausibleMin;
    this.plausibleMax = plausibleMax;
  }
}

/**
 * Thrown when a checkup session is not found.
 */
export class CheckupSessionNotFoundError extends Error {
  public readonly sessionId: string;

  constructor(sessionId: string) {
    super(`Checkup session not found: "${sessionId}".`);
    this.name = 'CheckupSessionNotFoundError';
    this.sessionId = sessionId;
  }
}

/**
 * Thrown when a checkup package is not found.
 */
export class PackageNotFoundError extends Error {
  public readonly packageId: string;

  constructor(packageId: string) {
    super(`Checkup package not found: "${packageId}".`);
    this.name = 'PackageNotFoundError';
    this.packageId = packageId;
  }
}

/**
 * Thrown when a test result is not found.
 */
export class TestResultNotFoundError extends Error {
  public readonly testResultId: string;

  constructor(testResultId: string) {
    super(`Test result not found: "${testResultId}".`);
    this.name = 'TestResultNotFoundError';
    this.testResultId = testResultId;
  }
}

/**
 * Thrown when a save operation fails, preserving the original request data for retry.
 *
 * Requirement 5.7: Preserve form data and allow retry on save failure.
 */
export class SaveFailedError extends Error {
  public readonly originalRequest: unknown;
  public readonly failureReason: string;

  constructor(failureReason: string, originalRequest: unknown) {
    super(
      `Save operation failed: ${failureReason}. Data has been preserved for retry.`
    );
    this.name = 'SaveFailedError';
    this.originalRequest = originalRequest;
    this.failureReason = failureReason;
  }
}
