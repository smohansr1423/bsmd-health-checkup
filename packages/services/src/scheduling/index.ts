/**
 * Scheduling Service barrel export
 */
export {
  SchedulingService,
  InMemoryAppointmentRepository,
  InMemorySlotRepository,
  InMemoryPhysicianRepository,
  InMemoryWaitlistRepository,
} from './scheduling.service';
export {
  validateDateRange,
  validateAppointmentRequest,
  getMaxSlotsPerDay,
  getMaxDaysAhead,
  getRescheduleWindowDays,
  getMinAlternativePhysicians,
} from './scheduling.validators';
export {
  NoSlotsAvailableError,
  PhysicianUnavailableError,
  SlotNotAvailableError,
  AppointmentNotFoundError,
  AppointmentNotCancellableError,
} from './scheduling.errors';
export {
  ReminderService,
  calculateReminderTimes,
  calculateSendTimeAt9AM,
  shouldMarkAsMissed,
  calculateRescheduleDeadline,
  isWithinConfirmationWindow,
  CONFIRMATION_DEADLINE_MS,
  MISSED_GRACE_PERIOD_MS,
  RESCHEDULE_DEADLINE_DAYS,
  REMINDER_SEND_HOUR,
} from './scheduling.reminders';
export type {
  DateRange,
  AppointmentRequest,
  RescheduleOptions,
  WaitlistPreferences,
  WaitlistEntry,
  AlternativePhysicianSuggestion,
  SchedulingDependencies,
  AppointmentRepository,
  SlotRepository,
  PhysicianRepository,
  WaitlistRepository,
} from './scheduling.types';
export type {
  ReminderType,
  AppointmentReminder,
  MissedAppointmentAction,
  AppointmentConfirmationEvent,
  AppointmentReminderDueEvent,
  AppointmentMissedEvent,
  EventPublisher,
  SeniorProfileProvider,
  ReminderServiceDependencies,
} from './scheduling.reminders';
