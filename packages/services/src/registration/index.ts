/**
 * Registration Service barrel export
 */
export { RegistrationService, InMemoryHealthProfileRepository } from './registration.service';
export { validateAge, validateRequiredFields, calculateAge } from './registration.validators';
export { DuplicateDetectedError } from './registration.errors';
export type {
  RegistrationRequest,
  ProfileUpdateRequest,
  ValidationResult,
  DuplicateCheckResult,
  ValidationError,
  ValidationSuccess,
  FieldValidationResult,
  RegistrationDependencies,
  HealthProfileRepository,
  InsuranceDetails,
} from './registration.types';
