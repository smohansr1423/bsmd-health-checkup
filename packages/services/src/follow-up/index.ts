/**
 * Follow-Up Tracker Service barrel export
 */
export { FollowUpTrackerService, InMemoryFollowUpActionRepository } from './follow-up.service';
export { FollowUpReminderService } from './follow-up.reminders';
export { validateAssignmentRequest, validateCompletionNotes } from './follow-up.validators';
export {
  FollowUpValidationError,
  MaxFollowUpActionsExceededError,
  FollowUpNotFoundError,
  FollowUpAlreadyCompletedError,
} from './follow-up.errors';
export type {
  FollowUpAssignmentRequest,
  FollowUpDashboard,
  FollowUpTrackerDependencies,
  FollowUpActionRepository,
  FollowUpActionType,
  FollowUpStatus,
  ReportContext,
} from './follow-up.types';
export type {
  FollowUpReminderSchedule,
  EscalationEvent,
  ReminderResult,
  FollowUpReminderDependencies,
} from './follow-up.reminders';
