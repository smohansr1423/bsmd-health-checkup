/**
 * Follow-Up Tracker Errors
 * Custom error types for the follow-up action workflow.
 * Validates: Requirements 8.1, 8.6
 */

/**
 * Thrown when a follow-up assignment request fails validation.
 */
export class FollowUpValidationError extends Error {
  public readonly field: string;
  public readonly constraint: string;

  constructor(field: string, constraint: string) {
    super(`Follow-up validation failed: ${field} - ${constraint}`);
    this.name = 'FollowUpValidationError';
    this.field = field;
    this.constraint = constraint;
  }
}

/**
 * Thrown when the maximum number of follow-up actions per report is exceeded.
 */
export class MaxFollowUpActionsExceededError extends Error {
  public readonly reportId: string;
  public readonly maxAllowed: number;
  public readonly currentCount: number;

  constructor(reportId: string, currentCount: number, maxAllowed: number = 20) {
    super(
      `Maximum follow-up actions exceeded for report ${reportId}: ` +
      `${currentCount} actions exist, maximum allowed is ${maxAllowed}.`
    );
    this.name = 'MaxFollowUpActionsExceededError';
    this.reportId = reportId;
    this.maxAllowed = maxAllowed;
    this.currentCount = currentCount;
  }
}

/**
 * Thrown when a follow-up action is not found.
 */
export class FollowUpNotFoundError extends Error {
  public readonly actionId: string;

  constructor(actionId: string) {
    super(`Follow-up action not found: ${actionId}`);
    this.name = 'FollowUpNotFoundError';
    this.actionId = actionId;
  }
}

/**
 * Thrown when attempting to complete an already-completed follow-up action.
 */
export class FollowUpAlreadyCompletedError extends Error {
  public readonly actionId: string;

  constructor(actionId: string) {
    super(`Follow-up action ${actionId} is already completed.`);
    this.name = 'FollowUpAlreadyCompletedError';
    this.actionId = actionId;
  }
}
