/**
 * Registration Service Types
 * Request/response types specific to senior citizen registration.
 */

import type {
  Address,
  EmergencyContact,
  Allergy,
  MedicalHistoryEntry,
  Medication,
  HealthProfile,
  InsurancePolicy,
  AccessibilityPreferences,
} from '@health-checkup/shared';
import { Gender, SupportedLanguage } from '@health-checkup/shared';

/**
 * Request payload for registering a new senior citizen.
 */
export interface RegistrationRequest {
  fullName: string;
  dateOfBirth: Date;
  gender: Gender;
  address: Address;
  phoneNumber: string;
  medicalHistory: MedicalHistoryEntry[];
  currentMedications: Medication[];
  allergies: Allergy[];
  emergencyContacts: EmergencyContact[]; // min 1
  preferredLanguage: SupportedLanguage;
  accessibilityPreferences: AccessibilityPreferences;
  insuranceDetails?: InsuranceDetails;
  /**
   * When true, bypasses duplicate detection and allows registration even if
   * a matching profile exists. Used after the user has reviewed the existing
   * profile and explicitly chosen to proceed.
   *
   * Requirement 1.5: Allow registration after review.
   */
  forceRegister?: boolean;
}

/**
 * Insurance details provided during registration.
 */
export interface InsuranceDetails {
  provider: string;
  policyNumber: string;
  coveragePercentage: number; // 0-100
  maxClaimableAmount: number;
  validUntil: Date;
}

/**
 * Request payload for updating an existing Health Profile.
 */
export interface ProfileUpdateRequest {
  fullName?: string;
  address?: Address;
  phoneNumber?: string;
  medicalHistory?: MedicalHistoryEntry[];
  currentMedications?: Medication[];
  allergies?: Allergy[];
  emergencyContacts?: EmergencyContact[];
  preferredLanguage?: SupportedLanguage;
  accessibilityPreferences?: AccessibilityPreferences;
  insuranceDetails?: InsuranceDetails;
}

/**
 * Result of age validation.
 */
export interface ValidationResult {
  valid: boolean;
  message?: string;
}

/**
 * Result of duplicate check.
 */
export interface DuplicateCheckResult {
  isDuplicate: boolean;
  existingProfile?: HealthProfile;
}

/**
 * Validation error with details about which fields are missing/invalid.
 */
export interface ValidationError {
  valid: false;
  missingFields: string[];
  message: string;
}

/**
 * Successful validation result.
 */
export interface ValidationSuccess {
  valid: true;
}

export type FieldValidationResult = ValidationError | ValidationSuccess;

/**
 * Dependencies injected into the RegistrationService for testability.
 */
export interface RegistrationDependencies {
  idGenerator: () => string;
  dateProvider: () => Date;
  repository: HealthProfileRepository;
  auditService?: AuditServiceInterface;
}

/**
 * Interface for audit service dependency injection.
 * Matches the contract of AuditService.recordEntry().
 */
export interface AuditServiceInterface {
  recordEntry(entry: {
    userId: string;
    action: string;
    resourceType: string;
    resourceId: string;
    details?: Record<string, unknown>;
  }): Promise<{ id: string; userId: string; action: string; resourceType: string; resourceId: string; timestamp: Date; details?: Record<string, unknown> }>;
}

/**
 * Repository interface for Health Profile persistence.
 */
export interface HealthProfileRepository {
  save(profile: HealthProfile): Promise<HealthProfile>;
  findById(id: string): Promise<HealthProfile | null>;
  findByNameAndDob(fullName: string, dateOfBirth: Date): Promise<HealthProfile | null>;
  update(profile: HealthProfile): Promise<HealthProfile>;
}
