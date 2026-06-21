/**
 * Registration Service
 * Manages senior citizen registration, health profile CRUD, and duplicate detection.
 * Validates: Requirements 1.1, 1.2, 1.4, 1.6, 1.7
 */

import type { HealthProfile } from '@health-checkup/shared';
import type {
  RegistrationRequest,
  ProfileUpdateRequest,
  ValidationResult,
  DuplicateCheckResult,
  RegistrationDependencies,
  HealthProfileRepository,
  AuditServiceInterface,
} from './registration.types';
import { validateAge, validateRequiredFields } from './registration.validators';
import { DuplicateDetectedError } from './registration.errors';

/**
 * In-memory implementation of HealthProfileRepository.
 * Suitable for development and testing; replace with database-backed
 * implementation for production.
 */
export class InMemoryHealthProfileRepository implements HealthProfileRepository {
  private profiles: HealthProfile[] = [];

  async save(profile: HealthProfile): Promise<HealthProfile> {
    this.profiles.push(profile);
    return profile;
  }

  async findById(id: string): Promise<HealthProfile | null> {
    return this.profiles.find((p) => p.id === id) ?? null;
  }

  async findByNameAndDob(
    fullName: string,
    dateOfBirth: Date
  ): Promise<HealthProfile | null> {
    const normalizedName = fullName.trim().replace(/\s+/g, ' ').toLowerCase();
    return (
      this.profiles.find(
        (p) =>
          p.fullName.trim().replace(/\s+/g, ' ').toLowerCase() === normalizedName &&
          p.dateOfBirth.getFullYear() === dateOfBirth.getFullYear() &&
          p.dateOfBirth.getMonth() === dateOfBirth.getMonth() &&
          p.dateOfBirth.getDate() === dateOfBirth.getDate()
      ) ?? null
    );
  }

  async update(profile: HealthProfile): Promise<HealthProfile> {
    const index = this.profiles.findIndex((p) => p.id === profile.id);
    if (index === -1) {
      throw new Error(`Health profile not found: ${profile.id}`);
    }
    this.profiles[index] = profile;
    return profile;
  }

  /** Utility for testing: clear all stored profiles */
  clear(): void {
    this.profiles = [];
  }
}

/** Default ID generator using timestamp + random suffix */
const defaultIdGenerator = (): string => {
  return `HP_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
};

/** Default date provider returning the current system date */
const defaultDateProvider = (): Date => new Date();

/**
 * RegistrationService implementation.
 *
 * Uses dependency injection for ID generation, date provision, and repository
 * access to support testability.
 */
export class RegistrationService {
  private readonly idGenerator: () => string;
  private readonly dateProvider: () => Date;
  private readonly repository: HealthProfileRepository;
  private readonly auditService?: AuditServiceInterface;

  constructor(deps?: Partial<RegistrationDependencies>) {
    this.idGenerator = deps?.idGenerator ?? defaultIdGenerator;
    this.dateProvider = deps?.dateProvider ?? defaultDateProvider;
    this.repository = deps?.repository ?? new InMemoryHealthProfileRepository();
    this.auditService = deps?.auditService;
  }

  /**
   * Register a new senior citizen and create their Health Profile.
   *
   * Requirement 1.1: Create Health_Profile with all personal details, medical history,
   *   medications, allergies, emergency contacts.
   * Requirement 1.2: Reject if age < 60.
   * Requirement 1.4: Generate unique system identifier.
   * Requirement 1.5: Check for duplicate registration by matching full name and date of birth.
   *   Throws DuplicateDetectedError with existing profile for review unless forceRegister is set.
   * Requirement 1.6: Capture preferred language and accessibility preferences.
   * Requirement 1.7: Reject if required fields missing.
   */
  async registerSeniorCitizen(data: RegistrationRequest): Promise<HealthProfile> {
    // Validate required fields (Req 1.7)
    const fieldValidation = validateRequiredFields(data);
    if (!fieldValidation.valid) {
      throw new Error(fieldValidation.message);
    }

    // Validate age eligibility (Req 1.2)
    const ageValidation = this.validateAge(data.dateOfBirth);
    if (!ageValidation.valid) {
      throw new Error(ageValidation.message);
    }

    // Check for duplicate registration (Req 1.5)
    if (!data.forceRegister) {
      const duplicateCheck = await this.checkDuplicate(data.fullName, data.dateOfBirth);
      if (duplicateCheck.isDuplicate && duplicateCheck.existingProfile) {
        throw new DuplicateDetectedError(duplicateCheck.existingProfile);
      }
    }

    // Generate unique system identifier (Req 1.4)
    const id = this.idGenerator();
    const now = this.dateProvider();

    // Build Health Profile (Req 1.1, 1.6)
    const profile: HealthProfile = {
      id,
      fullName: data.fullName,
      dateOfBirth: data.dateOfBirth,
      gender: data.gender,
      address: data.address,
      phoneNumber: data.phoneNumber,
      medicalHistory: data.medicalHistory,
      currentMedications: data.currentMedications,
      allergies: data.allergies,
      emergencyContacts: data.emergencyContacts,
      preferredLanguage: data.preferredLanguage,
      accessibilityPreferences: data.accessibilityPreferences,
      insuranceDetails: data.insuranceDetails
        ? {
            id: this.idGenerator(),
            seniorId: id,
            provider: data.insuranceDetails.provider,
            policyNumber: data.insuranceDetails.policyNumber,
            coveragePercentage: data.insuranceDetails.coveragePercentage,
            maxClaimableAmount: data.insuranceDetails.maxClaimableAmount,
            validUntil: data.insuranceDetails.validUntil,
          }
        : undefined,
      createdAt: now,
      updatedAt: now,
    };

    return this.repository.save(profile);
  }

  /**
   * Update an existing Health Profile.
   * Records the modification timestamp and the identity of the user
   * in an immutable audit trail entry.
   *
   * Requirement 1.3: Record modification timestamp and user identity in audit trail.
   * Requirement 18.3: Record all data modification events with immutable entries.
   */
  async updateHealthProfile(
    id: string,
    data: ProfileUpdateRequest,
    userId: string
  ): Promise<HealthProfile> {
    const existing = await this.repository.findById(id);
    if (!existing) {
      throw new Error(`Health profile not found: ${id}`);
    }

    const now = this.dateProvider();

    // Determine which fields are being changed for audit details
    const changedFields: Record<string, { old: unknown; new: unknown }> = {};
    for (const key of Object.keys(data) as Array<keyof ProfileUpdateRequest>) {
      if (data[key] !== undefined) {
        changedFields[key] = {
          old: existing[key as keyof typeof existing],
          new: data[key],
        };
      }
    }

    const updated: HealthProfile = {
      ...existing,
      ...(data.fullName !== undefined && { fullName: data.fullName }),
      ...(data.address !== undefined && { address: data.address }),
      ...(data.phoneNumber !== undefined && { phoneNumber: data.phoneNumber }),
      ...(data.medicalHistory !== undefined && { medicalHistory: data.medicalHistory }),
      ...(data.currentMedications !== undefined && { currentMedications: data.currentMedications }),
      ...(data.allergies !== undefined && { allergies: data.allergies }),
      ...(data.emergencyContacts !== undefined && { emergencyContacts: data.emergencyContacts }),
      ...(data.preferredLanguage !== undefined && { preferredLanguage: data.preferredLanguage }),
      ...(data.accessibilityPreferences !== undefined && {
        accessibilityPreferences: data.accessibilityPreferences,
      }),
      ...(data.insuranceDetails !== undefined && {
        insuranceDetails: {
          id: existing.insuranceDetails?.id ?? this.idGenerator(),
          seniorId: id,
          provider: data.insuranceDetails.provider,
          policyNumber: data.insuranceDetails.policyNumber,
          coveragePercentage: data.insuranceDetails.coveragePercentage,
          maxClaimableAmount: data.insuranceDetails.maxClaimableAmount,
          validUntil: data.insuranceDetails.validUntil,
        },
      }),
      updatedAt: now,
    };

    const result = await this.repository.update(updated);

    // Record immutable audit entry (Req 1.3, 18.3)
    if (this.auditService) {
      await this.auditService.recordEntry({
        userId,
        action: 'health_profile_updated',
        resourceType: 'health_profile',
        resourceId: id,
        details: {
          modifiedAt: now.toISOString(),
          changedFields,
        },
      });
    }

    return result;
  }

  /**
   * Retrieve a Health Profile by its unique system identifier.
   */
  async getHealthProfile(id: string): Promise<HealthProfile> {
    const profile = await this.repository.findById(id);
    if (!profile) {
      throw new Error(`Health profile not found: ${id}`);
    }
    return profile;
  }

  /**
   * Check for duplicate registration by matching full name and date of birth.
   *
   * Name matching is case-insensitive and whitespace-normalized (leading/trailing
   * whitespace stripped, consecutive spaces collapsed to single space).
   *
   * Requirement 1.5: Alert the user with a duplicate warning and display
   * the existing Health_Profile for review before allowing or blocking the registration.
   *
   * @returns DuplicateCheckResult with isDuplicate=true and the existing profile
   *   when a match is found, allowing the caller to display it for review.
   */
  async checkDuplicate(
    fullName: string,
    dateOfBirth: Date
  ): Promise<DuplicateCheckResult> {
    const normalizedName = fullName.trim().replace(/\s+/g, ' ');
    const existing = await this.repository.findByNameAndDob(normalizedName, dateOfBirth);

    if (existing) {
      return { isDuplicate: true, existingProfile: existing };
    }

    return { isDuplicate: false };
  }

  /**
   * Validate that the date of birth corresponds to age ≥ 60.
   *
   * Requirement 1.2: Reject if age < 60 based on DOB relative to current system date.
   */
  validateAge(dateOfBirth: Date): ValidationResult {
    const currentDate = this.dateProvider();
    return validateAge(dateOfBirth, currentDate);
  }
}
