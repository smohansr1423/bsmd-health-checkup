/**
 * Physician Assignment Service Types
 * Request/response types for physician and specialist assignment workflows.
 * Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5, 4.6
 */

import type { Physician } from '@health-checkup/shared';
import { TestCategory } from '@health-checkup/shared';

/**
 * Specialist mapping by test category.
 */
export const SPECIALIST_MAPPING: Record<TestCategory, string> = {
  [TestCategory.Cardiac]: 'cardiologist',
  [TestCategory.Vision]: 'ophthalmologist',
  [TestCategory.Hearing]: 'audiologist',
  [TestCategory.Musculoskeletal]: 'orthopedist',
  [TestCategory.Blood]: 'general',
  [TestCategory.Urine]: 'general',
  [TestCategory.Imaging]: 'radiologist',
  [TestCategory.Cognitive]: 'neurologist',
  [TestCategory.Endocrine]: 'endocrinologist',
  [TestCategory.OrganFunction]: 'general',
};

/**
 * Result of assigning a primary physician to a senior citizen.
 */
export interface PhysicianAssignment {
  assignmentId: string;
  seniorId: string;
  physicianId: string;
  physician: Physician;
  assignedAt: Date;
  reason: 'preferred' | 'most_recent' | 'fallback_same_specialization' | 'fallback_available';
}

/**
 * Result of assigning a specialist for a test category.
 */
export interface SpecialistAssignment {
  assignmentId: string;
  sessionId: string;
  testCategory: TestCategory;
  specialization: string;
  physicianId: string;
  physician: Physician;
  assignedAt: Date;
}

/**
 * Alternative physician suggestion when preferred is unavailable.
 */
export interface AlternativePhysician {
  physician: Physician;
  earliestAvailableDate: Date;
}

/**
 * Response when a specialist is unavailable.
 */
export interface UnavailabilityResponse {
  specialization: string;
  sessionId: string;
  status: 'queued';
  earliestAvailableDate: Date | null;
  adminNotified: boolean;
  queuedAt: Date;
}

/**
 * Notification for specialist referral assignment.
 */
export interface ReferralNotification {
  notificationId: string;
  seniorId: string;
  specialistId: string;
  specialization: string;
  sessionId: string;
  sentAt: Date;
  deadlineAt: Date; // must be within 24 hours of assignment
}

/**
 * Record of a senior's previous physician assignment (for preference lookup).
 */
export interface PhysicianHistory {
  seniorId: string;
  physicianId: string;
  sessionId: string;
  assignedAt: Date;
}

/**
 * Repository for physician data.
 */
export interface PhysicianAssignmentPhysicianRepository {
  findById(id: string): Promise<Physician | null>;
  findBySpecialization(specialization: string): Promise<Physician[]>;
  findAll(): Promise<Physician[]>;
  findAvailableBySpecialization(specialization: string, withinDays: number): Promise<Physician[]>;
}

/**
 * Repository for physician assignment history.
 */
export interface PhysicianHistoryRepository {
  findBySeniorId(seniorId: string): Promise<PhysicianHistory[]>;
  save(history: PhysicianHistory): Promise<PhysicianHistory>;
}

/**
 * Repository for assignment queue (when specialist unavailable).
 */
export interface AssignmentQueueRepository {
  enqueue(entry: QueuedAssignment): Promise<QueuedAssignment>;
  findBySessionId(sessionId: string): Promise<QueuedAssignment[]>;
}

/**
 * A queued assignment entry when a specialist is unavailable.
 */
export interface QueuedAssignment {
  id: string;
  sessionId: string;
  specialization: string;
  queuedAt: Date;
  status: 'pending' | 'assigned' | 'cancelled';
}

/**
 * Notification service interface for sending referral notifications.
 */
export interface NotificationSender {
  sendReferralNotification(notification: ReferralNotification): Promise<void>;
}

/**
 * Admin notification service interface.
 */
export interface AdminNotifier {
  notifySpecialistUnavailable(specialization: string, sessionId: string): Promise<void>;
}

/**
 * Dependencies for the PhysicianAssignmentService.
 */
export interface PhysicianAssignmentDependencies {
  idGenerator: () => string;
  dateProvider: () => Date;
  physicianRepository: PhysicianAssignmentPhysicianRepository;
  historyRepository: PhysicianHistoryRepository;
  queueRepository: AssignmentQueueRepository;
  notificationSender: NotificationSender;
  adminNotifier: AdminNotifier;
}
