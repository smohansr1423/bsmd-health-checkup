/**
 * Physician Assignment Service barrel export
 */
export {
  PhysicianAssignmentService,
  InMemoryPhysicianAssignmentRepository,
  InMemoryPhysicianHistoryRepository,
  InMemoryAssignmentQueueRepository,
  InMemoryNotificationSender,
  InMemoryAdminNotifier,
} from './physician-assignment.service';
export {
  NoPhysicianAvailableError,
  PreferredPhysicianUnavailableError,
  SpecialistUnavailableError,
  PhysicianNotFoundError,
  InvalidSeniorIdError,
  InvalidSessionIdError,
} from './physician-assignment.errors';
export {
  SPECIALIST_MAPPING,
} from './physician-assignment.types';
export type {
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
