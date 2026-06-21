/**
 * Registration Errors
 * Custom error types for the registration workflow.
 * Validates: Requirements 1.5
 */

import type { HealthProfile } from '@health-checkup/shared';

/**
 * Thrown when a duplicate registration is detected (matching full name + date of birth).
 *
 * Requirement 1.5: Alert the user with a duplicate warning and display
 * the existing Health_Profile for review before allowing or blocking the registration.
 *
 * Contains the existing profile so the caller can display it for review.
 * After review, the user can either:
 *  - Block registration (do not re-submit)
 *  - Allow registration by re-submitting with `forceRegister: true`
 */
export class DuplicateDetectedError extends Error {
  /** The existing Health Profile matching the submitted name + date of birth. */
  public readonly existingProfile: HealthProfile;

  /** Structured warning message suitable for display to the user. */
  public readonly duplicateWarning: string;

  constructor(existingProfile: HealthProfile) {
    const warning =
      `Duplicate registration detected: a Health Profile already exists for "${existingProfile.fullName}" ` +
      `with date of birth ${existingProfile.dateOfBirth.toISOString().split('T')[0]}. ` +
      `Please review the existing profile (ID: ${existingProfile.id}) before proceeding.`;

    super(warning);
    this.name = 'DuplicateDetectedError';
    this.existingProfile = existingProfile;
    this.duplicateWarning = warning;
  }
}
