/**
 * Payment Processing Errors
 * Custom error types for the payment processing service.
 * Validates: Requirements 10.1, 10.4, 10.6, 10.7
 */

/**
 * Thrown when a payment session is not found.
 */
export class PaymentSessionNotFoundError extends Error {
  public readonly sessionId: string;

  constructor(sessionId: string) {
    super(`Payment session not found: ${sessionId}`);
    this.name = 'PaymentSessionNotFoundError';
    this.sessionId = sessionId;
  }
}

/**
 * Thrown when a payment session has expired.
 * Requirement 10.6: Expire session after 10 minutes of inactivity.
 */
export class PaymentSessionExpiredError extends Error {
  public readonly sessionId: string;

  constructor(sessionId: string) {
    super(`Payment session has expired: ${sessionId}. Please initiate a new payment.`);
    this.name = 'PaymentSessionExpiredError';
    this.sessionId = sessionId;
  }
}

/**
 * Thrown when maximum retry attempts have been exceeded.
 * Requirement 10.4: Max 5 retry attempts per session.
 */
export class MaxRetriesExceededError extends Error {
  public readonly sessionId: string;
  public readonly retryCount: number;
  public readonly maxRetries: number;

  constructor(sessionId: string, retryCount: number, maxRetries: number) {
    super(
      `Maximum retry attempts (${maxRetries}) exceeded for session ${sessionId}. Current attempts: ${retryCount}.`
    );
    this.name = 'MaxRetriesExceededError';
    this.sessionId = sessionId;
    this.retryCount = retryCount;
    this.maxRetries = maxRetries;
  }
}

/**
 * Thrown when payment details fail validation.
 * Requirement 10.2: Validate payment details.
 */
export class PaymentValidationError extends Error {
  public readonly field: string;
  public readonly reason: string;

  constructor(field: string, reason: string) {
    super(`Payment validation failed for '${field}': ${reason}`);
    this.name = 'PaymentValidationError';
    this.field = field;
    this.reason = reason;
  }
}

/**
 * Thrown when payment processing times out.
 * Requirement 10.1: Process within 30 seconds.
 */
export class PaymentTimeoutError extends Error {
  public readonly sessionId: string;
  public readonly timeoutMs: number;

  constructor(sessionId: string, timeoutMs: number) {
    super(`Payment processing timed out after ${timeoutMs}ms for session ${sessionId}.`);
    this.name = 'PaymentTimeoutError';
    this.sessionId = sessionId;
    this.timeoutMs = timeoutMs;
  }
}

/**
 * Thrown when an installment plan cannot be created.
 * Requirement 10.5: Installment plans for Comprehensive packages ≥500.
 */
export class InstallmentPlanError extends Error {
  public readonly reason: string;

  constructor(reason: string) {
    super(`Cannot create installment plan: ${reason}`);
    this.name = 'InstallmentPlanError';
    this.reason = reason;
  }
}

/**
 * Thrown when a session is not in the correct state for an operation.
 */
export class InvalidSessionStateError extends Error {
  public readonly sessionId: string;
  public readonly currentStatus: string;
  public readonly expectedStatus: string;

  constructor(sessionId: string, currentStatus: string, expectedStatus: string) {
    super(
      `Session ${sessionId} is in '${currentStatus}' state but '${expectedStatus}' was expected.`
    );
    this.name = 'InvalidSessionStateError';
    this.sessionId = sessionId;
    this.currentStatus = currentStatus;
    this.expectedStatus = expectedStatus;
  }
}
