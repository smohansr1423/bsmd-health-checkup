/**
 * Physician Assignment Errors
 * Custom error types for physician and specialist assignment workflows.
 * Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5, 4.6
 */

/**
 * Thrown when no physician is available for assignment.
 * Requirement 4.4: Suggest alternatives when preferred physician unavailable.
 */
export class NoPhysicianAvailableError extends Error {
  public readonly specialization: string;

  constructor(specialization: string) {
    super(
      `No physician with specialization "${specialization}" is available within the next 30 days.`
    );
    this.name = 'NoPhysicianAvailableError';
    this.specialization = specialization;
  }
}

/**
 * Thrown when the preferred physician is not available.
 * Requirement 4.4: When preferred physician unavailable, suggest ≥3 alternatives.
 */
export class PreferredPhysicianUnavailableError extends Error {
  public readonly preferredPhysicianId: string;
  public readonly specialization: string;

  constructor(preferredPhysicianId: string, specialization: string) {
    super(
      `Preferred physician "${preferredPhysicianId}" is not available. ` +
      `Alternatives with specialization "${specialization}" have been suggested.`
    );
    this.name = 'PreferredPhysicianUnavailableError';
    this.preferredPhysicianId = preferredPhysicianId;
    this.specialization = specialization;
  }
}

/**
 * Thrown when a specialist is unavailable for a given test category.
 * Requirement 4.5: Notify admin, queue assignment, show earliest date.
 */
export class SpecialistUnavailableError extends Error {
  public readonly specialization: string;
  public readonly sessionId: string;

  constructor(specialization: string, sessionId: string) {
    super(
      `No specialist with specialization "${specialization}" is available for session "${sessionId}". ` +
      `Assignment has been queued and admin notified.`
    );
    this.name = 'SpecialistUnavailableError';
    this.specialization = specialization;
    this.sessionId = sessionId;
  }
}

/**
 * Thrown when a physician is not found.
 */
export class PhysicianNotFoundError extends Error {
  public readonly physicianId: string;

  constructor(physicianId: string) {
    super(`Physician not found: ${physicianId}`);
    this.name = 'PhysicianNotFoundError';
    this.physicianId = physicianId;
  }
}

/**
 * Thrown when a senior citizen ID is invalid.
 */
export class InvalidSeniorIdError extends Error {
  constructor() {
    super('A valid senior citizen ID is required for physician assignment.');
    this.name = 'InvalidSeniorIdError';
  }
}

/**
 * Thrown when a session ID is invalid.
 */
export class InvalidSessionIdError extends Error {
  constructor() {
    super('A valid session ID is required for specialist assignment.');
    this.name = 'InvalidSessionIdError';
  }
}
