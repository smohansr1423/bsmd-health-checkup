/**
 * Test Execution Service - Unit Tests
 * Validates: Requirements 5.1, 5.2, 5.3, 5.6, 5.7
 */

import { AgeGroup, TestCategory } from '@health-checkup/shared';
import type { CheckupSession, CheckupPackage, TestResult, ReferenceRange } from '@health-checkup/shared';
import { InMemoryEventBus } from '@health-checkup/shared';
import {
  TestExecutionService,
  InMemoryTestResultRepository,
  InMemoryCheckupSessionRepository,
  InMemoryCheckupPackageRepository,
  DefaultReferenceRangeProvider,
  DefaultSeniorAgeGroupProvider,
  RETENTION_YEARS,
  isWithinRetentionPeriod,
} from './test-execution.service';
import {
  SessionNotInProgressError,
  TestNotInPackageError,
  OutOfRangeNotConfirmedError,
  CheckupSessionNotFoundError,
  PackageNotFoundError,
  TestResultNotFoundError,
  SaveFailedError,
} from './test-execution.errors';
import type { TestResultRequest, MeasuredValue } from './test-execution.types';

describe('TestExecutionService', () => {
  let service: TestExecutionService;
  let testResultRepo: InMemoryTestResultRepository;
  let sessionRepo: InMemoryCheckupSessionRepository;
  let packageRepo: InMemoryCheckupPackageRepository;
  let referenceRangeProvider: DefaultReferenceRangeProvider;
  let seniorAgeGroupProvider: DefaultSeniorAgeGroupProvider;

  const fixedDate = new Date('2024-06-15T10:00:00.000Z');
  let idCounter = 0;

  const testPackage: CheckupPackage = {
    id: 'pkg-001',
    name: 'Basic Health Checkup',
    tier: 'Basic',
    tests: [
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
    ],
    totalCost: 90,
    isActive: true,
    createdAt: fixedDate,
    updatedAt: fixedDate,
  };

  const testSession: CheckupSession = {
    id: 'session-001',
    appointmentId: 'apt-001',
    seniorId: 'senior-001',
    packageId: 'pkg-001',
    assignedPhysicianId: 'physician-001',
    assignedSpecialists: [],
    status: 'in_progress',
    startedAt: fixedDate,
  };

  const validRequest: TestResultRequest = {
    checkupSessionId: 'session-001',
    testType: 'blood_sugar',
    measuredValue: 100,
    unit: 'mg/dL',
    collectionTimestamp: fixedDate,
    technicianId: 'tech-001',
  };

  beforeEach(() => {
    idCounter = 0;
    testResultRepo = new InMemoryTestResultRepository();
    sessionRepo = new InMemoryCheckupSessionRepository();
    packageRepo = new InMemoryCheckupPackageRepository();
    referenceRangeProvider = new DefaultReferenceRangeProvider();
    seniorAgeGroupProvider = new DefaultSeniorAgeGroupProvider();

    // Seed test data
    sessionRepo.addSession({ ...testSession });
    packageRepo.addPackage({ ...testPackage });
    seniorAgeGroupProvider.setAgeGroup('senior-001', AgeGroup.SixtyToSixtyNine);

    service = new TestExecutionService({
      idGenerator: () => `TR_${++idCounter}`,
      dateProvider: () => fixedDate,
      testResultRepository: testResultRepo,
      sessionRepository: sessionRepo,
      packageRepository: packageRepo,
      referenceRangeProvider,
      seniorAgeGroupProvider,
    });
  });

  describe('recordTestResult', () => {
    it('should record a valid test result successfully', async () => {
      const result = await service.recordTestResult(validRequest);

      expect(result.id).toBe('TR_1');
      expect(result.checkupSessionId).toBe('session-001');
      expect(result.seniorId).toBe('senior-001');
      expect(result.testType).toBe('blood_sugar');
      expect(result.measuredValue).toBe(100);
      expect(result.unit).toBe('mg/dL');
      expect(result.technicianId).toBe('tech-001');
      expect(result.amendmentHistory).toEqual([]);
      expect(result.createdAt).toEqual(fixedDate);
    });

    it('should attach age-adjusted reference range when available (Req 5.6)', async () => {
      const result = await service.recordTestResult(validRequest);

      expect(result.ageAdjustedRange).toBeDefined();
      expect(result.ageAdjustedRange!.ageGroup).toBe(AgeGroup.SixtyToSixtyNine);
      expect(result.ageAdjustedRange!.min).toBe(70);
      expect(result.ageAdjustedRange!.max).toBe(130);
    });

    it('should not attach reference range when age group is unknown', async () => {
      // Use a senior without age group set
      sessionRepo.addSession({
        ...testSession,
        id: 'session-002',
        seniorId: 'senior-unknown',
      });

      const request: TestResultRequest = {
        ...validRequest,
        checkupSessionId: 'session-002',
      };

      const result = await service.recordTestResult(request);
      expect(result.ageAdjustedRange).toBeUndefined();
    });

    describe('Guard 1: Session must be in-progress (Req 5.1)', () => {
      it('should throw SessionNotInProgressError when session is complete', async () => {
        sessionRepo.addSession({
          ...testSession,
          id: 'session-complete',
          status: 'complete',
          completedAt: fixedDate,
        });

        const request: TestResultRequest = {
          ...validRequest,
          checkupSessionId: 'session-complete',
        };

        await expect(service.recordTestResult(request)).rejects.toThrow(
          SessionNotInProgressError
        );
      });

      it('should throw SessionNotInProgressError when session is pending_results', async () => {
        sessionRepo.addSession({
          ...testSession,
          id: 'session-pending',
          status: 'pending_results',
        });

        const request: TestResultRequest = {
          ...validRequest,
          checkupSessionId: 'session-pending',
        };

        await expect(service.recordTestResult(request)).rejects.toThrow(
          SessionNotInProgressError
        );
      });

      it('should throw CheckupSessionNotFoundError when session does not exist', async () => {
        const request: TestResultRequest = {
          ...validRequest,
          checkupSessionId: 'non-existent',
        };

        await expect(service.recordTestResult(request)).rejects.toThrow(
          CheckupSessionNotFoundError
        );
      });
    });

    describe('Guard 2: Test must belong to assigned package (Req 5.1)', () => {
      it('should throw TestNotInPackageError when test type is not in package', async () => {
        const request: TestResultRequest = {
          ...validRequest,
          testType: 'cardiac_stress_test',
        };

        await expect(service.recordTestResult(request)).rejects.toThrow(
          TestNotInPackageError
        );
      });

      it('should throw PackageNotFoundError when package does not exist', async () => {
        sessionRepo.addSession({
          ...testSession,
          id: 'session-bad-pkg',
          packageId: 'nonexistent-pkg',
        });

        const request: TestResultRequest = {
          ...validRequest,
          checkupSessionId: 'session-bad-pkg',
        };

        await expect(service.recordTestResult(request)).rejects.toThrow(
          PackageNotFoundError
        );
      });
    });

    describe('Guard 3: Plausible range validation (Req 5.2, 5.3)', () => {
      it('should throw OutOfRangeNotConfirmedError when value exceeds plausible max without confirmation', async () => {
        const request: TestResultRequest = {
          ...validRequest,
          measuredValue: 600, // plausible max is 500
        };

        await expect(service.recordTestResult(request)).rejects.toThrow(
          OutOfRangeNotConfirmedError
        );
      });

      it('should throw OutOfRangeNotConfirmedError when value is below plausible min without confirmation', async () => {
        const request: TestResultRequest = {
          ...validRequest,
          measuredValue: 30, // plausible min is 40
        };

        await expect(service.recordTestResult(request)).rejects.toThrow(
          OutOfRangeNotConfirmedError
        );
      });

      it('should allow out-of-range value when confirmOutOfRange is true', async () => {
        const request: TestResultRequest = {
          ...validRequest,
          measuredValue: 600,
          confirmOutOfRange: true,
        };

        const result = await service.recordTestResult(request);
        expect(result.measuredValue).toBe(600);
      });

      it('should record value at the exact plausible boundary without requiring confirmation', async () => {
        const requestAtMin: TestResultRequest = { ...validRequest, measuredValue: 40 };
        const resultMin = await service.recordTestResult(requestAtMin);
        expect(resultMin.measuredValue).toBe(40);

        const requestAtMax: TestResultRequest = { ...validRequest, measuredValue: 500 };
        const resultMax = await service.recordTestResult(requestAtMax);
        expect(resultMax.measuredValue).toBe(500);
      });
    });

    describe('Save failure handling (Req 5.7)', () => {
      it('should throw SaveFailedError with preserved request data on repository failure', async () => {
        // Create a repo that always fails on save
        const failingRepo: InMemoryTestResultRepository = new InMemoryTestResultRepository();
        failingRepo.save = async () => {
          throw new Error('Database connection lost');
        };

        const failingService = new TestExecutionService({
          idGenerator: () => `TR_${++idCounter}`,
          dateProvider: () => fixedDate,
          testResultRepository: failingRepo,
          sessionRepository: sessionRepo,
          packageRepository: packageRepo,
          referenceRangeProvider,
          seniorAgeGroupProvider,
        });

        await expect(failingService.recordTestResult(validRequest)).rejects.toThrow(
          SaveFailedError
        );

        try {
          await failingService.recordTestResult(validRequest);
        } catch (error) {
          expect(error).toBeInstanceOf(SaveFailedError);
          const saveError = error as SaveFailedError;
          expect(saveError.originalRequest).toEqual(validRequest);
          expect(saveError.failureReason).toBe('Database connection lost');
        }
      });
    });

    it('should reject request with missing required fields', async () => {
      const request: TestResultRequest = {
        ...validRequest,
        checkupSessionId: '',
      };

      await expect(service.recordTestResult(request)).rejects.toThrow(
        'Checkup session ID is required.'
      );
    });
  });

  describe('amendTestResult', () => {
    let savedResult: TestResult;

    beforeEach(async () => {
      savedResult = await service.recordTestResult(validRequest);
    });

    it('should amend a test result and preserve history', async () => {
      const newValue: MeasuredValue = {
        value: 120,
        unit: 'mg/dL',
        reason: 'Recalibrated instrument',
      };

      const amended = await service.amendTestResult(savedResult.id, newValue, 'tech-002');

      expect(amended.measuredValue).toBe(120);
      expect(amended.unit).toBe('mg/dL');
      expect(amended.amendmentHistory).toHaveLength(1);
      expect(amended.amendmentHistory[0].previousValue).toBe(100);
      expect(amended.amendmentHistory[0].newValue).toBe(120);
      expect(amended.amendmentHistory[0].amendedBy).toBe('tech-002');
      expect(amended.amendmentHistory[0].reason).toBe('Recalibrated instrument');
    });

    it('should accumulate multiple amendments in history', async () => {
      const firstAmend: MeasuredValue = { value: 110, unit: 'mg/dL' };
      const secondAmend: MeasuredValue = { value: 115, unit: 'mg/dL', reason: 'Final correction' };

      await service.amendTestResult(savedResult.id, firstAmend, 'tech-001');
      const result = await service.amendTestResult(savedResult.id, secondAmend, 'tech-002');

      expect(result.amendmentHistory).toHaveLength(2);
      expect(result.amendmentHistory[0].previousValue).toBe(100);
      expect(result.amendmentHistory[0].newValue).toBe(110);
      expect(result.amendmentHistory[1].previousValue).toBe(110);
      expect(result.amendmentHistory[1].newValue).toBe(115);
    });

    it('should throw TestResultNotFoundError for non-existent result', async () => {
      const newValue: MeasuredValue = { value: 120, unit: 'mg/dL' };

      await expect(
        service.amendTestResult('non-existent', newValue, 'tech-001')
      ).rejects.toThrow(TestResultNotFoundError);
    });
  });

  describe('getTestResults', () => {
    it('should return all results for a session', async () => {
      await service.recordTestResult(validRequest);
      await service.recordTestResult({
        ...validRequest,
        testType: 'lipid_profile',
        measuredValue: 180,
      });

      const results = await service.getTestResults('session-001');
      expect(results).toHaveLength(2);
      expect(results.map((r) => r.testType)).toContain('blood_sugar');
      expect(results.map((r) => r.testType)).toContain('lipid_profile');
    });

    it('should return empty array for session with no results', async () => {
      const results = await service.getTestResults('session-001');
      expect(results).toEqual([]);
    });
  });

  describe('getTestHistory', () => {
    it('should return all results for a senior citizen', async () => {
      await service.recordTestResult(validRequest);

      const history = await service.getTestHistory('senior-001');
      expect(history).toHaveLength(1);
      expect(history[0].seniorId).toBe('senior-001');
    });

    it('should filter by test type', async () => {
      await service.recordTestResult(validRequest);
      await service.recordTestResult({
        ...validRequest,
        testType: 'lipid_profile',
        measuredValue: 180,
      });

      const history = await service.getTestHistory('senior-001', 'blood_sugar');
      expect(history).toHaveLength(1);
      expect(history[0].testType).toBe('blood_sugar');
    });

    it('should return empty array for unknown senior', async () => {
      const history = await service.getTestHistory('unknown-senior');
      expect(history).toEqual([]);
    });
  });

  describe('validatePlausibleRange', () => {
    it('should return isWithinRange true for value within range', () => {
      const result = service.validatePlausibleRange('blood_sugar', 100, 40, 500);
      expect(result.isWithinRange).toBe(true);
      expect(result.requiresConfirmation).toBe(false);
    });

    it('should return isWithinRange false for value above range', () => {
      const result = service.validatePlausibleRange('blood_sugar', 600, 40, 500);
      expect(result.isWithinRange).toBe(false);
      expect(result.requiresConfirmation).toBe(true);
    });

    it('should return isWithinRange false for value below range', () => {
      const result = service.validatePlausibleRange('blood_sugar', 30, 40, 500);
      expect(result.isWithinRange).toBe(false);
      expect(result.requiresConfirmation).toBe(true);
    });

    it('should return isWithinRange true at exact boundaries', () => {
      const resultMin = service.validatePlausibleRange('blood_sugar', 40, 40, 500);
      expect(resultMin.isWithinRange).toBe(true);

      const resultMax = service.validatePlausibleRange('blood_sugar', 500, 40, 500);
      expect(resultMax.isWithinRange).toBe(true);
    });
  });

  describe('completeCheckupSession', () => {
    it('should mark session as complete with completedAt timestamp', async () => {
      const completed = await service.completeCheckupSession('session-001');

      expect(completed.status).toBe('complete');
      expect(completed.completedAt).toEqual(fixedDate);
    });

    it('should throw CheckupSessionNotFoundError for non-existent session', async () => {
      await expect(service.completeCheckupSession('non-existent')).rejects.toThrow(
        CheckupSessionNotFoundError
      );
    });
  });

  describe('auto-completion detection (Req 5.4)', () => {
    let eventBus: InMemoryEventBus;
    let serviceWithEvents: TestExecutionService;

    beforeEach(() => {
      eventBus = new InMemoryEventBus();
      serviceWithEvents = new TestExecutionService({
        idGenerator: () => `TR_${++idCounter}`,
        dateProvider: () => fixedDate,
        testResultRepository: testResultRepo,
        sessionRepository: sessionRepo,
        packageRepository: packageRepo,
        referenceRangeProvider,
        seniorAgeGroupProvider,
        eventBus,
      });
    });

    it('should auto-complete session when all package tests have results', async () => {
      // Record first test (blood_sugar)
      await serviceWithEvents.recordTestResult(validRequest);

      // Session should still be in_progress (only 1 of 2 tests done)
      const sessionAfterFirst = await sessionRepo.findById('session-001');
      expect(sessionAfterFirst!.status).toBe('in_progress');

      // Record second test (lipid_profile)
      await serviceWithEvents.recordTestResult({
        ...validRequest,
        testType: 'lipid_profile',
        measuredValue: 180,
      });

      // Session should now be complete
      const sessionAfterAll = await sessionRepo.findById('session-001');
      expect(sessionAfterAll!.status).toBe('complete');
      expect(sessionAfterAll!.completedAt).toEqual(fixedDate);
    });

    it('should publish CheckupSessionCompleted event when session auto-completes', async () => {
      const publishedEvents: any[] = [];
      eventBus.subscribe('CheckupSessionCompleted', (event) => {
        publishedEvents.push(event);
      });

      // Record both tests to trigger auto-completion
      await serviceWithEvents.recordTestResult(validRequest);
      await serviceWithEvents.recordTestResult({
        ...validRequest,
        testType: 'lipid_profile',
        measuredValue: 180,
      });

      expect(publishedEvents).toHaveLength(1);
      expect(publishedEvents[0].type).toBe('CheckupSessionCompleted');
      expect(publishedEvents[0].payload.checkupSessionId).toBe('session-001');
      expect(publishedEvents[0].payload.seniorId).toBe('senior-001');
      expect(publishedEvents[0].payload.packageId).toBe('pkg-001');
      expect(publishedEvents[0].payload.assignedPhysicianId).toBe('physician-001');
      expect(publishedEvents[0].payload.completedAt).toBe(fixedDate.toISOString());
    });

    it('should NOT auto-complete when not all tests have results', async () => {
      const publishedEvents: any[] = [];
      eventBus.subscribe('CheckupSessionCompleted', (event) => {
        publishedEvents.push(event);
      });

      // Record only one of two required tests
      await serviceWithEvents.recordTestResult(validRequest);

      const session = await sessionRepo.findById('session-001');
      expect(session!.status).toBe('in_progress');
      expect(publishedEvents).toHaveLength(0);
    });

    it('should work without event bus configured (no event published)', async () => {
      // The default service has no eventBus — should still auto-complete without error
      await service.recordTestResult(validRequest);
      await service.recordTestResult({
        ...validRequest,
        testType: 'lipid_profile',
        measuredValue: 180,
      });

      const session = await sessionRepo.findById('session-001');
      expect(session!.status).toBe('complete');
    });

    it('should count distinct test types, not total results', async () => {
      const publishedEvents: any[] = [];
      eventBus.subscribe('CheckupSessionCompleted', (event) => {
        publishedEvents.push(event);
      });

      // Record the same test type twice — should NOT trigger completion
      await serviceWithEvents.recordTestResult(validRequest);
      await serviceWithEvents.recordTestResult({
        ...validRequest,
        measuredValue: 105, // same testType, different value
      });

      const session = await sessionRepo.findById('session-001');
      expect(session!.status).toBe('in_progress');
      expect(publishedEvents).toHaveLength(0);
    });
  });

  describe('isWithinRetentionPeriod', () => {
    it('should return true for results within 10-year retention period', () => {
      const now = new Date('2024-06-15T10:00:00.000Z');
      const fiveYearsAgo = new Date('2019-06-15T10:00:00.000Z');
      expect(isWithinRetentionPeriod(fiveYearsAgo, now)).toBe(true);
    });

    it('should return true for results created exactly 10 years ago', () => {
      const now = new Date('2024-06-15T10:00:00.000Z');
      const tenYearsAgo = new Date('2014-06-15T10:00:00.000Z');
      expect(isWithinRetentionPeriod(tenYearsAgo, now)).toBe(true);
    });

    it('should return false for results older than 10 years', () => {
      const now = new Date('2024-06-15T10:00:00.000Z');
      const elevenYearsAgo = new Date('2013-06-14T10:00:00.000Z');
      expect(isWithinRetentionPeriod(elevenYearsAgo, now)).toBe(false);
    });

    it('should return true for results created today', () => {
      const now = new Date('2024-06-15T10:00:00.000Z');
      expect(isWithinRetentionPeriod(now, now)).toBe(true);
    });

    it('should use current date when now is not provided', () => {
      const recentDate = new Date();
      recentDate.setFullYear(recentDate.getFullYear() - 1);
      expect(isWithinRetentionPeriod(recentDate)).toBe(true);
    });
  });

  describe('RETENTION_YEARS constant', () => {
    it('should be 10 years', () => {
      expect(RETENTION_YEARS).toBe(10);
    });
  });
});
