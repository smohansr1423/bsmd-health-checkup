/**
 * Risk Assessment Engine Errors
 * Custom error classes for risk assessment operations.
 * Validates: Requirements 6.1, 6.2, 6.5
 */

/**
 * Thrown when no reference range is defined for a test type + age group combination.
 * The result should be marked as Uncategorized and the physician notified for manual review.
 */
export class NoReferenceRangeError extends Error {
  constructor(
    public readonly testType: string,
    public readonly ageGroup: string
  ) {
    super(
      `No reference range defined for test type "${testType}" in age group "${ageGroup}". ` +
      `Result marked as Uncategorized; physician notification required for manual review.`
    );
    this.name = 'NoReferenceRangeError';
  }
}

/**
 * Thrown when a critical alert could not be published within the required timeframe.
 */
export class CriticalAlertPublishError extends Error {
  constructor(
    public readonly testResultId: string,
    public readonly reason: string
  ) {
    super(
      `Failed to publish critical alert for test result "${testResultId}": ${reason}`
    );
    this.name = 'CriticalAlertPublishError';
  }
}

/**
 * Thrown when health score computation receives no scoreable results.
 */
export class NoScoreableResultsError extends Error {
  constructor() {
    super('Cannot compute health score: no scoreable results provided (all results are uncategorized or input is empty).');
    this.name = 'NoScoreableResultsError';
  }
}
