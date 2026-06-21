/**
 * Unit tests for Allergy/Contraindication Conflict Detection
 * Validates: Requirements 2.3, 2.4
 */

import { TestCategory } from '@health-checkup/shared';
import type { PackageTest, Allergy } from '@health-checkup/shared';
import { AllergyConflictDetector } from './allergy-conflict-detector';
import {
  CheckupPackageService,
  InMemoryCheckupPackageRepository,
  InMemoryCheckupSessionRepository,
} from './checkup-package.service';
import { InvalidTestCountError, PackageNotFoundError } from './checkup-package.errors';
import type { CreatePackageRequest } from './checkup-package.types';

/** Helper to create a PackageTest with optional overrides */
function createTestItem(overrides?: Partial<PackageTest>): PackageTest {
  return {
    testType: 'blood_sugar',
    name: 'Blood Sugar (Fasting)',
    category: TestCategory.Blood,
    cost: 30,
    contraindications: [],
    plausibleRange: { min: 40, max: 500 },
    unit: 'mg/dL',
    ...overrides,
  };
}

/** Helper to create an Allergy with optional overrides */
function createAllergy(overrides?: Partial<Allergy>): Allergy {
  return {
    substance: 'penicillin',
    severity: 'moderate',
    ...overrides,
  };
}

describe('AllergyConflictDetector', () => {
  let detector: AllergyConflictDetector;

  beforeEach(() => {
    detector = new AllergyConflictDetector();
  });

  describe('detectConflicts', () => {
    it('should detect conflicts when allergies match contraindications', () => {
      const tests: PackageTest[] = [
        createTestItem({
          testType: 'cardiac_stress_test',
          name: 'Cardiac Stress Test',
          contraindications: ['unstable_angina', 'severe_heart_failure'],
        }),
      ];
      const allergies: Allergy[] = [
        createAllergy({ substance: 'unstable_angina', severity: 'severe' }),
      ];

      const result = detector.detectConflicts(tests, allergies);

      expect(result.hasConflicts).toBe(true);
      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0].testType).toBe('cardiac_stress_test');
      expect(result.conflicts[0].testName).toBe('Cardiac Stress Test');
      expect(result.conflicts[0].conflictingAllergies).toContain('unstable_angina');
    });

    it('should perform case-insensitive matching', () => {
      const tests: PackageTest[] = [
        createTestItem({
          testType: 'ecg',
          name: 'ECG',
          contraindications: ['Pacemaker_Incompatible'],
        }),
      ];
      const allergies: Allergy[] = [
        createAllergy({ substance: 'pacemaker_incompatible' }),
      ];

      const result = detector.detectConflicts(tests, allergies);

      expect(result.hasConflicts).toBe(true);
      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0].conflictingAllergies).toContain('pacemaker_incompatible');
    });

    it('should perform case-insensitive matching with uppercase allergy', () => {
      const tests: PackageTest[] = [
        createTestItem({
          testType: 'chest_xray',
          name: 'Chest X-Ray',
          contraindications: ['pregnancy'],
        }),
      ];
      const allergies: Allergy[] = [
        createAllergy({ substance: 'PREGNANCY' }),
      ];

      const result = detector.detectConflicts(tests, allergies);

      expect(result.hasConflicts).toBe(true);
      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0].conflictingAllergies).toContain('PREGNANCY');
    });

    it('should return no conflicts when allergies do not match any contraindications', () => {
      const tests: PackageTest[] = [
        createTestItem({
          testType: 'ecg',
          name: 'ECG',
          contraindications: ['pacemaker_incompatible'],
        }),
        createTestItem({
          testType: 'chest_xray',
          name: 'Chest X-Ray',
          contraindications: ['pregnancy'],
        }),
      ];
      const allergies: Allergy[] = [
        createAllergy({ substance: 'penicillin' }),
        createAllergy({ substance: 'latex' }),
      ];

      const result = detector.detectConflicts(tests, allergies);

      expect(result.hasConflicts).toBe(false);
      expect(result.conflicts).toHaveLength(0);
      expect(result.safeTests).toHaveLength(2);
    });

    it('should detect multiple tests conflicting with the same allergy', () => {
      const tests: PackageTest[] = [
        createTestItem({
          testType: 'ct_scan',
          name: 'CT Scan',
          contraindications: ['iodine_contrast'],
        }),
        createTestItem({
          testType: 'angiography',
          name: 'Angiography',
          contraindications: ['iodine_contrast'],
        }),
        createTestItem({
          testType: 'blood_test',
          name: 'Blood Test',
          contraindications: [],
        }),
      ];
      const allergies: Allergy[] = [
        createAllergy({ substance: 'iodine_contrast', severity: 'severe' }),
      ];

      const result = detector.detectConflicts(tests, allergies);

      expect(result.hasConflicts).toBe(true);
      expect(result.conflicts).toHaveLength(2);
      expect(result.conflicts[0].testType).toBe('ct_scan');
      expect(result.conflicts[1].testType).toBe('angiography');
      expect(result.safeTests).toHaveLength(1);
      expect(result.safeTests[0].testType).toBe('blood_test');
    });

    it('should never conflict when package has no contraindications', () => {
      const tests: PackageTest[] = [
        createTestItem({ testType: 'blood_sugar', contraindications: [] }),
        createTestItem({ testType: 'lipid_profile', name: 'Lipid Profile', contraindications: [] }),
        createTestItem({ testType: 'urine_analysis', name: 'Urine Analysis', contraindications: [] }),
      ];
      const allergies: Allergy[] = [
        createAllergy({ substance: 'penicillin' }),
        createAllergy({ substance: 'latex' }),
        createAllergy({ substance: 'iodine' }),
      ];

      const result = detector.detectConflicts(tests, allergies);

      expect(result.hasConflicts).toBe(false);
      expect(result.conflicts).toHaveLength(0);
      expect(result.safeTests).toHaveLength(3);
    });

    it('should return no conflicts when senior has no allergies', () => {
      const tests: PackageTest[] = [
        createTestItem({
          testType: 'cardiac_stress_test',
          name: 'Cardiac Stress Test',
          contraindications: ['unstable_angina', 'severe_heart_failure'],
        }),
      ];
      const allergies: Allergy[] = [];

      const result = detector.detectConflicts(tests, allergies);

      expect(result.hasConflicts).toBe(false);
      expect(result.conflicts).toHaveLength(0);
      expect(result.safeTests).toHaveLength(1);
    });

    it('should report all matching allergies for a single test with multiple contraindications', () => {
      const tests: PackageTest[] = [
        createTestItem({
          testType: 'contrast_mri',
          name: 'Contrast MRI',
          contraindications: ['gadolinium', 'severe_kidney_disease'],
        }),
      ];
      const allergies: Allergy[] = [
        createAllergy({ substance: 'gadolinium', severity: 'severe' }),
        createAllergy({ substance: 'severe_kidney_disease', severity: 'moderate' }),
      ];

      const result = detector.detectConflicts(tests, allergies);

      expect(result.hasConflicts).toBe(true);
      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0].conflictingAllergies).toHaveLength(2);
      expect(result.conflicts[0].conflictingAllergies).toContain('gadolinium');
      expect(result.conflicts[0].conflictingAllergies).toContain('severe_kidney_disease');
    });

    it('should correctly separate safe and conflicting tests', () => {
      const tests: PackageTest[] = [
        createTestItem({ testType: 'blood_sugar', name: 'Blood Sugar', contraindications: [] }),
        createTestItem({
          testType: 'ecg',
          name: 'ECG',
          contraindications: ['pacemaker_incompatible'],
        }),
        createTestItem({ testType: 'vitals', name: 'Vitals', contraindications: [] }),
        createTestItem({
          testType: 'chest_xray',
          name: 'Chest X-Ray',
          contraindications: ['pregnancy'],
        }),
      ];
      const allergies: Allergy[] = [
        createAllergy({ substance: 'pacemaker_incompatible' }),
      ];

      const result = detector.detectConflicts(tests, allergies);

      expect(result.hasConflicts).toBe(true);
      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0].testType).toBe('ecg');
      expect(result.safeTests).toHaveLength(3);
      expect(result.safeTests.map((t) => t.testType)).toEqual(['blood_sugar', 'vitals', 'chest_xray']);
    });

    it('should handle whitespace-trimmed matching', () => {
      const tests: PackageTest[] = [
        createTestItem({
          testType: 'ecg',
          name: 'ECG',
          contraindications: ['  pacemaker_incompatible  '],
        }),
      ];
      const allergies: Allergy[] = [
        createAllergy({ substance: 'pacemaker_incompatible' }),
      ];

      const result = detector.detectConflicts(tests, allergies);

      expect(result.hasConflicts).toBe(true);
      expect(result.conflicts).toHaveLength(1);
    });
  });
});

describe('CheckupPackageService - Conflict Detection (Req 2.3, 2.4)', () => {
  let service: CheckupPackageService;
  let packageRepository: InMemoryCheckupPackageRepository;
  let sessionRepository: InMemoryCheckupSessionRepository;
  let idCounter: number;
  const fixedDate = new Date('2024-06-15');

  beforeEach(() => {
    idCounter = 0;
    packageRepository = new InMemoryCheckupPackageRepository();
    sessionRepository = new InMemoryCheckupSessionRepository();
    service = new CheckupPackageService({
      idGenerator: () => `PKG_${++idCounter}`,
      dateProvider: () => fixedDate,
      packageRepository,
      sessionRepository,
    });
  });

  /** Helper to create a package with specific tests */
  async function createPackageWithTests(tests: PackageTest[]) {
    return service.createPackage({
      name: 'Test Package',
      tier: 'Custom',
      tests,
    });
  }

  describe('detectConflicts', () => {
    it('should detect conflicts for a stored package', async () => {
      const pkg = await createPackageWithTests([
        createTestItem({
          testType: 'cardiac_stress_test',
          name: 'Cardiac Stress Test',
          contraindications: ['unstable_angina'],
        }),
      ]);

      const allergies: Allergy[] = [
        createAllergy({ substance: 'unstable_angina', severity: 'severe' }),
      ];

      const result = await service.detectConflicts(pkg.id, allergies);

      expect(result.hasConflicts).toBe(true);
      expect(result.conflicts).toHaveLength(1);
    });

    it('should throw PackageNotFoundError for nonexistent package', async () => {
      const allergies: Allergy[] = [createAllergy()];

      await expect(service.detectConflicts('nonexistent', allergies)).rejects.toThrow(
        PackageNotFoundError
      );
    });
  });

  describe('assignPackageToSenior', () => {
    it('should block assignment when conflicts are found (Req 2.4)', async () => {
      const pkg = await createPackageWithTests([
        createTestItem({
          testType: 'cardiac_stress_test',
          name: 'Cardiac Stress Test',
          contraindications: ['unstable_angina'],
        }),
        createTestItem({ testType: 'blood_sugar', name: 'Blood Sugar', contraindications: [] }),
      ]);

      const allergies: Allergy[] = [
        createAllergy({ substance: 'unstable_angina', severity: 'severe' }),
      ];

      const result = await service.assignPackageToSenior(pkg.id, 'senior_1', allergies);

      expect(result.success).toBe(false);
      expect(result.conflictDetection?.hasConflicts).toBe(true);
      expect(result.conflictDetection?.conflicts).toHaveLength(1);
      expect(result.message).toContain('blocked');
    });

    it('should allow assignment when no conflicts exist', async () => {
      const pkg = await createPackageWithTests([
        createTestItem({ testType: 'blood_sugar', name: 'Blood Sugar', contraindications: [] }),
        createTestItem({ testType: 'lipid_profile', name: 'Lipid Profile', contraindications: [] }),
      ]);

      const allergies: Allergy[] = [createAllergy({ substance: 'penicillin' })];

      const result = await service.assignPackageToSenior(pkg.id, 'senior_1', allergies);

      expect(result.success).toBe(true);
      expect(result.conflictDetection?.hasConflicts).toBe(false);
      expect(result.message).toContain('successfully');
    });

    it('should allow assignment after removing conflicting tests', async () => {
      const pkg = await createPackageWithTests([
        createTestItem({
          testType: 'cardiac_stress_test',
          name: 'Cardiac Stress Test',
          contraindications: ['unstable_angina'],
        }),
        createTestItem({ testType: 'blood_sugar', name: 'Blood Sugar', contraindications: [] }),
        createTestItem({ testType: 'lipid_profile', name: 'Lipid Profile', contraindications: [] }),
      ]);

      const allergies: Allergy[] = [
        createAllergy({ substance: 'unstable_angina', severity: 'severe' }),
      ];

      // First attempt should be blocked
      const firstAttempt = await service.assignPackageToSenior(pkg.id, 'senior_1', allergies);
      expect(firstAttempt.success).toBe(false);

      // Admin removes conflicting test
      await service.removeConflictingTests(pkg.id, ['cardiac_stress_test']);

      // Second attempt should succeed
      const secondAttempt = await service.assignPackageToSenior(pkg.id, 'senior_1', allergies);
      expect(secondAttempt.success).toBe(true);
    });

    it('should throw PackageNotFoundError for nonexistent package', async () => {
      const allergies: Allergy[] = [createAllergy()];

      await expect(
        service.assignPackageToSenior('nonexistent', 'senior_1', allergies)
      ).rejects.toThrow(PackageNotFoundError);
    });

    it('should succeed with empty allergies list', async () => {
      const pkg = await createPackageWithTests([
        createTestItem({
          testType: 'cardiac_stress_test',
          name: 'Cardiac Stress Test',
          contraindications: ['unstable_angina'],
        }),
      ]);

      const result = await service.assignPackageToSenior(pkg.id, 'senior_1', []);

      expect(result.success).toBe(true);
    });
  });

  describe('removeConflictingTests', () => {
    it('should remove specified tests from the package', async () => {
      const pkg = await createPackageWithTests([
        createTestItem({
          testType: 'cardiac_stress_test',
          name: 'Cardiac Stress Test',
          contraindications: ['unstable_angina'],
        }),
        createTestItem({ testType: 'blood_sugar', name: 'Blood Sugar', contraindications: [] }),
        createTestItem({ testType: 'lipid_profile', name: 'Lipid Profile', contraindications: [] }),
      ]);

      const updated = await service.removeConflictingTests(pkg.id, ['cardiac_stress_test']);

      expect(updated.tests).toHaveLength(2);
      expect(updated.tests.map((t) => t.testType)).toEqual(['blood_sugar', 'lipid_profile']);
    });

    it('should recalculate total cost after removing tests', async () => {
      const pkg = await createPackageWithTests([
        createTestItem({ testType: 'test_a', name: 'Test A', cost: 100, contraindications: ['allergy_x'] }),
        createTestItem({ testType: 'test_b', name: 'Test B', cost: 50, contraindications: [] }),
      ]);

      const updated = await service.removeConflictingTests(pkg.id, ['test_a']);

      expect(updated.totalCost).toBe(50);
    });

    it('should throw InvalidTestCountError if removing all tests would leave package empty', async () => {
      const pkg = await createPackageWithTests([
        createTestItem({
          testType: 'cardiac_stress_test',
          name: 'Cardiac Stress Test',
          contraindications: ['unstable_angina'],
        }),
      ]);

      await expect(
        service.removeConflictingTests(pkg.id, ['cardiac_stress_test'])
      ).rejects.toThrow(InvalidTestCountError);
    });

    it('should throw PackageNotFoundError for nonexistent package', async () => {
      await expect(
        service.removeConflictingTests('nonexistent', ['some_test'])
      ).rejects.toThrow(PackageNotFoundError);
    });

    it('should perform case-insensitive test type matching for removal', async () => {
      const pkg = await createPackageWithTests([
        createTestItem({ testType: 'Cardiac_Stress_Test', name: 'Cardiac Stress Test', contraindications: ['x'] }),
        createTestItem({ testType: 'blood_sugar', name: 'Blood Sugar', contraindications: [] }),
      ]);

      const updated = await service.removeConflictingTests(pkg.id, ['cardiac_stress_test']);

      expect(updated.tests).toHaveLength(1);
      expect(updated.tests[0].testType).toBe('blood_sugar');
    });

    it('should update the updatedAt timestamp', async () => {
      const pkg = await createPackageWithTests([
        createTestItem({ testType: 'test_a', name: 'Test A', contraindications: ['x'] }),
        createTestItem({ testType: 'test_b', name: 'Test B', contraindications: [] }),
      ]);

      const laterDate = new Date('2024-12-01');
      const laterService = new CheckupPackageService({
        idGenerator: () => `PKG_${++idCounter}`,
        dateProvider: () => laterDate,
        packageRepository,
        sessionRepository,
      });

      const updated = await laterService.removeConflictingTests(pkg.id, ['test_a']);
      expect(updated.updatedAt).toEqual(laterDate);
    });
  });
});
