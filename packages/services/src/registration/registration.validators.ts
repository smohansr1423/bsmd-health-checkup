/**
 * Registration Validators
 * Validation logic for age eligibility and required fields.
 * Validates: Requirements 1.2, 1.7
 */

import type {
  RegistrationRequest,
  ValidationResult,
  FieldValidationResult,
} from './registration.types';

const MINIMUM_AGE = 60;

/**
 * Validates that the date of birth corresponds to an age of at least 60 years
 * relative to the provided current date.
 *
 * Requirement 1.2: Reject registration if age < 60 based on DOB relative
 * to the current system date.
 */
export function validateAge(
  dateOfBirth: Date,
  currentDate: Date
): ValidationResult {
  const age = calculateAge(dateOfBirth, currentDate);

  if (age < MINIMUM_AGE) {
    return {
      valid: false,
      message: `Registration rejected: minimum age eligibility requirement is ${MINIMUM_AGE} years. Calculated age: ${age}.`,
    };
  }

  return { valid: true };
}

/**
 * Calculates age in full years from date of birth relative to a reference date.
 * Accounts for whether the birthday has occurred yet in the reference year.
 */
export function calculateAge(dateOfBirth: Date, referenceDate: Date): number {
  let age = referenceDate.getFullYear() - dateOfBirth.getFullYear();
  const monthDiff = referenceDate.getMonth() - dateOfBirth.getMonth();

  if (
    monthDiff < 0 ||
    (monthDiff === 0 && referenceDate.getDate() < dateOfBirth.getDate())
  ) {
    age--;
  }

  return age;
}

/**
 * Validates that all required fields are present in the registration request.
 *
 * Requirement 1.7: Reject if any required field (full name, date of birth,
 * gender, phone number, or emergency contact) is missing.
 */
export function validateRequiredFields(
  data: Partial<RegistrationRequest>
): FieldValidationResult {
  const missingFields: string[] = [];

  if (!data.fullName || data.fullName.trim().length === 0) {
    missingFields.push('fullName');
  }

  if (!data.dateOfBirth) {
    missingFields.push('dateOfBirth');
  }

  if (!data.gender) {
    missingFields.push('gender');
  }

  if (!data.phoneNumber || data.phoneNumber.trim().length === 0) {
    missingFields.push('phoneNumber');
  }

  if (!data.emergencyContacts || data.emergencyContacts.length === 0) {
    missingFields.push('emergencyContacts');
  }

  if (missingFields.length > 0) {
    return {
      valid: false,
      missingFields,
      message: `Registration rejected: the following required fields are missing: ${missingFields.join(', ')}.`,
    };
  }

  return { valid: true };
}
