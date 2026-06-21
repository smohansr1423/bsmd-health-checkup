/**
 * Scheduling Page — Barrel export
 *
 * Exports all scheduling UI types, state interfaces, business logic,
 * and configuration for the appointment scheduling workflow.
 *
 * Requirements: 3.1, 3.4, 3.6, 3.7, 3.8
 */

// ─── SlotPicker ──────────────────────────────────────────────────────────────
export {
  SLOT_DISPLAY_DAYS,
  MAX_SLOTS_PER_DAY,
  type SlotDisplayItem,
  type DaySlotGroup,
  type SlotPickerState,
  type SlotPickerProps,
  computeSlotDateRange,
  groupSlotsByDay,
  toSlotDisplayItem,
  shouldShowNoSlotsMessage,
  createInitialSlotPickerState,
  SLOT_PICKER_ARIA,
} from './SlotPicker';

// ─── PhysicianSelection ──────────────────────────────────────────────────────
export {
  MIN_ALTERNATIVE_SUGGESTIONS,
  ALTERNATIVE_SEARCH_DAYS,
  type PhysicianDisplayItem,
  type AlternativeSuggestionItem,
  type PhysicianSelectionState,
  type PhysicianSelectionProps,
  toPhysicianDisplayItem,
  shouldShowAlternatives,
  getAlternativeSuggestions,
  getUnavailabilityMessage,
  hasMinimumAlternatives,
  createInitialPhysicianSelectionState,
  PHYSICIAN_SELECTION_ARIA,
} from './PhysicianSelection';

// ─── AppointmentActions ──────────────────────────────────────────────────────
export {
  MIN_RESCHEDULE_OPTIONS,
  RESCHEDULE_WINDOW_DAYS,
  type AppointmentActionType,
  type ActionStatus,
  type AppointmentDisplayItem,
  type ConfirmationState,
  type AppointmentConfirmationSummary,
  type CancellationResult,
  type RescheduleOptionItem,
  type AppointmentActionsState,
  type AppointmentActionsProps,
  canCancelAppointment,
  canRescheduleAppointment,
  toRescheduleOptionItems,
  hasMinimumRescheduleOptions,
  buildConfirmationSummary,
  toAppointmentDisplayItem,
  createInitialAppointmentActionsState,
  APPOINTMENT_ACTIONS_ARIA,
} from './AppointmentActions';

// ─── WaitingList ─────────────────────────────────────────────────────────────
export {
  type PreferredTimeOfDay,
  type WaitlistStatus,
  type WaitlistEnrollmentForm,
  type WaitlistDisplayItem,
  type WaitingListState,
  type WaitingListProps,
  validateWaitlistForm,
  buildPreferencesSummary,
  isWaitlistEntryActive,
  isAlreadyOnWaitlist,
  createInitialWaitlistForm,
  createInitialWaitingListState,
  getNoSlotsMessage,
  WAITING_LIST_ARIA,
  TIME_OF_DAY_OPTIONS,
} from './WaitingList';
