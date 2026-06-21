/**
 * Physician Assignment Service Tests
 * Unit tests for physician and specialist assignment logic.
 * Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5, 4.6
 */

import { TestCategory } from '@health-checkup/shared';
import type { Physician, WeeklySchedule } from '@health-checkup/shared';
import {
  PhysicianAssignmentService,
  InMemoryPhysicianAssignmentRepository,
  InMemoryPhysicianHistoryRepository,
  InMemoryAssignmentQueueRepository,
  InMemoryNotificationSender,
  InMemoryAdminNotifier,
} from './physician-assignment.service';
import { SPECIALIST_MAPPING } from './physician-assignment.types';
import {
  InvalidSeniorIdError,
  InvalidSessionIdError,
  NoPhysicianAvailableError,
} from './physician-assignment.errors';

function createWeeklySchedule(available: boolean): WeeklySchedule {
  const day = { isAvailable: available, startTime: '09:00', endTime: '17:00' };
  return {
    monday: day,
    tuesday: day,
    wednesday: day,
    thursday: day,
    friday: day,
    saturday: { isAvailable: false },
    sunday: { isAvailable: false },
  };
}

function createPhysician(overrides: Partial<Physician> = {}): Physician {
  return {
    id: 'phys-1',
    name: 'Dr. Smith',
    specialization: 'general',
    qualifications: ['MBBS', 'MD'],
    department: 'Internal Medicine',
    availabilitySchedule: createWeeklySchedule(true),
    isActive: true,
    ...overrides,
  };
}

describe('PhysicianAssignmentService', () => {
  let service: PhysicianAssignmentService;
  let physicianRepo: InMemoryPhysicianAssignmentRepository;
  let historyRepo: InMemoryPhysicianHistoryRepository;
  let queueRepo: InMemoryAssignmentQueueRepository;
  let notificationSender: InMemoryNotificationSender;
  let adminNotifier: InMemoryAdminNotifier;
  let idCounter: number;
  const fixedDate = new Date('2024-06-15T10:00:00Z');

  beforeEach(() => {
    physicianRepo = new InMemoryPhysicianAssignmentRepository();
    historyRepo = new InMemoryPhysicianHistoryRepository();
    queueRepo = new InMemoryAssignmentQueueRepository();
    notificationSender = new InMemoryNotificationSender();
    adminNotifier = new InMemoryAdminNotifier();
    idCounter = 0;

    service = new PhysicianAssignmentService({
      idGenerator: () => `ID_${++idCounter}`,
      dateProvider: () => fixedDate,
      physicianRepository: physicianRepo,
      historyRepository: historyRepo,
      queueRepository: queueRepo,
      notificationSender,
      adminNotifier,
    });
  });

  describe('assignPrimaryPhysician', () => {
    it('should throw InvalidSeniorIdError for empty seniorId', async () => {
      await expect(service.assignPrimaryPhysician('')).rejects.toThrow(InvalidSeniorIdError);
    });

    it('should assign preferred physician when available (Requirement 4.1)', async () => {
      const physician = createPhysician({ id: 'preferred-doc' });
      physicianRepo.addPhysician(physician);

      const result = await service.assignPrimaryPhysician('senior-1', 'preferred-doc');

      expect(result.physicianId).toBe('preferred-doc');
      expect(result.reason).toBe('preferred');
      expect(result.seniorId).toBe('senior-1');
      expect(result.assignedAt).toEqual(fixedDate);
    });

    it('should fallback to most recent physician from history (Requirement 4.1)', async () => {
      const recentDoc = createPhysician({ id: 'recent-doc', specialization: 'cardiologist' });
      physicianRepo.addPhysician(recentDoc);

      await historyRepo.save({
        seniorId: 'senior-1',
        physicianId: 'recent-doc',
        sessionId: 'session-old',
        assignedAt: new Date('2024-01-01'),
      });

      const result = await service.assignPrimaryPhysician('senior-1');

      expect(result.physicianId).toBe('recent-doc');
      expect(result.reason).toBe('most_recent');
    });

    it('should fallback to same specialization when most recent is inactive (Requirement 4.1)', async () => {
      const inactiveDoc = createPhysician({ id: 'inactive-doc', specialization: 'cardiologist', isActive: false });
      const fallbackDoc = createPhysician({ id: 'fallback-doc', specialization: 'cardiologist' });
      physicianRepo.addPhysician(inactiveDoc);
      physicianRepo.addPhysician(fallbackDoc);

      await historyRepo.save({
        seniorId: 'senior-1',
        physicianId: 'inactive-doc',
        sessionId: 'session-old',
        assignedAt: new Date('2024-01-01'),
      });

      const result = await service.assignPrimaryPhysician('senior-1');

      expect(result.physicianId).toBe('fallback-doc');
      expect(result.reason).toBe('fallback_same_specialization');
    });

    it('should fallback to any available physician when no history match (Requirement 4.1)', async () => {
      const anyDoc = createPhysician({ id: 'any-doc' });
      physicianRepo.addPhysician(anyDoc);

      const result = await service.assignPrimaryPhysician('senior-1');

      expect(result.physicianId).toBe('any-doc');
      expect(result.reason).toBe('fallback_available');
    });

    it('should throw NoPhysicianAvailableError when no physicians exist', async () => {
      await expect(service.assignPrimaryPhysician('senior-1')).rejects.toThrow(
        NoPhysicianAvailableError
      );
    });

    it('should record assignment in history', async () => {
      const physician = createPhysician({ id: 'doc-1' });
      physicianRepo.addPhysician(physician);

      await service.assignPrimaryPhysician('senior-1');

      const history = await historyRepo.findBySeniorId('senior-1');
      expect(history.length).toBe(1);
      expect(history[0].physicianId).toBe('doc-1');
    });

    it('should skip unavailable preferred physician and use most recent', async () => {
      const inactivePreferred = createPhysician({ id: 'pref-doc', isActive: false });
      const recentDoc = createPhysician({ id: 'recent-doc' });
      physicianRepo.addPhysician(inactivePreferred);
      physicianRepo.addPhysician(recentDoc);

      await historyRepo.save({
        seniorId: 'senior-1',
        physicianId: 'recent-doc',
        sessionId: 'session-1',
        assignedAt: new Date('2024-05-01'),
      });

      const result = await service.assignPrimaryPhysician('senior-1', 'pref-doc');

      expect(result.physicianId).toBe('recent-doc');
      expect(result.reason).toBe('most_recent');
    });
  });

  describe('assignSpecialists', () => {
    it('should throw InvalidSessionIdError for empty sessionId', async () => {
      await expect(
        service.assignSpecialists('', [TestCategory.Cardiac])
      ).rejects.toThrow(InvalidSessionIdError);
    });

    it('should assign correct specialist by test category (Requirement 4.2)', async () => {
      const cardiologist = createPhysician({ id: 'cardio-1', specialization: 'cardiologist' });
      physicianRepo.addPhysician(cardiologist);

      const result = await service.assignSpecialists('session-1', [TestCategory.Cardiac]);

      expect(result.length).toBe(1);
      expect(result[0].specialization).toBe('cardiologist');
      expect(result[0].physicianId).toBe('cardio-1');
      expect(result[0].testCategory).toBe(TestCategory.Cardiac);
    });

    it('should assign specialists for multiple test categories (Requirement 4.2)', async () => {
      const cardiologist = createPhysician({ id: 'cardio-1', specialization: 'cardiologist' });
      const ophthalmologist = createPhysician({ id: 'eye-1', specialization: 'ophthalmologist' });
      const audiologist = createPhysician({ id: 'audio-1', specialization: 'audiologist' });
      physicianRepo.addPhysician(cardiologist);
      physicianRepo.addPhysician(ophthalmologist);
      physicianRepo.addPhysician(audiologist);

      const result = await service.assignSpecialists('session-1', [
        TestCategory.Cardiac,
        TestCategory.Vision,
        TestCategory.Hearing,
      ]);

      expect(result.length).toBe(3);
      expect(result.find((a) => a.testCategory === TestCategory.Cardiac)?.specialization).toBe('cardiologist');
      expect(result.find((a) => a.testCategory === TestCategory.Vision)?.specialization).toBe('ophthalmologist');
      expect(result.find((a) => a.testCategory === TestCategory.Hearing)?.specialization).toBe('audiologist');
    });

    it('should send referral notification within 24 hours (Requirement 4.6)', async () => {
      const cardiologist = createPhysician({ id: 'cardio-1', specialization: 'cardiologist' });
      physicianRepo.addPhysician(cardiologist);

      await service.assignSpecialists('session-1', [TestCategory.Cardiac]);

      expect(notificationSender.sentNotifications.length).toBe(1);
      const notification = notificationSender.sentNotifications[0];
      expect(notification.sentAt).toEqual(fixedDate);

      const deadlineMs = notification.deadlineAt.getTime() - notification.sentAt.getTime();
      const twentyFourHoursMs = 24 * 60 * 60 * 1000;
      expect(deadlineMs).toBe(twentyFourHoursMs);
    });

    it('should handle specialist unavailability (Requirement 4.5)', async () => {
      // No cardiologists available
      const result = await service.assignSpecialists('session-1', [TestCategory.Cardiac]);

      expect(result.length).toBe(0);
      expect(adminNotifier.notifications.length).toBe(1);
      expect(adminNotifier.notifications[0].specialization).toBe('cardiologist');
      expect(adminNotifier.notifications[0].sessionId).toBe('session-1');
    });

    it('should deduplicate specializations for multiple categories mapping to same specialist', async () => {
      const generalDoc = createPhysician({ id: 'gen-1', specialization: 'general' });
      physicianRepo.addPhysician(generalDoc);

      // Blood, Urine, and OrganFunction all map to 'general'
      const result = await service.assignSpecialists('session-1', [
        TestCategory.Blood,
        TestCategory.Urine,
        TestCategory.OrganFunction,
      ]);

      expect(result.length).toBe(3);
      // All assigned to same specialist
      expect(result.every((a) => a.physicianId === 'gen-1')).toBe(true);
      // But only one notification sent (per specialization)
      expect(notificationSender.sentNotifications.length).toBe(1);
    });
  });

  describe('suggestAlternatives', () => {
    it('should suggest at least 3 alternatives (Requirement 4.4)', async () => {
      for (let i = 1; i <= 5; i++) {
        physicianRepo.addPhysician(
          createPhysician({ id: `cardio-${i}`, specialization: 'cardiologist' })
        );
      }

      const result = await service.suggestAlternatives('cardiologist');

      expect(result.length).toBeGreaterThanOrEqual(3);
    });

    it('should return all available if fewer than 3 exist', async () => {
      physicianRepo.addPhysician(
        createPhysician({ id: 'cardio-1', specialization: 'cardiologist' })
      );
      physicianRepo.addPhysician(
        createPhysician({ id: 'cardio-2', specialization: 'cardiologist' })
      );

      const result = await service.suggestAlternatives('cardiologist');

      expect(result.length).toBe(2);
    });

    it('should return empty array when no physicians with that specialization', async () => {
      const result = await service.suggestAlternatives('cardiologist');

      expect(result.length).toBe(0);
    });

    it('should respect custom count parameter', async () => {
      for (let i = 1; i <= 10; i++) {
        physicianRepo.addPhysician(
          createPhysician({ id: `cardio-${i}`, specialization: 'cardiologist' })
        );
      }

      const result = await service.suggestAlternatives('cardiologist', 5);

      expect(result.length).toBeGreaterThanOrEqual(5);
    });
  });

  describe('handleUnavailability', () => {
    it('should notify admin when specialist unavailable (Requirement 4.5)', async () => {
      const result = await service.handleUnavailability('cardiologist', 'session-1');

      expect(result.adminNotified).toBe(true);
      expect(adminNotifier.notifications.length).toBe(1);
      expect(adminNotifier.notifications[0].specialization).toBe('cardiologist');
    });

    it('should queue assignment (Requirement 4.5)', async () => {
      const result = await service.handleUnavailability('cardiologist', 'session-1');

      expect(result.status).toBe('queued');
      expect(result.queuedAt).toEqual(fixedDate);

      const queued = await queueRepo.findBySessionId('session-1');
      expect(queued.length).toBe(1);
      expect(queued[0].specialization).toBe('cardiologist');
      expect(queued[0].status).toBe('pending');
    });

    it('should show earliest available date when physicians exist but unavailable (Requirement 4.5)', async () => {
      // Add an inactive cardiologist (exists but not available via findAvailableBySpecialization)
      physicianRepo.addPhysician(
        createPhysician({ id: 'cardio-inactive', specialization: 'cardiologist', isActive: false })
      );

      const result = await service.handleUnavailability('cardiologist', 'session-1');

      // No active physicians found by findBySpecialization (filters isActive), so null
      expect(result.earliestAvailableDate).toBeNull();
    });

    it('should return null earliest date when no physicians of that specialization exist', async () => {
      const result = await service.handleUnavailability('cardiologist', 'session-1');

      expect(result.earliestAvailableDate).toBeNull();
    });
  });

  describe('SPECIALIST_MAPPING', () => {
    it('should map cardiac to cardiologist (Requirement 4.2)', () => {
      expect(SPECIALIST_MAPPING[TestCategory.Cardiac]).toBe('cardiologist');
    });

    it('should map vision to ophthalmologist (Requirement 4.2)', () => {
      expect(SPECIALIST_MAPPING[TestCategory.Vision]).toBe('ophthalmologist');
    });

    it('should map hearing to audiologist (Requirement 4.2)', () => {
      expect(SPECIALIST_MAPPING[TestCategory.Hearing]).toBe('audiologist');
    });

    it('should map musculoskeletal to orthopedist (Requirement 4.2)', () => {
      expect(SPECIALIST_MAPPING[TestCategory.Musculoskeletal]).toBe('orthopedist');
    });

    it('should map blood to general (Requirement 4.2)', () => {
      expect(SPECIALIST_MAPPING[TestCategory.Blood]).toBe('general');
    });

    it('should map imaging to radiologist (Requirement 4.2)', () => {
      expect(SPECIALIST_MAPPING[TestCategory.Imaging]).toBe('radiologist');
    });

    it('should map cognitive to neurologist (Requirement 4.2)', () => {
      expect(SPECIALIST_MAPPING[TestCategory.Cognitive]).toBe('neurologist');
    });

    it('should map endocrine to endocrinologist (Requirement 4.2)', () => {
      expect(SPECIALIST_MAPPING[TestCategory.Endocrine]).toBe('endocrinologist');
    });

    it('should have a mapping for every TestCategory value', () => {
      const allCategories = Object.values(TestCategory);
      for (const category of allCategories) {
        expect(SPECIALIST_MAPPING[category]).toBeDefined();
      }
    });
  });

  describe('getSpecializationForCategory', () => {
    it('should return the correct specialization for each category', () => {
      expect(service.getSpecializationForCategory(TestCategory.Cardiac)).toBe('cardiologist');
      expect(service.getSpecializationForCategory(TestCategory.Vision)).toBe('ophthalmologist');
      expect(service.getSpecializationForCategory(TestCategory.Hearing)).toBe('audiologist');
      expect(service.getSpecializationForCategory(TestCategory.Musculoskeletal)).toBe('orthopedist');
    });
  });
});
