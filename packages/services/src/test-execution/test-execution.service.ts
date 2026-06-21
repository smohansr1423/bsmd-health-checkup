/**
 * Test Execution Service
 * Records test results, validates plausible ranges, manages checkup session states,
 * and handles result amendments.
 * Validates: Requirements 5.1, 5.2, 5.3, 5.6, 5.7
 */

import type {
  CheckupSession,
  CheckupPackage,
  TestResult,
  ReferenceRange,
} from '@health-checkup/shared';
import { AgeGroup } from '@health-checkup/shared';
import type { EventBus, CheckupSessionCompletedEvent } from '@health-checkup/shared';
import type {
  TestResultRequest,
  MeasuredValue,
  PlausibleRangeResult,
  TestExecutionDependencies,
  TestResultRepository,
  CheckupSessionRepository,
  CheckupPackageRepository,
  ReferenceRangeProvider,
  SeniorAgeGroupProvider,
} from './test-execution.types';
import { validateTestResultRequest, validatePlausibleRange } from './test-execution.validators';
import {
  SessionNotInProgressError,
  TestNotInPackageError,
  OutOfRangeNotConfirmedError,
  CheckupSessionNotFoundError,
  PackageNotFoundError,
  TestResultNotFoundError,
  SaveFailedError,
} from './test-execution.errors';

/**
 * Retention period for all test results in years.
 * Requirement 5.5: Maintain 10-year retention for all test results.
 */
export const RETENTION_YEARS = 10;

/**
 * Checks whether a test result created at the given date is still within the retention period.
 * @param createdAt - The date when the test result was created.
 * @param now - Optional current date for testing purposes. Defaults to current system date.
 * @returns true if the result is within the 10-year retention period.
 */
export function isWithinRetentionPeriod(createdAt: Date, now?: Date): boolean {
  const currentDate = now ?? new Date();
  const retentionBoundary = new Date(currentDate);
  retentionBoundary.setFullYear(retentionBoundary.getFullYear() - RETENTION_YEARS);
  return createdAt >= retentionBoundary;
}

/**
 * In-memory implementation of TestResultRepository.
 */
export class InMemoryTestResultRepository implements TestResultRepository {
  private results: TestResult[] = [];

  async save(result: TestResult): Promise<TestResult> {
    this.results.push(result);
    return result;
  }

  async findById(id: string): Promise<TestResult | null> {
    return this.results.find((r) => r.id === id) ?? null;
  }

  async findBySessionId(sessionId: string): Promise<TestResult[]> {
    return this.results.filter((r) => r.checkupSessionId === sessionId);
  }

  async findBySeniorId(seniorId: string, testType?: string): Promise<TestResult[]> {
    return this.results.filter((r) => {
      if (r.seniorId !== seniorId) return false;
      if (testType && r.testType !== testType) return false;
      return true;
    });
  }

  async update(result: TestResult): Promise<TestResult> {
    const index = this.results.findIndex((r) => r.id === result.id);
    if (index === -1) {
      throw new Error(`Test result not found: ${result.id}`);
    }
    this.results[index] = result;
    return result;
  }

  clear(): void {
    this.results = [];
  }
}

/**
 * In-memory implementation of CheckupSessionRepository.
 */
export class InMemoryCheckupSessionRepository implements CheckupSessionRepository {
  private sessions: CheckupSession[] = [];

  async findById(id: string): Promise<CheckupSession | null> {
    return this.sessions.find((s) => s.id === id) ?? null;
  }

  async update(session: CheckupSession): Promise<CheckupSession> {
    const index = this.sessions.findIndex((s) => s.id === session.id);
    if (index === -1) {
      throw new Error(`Session not found: ${session.id}`);
    }
    this.sessions[index] = session;
    return session;
  }

  addSession(session: CheckupSession): void {
    this.sessions.push(session);
  }

  clear(): void {
    this.sessions = [];
  }
}

/**
 * In-memory implementation of CheckupPackageRepository.
 */
export class InMemoryCheckupPackageRepository implements CheckupPackageRepository {
  private packages: CheckupPackage[] = [];

  async findById(id: string): Promise<CheckupPackage | null> {
    return this.packages.find((p) => p.id === id) ?? null;
  }

  addPackage(pkg: CheckupPackage): void {
    this.packages.push(pkg);
  }

  clear(): void {
    this.packages = [];
  }
}

/**
 * Default reference range data for common tests by age group.
 * In production, this would come from a database or external configuration.
 */
const DEFAULT_REFERENCE_RANGES: Record<string, Record<string, ReferenceRange>> = {
  blood_sugar: {
    [AgeGroup.SixtyToSixtyNine]: {
      min: 70, max: 130, borderlineLow: 60, borderlineHigh: 140,
      criticalLow: 40, criticalHigh: 200, ageGroup: AgeGroup.SixtyToSixtyNine,
    },
    [AgeGroup.SeventyToSeventyNine]: {
      min: 70, max: 140, borderlineLow: 60, borderlineHigh: 150,
      criticalLow: 40, criticalHigh: 220, ageGroup: AgeGroup.SeventyToSeventyNine,
    },
    [AgeGroup.EightyToEightyNine]: {
      min: 70, max: 150, borderlineLow: 60, borderlineHigh: 160,
      criticalLow: 40, criticalHigh: 240, ageGroup: AgeGroup.EightyToEightyNine,
    },
    [AgeGroup.NinetyPlus]: {
      min: 70, max: 160, borderlineLow: 60, borderlineHigh: 170,
      criticalLow: 40, criticalHigh: 260, ageGroup: AgeGroup.NinetyPlus,
    },
  },
  lipid_profile: {
    [AgeGroup.SixtyToSixtyNine]: {
      min: 100, max: 200, borderlineLow: 90, borderlineHigh: 240,
      criticalLow: 70, criticalHigh: 300, ageGroup: AgeGroup.SixtyToSixtyNine,
    },
    [AgeGroup.SeventyToSeventyNine]: {
      min: 100, max: 210, borderlineLow: 90, borderlineHigh: 250,
      criticalLow: 70, criticalHigh: 320, ageGroup: AgeGroup.SeventyToSeventyNine,
    },
    [AgeGroup.EightyToEightyNine]: {
      min: 100, max: 220, borderlineLow: 90, borderlineHigh: 260,
      criticalLow: 70, criticalHigh: 340, ageGroup: AgeGroup.EightyToEightyNine,
    },
    [AgeGroup.NinetyPlus]: {
      min: 100, max: 230, borderlineLow: 90, borderlineHigh: 270,
      criticalLow: 70, criticalHigh: 360, ageGroup: AgeGroup.NinetyPlus,
    },
  },
  complete_blood_count: {
    [AgeGroup.SixtyToSixtyNine]: {
      min: 4, max: 11, borderlineLow: 3, borderlineHigh: 13,
      criticalLow: 1, criticalHigh: 20, ageGroup: AgeGroup.SixtyToSixtyNine,
    },
    [AgeGroup.SeventyToSeventyNine]: {
      min: 4, max: 11, borderlineLow: 3, borderlineHigh: 13,
      criticalLow: 1, criticalHigh: 20, ageGroup: AgeGroup.SeventyToSeventyNine,
    },
    [AgeGroup.EightyToEightyNine]: {
      min: 3.5, max: 10.5, borderlineLow: 2.5, borderlineHigh: 12,
      criticalLow: 1, criticalHigh: 18, ageGroup: AgeGroup.EightyToEightyNine,
    },
    [AgeGroup.NinetyPlus]: {
      min: 3.5, max: 10.5, borderlineLow: 2.5, borderlineHigh: 12,
      criticalLow: 1, criticalHigh: 18, ageGroup: AgeGroup.NinetyPlus,
    },
  },
};

/**
 * Default ReferenceRangeProvider using the in-memory lookup table.
 */
export class DefaultReferenceRangeProvider implements ReferenceRangeProvider {
  private ranges: Record<string, Record<string, ReferenceRange>>;

  constructor(ranges?: Record<string, Record<string, ReferenceRange>>) {
    this.ranges = ranges ?? DEFAULT_REFERENCE_RANGES;
  }

  getRange(testType: string, ageGroup: AgeGroup): ReferenceRange | null {
    const testRanges = this.ranges[testType];
    if (!testRanges) return null;
    return testRanges[ageGroup] ?? null;
  }

  addRange(testType: string, ageGroup: AgeGroup, range: ReferenceRange): void {
    if (!this.ranges[testType]) {
      this.ranges[testType] = {};
    }
    this.ranges[testType][ageGroup] = range;
  }
}

/**
 * Default SeniorAgeGroupProvider using an in-memory map.
 */
export class DefaultSeniorAgeGroupProvider implements SeniorAgeGroupProvider {
  private ageGroups: Map<string, AgeGroup> = new Map();

  async getAgeGroup(seniorId: string): Promise<AgeGroup | null> {
    return this.ageGroups.get(seniorId) ?? null;
  }

  setAgeGroup(seniorId: string, ageGroup: AgeGroup): void {
    this.ageGroups.set(seniorId, ageGroup);
  }
}

/** Default ID generator using timestamp + random suffix */
const defaultIdGenerator = (): string => {
  return `TR_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
};

/** Default date provider returning the current system date */
const defaultDateProvider = (): Date => new Date();

/**
 * TestExecutionService implementation.
 *
 * Uses dependency injection for ID generation, date provision, and repository
 * access to support testability.
 *
 * Business rules:
 * - Guard 1: Session must be "in_progress" to record results
 * - Guard 2: Test type must belong to the assigned package's tests
 * - Guard 3: If measured value is outside plausible range, confirmOutOfRange must be true
 * - Display age-adjusted reference range alongside measured value
 * - Handle save failures: return error but preserve request data for retry
 */
export class TestExecutionService {
  private readonly idGenerator: () => string;
  private readonly dateProvider: () => Date;
  private readonly testResultRepository: TestResultRepository;
  private readonly sessionRepository: CheckupSessionRepository;
  private readonly packageRepository: CheckupPackageRepository;
  private readonly referenceRangeProvider: ReferenceRangeProvider;
  private readonly seniorAgeGroupProvider: SeniorAgeGroupProvider;
  private readonly eventBus?: EventBus;

  constructor(deps?: Partial<TestExecutionDependencies>) {
    this.idGenerator = deps?.idGenerator ?? defaultIdGenerator;
    this.dateProvider = deps?.dateProvider ?? defaultDateProvider;
    this.testResultRepository = deps?.testResultRepository ?? new InMemoryTestResultRepository();
    this.sessionRepository = deps?.sessionRepository ?? new InMemoryCheckupSessionRepository();
    this.packageRepository = deps?.packageRepository ?? new InMemoryCheckupPackageRepository();
    this.referenceRangeProvider = deps?.referenceRangeProvider ?? new DefaultReferenceRangeProvider();
    this.seniorAgeGroupProvider = deps?.seniorAgeGroupProvider ?? new DefaultSeniorAgeGroupProvider();
    this.eventBus = deps?.eventBus;
  }

  /**
   * Record a test result for a checkup session.
   *
   * Requirement 5.1: Only allow recording when session is "in-progress" and test belongs to assigned package.
   * Requirement 5.2: Validate plausible range before saving.
   * Requirement 5.3: Require explicit confirmation for out-of-range values.
   * Requirement 5.6: Display age-adjusted reference range alongside measured value.
   * Requirement 5.7: Handle save failures; preserve form data for retry.
   */
  async recordTestResult(request: TestResultRequest): Promise<TestResult> {
    // Validate request fields
    const validation = validateTestResultRequest(request);
    if (!validation.valid) {
      throw new Error(validation.message);
    }

    // Guard 1: Session must exist and be in-progress
    const session = await this.sessionRepository.findById(request.checkupSessionId);
    if (!session) {
      throw new CheckupSessionNotFoundError(request.checkupSessionId);
    }
    if (session.status !== 'in_progress') {
      throw new SessionNotInProgressError(request.checkupSessionId, session.status);
    }

    // Guard 2: Test must belong to the assigned package
    const pkg = await this.packageRepository.findById(session.packageId);
    if (!pkg) {
      throw new PackageNotFoundError(session.packageId);
    }

    const packageTest = pkg.tests.find((t) => t.testType === request.testType);
    if (!packageTest) {
      throw new TestNotInPackageError(request.testType, session.packageId);
    }

    // Guard 3: Validate plausible range
    const rangeResult = validatePlausibleRange(
      request.testType,
      request.measuredValue,
      packageTest.plausibleRange.min,
      packageTest.plausibleRange.max
    );

    if (!rangeResult.isWithinRange && !request.confirmOutOfRange) {
      throw new OutOfRangeNotConfirmedError(
        request.testType,
        request.measuredValue,
        packageTest.plausibleRange.min,
        packageTest.plausibleRange.max
      );
    }

    // Get age-adjusted reference range (Requirement 5.6)
    const ageGroup = await this.seniorAgeGroupProvider.getAgeGroup(session.seniorId);
    let ageAdjustedRange: ReferenceRange | undefined;
    if (ageGroup) {
      const range = this.referenceRangeProvider.getRange(request.testType, ageGroup);
      if (range) {
        ageAdjustedRange = range;
      }
    }

    // Build the test result
    const now = this.dateProvider();
    const testResult: TestResult = {
      id: this.idGenerator(),
      checkupSessionId: request.checkupSessionId,
      seniorId: session.seniorId,
      testType: request.testType,
      measuredValue: request.measuredValue,
      unit: request.unit,
      collectionTimestamp: request.collectionTimestamp,
      technicianId: request.technicianId,
      ageAdjustedRange,
      amendmentHistory: [],
      createdAt: now,
    };

    // Attempt save with error handling (Requirement 5.7)
    try {
      const savedResult = await this.testResultRepository.save(testResult);

      // Auto-completion detection (Requirement 5.4):
      // After recording, check if all package tests now have results.
      // If yes, automatically mark session as complete and publish event.
      await this.checkAndCompleteSession(session, pkg);

      return savedResult;
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Unknown save failure';
      throw new SaveFailedError(reason, request);
    }
  }

  /**
   * Amend an existing test result.
   *
   * Requirement 5.8: Present existing result, require confirmation, record both values with timestamps.
   */
  async amendTestResult(
    testResultId: string,
    newValue: MeasuredValue,
    technicianId: string
  ): Promise<TestResult> {
    const existing = await this.testResultRepository.findById(testResultId);
    if (!existing) {
      throw new TestResultNotFoundError(testResultId);
    }

    const now = this.dateProvider();

    // Record the amendment in history
    const amendment = {
      previousValue: existing.measuredValue,
      newValue: newValue.value,
      amendedBy: technicianId,
      amendedAt: now,
      reason: newValue.reason,
    };

    const updatedResult: TestResult = {
      ...existing,
      measuredValue: newValue.value,
      unit: newValue.unit,
      amendmentHistory: [...existing.amendmentHistory, amendment],
    };

    try {
      return await this.testResultRepository.update(updatedResult);
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Unknown save failure';
      throw new SaveFailedError(reason, { testResultId, newValue, technicianId });
    }
  }

  /**
   * Get all test results for a checkup session.
   */
  async getTestResults(checkupSessionId: string): Promise<TestResult[]> {
    return this.testResultRepository.findBySessionId(checkupSessionId);
  }

  /**
   * Get test history for a senior citizen, optionally filtered by test type.
   *
   * Requirement 5.5: Maintain complete history across all checkup sessions.
   */
  async getTestHistory(seniorId: string, testType?: string): Promise<TestResult[]> {
    return this.testResultRepository.findBySeniorId(seniorId, testType);
  }

  /**
   * Validate whether a value is within the plausible range for a test type.
   * Uses the package test configuration for the range.
   *
   * Requirement 5.2: Validate plausible range.
   */
  validatePlausibleRange(testType: string, value: number, plausibleMin: number, plausibleMax: number): PlausibleRangeResult {
    return validatePlausibleRange(testType, value, plausibleMin, plausibleMax);
  }

  /**
   * Check if all tests in the package have results for the session.
   * If yes, automatically mark the session as complete and publish CheckupSessionCompleted event.
   *
   * Requirement 5.4: Mark session "complete" when all package tests have results;
   * trigger report generation within 5 seconds.
   */
  private async checkAndCompleteSession(
    session: CheckupSession,
    pkg: CheckupPackage
  ): Promise<void> {
    const results = await this.testResultRepository.findBySessionId(session.id);
    const distinctTestTypesWithResults = new Set(results.map((r) => r.testType));
    const requiredTestCount = pkg.tests.length;

    if (distinctTestTypesWithResults.size >= requiredTestCount) {
      // All tests have results — auto-complete the session
      const now = this.dateProvider();
      const completedSession: CheckupSession = {
        ...session,
        status: 'complete',
        completedAt: now,
      };
      await this.sessionRepository.update(completedSession);

      // Publish CheckupSessionCompleted event to trigger report generation
      if (this.eventBus) {
        const event: CheckupSessionCompletedEvent = {
          id: this.idGenerator(),
          type: 'CheckupSessionCompleted',
          occurredAt: now.toISOString(),
          sourceId: session.id,
          payload: {
            checkupSessionId: session.id,
            seniorId: session.seniorId,
            packageId: session.packageId,
            assignedPhysicianId: session.assignedPhysicianId,
            completedAt: now.toISOString(),
          },
        };
        await this.eventBus.publish(event);
      }
    }
  }

  /**
   * Complete a checkup session when all tests have results.
   *
   * Requirement 5.4: Mark session as "complete" when all package tests are done.
   */
  async completeCheckupSession(sessionId: string): Promise<CheckupSession> {
    const session = await this.sessionRepository.findById(sessionId);
    if (!session) {
      throw new CheckupSessionNotFoundError(sessionId);
    }

    const now = this.dateProvider();
    const completedSession: CheckupSession = {
      ...session,
      status: 'complete',
      completedAt: now,
    };

    return this.sessionRepository.update(completedSession);
  }
}
