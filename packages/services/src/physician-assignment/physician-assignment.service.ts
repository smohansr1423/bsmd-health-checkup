/**
 * Physician Assignment Service
 * Manages primary physician assignment, specialist assignment by test category,
 * alternative suggestions, unavailability handling, and referral notifications.
 * Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5, 4.6
 */

import type { Physician } from '@health-checkup/shared';
import { TestCategory } from '@health-checkup/shared';
import type {
  PhysicianAssignment,
  SpecialistAssignment,
  AlternativePhysician,
  UnavailabilityResponse,
  ReferralNotification,
  PhysicianHistory,
  QueuedAssignment,
  PhysicianAssignmentDependencies,
  PhysicianAssignmentPhysicianRepository,
  PhysicianHistoryRepository,
  AssignmentQueueRepository,
  NotificationSender,
  AdminNotifier,
} from './physician-assignment.types';
import { SPECIALIST_MAPPING } from './physician-assignment.types';
import {
  InvalidSeniorIdError,
  InvalidSessionIdError,
  NoPhysicianAvailableError,
  PhysicianNotFoundError,
} from './physician-assignment.errors';

/** Minimum number of alternatives to suggest (Requirement 4.4) */
const MIN_ALTERNATIVES = 3;

/** Window in days for availability checks (Requirement 4.4) */
const AVAILABILITY_WINDOW_DAYS = 30;

/** Notification deadline in hours (Requirement 4.6) */
const NOTIFICATION_DEADLINE_HOURS = 24;

/**
 * In-memory implementation of PhysicianAssignmentPhysicianRepository.
 */
export class InMemoryPhysicianAssignmentRepository implements PhysicianAssignmentPhysicianRepository {
  private physicians: Physician[] = [];

  async findById(id: string): Promise<Physician | null> {
    return this.physicians.find((p) => p.id === id) ?? null;
  }

  async findBySpecialization(specialization: string): Promise<Physician[]> {
    return this.physicians.filter(
      (p) => p.isActive && p.specialization === specialization
    );
  }

  async findAll(): Promise<Physician[]> {
    return this.physicians.filter((p) => p.isActive);
  }

  async findAvailableBySpecialization(specialization: string, _withinDays: number): Promise<Physician[]> {
    // In-memory: return all active physicians with the specialization
    return this.physicians.filter(
      (p) => p.isActive && p.specialization === specialization
    );
  }

  addPhysician(physician: Physician): void {
    this.physicians.push(physician);
  }

  clear(): void {
    this.physicians = [];
  }
}

/**
 * In-memory implementation of PhysicianHistoryRepository.
 */
export class InMemoryPhysicianHistoryRepository implements PhysicianHistoryRepository {
  private history: PhysicianHistory[] = [];

  async findBySeniorId(seniorId: string): Promise<PhysicianHistory[]> {
    return this.history
      .filter((h) => h.seniorId === seniorId)
      .sort((a, b) => b.assignedAt.getTime() - a.assignedAt.getTime());
  }

  async save(entry: PhysicianHistory): Promise<PhysicianHistory> {
    this.history.push(entry);
    return entry;
  }

  clear(): void {
    this.history = [];
  }
}

/**
 * In-memory implementation of AssignmentQueueRepository.
 */
export class InMemoryAssignmentQueueRepository implements AssignmentQueueRepository {
  private queue: QueuedAssignment[] = [];

  async enqueue(entry: QueuedAssignment): Promise<QueuedAssignment> {
    this.queue.push(entry);
    return entry;
  }

  async findBySessionId(sessionId: string): Promise<QueuedAssignment[]> {
    return this.queue.filter((q) => q.sessionId === sessionId);
  }

  clear(): void {
    this.queue = [];
  }
}

/**
 * In-memory notification sender (no-op for testing).
 */
export class InMemoryNotificationSender implements NotificationSender {
  public sentNotifications: ReferralNotification[] = [];

  async sendReferralNotification(notification: ReferralNotification): Promise<void> {
    this.sentNotifications.push(notification);
  }

  clear(): void {
    this.sentNotifications = [];
  }
}

/**
 * In-memory admin notifier (no-op for testing).
 */
export class InMemoryAdminNotifier implements AdminNotifier {
  public notifications: Array<{ specialization: string; sessionId: string }> = [];

  async notifySpecialistUnavailable(specialization: string, sessionId: string): Promise<void> {
    this.notifications.push({ specialization, sessionId });
  }

  clear(): void {
    this.notifications = [];
  }
}

/** Default ID generator */
const defaultIdGenerator = (): string => {
  return `ASSIGN_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
};

/** Default date provider */
const defaultDateProvider = (): Date => new Date();

/**
 * PhysicianAssignmentService implementation.
 *
 * Requirement 4.1: Assign primary physician with preference/fallback logic.
 * Requirement 4.2: Assign specialists by test category.
 * Requirement 4.3: Physician registry with qualifications, availability, departments.
 * Requirement 4.4: Suggest ≥3 alternatives when preferred physician unavailable (within 30 days).
 * Requirement 4.5: Handle specialist unavailability: notify admin, queue assignment, show earliest date.
 * Requirement 4.6: Notify senior citizen of specialist referral assignment within 24 hours.
 */
export class PhysicianAssignmentService {
  private readonly idGenerator: () => string;
  private readonly dateProvider: () => Date;
  private readonly physicianRepository: PhysicianAssignmentPhysicianRepository;
  private readonly historyRepository: PhysicianHistoryRepository;
  private readonly queueRepository: AssignmentQueueRepository;
  private readonly notificationSender: NotificationSender;
  private readonly adminNotifier: AdminNotifier;

  constructor(deps?: Partial<PhysicianAssignmentDependencies>) {
    this.idGenerator = deps?.idGenerator ?? defaultIdGenerator;
    this.dateProvider = deps?.dateProvider ?? defaultDateProvider;
    this.physicianRepository = deps?.physicianRepository ?? new InMemoryPhysicianAssignmentRepository();
    this.historyRepository = deps?.historyRepository ?? new InMemoryPhysicianHistoryRepository();
    this.queueRepository = deps?.queueRepository ?? new InMemoryAssignmentQueueRepository();
    this.notificationSender = deps?.notificationSender ?? new InMemoryNotificationSender();
    this.adminNotifier = deps?.adminNotifier ?? new InMemoryAdminNotifier();
  }

  /**
   * Assign a primary physician to a senior citizen.
   *
   * Requirement 4.1: Prefer the senior's most recent physician preference if available,
   * else next available with same specialization.
   * Requirement 4.4: If preferred physician unavailable, suggest ≥3 alternatives within 30 days.
   */
  async assignPrimaryPhysician(
    seniorId: string,
    preferredPhysicianId?: string
  ): Promise<PhysicianAssignment> {
    if (!seniorId || seniorId.trim() === '') {
      throw new InvalidSeniorIdError();
    }

    const now = this.dateProvider();

    // Step 1: If explicit preferred physician given, try that first
    if (preferredPhysicianId) {
      const preferred = await this.physicianRepository.findById(preferredPhysicianId);
      if (preferred && preferred.isActive) {
        const assignment = this.createAssignment(seniorId, preferred, now, 'preferred');
        await this.recordHistory(seniorId, preferred.id, assignment.assignmentId, now);
        return assignment;
      }
    }

    // Step 2: Check the senior's most recent physician from history
    const history = await this.historyRepository.findBySeniorId(seniorId);
    if (history.length > 0) {
      const mostRecent = history[0]; // sorted by most recent first
      const recentPhysician = await this.physicianRepository.findById(mostRecent.physicianId);
      if (recentPhysician && recentPhysician.isActive) {
        const assignment = this.createAssignment(seniorId, recentPhysician, now, 'most_recent');
        await this.recordHistory(seniorId, recentPhysician.id, assignment.assignmentId, now);
        return assignment;
      }

      // Step 3: Fallback to same specialization as most recent physician
      if (recentPhysician) {
        const sameSpecialization = await this.physicianRepository.findAvailableBySpecialization(
          recentPhysician.specialization,
          AVAILABILITY_WINDOW_DAYS
        );
        const available = sameSpecialization.filter((p) => p.id !== recentPhysician.id);
        if (available.length > 0) {
          const chosen = available[0];
          const assignment = this.createAssignment(seniorId, chosen, now, 'fallback_same_specialization');
          await this.recordHistory(seniorId, chosen.id, assignment.assignmentId, now);
          return assignment;
        }
      }
    }

    // Step 4: Fallback to any available physician
    const allPhysicians = await this.physicianRepository.findAll();
    if (allPhysicians.length > 0) {
      const chosen = allPhysicians[0];
      const assignment = this.createAssignment(seniorId, chosen, now, 'fallback_available');
      await this.recordHistory(seniorId, chosen.id, assignment.assignmentId, now);
      return assignment;
    }

    throw new NoPhysicianAvailableError('general');
  }

  /**
   * Assign specialists for a set of test categories in a session.
   *
   * Requirement 4.2: Assign specialists by test category mapping.
   * Requirement 4.5: Handle specialist unavailability.
   * Requirement 4.6: Notify senior citizen of specialist referral within 24 hours.
   */
  async assignSpecialists(
    sessionId: string,
    testCategories: TestCategory[]
  ): Promise<SpecialistAssignment[]> {
    if (!sessionId || sessionId.trim() === '') {
      throw new InvalidSessionIdError();
    }

    const now = this.dateProvider();
    const assignments: SpecialistAssignment[] = [];

    // Deduplicate specializations needed
    const specializationMap = new Map<string, TestCategory[]>();
    for (const category of testCategories) {
      const specialization = SPECIALIST_MAPPING[category];
      const existing = specializationMap.get(specialization) ?? [];
      existing.push(category);
      specializationMap.set(specialization, existing);
    }

    for (const [specialization, categories] of specializationMap) {
      const available = await this.physicianRepository.findAvailableBySpecialization(
        specialization,
        AVAILABILITY_WINDOW_DAYS
      );

      if (available.length > 0) {
        const specialist = available[0];

        for (const category of categories) {
          const assignment: SpecialistAssignment = {
            assignmentId: this.idGenerator(),
            sessionId,
            testCategory: category,
            specialization,
            physicianId: specialist.id,
            physician: specialist,
            assignedAt: now,
          };
          assignments.push(assignment);
        }

        // Requirement 4.6: Send notification within 24 hours
        const deadlineAt = new Date(now.getTime() + NOTIFICATION_DEADLINE_HOURS * 60 * 60 * 1000);
        const notification: ReferralNotification = {
          notificationId: this.idGenerator(),
          seniorId: sessionId, // sessionId used as proxy; in production, resolve to seniorId
          specialistId: specialist.id,
          specialization,
          sessionId,
          sentAt: now,
          deadlineAt,
        };
        await this.notificationSender.sendReferralNotification(notification);
      } else {
        // Requirement 4.5: Handle unavailability
        await this.handleUnavailability(specialization, sessionId);
      }
    }

    return assignments;
  }

  /**
   * Suggest alternative physicians when the preferred one is unavailable.
   *
   * Requirement 4.4: Suggest ≥3 alternatives within 30 days.
   */
  async suggestAlternatives(
    specialization: string,
    count: number = MIN_ALTERNATIVES
  ): Promise<Physician[]> {
    const minCount = Math.max(count, MIN_ALTERNATIVES);
    const available = await this.physicianRepository.findAvailableBySpecialization(
      specialization,
      AVAILABILITY_WINDOW_DAYS
    );

    // Return at least minCount if available, otherwise all available
    return available.slice(0, Math.max(minCount, available.length));
  }

  /**
   * Handle specialist unavailability.
   *
   * Requirement 4.5: Notify admin, queue the assignment, report earliest available date.
   */
  async handleUnavailability(
    specialization: string,
    sessionId: string
  ): Promise<UnavailabilityResponse> {
    const now = this.dateProvider();

    // Notify admin
    await this.adminNotifier.notifySpecialistUnavailable(specialization, sessionId);

    // Queue the assignment
    const queueEntry: QueuedAssignment = {
      id: this.idGenerator(),
      sessionId,
      specialization,
      queuedAt: now,
      status: 'pending',
    };
    await this.queueRepository.enqueue(queueEntry);

    // Attempt to find earliest available date (check all physicians of that specialization)
    const allSpecialists = await this.physicianRepository.findBySpecialization(specialization);
    let earliestDate: Date | null = null;

    if (allSpecialists.length > 0) {
      // In a production system, this would check actual availability schedules.
      // For now, estimate earliest as 30 days from now if physicians exist but aren't available.
      earliestDate = new Date(now.getTime() + AVAILABILITY_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    }

    return {
      specialization,
      sessionId,
      status: 'queued',
      earliestAvailableDate: earliestDate,
      adminNotified: true,
      queuedAt: now,
    };
  }

  /**
   * Get the specialist mapping for a test category.
   */
  getSpecializationForCategory(category: TestCategory): string {
    return SPECIALIST_MAPPING[category];
  }

  private createAssignment(
    seniorId: string,
    physician: Physician,
    assignedAt: Date,
    reason: PhysicianAssignment['reason']
  ): PhysicianAssignment {
    return {
      assignmentId: this.idGenerator(),
      seniorId,
      physicianId: physician.id,
      physician,
      assignedAt,
      reason,
    };
  }

  private async recordHistory(
    seniorId: string,
    physicianId: string,
    sessionId: string,
    assignedAt: Date
  ): Promise<void> {
    await this.historyRepository.save({
      seniorId,
      physicianId,
      sessionId,
      assignedAt,
    });
  }
}
