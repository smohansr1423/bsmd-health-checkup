/**
 * Test Execution Service Types
 * Request/response types for test result recording, amendment, and session management.
 * Validates: Requirements 5.1, 5.2, 5.3, 5.6, 5.7
 */

import type { CheckupSession, CheckupPackage, TestResult, ReferenceRange } from '@health-checkup/shared';
import type { AgeGroup } from '@health-checkup/shared';
import type { EventBus } from '@health-checkup/shared';

/**
 * Request payload for recording a test result.
 */
export interface TestResultRequest {
  checkupSessionId: string;
  testType: string;
  measuredValue: number;
  unit: string;
  collectionTimestamp: Date;
  technicianId: string;
  confirmOutOfRange?: boolean; // required if value is outside plausible range
}

/**
 * Value type used for amending a test result.
 */
export interface MeasuredValue {
  value: number;
  unit: string;
  reason?: string;
}

/**
 * Result of plausible range validation.
 */
export interface PlausibleRangeResult {
  isWithinRange: boolean;
  plausibleMin: number;
  plausibleMax: number;
  measuredValue: number;
  requiresConfirmation: boolean;
}

/**
 * Repository interface for TestResult persistence.
 */
export interface TestResultRepository {
  save(result: TestResult): Promise<TestResult>;
  findById(id: string): Promise<TestResult | null>;
  findBySessionId(sessionId: string): Promise<TestResult[]>;
  findBySeniorId(seniorId: string, testType?: string): Promise<TestResult[]>;
  update(result: TestResult): Promise<TestResult>;
}

/**
 * Repository interface for CheckupSession access.
 */
export interface CheckupSessionRepository {
  findById(id: string): Promise<CheckupSession | null>;
  update(session: CheckupSession): Promise<CheckupSession>;
}

/**
 * Repository interface for CheckupPackage access (read-only).
 */
export interface CheckupPackageRepository {
  findById(id: string): Promise<CheckupPackage | null>;
}

/**
 * Provider for age-adjusted reference ranges.
 */
export interface ReferenceRangeProvider {
  getRange(testType: string, ageGroup: AgeGroup): ReferenceRange | null;
}

/**
 * Provider for the senior citizen's age group.
 */
export interface SeniorAgeGroupProvider {
  getAgeGroup(seniorId: string): Promise<AgeGroup | null>;
}

/**
 * Dependencies injected into the TestExecutionService for testability.
 */
export interface TestExecutionDependencies {
  idGenerator: () => string;
  dateProvider: () => Date;
  testResultRepository: TestResultRepository;
  sessionRepository: CheckupSessionRepository;
  packageRepository: CheckupPackageRepository;
  referenceRangeProvider: ReferenceRangeProvider;
  seniorAgeGroupProvider: SeniorAgeGroupProvider;
  eventBus?: EventBus;
}
