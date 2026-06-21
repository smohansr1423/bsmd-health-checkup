/**
 * Checkup Package Service
 * Manages predefined and custom checkup package CRUD operations.
 * Validates: Requirements 2.1, 2.2, 2.5, 2.6
 */

import type { CheckupPackage, PackageTest, Allergy } from '@health-checkup/shared';
import { TestCategory } from '@health-checkup/shared';
import type {
  CreatePackageRequest,
  UpdatePackageRequest,
  CheckupPackageDependencies,
  CheckupPackageRepository,
  CheckupSessionRepository,
} from './checkup-package.types';
import {
  AllergyConflictError,
  InvalidTestCountError,
  PackageModificationBlockedError,
  PackageNotFoundError,
} from './checkup-package.errors';
import { calculateTotalCost, validateTestCount } from './checkup-package.validators';
import {
  AllergyConflictDetector,
  type AssignmentResult,
  type ConflictDetectionResult,
} from './allergy-conflict-detector';

/**
 * In-memory implementation of CheckupPackageRepository.
 * Suitable for development and testing.
 */
export class InMemoryCheckupPackageRepository implements CheckupPackageRepository {
  private packages: CheckupPackage[] = [];

  async save(pkg: CheckupPackage): Promise<CheckupPackage> {
    this.packages.push(pkg);
    return pkg;
  }

  async findById(id: string): Promise<CheckupPackage | null> {
    return this.packages.find((p) => p.id === id) ?? null;
  }

  async findAll(): Promise<CheckupPackage[]> {
    return [...this.packages];
  }

  async findByTier(tier: CheckupPackage['tier']): Promise<CheckupPackage[]> {
    return this.packages.filter((p) => p.tier === tier);
  }

  async update(pkg: CheckupPackage): Promise<CheckupPackage> {
    const index = this.packages.findIndex((p) => p.id === pkg.id);
    if (index === -1) {
      throw new Error(`Checkup package not found: ${pkg.id}`);
    }
    this.packages[index] = pkg;
    return pkg;
  }

  async delete(id: string): Promise<void> {
    const index = this.packages.findIndex((p) => p.id === id);
    if (index === -1) {
      throw new Error(`Checkup package not found: ${id}`);
    }
    this.packages.splice(index, 1);
  }

  /** Utility for testing: clear all stored packages */
  clear(): void {
    this.packages = [];
  }
}

/**
 * In-memory implementation of CheckupSessionRepository (read-only for package service).
 */
export class InMemoryCheckupSessionRepository implements CheckupSessionRepository {
  private sessions: Array<{ id: string; packageId: string; status: string }> = [];

  async findCompletedByPackageId(packageId: string) {
    return this.sessions
      .filter((s) => s.packageId === packageId && s.status === 'complete')
      .map((s) => ({
        id: s.id,
        appointmentId: `apt_${s.id}`,
        seniorId: `sr_${s.id}`,
        packageId: s.packageId,
        assignedPhysicianId: `ph_${s.id}`,
        assignedSpecialists: [],
        status: s.status as 'complete',
        startedAt: new Date(),
        completedAt: new Date(),
      }));
  }

  /** Utility for testing: add a session */
  addSession(session: { id: string; packageId: string; status: string }): void {
    this.sessions.push(session);
  }

  /** Utility for testing: clear all stored sessions */
  clear(): void {
    this.sessions = [];
  }
}

/** Default ID generator using timestamp + random suffix */
const defaultIdGenerator = (): string => {
  return `PKG_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
};

/** Default date provider returning the current system date */
const defaultDateProvider = (): Date => new Date();

/**
 * Predefined package test compositions per Requirement 2.1.
 */
export const PREDEFINED_BASIC_TESTS: PackageTest[] = [
  {
    testType: 'complete_blood_count',
    name: 'Complete Blood Count',
    category: TestCategory.Blood,
    cost: 50,
    contraindications: [],
    plausibleRange: { min: 0, max: 50 },
    unit: 'count/mcL',
  },
  {
    testType: 'blood_sugar',
    name: 'Blood Sugar (Fasting)',
    category: TestCategory.Blood,
    cost: 30,
    contraindications: [],
    plausibleRange: { min: 40, max: 500 },
    unit: 'mg/dL',
  },
  {
    testType: 'lipid_profile',
    name: 'Lipid Profile',
    category: TestCategory.Blood,
    cost: 60,
    contraindications: [],
    plausibleRange: { min: 50, max: 400 },
    unit: 'mg/dL',
  },
  {
    testType: 'urine_analysis',
    name: 'Urine Analysis',
    category: TestCategory.Urine,
    cost: 25,
    contraindications: [],
    plausibleRange: { min: 0, max: 100 },
    unit: 'various',
  },
  {
    testType: 'vitals',
    name: 'Vitals Check',
    category: TestCategory.Blood,
    cost: 20,
    contraindications: [],
    plausibleRange: { min: 0, max: 300 },
    unit: 'various',
  },
];

export const PREDEFINED_STANDARD_TESTS: PackageTest[] = [
  ...PREDEFINED_BASIC_TESTS,
  {
    testType: 'ecg',
    name: 'ECG (Electrocardiogram)',
    category: TestCategory.Cardiac,
    cost: 80,
    contraindications: ['pacemaker_incompatible'],
    plausibleRange: { min: 40, max: 200 },
    unit: 'bpm',
  },
  {
    testType: 'chest_xray',
    name: 'Chest X-Ray',
    category: TestCategory.Imaging,
    cost: 100,
    contraindications: ['pregnancy'],
    plausibleRange: { min: 0, max: 1 },
    unit: 'status',
  },
  {
    testType: 'eye_exam',
    name: 'Eye Examination',
    category: TestCategory.Vision,
    cost: 70,
    contraindications: [],
    plausibleRange: { min: 0, max: 20 },
    unit: 'diopter',
  },
  {
    testType: 'hearing_test',
    name: 'Hearing Test (Audiometry)',
    category: TestCategory.Hearing,
    cost: 60,
    contraindications: [],
    plausibleRange: { min: 0, max: 120 },
    unit: 'dB',
  },
];

export const PREDEFINED_COMPREHENSIVE_TESTS: PackageTest[] = [
  ...PREDEFINED_STANDARD_TESTS,
  {
    testType: 'bone_density_scan',
    name: 'Bone Density Scan (DEXA)',
    category: TestCategory.Musculoskeletal,
    cost: 150,
    contraindications: ['barium_contrast_recent'],
    plausibleRange: { min: -4, max: 4 },
    unit: 'T-score',
  },
  {
    testType: 'cognitive_screening',
    name: 'Cognitive Screening (MMSE)',
    category: TestCategory.Cognitive,
    cost: 90,
    contraindications: [],
    plausibleRange: { min: 0, max: 30 },
    unit: 'score',
  },
  {
    testType: 'cardiac_stress_test',
    name: 'Cardiac Stress Test',
    category: TestCategory.Cardiac,
    cost: 200,
    contraindications: ['unstable_angina', 'severe_heart_failure'],
    plausibleRange: { min: 40, max: 220 },
    unit: 'bpm',
  },
  {
    testType: 'thyroid_function',
    name: 'Thyroid Function Test',
    category: TestCategory.Endocrine,
    cost: 70,
    contraindications: [],
    plausibleRange: { min: 0, max: 20 },
    unit: 'mIU/L',
  },
  {
    testType: 'kidney_function',
    name: 'Kidney Function Test',
    category: TestCategory.OrganFunction,
    cost: 65,
    contraindications: [],
    plausibleRange: { min: 0, max: 200 },
    unit: 'mg/dL',
  },
  {
    testType: 'liver_function',
    name: 'Liver Function Test',
    category: TestCategory.OrganFunction,
    cost: 65,
    contraindications: [],
    plausibleRange: { min: 0, max: 500 },
    unit: 'U/L',
  },
];

/**
 * CheckupPackageService implementation.
 *
 * Provides CRUD operations for checkup packages, seeds predefined packages,
 * validates custom package constraints, calculates costs, and ensures
 * package modifications don't affect completed sessions.
 */
export class CheckupPackageService {
  private readonly idGenerator: () => string;
  private readonly dateProvider: () => Date;
  private readonly packageRepository: CheckupPackageRepository;
  private readonly sessionRepository: CheckupSessionRepository;

  constructor(deps?: Partial<CheckupPackageDependencies>) {
    this.idGenerator = deps?.idGenerator ?? defaultIdGenerator;
    this.dateProvider = deps?.dateProvider ?? defaultDateProvider;
    this.packageRepository = deps?.packageRepository ?? new InMemoryCheckupPackageRepository();
    this.sessionRepository = deps?.sessionRepository ?? new InMemoryCheckupSessionRepository();
  }

  /**
   * Seed predefined packages (Basic, Standard, Comprehensive).
   * Requirement 2.1: Provide predefined packages with specific test compositions.
   */
  async seedPredefinedPackages(): Promise<CheckupPackage[]> {
    const now = this.dateProvider();
    const packages: CheckupPackage[] = [
      {
        id: this.idGenerator(),
        name: 'Basic Health Checkup',
        tier: 'Basic',
        tests: PREDEFINED_BASIC_TESTS,
        totalCost: calculateTotalCost(PREDEFINED_BASIC_TESTS),
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: this.idGenerator(),
        name: 'Standard Health Checkup',
        tier: 'Standard',
        tests: PREDEFINED_STANDARD_TESTS,
        totalCost: calculateTotalCost(PREDEFINED_STANDARD_TESTS),
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: this.idGenerator(),
        name: 'Comprehensive Health Checkup',
        tier: 'Comprehensive',
        tests: PREDEFINED_COMPREHENSIVE_TESTS,
        totalCost: calculateTotalCost(PREDEFINED_COMPREHENSIVE_TESTS),
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
    ];

    const saved: CheckupPackage[] = [];
    for (const pkg of packages) {
      saved.push(await this.packageRepository.save(pkg));
    }
    return saved;
  }

  /**
   * Create a new checkup package.
   * Requirement 2.2: Validate test count is between 1 and 50 for custom packages.
   * Requirement 2.6: Calculate total cost as sum of individual test costs.
   */
  async createPackage(request: CreatePackageRequest): Promise<CheckupPackage> {
    // Validate test count for custom packages (Req 2.2)
    const testCountValidation = validateTestCount(request.tests.length);
    if (!testCountValidation.valid) {
      throw new InvalidTestCountError(request.tests.length);
    }

    const now = this.dateProvider();
    const totalCost = calculateTotalCost(request.tests);

    const pkg: CheckupPackage = {
      id: this.idGenerator(),
      name: request.name,
      tier: request.tier,
      tests: request.tests,
      totalCost,
      discountRate: request.discountRate,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    };

    return this.packageRepository.save(pkg);
  }

  /**
   * Get a package by ID.
   */
  async getPackage(id: string): Promise<CheckupPackage> {
    const pkg = await this.packageRepository.findById(id);
    if (!pkg) {
      throw new PackageNotFoundError(id);
    }
    return pkg;
  }

  /**
   * Get all packages.
   */
  async getAllPackages(): Promise<CheckupPackage[]> {
    return this.packageRepository.findAll();
  }

  /**
   * Get packages by tier.
   */
  async getPackagesByTier(tier: CheckupPackage['tier']): Promise<CheckupPackage[]> {
    return this.packageRepository.findByTier(tier);
  }

  /**
   * Update a checkup package.
   * Requirement 2.5: Allow modifications without affecting completed sessions.
   *   - If the package has completed sessions, block modification of tests.
   * Requirement 2.6: Recalculate total cost when tests change.
   */
  async updatePackage(id: string, request: UpdatePackageRequest): Promise<CheckupPackage> {
    const existing = await this.packageRepository.findById(id);
    if (!existing) {
      throw new PackageNotFoundError(id);
    }

    // If tests are being modified, check for completed sessions (Req 2.5)
    if (request.tests !== undefined) {
      const completedSessions = await this.sessionRepository.findCompletedByPackageId(id);
      if (completedSessions.length > 0) {
        throw new PackageModificationBlockedError(id, completedSessions.length);
      }

      // Validate new test count (Req 2.2)
      const testCountValidation = validateTestCount(request.tests.length);
      if (!testCountValidation.valid) {
        throw new InvalidTestCountError(request.tests.length);
      }
    }

    const now = this.dateProvider();
    const updatedTests = request.tests ?? existing.tests;
    const totalCost = calculateTotalCost(updatedTests);

    const updated: CheckupPackage = {
      ...existing,
      ...(request.name !== undefined && { name: request.name }),
      ...(request.tests !== undefined && { tests: request.tests }),
      ...(request.discountRate !== undefined && { discountRate: request.discountRate }),
      ...(request.isActive !== undefined && { isActive: request.isActive }),
      totalCost,
      updatedAt: now,
    };

    return this.packageRepository.update(updated);
  }

  /**
   * Delete (deactivate) a checkup package.
   * Does not permanently delete packages with completed sessions.
   */
  async deletePackage(id: string): Promise<void> {
    const existing = await this.packageRepository.findById(id);
    if (!existing) {
      throw new PackageNotFoundError(id);
    }

    // If the package has completed sessions, soft-delete by deactivation
    const completedSessions = await this.sessionRepository.findCompletedByPackageId(id);
    if (completedSessions.length > 0) {
      const now = this.dateProvider();
      await this.packageRepository.update({
        ...existing,
        isActive: false,
        updatedAt: now,
      });
    } else {
      await this.packageRepository.delete(id);
    }
  }

  /**
   * Get the total cost for a package (displays sum of individual test costs).
   * Requirement 2.6: Display total cost calculated as sum of individual test costs.
   */
  getPackageCost(pkg: CheckupPackage): number {
    return calculateTotalCost(pkg.tests);
  }

  /**
   * Detect allergy/contraindication conflicts between a package's tests and a senior's allergies.
   * Requirement 2.3: Verify that no tests conflict with recorded allergies or contraindications.
   */
  async detectConflicts(packageId: string, allergies: Allergy[]): Promise<ConflictDetectionResult> {
    const pkg = await this.packageRepository.findById(packageId);
    if (!pkg) {
      throw new PackageNotFoundError(packageId);
    }

    const detector = new AllergyConflictDetector();
    return detector.detectConflicts(pkg.tests, allergies);
  }

  /**
   * Assign a package to a senior citizen, checking for allergy conflicts first.
   * Requirement 2.3: Verify no test conflicts with allergies before assignment.
   * Requirement 2.4: Prevent assignment when conflicts exist, report conflicts.
   */
  async assignPackageToSenior(
    packageId: string,
    seniorId: string,
    allergies: Allergy[]
  ): Promise<AssignmentResult> {
    const pkg = await this.packageRepository.findById(packageId);
    if (!pkg) {
      throw new PackageNotFoundError(packageId);
    }

    const detector = new AllergyConflictDetector();
    const conflictResult = detector.detectConflicts(pkg.tests, allergies);

    if (conflictResult.hasConflicts) {
      return {
        success: false,
        packageId,
        seniorId,
        conflictDetection: conflictResult,
        message: `Assignment blocked: ${conflictResult.conflicts.length} test(s) conflict with recorded allergies.`,
      };
    }

    return {
      success: true,
      packageId,
      seniorId,
      conflictDetection: conflictResult,
      message: 'Package assigned successfully.',
    };
  }

  /**
   * Remove conflicting tests from a package.
   * Requirement 2.4: Allow administrator to remove conflicting tests.
   */
  async removeConflictingTests(
    packageId: string,
    testTypesToRemove: string[]
  ): Promise<CheckupPackage> {
    const pkg = await this.packageRepository.findById(packageId);
    if (!pkg) {
      throw new PackageNotFoundError(packageId);
    }

    const normalizedTypesToRemove = testTypesToRemove.map((t) => t.toLowerCase().trim());
    const remainingTests = pkg.tests.filter(
      (test) => !normalizedTypesToRemove.includes(test.testType.toLowerCase().trim())
    );

    // Validate that removing tests doesn't leave the package empty
    const testCountValidation = validateTestCount(remainingTests.length);
    if (!testCountValidation.valid) {
      throw new InvalidTestCountError(remainingTests.length);
    }

    const now = this.dateProvider();
    const updatedPkg: CheckupPackage = {
      ...pkg,
      tests: remainingTests,
      totalCost: calculateTotalCost(remainingTests),
      updatedAt: now,
    };

    return this.packageRepository.update(updatedPkg);
  }
}
