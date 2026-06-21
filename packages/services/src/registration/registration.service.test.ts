// @ts-nocheck
/**
 * Unit tests for Registration Service
 * Validates: Requirements 1.1, 1.2, 1.4, 1.5, 1.6, 1.7
 */

import { Gender, SupportedLanguage } from '@health-checkup/shared';
import {
  RegistrationService,
  InMemoryHealthProfileRepository,
} from './registration.service';
import { validateAge, validateRequiredFields, calculateAge } from './registration.validators';
import type { RegistrationRequest } from './registration.types';

/** Helper to create a valid registration request */
function createValidRequest(overrides?: Partial<RegistrationRequest>): RegistrationRequest {
  return {
    fullName: 'John Doe',
    dateOfBirth: new Date('1950-05-15'),
    gender: Gender.Male,
    address: {
      street: '123 Main St',
      city: 'Springfield',
      state: 'IL',
      postalCode: '62701',
      country: 'US',
    },
    phoneNumber: '+1-555-0100',
    medicalHistory: [
      { condition: 'Hypertension', status: 'active' },
    ],
    currentMedications: [
      { name: 'Lisinopril', dosage: '10mg', frequency: 'daily', startDate: new Date('2020-01-01') },
    ],
    allergies: [
      { substance: 'Penicillin', severity: 'moderate' },
    ],
    emergencyContacts: [
      { name: 'Jane Doe', relationship: 'Spouse', phoneNumber: '+1-555-0101' },
    ],
    preferredLanguage: SupportedLanguage.English,
    accessibilityPreferences: {
      textSize: 'large',
      contrastMode: 'default',
      voiceAssistance: false,
      largeButtonMode: false,
      simplifiedNavigation: false,
    },
    ...overrides,
  };
}

describe('RegistrationService', () => {
  let service: RegistrationService;
  let idCounter: number;
  const fixedDate = new Date('2024-06-15');

  beforeEach(() => {
    idCounter = 0;
    service = new RegistrationService({
      idGenerator: () => `HP_${++idCounter}`,
      dateProvider: () => fixedDate,
      repository: new InMemoryHealthProfileRepository(),
    });
  });

  describe('registerSeniorCitizen (Req 1.1, 1.4, 1.6)', () => {
    it('should create a Health Profile with all personal details', async () => {
      const request = createValidRequest();
      const profile = await service.registerSeniorCitizen(request);

      expect(profile.fullName).toBe('John Doe');
      expect(profile.dateOfBirth).toEqual(new Date('1950-05-15'));
      expect(profile.gender).toBe(Gender.Male);
      expect(profile.address.city).toBe('Springfield');
      expect(profile.phoneNumber).toBe('+1-555-0100');
    });

    it('should store medical history, medications, and allergies', async () => {
      const request = createValidRequest();
      const profile = await service.registerSeniorCitizen(request);

      expect(profile.medicalHistory).toHaveLength(1);
      expect(profile.medicalHistory[0].condition).toBe('Hypertension');
      expect(profile.currentMedications).toHaveLength(1);
      expect(profile.currentMedications[0].name).toBe('Lisinopril');
      expect(profile.allergies).toHaveLength(1);
      expect(profile.allergies[0].substance).toBe('Penicillin');
    });

    it('should store emergency contacts', async () => {
      const request = createValidRequest();
      const profile = await service.registerSeniorCitizen(request);

      expect(profile.emergencyContacts).toHaveLength(1);
      expect(profile.emergencyContacts[0].name).toBe('Jane Doe');
      expect(profile.emergencyContacts[0].relationship).toBe('Spouse');
    });

    it('should generate a unique system identifier (Req 1.4)', async () => {
      const request = createValidRequest();
      const profile1 = await service.registerSeniorCitizen(request);
      const profile2 = await service.registerSeniorCitizen(
        createValidRequest({ fullName: 'Another Person', dateOfBirth: new Date('1955-01-01') })
      );

      expect(profile1.id).toBe('HP_1');
      expect(profile2.id).toBe('HP_2');
      expect(profile1.id).not.toBe(profile2.id);
    });

    it('should capture preferred language and accessibility preferences (Req 1.6)', async () => {
      const request = createValidRequest({
        preferredLanguage: SupportedLanguage.Hindi,
        accessibilityPreferences: {
          textSize: 'extra_large',
          contrastMode: 'high_contrast_dark',
          voiceAssistance: true,
          largeButtonMode: true,
          simplifiedNavigation: true,
        },
      });
      const profile = await service.registerSeniorCitizen(request);

      expect(profile.preferredLanguage).toBe(SupportedLanguage.Hindi);
      expect(profile.accessibilityPreferences.textSize).toBe('extra_large');
      expect(profile.accessibilityPreferences.contrastMode).toBe('high_contrast_dark');
      expect(profile.accessibilityPreferences.voiceAssistance).toBe(true);
      expect(profile.accessibilityPreferences.largeButtonMode).toBe(true);
    });

    it('should set createdAt and updatedAt timestamps', async () => {
      const request = createValidRequest();
      const profile = await service.registerSeniorCitizen(request);

      expect(profile.createdAt).toEqual(fixedDate);
      expect(profile.updatedAt).toEqual(fixedDate);
    });

    it('should store insurance details when provided', async () => {
      const request = createValidRequest({
        insuranceDetails: {
          provider: 'Medicare',
          policyNumber: 'POL-12345',
          coveragePercentage: 80,
          maxClaimableAmount: 50000,
          validUntil: new Date('2025-12-31'),
        },
      });
      const profile = await service.registerSeniorCitizen(request);

      expect(profile.insuranceDetails).toBeDefined();
      expect(profile.insuranceDetails!.provider).toBe('Medicare');
      expect(profile.insuranceDetails!.policyNumber).toBe('POL-12345');
      expect(profile.insuranceDetails!.coveragePercentage).toBe(80);
      expect(profile.insuranceDetails!.seniorId).toBe(profile.id);
    });
  });

  describe('validateAge (Req 1.2)', () => {
    it('should accept age exactly 60', async () => {
      // Born June 15, 1964 → exactly 60 on June 15, 2024
      const request = createValidRequest({ dateOfBirth: new Date('1964-06-15') });
      const profile = await service.registerSeniorCitizen(request);
      expect(profile).toBeDefined();
    });

    it('should reject age below 60', async () => {
      // Born June 16, 1964 → age 59 on June 15, 2024
      const request = createValidRequest({ dateOfBirth: new Date('1964-06-16') });
      await expect(service.registerSeniorCitizen(request)).rejects.toThrow(
        /minimum age eligibility requirement/
      );
    });

    it('should accept age well above 60', async () => {
      const request = createValidRequest({ dateOfBirth: new Date('1940-01-01') });
      const profile = await service.registerSeniorCitizen(request);
      expect(profile).toBeDefined();
    });

    it('validateAge method returns correct result for valid age', () => {
      const result = service.validateAge(new Date('1950-01-01'));
      expect(result.valid).toBe(true);
      expect(result.message).toBeUndefined();
    });

    it('validateAge method returns correct result for invalid age', () => {
      const result = service.validateAge(new Date('1970-01-01'));
      expect(result.valid).toBe(false);
      expect(result.message).toContain('minimum age eligibility requirement');
    });
  });

  describe('required field validation (Req 1.7)', () => {
    it('should reject when fullName is missing', async () => {
      const request = createValidRequest({ fullName: '' });
      await expect(service.registerSeniorCitizen(request)).rejects.toThrow(/fullName/);
    });

    it('should reject when dateOfBirth is missing', async () => {
      const request = createValidRequest({ dateOfBirth: undefined as unknown as Date });
      await expect(service.registerSeniorCitizen(request)).rejects.toThrow(/dateOfBirth/);
    });

    it('should reject when gender is missing', async () => {
      const request = createValidRequest({ gender: '' as Gender });
      await expect(service.registerSeniorCitizen(request)).rejects.toThrow(/gender/);
    });

    it('should reject when phoneNumber is missing', async () => {
      const request = createValidRequest({ phoneNumber: '' });
      await expect(service.registerSeniorCitizen(request)).rejects.toThrow(/phoneNumber/);
    });

    it('should reject when emergencyContacts is empty', async () => {
      const request = createValidRequest({ emergencyContacts: [] });
      await expect(service.registerSeniorCitizen(request)).rejects.toThrow(/emergencyContacts/);
    });

    it('should indicate all missing fields in the error message', async () => {
      const request = {
        fullName: '',
        dateOfBirth: undefined as unknown as Date,
        gender: '' as Gender,
        phoneNumber: '',
        emergencyContacts: [],
        address: { street: '', city: '', state: '', postalCode: '', country: '' },
        medicalHistory: [],
        currentMedications: [],
        allergies: [],
        preferredLanguage: SupportedLanguage.English,
        accessibilityPreferences: {
          textSize: 'normal' as const,
          contrastMode: 'default' as const,
          voiceAssistance: false,
          largeButtonMode: false,
          simplifiedNavigation: false,
        },
      };
      await expect(service.registerSeniorCitizen(request)).rejects.toThrow(
        /fullName.*dateOfBirth.*gender.*phoneNumber.*emergencyContacts/
      );
    });
  });

  describe('checkDuplicate (Req 1.5)', () => {
    it('should detect duplicate by matching name and date of birth', async () => {
      const request = createValidRequest();
      await service.registerSeniorCitizen(request);

      const result = await service.checkDuplicate('John Doe', new Date('1950-05-15'));
      expect(result.isDuplicate).toBe(true);
      expect(result.existingProfile).toBeDefined();
      expect(result.existingProfile!.fullName).toBe('John Doe');
    });

    it('should be case-insensitive for name matching', async () => {
      const request = createValidRequest();
      await service.registerSeniorCitizen(request);

      const result = await service.checkDuplicate('john doe', new Date('1950-05-15'));
      expect(result.isDuplicate).toBe(true);
    });

    it('should return no duplicate when no match found', async () => {
      const request = createValidRequest();
      await service.registerSeniorCitizen(request);

      const result = await service.checkDuplicate('Unknown Person', new Date('1950-05-15'));
      expect(result.isDuplicate).toBe(false);
      expect(result.existingProfile).toBeUndefined();
    });

    it('should not detect duplicate when only name matches', async () => {
      const request = createValidRequest();
      await service.registerSeniorCitizen(request);

      const result = await service.checkDuplicate('John Doe', new Date('1951-01-01'));
      expect(result.isDuplicate).toBe(false);
    });

    it('should normalize whitespace in names for matching', async () => {
      const request = createValidRequest({ fullName: 'John  Doe' });
      await service.registerSeniorCitizen(request);

      const result = await service.checkDuplicate('John Doe', new Date('1950-05-15'));
      expect(result.isDuplicate).toBe(true);
      expect(result.existingProfile).toBeDefined();
    });

    it('should trim leading/trailing whitespace for matching', async () => {
      const request = createValidRequest();
      await service.registerSeniorCitizen(request);

      const result = await service.checkDuplicate('  John Doe  ', new Date('1950-05-15'));
      expect(result.isDuplicate).toBe(true);
    });

    it('should return existing profile with all details for review', async () => {
      const request = createValidRequest();
      const created = await service.registerSeniorCitizen(request);

      const result = await service.checkDuplicate('John Doe', new Date('1950-05-15'));
      expect(result.isDuplicate).toBe(true);
      expect(result.existingProfile!.id).toBe(created.id);
      expect(result.existingProfile!.phoneNumber).toBe('+1-555-0100');
      expect(result.existingProfile!.emergencyContacts).toHaveLength(1);
      expect(result.existingProfile!.medicalHistory).toHaveLength(1);
    });

    it('should throw DuplicateDetectedError during registration when duplicate exists', async () => {
      const request = createValidRequest();
      await service.registerSeniorCitizen(request);

      try {
        await service.registerSeniorCitizen(createValidRequest());
        fail('Expected DuplicateDetectedError');
      } catch (error: any) {
        expect(error.name).toBe('DuplicateDetectedError');
        expect(error.existingProfile).toBeDefined();
        expect(error.existingProfile.fullName).toBe('John Doe');
        expect(error.duplicateWarning).toContain('Duplicate registration detected');
        expect(error.duplicateWarning).toContain('John Doe');
      }
    });

    it('should allow registration with forceRegister after duplicate review', async () => {
      const request = createValidRequest();
      await service.registerSeniorCitizen(request);

      const forceRequest = createValidRequest({ forceRegister: true });
      const profile = await service.registerSeniorCitizen(forceRequest);
      expect(profile).toBeDefined();
      expect(profile.fullName).toBe('John Doe');
    });

    it('should not detect duplicate when only date of birth matches', async () => {
      const request = createValidRequest();
      await service.registerSeniorCitizen(request);

      const result = await service.checkDuplicate('Different Person', new Date('1950-05-15'));
      expect(result.isDuplicate).toBe(false);
    });
  });

  describe('getHealthProfile', () => {
    it('should retrieve an existing profile by ID', async () => {
      const request = createValidRequest();
      const created = await service.registerSeniorCitizen(request);

      const retrieved = await service.getHealthProfile(created.id);
      expect(retrieved.id).toBe(created.id);
      expect(retrieved.fullName).toBe('John Doe');
    });

    it('should throw when profile not found', async () => {
      await expect(service.getHealthProfile('nonexistent')).rejects.toThrow(
        /Health profile not found/
      );
    });
  });

  describe('updateHealthProfile (Req 1.3, 18.3)', () => {
    it('should update fields and set new updatedAt timestamp', async () => {
      const request = createValidRequest();
      const created = await service.registerSeniorCitizen(request);

      const laterDate = new Date('2024-07-01');
      const serviceWithLaterDate = new RegistrationService({
        idGenerator: () => `HP_${++idCounter}`,
        dateProvider: () => laterDate,
        repository: (service as any).repository,
      });

      const updated = await serviceWithLaterDate.updateHealthProfile(
        created.id,
        { phoneNumber: '+1-555-9999' },
        'admin-1'
      );

      expect(updated.phoneNumber).toBe('+1-555-9999');
      expect(updated.updatedAt).toEqual(laterDate);
      expect(updated.fullName).toBe('John Doe'); // unchanged field
    });

    it('should throw when profile does not exist', async () => {
      await expect(
        service.updateHealthProfile('nonexistent', { phoneNumber: '555' }, 'admin')
      ).rejects.toThrow(/Health profile not found/);
    });

    it('should record an audit entry with modification timestamp and user identity', async () => {
      const auditEntries: Array<{
        userId: string;
        action: string;
        resourceType: string;
        resourceId: string;
        details?: Record<string, unknown>;
      }> = [];

      const mockAuditService: any = {
        recordEntry: jest.fn(async (entry: any) => {
          const recorded = {
            id: `audit_${auditEntries.length + 1}`,
            ...entry,
            timestamp: new Date(),
          };
          auditEntries.push(entry);
          return recorded;
        }),
      };

      const laterDate = new Date('2024-07-15T10:30:00Z');
      const serviceWithAudit = new RegistrationService({
        idGenerator: () => `HP_${++idCounter}`,
        dateProvider: () => laterDate,
        repository: (service as any).repository,
        auditService: mockAuditService,
      });

      const request = createValidRequest();
      const created = await service.registerSeniorCitizen(request);

      await serviceWithAudit.updateHealthProfile(
        created.id,
        { phoneNumber: '+1-555-8888' },
        'admin-42'
      );

      expect(mockAuditService.recordEntry).toHaveBeenCalledTimes(1);
      const auditCall = mockAuditService.recordEntry.mock.calls[0][0];
      expect(auditCall.userId).toBe('admin-42');
      expect(auditCall.action).toBe('health_profile_updated');
      expect(auditCall.resourceType).toBe('health_profile');
      expect(auditCall.resourceId).toBe(created.id);
      expect(auditCall.details).toBeDefined();
      expect(auditCall.details.modifiedAt).toBe(laterDate.toISOString());
    });

    it('should include changed fields in the audit entry details', async () => {
      const mockAuditService: any = {
        recordEntry: jest.fn(async (entry: any) => ({
          id: 'audit_1',
          ...entry,
          timestamp: new Date(),
        })),
      };

      const laterDate = new Date('2024-08-01');
      const serviceWithAudit = new RegistrationService({
        idGenerator: () => `HP_${++idCounter}`,
        dateProvider: () => laterDate,
        repository: (service as any).repository,
        auditService: mockAuditService,
      });

      const request = createValidRequest();
      const created = await service.registerSeniorCitizen(request);

      await serviceWithAudit.updateHealthProfile(
        created.id,
        { phoneNumber: '+1-555-7777', preferredLanguage: SupportedLanguage.Spanish },
        'nurse-1'
      );

      const auditCall = mockAuditService.recordEntry.mock.calls[0][0];
      const changedFields = auditCall.details.changedFields;
      expect(changedFields.phoneNumber).toBeDefined();
      expect(changedFields.phoneNumber.old).toBe('+1-555-0100');
      expect(changedFields.phoneNumber.new).toBe('+1-555-7777');
      expect(changedFields.preferredLanguage).toBeDefined();
      expect(changedFields.preferredLanguage.old).toBe(SupportedLanguage.English);
      expect(changedFields.preferredLanguage.new).toBe(SupportedLanguage.Spanish);
    });

    it('should create an audit entry for each update (multiple updates produce multiple entries)', async () => {
      const mockAuditService: any = {
        recordEntry: jest.fn(async (entry: any) => ({
          id: `audit_${mockAuditService.recordEntry.mock.calls.length}`,
          ...entry,
          timestamp: new Date(),
        })),
      };

      const laterDate = new Date('2024-09-01');
      const serviceWithAudit = new RegistrationService({
        idGenerator: () => `HP_${++idCounter}`,
        dateProvider: () => laterDate,
        repository: (service as any).repository,
        auditService: mockAuditService,
      });

      const request = createValidRequest();
      const created = await service.registerSeniorCitizen(request);

      await serviceWithAudit.updateHealthProfile(
        created.id,
        { phoneNumber: '+1-555-1111' },
        'admin-1'
      );
      await serviceWithAudit.updateHealthProfile(
        created.id,
        { phoneNumber: '+1-555-2222' },
        'admin-2'
      );

      expect(mockAuditService.recordEntry).toHaveBeenCalledTimes(2);
      // First audit tracks user admin-1
      expect(mockAuditService.recordEntry.mock.calls[0][0].userId).toBe('admin-1');
      // Second audit tracks user admin-2
      expect(mockAuditService.recordEntry.mock.calls[1][0].userId).toBe('admin-2');
    });

    it('should update the profile even when audit service is not configured', async () => {
      // No audit service provided → should still update successfully
      const request = createValidRequest();
      const created = await service.registerSeniorCitizen(request);

      const updated = await service.updateHealthProfile(
        created.id,
        { phoneNumber: '+1-555-0000' },
        'admin-1'
      );

      expect(updated.phoneNumber).toBe('+1-555-0000');
    });

    it('should update multiple fields simultaneously', async () => {
      const request = createValidRequest();
      const created = await service.registerSeniorCitizen(request);

      const newAllergies = [
        { substance: 'Aspirin', severity: 'severe' as const },
      ];
      const newMedications = [
        { name: 'Metformin', dosage: '500mg', frequency: 'twice daily', startDate: new Date('2024-01-01') },
      ];

      const updated = await service.updateHealthProfile(
        created.id,
        {
          allergies: newAllergies,
          currentMedications: newMedications,
          phoneNumber: '+1-555-3333',
        },
        'doctor-5'
      );

      expect(updated.allergies).toEqual(newAllergies);
      expect(updated.currentMedications).toEqual(newMedications);
      expect(updated.phoneNumber).toBe('+1-555-3333');
      // Unchanged fields preserved
      expect(updated.fullName).toBe('John Doe');
      expect(updated.gender).toBe(Gender.Male);
    });

    it('should preserve the original profile id and createdAt after update', async () => {
      const request = createValidRequest();
      const created = await service.registerSeniorCitizen(request);

      const laterDate = new Date('2024-10-01');
      const serviceWithLaterDate = new RegistrationService({
        idGenerator: () => `HP_${++idCounter}`,
        dateProvider: () => laterDate,
        repository: (service as any).repository,
      });

      const updated = await serviceWithLaterDate.updateHealthProfile(
        created.id,
        { phoneNumber: '+1-555-4444' },
        'admin-1'
      );

      expect(updated.id).toBe(created.id);
      expect(updated.createdAt).toEqual(created.createdAt);
      expect(updated.updatedAt).toEqual(laterDate);
    });
  });
});

describe('validateAge (standalone)', () => {
  it('should return valid for age exactly 60', () => {
    const result = validateAge(new Date('1964-03-15'), new Date('2024-03-15'));
    expect(result.valid).toBe(true);
  });

  it('should return invalid for age 59 (birthday not yet passed)', () => {
    const result = validateAge(new Date('1964-03-16'), new Date('2024-03-15'));
    expect(result.valid).toBe(false);
    expect(result.message).toContain('59');
  });

  it('should return valid for age 90', () => {
    const result = validateAge(new Date('1934-01-01'), new Date('2024-06-15'));
    expect(result.valid).toBe(true);
  });
});

describe('calculateAge', () => {
  it('should calculate age correctly when birthday has passed', () => {
    expect(calculateAge(new Date('1950-01-01'), new Date('2024-06-15'))).toBe(74);
  });

  it('should calculate age correctly when birthday has not passed', () => {
    expect(calculateAge(new Date('1950-12-25'), new Date('2024-06-15'))).toBe(73);
  });

  it('should handle same day birthday', () => {
    expect(calculateAge(new Date('1964-06-15'), new Date('2024-06-15'))).toBe(60);
  });

  it('should handle day before birthday', () => {
    expect(calculateAge(new Date('1964-06-16'), new Date('2024-06-15'))).toBe(59);
  });
});

describe('validateRequiredFields', () => {
  it('should pass when all required fields are present', () => {
    const result = validateRequiredFields(createValidRequest());
    expect(result.valid).toBe(true);
  });

  it('should report multiple missing fields', () => {
    const result = validateRequiredFields({});
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.missingFields).toContain('fullName');
      expect(result.missingFields).toContain('dateOfBirth');
      expect(result.missingFields).toContain('gender');
      expect(result.missingFields).toContain('phoneNumber');
      expect(result.missingFields).toContain('emergencyContacts');
    }
  });

  it('should treat whitespace-only fullName as missing', () => {
    const result = validateRequiredFields(createValidRequest({ fullName: '   ' }));
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.missingFields).toContain('fullName');
    }
  });
});
