/**
 * Critical Alert Service Errors
 * Custom error types for the critical alert escalation state machine.
 * Validates: Requirements 19.1, 19.3, 19.4, 19.5
 */

/**
 * Thrown when a critical alert is not found by ID.
 */
export class CriticalAlertNotFoundError extends Error {
  public readonly alertId: string;

  constructor(alertId: string) {
    super(`Critical alert not found: ${alertId}`);
    this.name = 'CriticalAlertNotFoundError';
    this.alertId = alertId;
  }
}

/**
 * Thrown when attempting to acknowledge an alert that has already been acknowledged.
 */
export class AlertAlreadyAcknowledgedError extends Error {
  public readonly alertId: string;

  constructor(alertId: string) {
    super(`Critical alert has already been acknowledged: ${alertId}`);
    this.name = 'AlertAlreadyAcknowledgedError';
    this.alertId = alertId;
  }
}

/**
 * Thrown when acknowledgement data is incomplete (missing responder or action status).
 */
export class IncompleteAcknowledgementError extends Error {
  public readonly alertId: string;
  public readonly missingFields: string[];

  constructor(alertId: string, missingFields: string[]) {
    super(`Incomplete acknowledgement for alert ${alertId}. Missing: ${missingFields.join(', ')}`);
    this.name = 'IncompleteAcknowledgementError';
    this.alertId = alertId;
    this.missingFields = missingFields;
  }
}

/**
 * Thrown when invalid alert data is provided during creation.
 */
export class InvalidAlertDataError extends Error {
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`Invalid alert data - ${field}: ${message}`);
    this.name = 'InvalidAlertDataError';
    this.field = field;
  }
}
