/**
 * Unit tests for CheckupPackageService
 * Validates: Requirements 2.1, 2.2, 2.5, 2.6
 */

import { TestCategory } from '@health-checkup/shared';
import type { PackageTest } from '@health-checkup/shared';
import {
  CheckupPackageService,
  InMemoryCheckupPackageRepository,
  InMemoryCheckupSessionRepository,
  PREDEFINED_BASIC_TESTS,
  PREDEFINED_STANDARD_TESTS,
  PREDEFINED_COMPREHENSIVE_TESTS,
} from './checkup-package.service';
import {
  InvalidTestCountError,
  PackageModificationBlockedError,
  PackageNotFoundError,
} from './checkup-package.errors';
import {
  validateTestCount,
  validateDiscountRate,
  validateTestCosts,
  calculateTotalCost,
} from './checkup-package.validators';
import type { CreatePackageRequest } from './checkup-package.types';

/** Helper to create a valid PackageTest */
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

/** Helper to create a valid CreatePackageRequest */
function createValidPackageRequest(overrides?: Partial<CreatePackageRequest>): CreatePackageRequest {
  return {
    name: 'Custom Checkup Package',
    tier: 'Custom',
    tests: [
      createTestItem(),
      createTestItem({ testType: 'lipid_profile', name: 'Lipid Profile', cost: 60 }),
    ],
    ...overrides,
  };
}

describe('CheckupPackageService', () => {
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

  describe('seedPredefinedPackages (Req 2.1)', () => {
    it('should seed Basic, Standard, and Comprehensive packages', async () => {
      const packages = await service.seedPredefinedPackages();

      expect(packages).toHaveLength(3);
      expect(packages[0].tier).toBe('Basic');
      expect(packages[1].tier).toBe('Standard');
      expect(packages[2].tier).toBe('Comprehensive');
    });

    it('should assign correct names to predefined packages', async () => {
      const packages = await service.seedPredefinedPackages();

      expect(packages[0].name).toBe('Basic Health Checkup');
      expect(packages[1].name).toBe('Standard Health Checkup');
      expect(packages[2].name).toBe('Comprehensive Health Checkup');
    });

    it('should assign unique IDs to each predefined package', async () => {
      const packages = await service.seedPredefinedPackages();

      const ids = packages.map((p) => p.id);
      expect(new Set(ids).size).toBe(3);
    });

    it('should mark all predefined packages as active', async () => {
      const packages = await service.seedPredefinedPackages();

      packages.forEach((pkg) => {
        expect(pkg.isActive).toBe(true);
      });
    });

    it('should set correct timestamps on predefined packages', async () => {
      const packages = await service.seedPredefinedPackages();

      packages.forEach((pkg) => {
        expect(pkg.createdAt).toEqual(fixedDate);
        expect(pkg.updatedAt).toEqual(fixedDate);
      });
    });

    it('Basic package should contain blood count, blood sugar, lipid profile, urine analysis, vitals', async () => {
      const packages = await service.seedPredefinedPackages();
      const basic = packages[0];

      expect(basic.tests).toHaveLength(PREDEFINED_BASIC_TESTS.length);
      const testTypes = basic.tests.map((t) => t.testType);
      expect(testTypes).toContain('complete_blood_count');
      expect(testTypes).toContain('blood_sugar');
      expect(testTypes).toContain('lipid_profile');
      expect(testTypes).toContain('urine_analysis');
      expect(testTypes).toContain('vitals');
    });

    it('Standard package should include all Basic tests plus ECG, chest X-ray, eye exam, hearing test', async () => {
      const packages = await service.seedPredefinedPackages();
      const standard = packages[1];

      expect(standard.tests).toHaveLength(PREDEFINED_STANDARD_TESTS.length);
      const testTypes = standard.tests.map((t) => t.testType);
      // Basic tests
      expect(testTypes).toContain('complete_blood_count');
      expect(testTypes).toContain('blood_sugar');
      // Standard-specific
      expect(testTypes).toContain('ecg');
      expect(testTypes).toContain('chest_xray');
      expect(testTypes).toContain('eye_exam');
      expect(testTypes).toContain('hearing_test');
    });

    it('Comprehensive package should include all Standard tests plus bone density, cognitive, cardiac stress, thyroid, kidney, liver', async () => {
      const packages = await service.seedPredefinedPackages();
      const comprehensive = packages[2];

      expect(comprehensive.tests).toHaveLength(PREDEFINED_COMPREHENSIVE_TESTS.length);
      const testTypes = comprehensive.tests.map((t) => t.testType);
      // Standard tests
      expect(testTypes).toContain('ecg');
      expect(testTypes).toContain('eye_exam');
      // Comprehensive-specific
      expect(testTypes).toContain('bone_density_scan');
      expect(testTypes).toContain('cognitive_screening');
      expect(testTypes).toContain('cardiac_stress_test');
      expect(testTypes).toContain('thyroid_function');
      expect(testTypes).toContain('kidney_function');
      expect(testTypes).toContain('liver_function');
    });

    it('should calculate correct total cost for each predefined package', async () => {
      const packages = await service.seedPredefinedPackages();

      packages.forEach((pkg) => {
        const expectedCost = pkg.tests.reduce((sum, t) => sum + t.cost, 0);
        expect(pkg.totalCost).toBe(expectedCost);
      });
    });
  });

  describe('createPackage (Req 2.2, 2.6)', () => {
    it('should create a custom package with valid test count', async () => {
      const request = createValidPackageRequest();
      const pkg = await service.createPackage(request);

      expect(pkg.id).toBe('PKG_1');
      expect(pkg.name).toBe('Custom Checkup Package');
      expect(pkg.tier).toBe('Custom');
      expect(pkg.tests).toHaveLength(2);
      expect(pkg.isActive).toBe(true);
    });

    it('should calculate total cost as sum of individual test costs (Req 2.6)', async () => {
      const tests = [
        createTestItem({ cost: 50 }),
        createTestItem({ testType: 'ecg', name: 'ECG', cost: 80 }),
        createTestItem({ testType: 'xray', name: 'X-Ray', cost: 100 }),
      ];
      const request = createValidPackageRequest({ tests });
      const pkg = await service.createPackage(request);

      expect(pkg.totalCost).toBe(230); // 50 + 80 + 100
    });

    it('should accept a package with exactly 1 test (minimum)', async () => {
      const request = createValidPackageRequest({
        tests: [createTestItem()],
      });
      const pkg = await service.createPackage(request);

      expect(pkg.tests).toHaveLength(1);
    });

    it('should accept a package with exactly 50 tests (maximum)', async () => {
      const tests = Array.from({ length: 50 }, (_, i) =>
        createTestItem({ testType: `test_${i}`, name: `Test ${i}`, cost: 10 })
      );
      const request = createValidPackageRequest({ tests });
      const pkg = await service.createPackage(request);

      expect(pkg.tests).toHaveLength(50);
      expect(pkg.totalCost).toBe(500); // 50 * 10
    });

    it('should reject a package with 0 tests (Req 2.2)', async () => {
      const request = createValidPackageRequest({ tests: [] });

      await expect(service.createPackage(request)).rejects.toThrow(InvalidTestCountError);
    });

    it('should reject a package with 51 tests (Req 2.2)', async () => {
      const tests = Array.from({ length: 51 }, (_, i) =>
        createTestItem({ testType: `test_${i}`, name: `Test ${i}` })
      );
      const request = createValidPackageRequest({ tests });

      await expect(service.createPackage(request)).rejects.toThrow(InvalidTestCountError);
    });

    it('should store discount rate when provided', async () => {
      const request = createValidPackageRequest({ discountRate: 15 });
      const pkg = await service.createPackage(request);

      expect(pkg.discountRate).toBe(15);
    });

    it('should set createdAt and updatedAt timestamps', async () => {
      const request = createValidPackageRequest();
      const pkg = await service.createPackage(request);

      expect(pkg.createdAt).toEqual(fixedDate);
      expect(pkg.updatedAt).toEqual(fixedDate);
    });
  });

  describe('getPackage', () => {
    it('should retrieve an existing package by ID', async () => {
      const request = createValidPackageRequest();
      const created = await service.createPackage(request);

      const retrieved = await service.getPackage(created.id);
      expect(retrieved.id).toBe(created.id);
      expect(retrieved.name).toBe('Custom Checkup Package');
    });

    it('should throw PackageNotFoundError when package does not exist', async () => {
      await expect(service.getPackage('nonexistent')).rejects.toThrow(PackageNotFoundError);
    });
  });

  describe('getAllPackages', () => {
    it('should return all stored packages', async () => {
      await service.seedPredefinedPackages();
      await service.createPackage(createValidPackageRequest());

      const all = await service.getAllPackages();
      expect(all).toHaveLength(4); // 3 predefined + 1 custom
    });

    it('should return empty array when no packages exist', async () => {
      const all = await service.getAllPackages();
      expect(all).toHaveLength(0);
    });
  });

  describe('getPackagesByTier', () => {
    it('should filter packages by tier', async () => {
      await service.seedPredefinedPackages();
      await service.createPackage(createValidPackageRequest());

      const customPackages = await service.getPackagesByTier('Custom');
      expect(customPackages).toHaveLength(1);
      expect(customPackages[0].tier).toBe('Custom');

      const basicPackages = await service.getPackagesByTier('Basic');
      expect(basicPackages).toHaveLength(1);
      expect(basicPackages[0].tier).toBe('Basic');
    });
  });

  describe('updatePackage (Req 2.5, 2.6)', () => {
    it('should update package name', async () => {
      const created = await service.createPackage(createValidPackageRequest());

      const updated = await service.updatePackage(created.id, { name: 'Updated Name' });
      expect(updated.name).toBe('Updated Name');
      expect(updated.tests).toEqual(created.tests); // tests unchanged
    });

    it('should update package tests and recalculate total cost (Req 2.6)', async () => {
      const created = await service.createPackage(createValidPackageRequest());

      const newTests = [
        createTestItem({ cost: 100 }),
        createTestItem({ testType: 'ecg', name: 'ECG', cost: 200 }),
        createTestItem({ testType: 'xray', name: 'X-Ray', cost: 150 }),
      ];
      const updated = await service.updatePackage(created.id, { tests: newTests });

      expect(updated.tests).toHaveLength(3);
      expect(updated.totalCost).toBe(450); // 100 + 200 + 150
    });

    it('should block test modifications when completed sessions exist (Req 2.5)', async () => {
      const created = await service.createPackage(createValidPackageRequest());

      // Add a completed session referencing this package
      sessionRepository.addSession({
        id: 'session_1',
        packageId: created.id,
        status: 'complete',
      });

      const newTests = [createTestItem({ cost: 999 })];
      await expect(
        service.updatePackage(created.id, { tests: newTests })
      ).rejects.toThrow(PackageModificationBlockedError);
    });

    it('should allow non-test modifications even when completed sessions exist', async () => {
      const created = await service.createPackage(createValidPackageRequest());

      sessionRepository.addSession({
        id: 'session_1',
        packageId: created.id,
        status: 'complete',
      });

      // Name and discount updates should still work
      const updated = await service.updatePackage(created.id, {
        name: 'Renamed Package',
        discountRate: 20,
      });
      expect(updated.name).toBe('Renamed Package');
      expect(updated.discountRate).toBe(20);
    });

    it('should allow test modifications when sessions are in-progress (not completed)', async () => {
      const created = await service.createPackage(createValidPackageRequest());

      // in-progress session should NOT block modification
      sessionRepository.addSession({
        id: 'session_1',
        packageId: created.id,
        status: 'in_progress',
      });

      const newTests = [createTestItem({ cost: 999 })];
      const updated = await service.updatePackage(created.id, { tests: newTests });
      expect(updated.totalCost).toBe(999);
    });

    it('should validate test count on update (Req 2.2)', async () => {
      const created = await service.createPackage(createValidPackageRequest());

      await expect(
        service.updatePackage(created.id, { tests: [] })
      ).rejects.toThrow(InvalidTestCountError);

      const tooMany = Array.from({ length: 51 }, (_, i) =>
        createTestItem({ testType: `test_${i}`, name: `Test ${i}` })
      );
      await expect(
        service.updatePackage(created.id, { tests: tooMany })
      ).rejects.toThrow(InvalidTestCountError);
    });

    it('should throw PackageNotFoundError for nonexistent package', async () => {
      await expect(
        service.updatePackage('nonexistent', { name: 'Test' })
      ).rejects.toThrow(PackageNotFoundError);
    });

    it('should update the updatedAt timestamp', async () => {
      const created = await service.createPackage(createValidPackageRequest());

      const laterDate = new Date('2024-12-01');
      const laterService = new CheckupPackageService({
        idGenerator: () => `PKG_${++idCounter}`,
        dateProvider: () => laterDate,
        packageRepository,
        sessionRepository,
      });

      const updated = await laterService.updatePackage(created.id, { name: 'New Name' });
      expect(updated.updatedAt).toEqual(laterDate);
      expect(updated.createdAt).toEqual(fixedDate); // createdAt unchanged
    });

    it('should update isActive status', async () => {
      const created = await service.createPackage(createValidPackageRequest());
      expect(created.isActive).toBe(true);

      const updated = await service.updatePackage(created.id, { isActive: false });
      expect(updated.isActive).toBe(false);
    });
  });

  describe('deletePackage', () => {
    it('should permanently delete a package with no completed sessions', async () => {
      const created = await service.createPackage(createValidPackageRequest());

      await service.deletePackage(created.id);

      await expect(service.getPackage(created.id)).rejects.toThrow(PackageNotFoundError);
    });

    it('should soft-delete (deactivate) a package with completed sessions', async () => {
      const created = await service.createPackage(createValidPackageRequest());

      sessionRepository.addSession({
        id: 'session_1',
        packageId: created.id,
        status: 'complete',
      });

      await service.deletePackage(created.id);

      const pkg = await service.getPackage(created.id);
      expect(pkg.isActive).toBe(false);
    });

    it('should throw PackageNotFoundError for nonexistent package', async () => {
      await expect(service.deletePackage('nonexistent')).rejects.toThrow(PackageNotFoundError);
    });
  });

  describe('getPackageCost (Req 2.6)', () => {
    it('should return sum of individual test costs', async () => {
      const tests = [
        createTestItem({ cost: 50 }),
        createTestItem({ testType: 'ecg', name: 'ECG', cost: 80 }),
        createTestItem({ testType: 'xray', name: 'X-Ray', cost: 100 }),
      ];
      const request = createValidPackageRequest({ tests });
      const pkg = await service.createPackage(request);

      expect(service.getPackageCost(pkg)).toBe(230);
    });

    it('should return 0 for a package with zero-cost tests', async () => {
      const tests = [
        createTestItem({ cost: 0 }),
        createTestItem({ testType: 'free_test', name: 'Free Test', cost: 0 }),
      ];
      const request = createValidPackageRequest({ tests });
      const pkg = await service.createPackage(request);

      expect(service.getPackageCost(pkg)).toBe(0);
    });
  });
});

describe('validateTestCount (standalone)', () => {
  it('should return valid for count of 1', () => {
    expect(validateTestCount(1)).toEqual({ valid: true });
  });

  it('should return valid for count of 50', () => {
    expect(validateTestCount(50)).toEqual({ valid: true });
  });

  it('should return valid for count of 25 (mid-range)', () => {
    expect(validateTestCount(25)).toEqual({ valid: true });
  });

  it('should return invalid for count of 0', () => {
    const result = validateTestCount(0);
    expect(result.valid).toBe(false);
    expect(result.message).toContain('at least 1');
  });

  it('should return invalid for count of 51', () => {
    const result = validateTestCount(51);
    expect(result.valid).toBe(false);
    expect(result.message).toContain('no more than 50');
  });

  it('should return invalid for negative count', () => {
    const result = validateTestCount(-5);
    expect(result.valid).toBe(false);
    expect(result.message).toContain('at least 1');
  });
});

describe('validateDiscountRate', () => {
  it('should return valid for 0%', () => {
    expect(validateDiscountRate(0)).toEqual({ valid: true });
  });

  it('should return valid for 100%', () => {
    expect(validateDiscountRate(100)).toEqual({ valid: true });
  });

  it('should return valid for 50%', () => {
    expect(validateDiscountRate(50)).toEqual({ valid: true });
  });

  it('should return invalid for negative discount', () => {
    const result = validateDiscountRate(-1);
    expect(result.valid).toBe(false);
    expect(result.message).toContain('between 0 and 100');
  });

  it('should return invalid for discount > 100', () => {
    const result = validateDiscountRate(101);
    expect(result.valid).toBe(false);
    expect(result.message).toContain('between 0 and 100');
  });
});

describe('validateTestCosts', () => {
  it('should return valid for tests with positive costs', () => {
    const tests = [createTestItem({ cost: 10 }), createTestItem({ cost: 50 })];
    expect(validateTestCosts(tests)).toEqual({ valid: true });
  });

  it('should return valid for tests with zero cost', () => {
    const tests = [createTestItem({ cost: 0 })];
    expect(validateTestCosts(tests)).toEqual({ valid: true });
  });

  it('should return invalid for tests with negative cost', () => {
    const tests = [createTestItem({ cost: -10, name: 'Bad Test' })];
    const result = validateTestCosts(tests);
    expect(result.valid).toBe(false);
    expect(result.message).toContain('Bad Test');
    expect(result.message).toContain('negative cost');
  });
});

describe('calculateTotalCost', () => {
  it('should sum all test costs', () => {
    const tests = [
      createTestItem({ cost: 50 }),
      createTestItem({ cost: 80 }),
      createTestItem({ cost: 100 }),
    ];
    expect(calculateTotalCost(tests)).toBe(230);
  });

  it('should return 0 for empty test list', () => {
    expect(calculateTotalCost([])).toBe(0);
  });

  it('should handle single test', () => {
    expect(calculateTotalCost([createTestItem({ cost: 42 })])).toBe(42);
  });
});
