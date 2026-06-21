/**
 * Test Execution Service barrel export
 */
export {
  TestExecutionService,
  InMemoryTestResultRepository,
  InMemoryCheckupSessionRepository as TestExecutionSessionRepository,
  InMemoryCheckupPackageRepository as TestExecutionPackageRepository,
  DefaultReferenceRangeProvider,
  DefaultSeniorAgeGroupProvider,
  RETENTION_YEARS,
  isWithinRetentionPeriod,
} from './test-execution.service';
export {
  validateTestResultRequest,
  validatePlausibleRange,
} from './test-execution.validators';
export {
  SessionNotInProgressError,
  TestNotInPackageError,
  OutOfRangeNotConfirmedError,
  CheckupSessionNotFoundError,
  PackageNotFoundError as TestExecutionPackageNotFoundError,
  TestResultNotFoundError,
  SaveFailedError,
} from './test-execution.errors';
export type {
  TestResultRequest,
  MeasuredValue,
  PlausibleRangeResult,
  TestResultRepository,
  CheckupSessionRepository as TestExecutionSessionRepositoryInterface,
  CheckupPackageRepository as TestExecutionPackageRepositoryInterface,
  ReferenceRangeProvider,
  SeniorAgeGroupProvider,
  TestExecutionDependencies,
} from './test-execution.types';
export type { ValidationResult as TestExecutionValidationResult } from './test-execution.validators';
