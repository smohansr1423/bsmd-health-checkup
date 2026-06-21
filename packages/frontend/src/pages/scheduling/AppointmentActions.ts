/**
 * AppointmentActions — Confirmation, cancellation, and rescheduling flows.
 *
 * Manages the appointment lifecycle actions: confirming a new appointment,
 * cancelling an existing one (releasing the slot and offering rescheduling
 * options), and rescheduling to a new slot.
 *
 * Requirements: 3.1, 3.4
 */

import type { Appointment, TimeSlot } from '@health-checkup/shared';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Minimum number of rescheduling options to offer after cancellation */
export const MIN_RESCHEDULE_OPTIONS = 3;

/** Days within which rescheduling options are offered */
export const RESCHEDULE_WINDOW_DAYS = 14;

// ─── Types ───────────────────────────────────────────────────────────────────

/** The current action/flow being performed */
export type AppointmentActionType = 'confirm' | 'cancel' | 'reschedule';

/** Status of the action operation */
export type ActionStatus = 'idle' | 'pending' | 'success' | 'error';

/** Display representation of an existing appointment */
export interface AppointmentDisplayItem {
  /** Appointment ID */
  appointmentId: string;
  /** Formatted scheduled date */
  dateLabel: string;
  /** Formatted time window */
  timeLabel: string;
  /** Physician name */
  physicianName: string;
  /** Package name */
  packageName: string;
  /** Current appointment status */
  status: Appointment['status'];
  /** Whether cancellation is allowed (only for scheduled/checked_in) */
  canCancel: boolean;
  /** Whether rescheduling is allowed */
  canReschedule: boolean;
}

/** Confirmation dialog state */
export interface ConfirmationState {
  /** Selected slot ID being confirmed */
  slotId: string;
  /** Selected physician ID */
  physicianId: string;
  /** Selected package ID */
  packageId: string;
  /** Formatted summary for confirmation display */
  summary: AppointmentConfirmationSummary;
}

/** Summary displayed in the confirmation dialog */
export interface AppointmentConfirmationSummary {
  /** Formatted date of the appointment */
  dateLabel: string;
  /** Formatted time of the appointment */
  timeLabel: string;
  /** Physician name */
  physicianName: string;
  /** Package name */
  packageName: string;
  /** Specialization of the physician */
  specialization: string;
}

/** Cancellation result with rescheduling options */
export interface CancellationResult {
  /** ID of the cancelled appointment */
  cancelledAppointmentId: string;
  /** Available rescheduling slots (minimum 3 within 14 days) */
  rescheduleOptions: RescheduleOptionItem[];
  /** Message explaining the cancellation result */
  message: string;
  /** Whether minimum rescheduling options are available */
  hasMinimumOptions: boolean;
}

/** Display representation of a rescheduling option */
export interface RescheduleOptionItem {
  /** Slot ID */
  slotId: string;
  /** Formatted date */
  dateLabel: string;
  /** Formatted time */
  timeLabel: string;
  /** Physician name for this slot */
  physicianName: string;
  /** Whether this option is selected */
  isSelected: boolean;
}

/** State for the AppointmentActions component */
export interface AppointmentActionsState {
  /** Current active action type */
  activeAction: AppointmentActionType | null;
  /** Status of the current operation */
  actionStatus: ActionStatus;
  /** Confirmation state (when confirming a new appointment) */
  confirmation: ConfirmationState | null;
  /** Cancellation result (when appointment was just cancelled) */
  cancellationResult: CancellationResult | null;
  /** Selected reschedule slot ID (during rescheduling flow) */
  selectedRescheduleSlotId: string | null;
  /** Error message if action failed */
  error: string | null;
  /** Success message after completed action */
  successMessage: string | null;
}

/** Props for the AppointmentActions component */
export interface AppointmentActionsProps {
  /** Current appointment (for cancel/reschedule flows) */
  appointment?: AppointmentDisplayItem;
  /** Slot, physician, and package selection (for confirmation flow) */
  bookingSelection?: {
    slotId: string;
    physicianId: string;
    packageId: string;
  };
  /** Callback when appointment is confirmed */
  onConfirm: (slotId: string, physicianId: string, packageId: string) => void;
  /** Callback when appointment is cancelled */
  onCancel: (appointmentId: string) => void;
  /** Callback when appointment is rescheduled */
  onReschedule: (appointmentId: string, newSlotId: string) => void;
  /** Locale for date/time formatting */
  locale?: string;
}

// ─── Business Logic ──────────────────────────────────────────────────────────

/**
 * Determines whether an appointment can be cancelled.
 * Only 'scheduled' and 'checked_in' statuses allow cancellation.
 *
 * Requirement 3.4: Senior citizen can cancel an appointment.
 */
export function canCancelAppointment(status: Appointment['status']): boolean {
  return status === 'scheduled' || status === 'checked_in';
}

/**
 * Determines whether an appointment can be rescheduled.
 * Only 'scheduled' and 'cancelled' (pending reschedule) statuses allow this.
 */
export function canRescheduleAppointment(status: Appointment['status']): boolean {
  return status === 'scheduled' || status === 'cancelled';
}

/**
 * Transforms rescheduling slots into display items.
 */
export function toRescheduleOptionItems(
  slots: TimeSlot[],
  physicianNames: Map<string, string>,
  selectedSlotId: string | null,
  locale: string = 'en'
): RescheduleOptionItem[] {
  return slots
    .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
    .map((slot) => {
      const startDate = new Date(slot.startTime);
      const endDate = new Date(slot.endTime);

      return {
        slotId: slot.id,
        dateLabel: startDate.toLocaleDateString(locale, {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
        }),
        timeLabel: `${startDate.toLocaleTimeString(locale, {
          hour: '2-digit',
          minute: '2-digit',
        })} – ${endDate.toLocaleTimeString(locale, {
          hour: '2-digit',
          minute: '2-digit',
        })}`,
        physicianName: physicianNames.get(slot.physicianId) ?? 'Unknown',
        isSelected: slot.id === selectedSlotId,
      };
    });
}

/**
 * Validates that the minimum number of reschedule options is met.
 *
 * Requirement 3.4: Offer a minimum of 3 rescheduling options within the next 14 days.
 */
export function hasMinimumRescheduleOptions(options: RescheduleOptionItem[]): boolean {
  return options.length >= MIN_RESCHEDULE_OPTIONS;
}

/**
 * Builds an AppointmentConfirmationSummary from selection data.
 */
export function buildConfirmationSummary(
  slot: TimeSlot,
  physicianName: string,
  physicianSpecialization: string,
  packageName: string,
  locale: string = 'en'
): AppointmentConfirmationSummary {
  const startDate = new Date(slot.startTime);
  const endDate = new Date(slot.endTime);

  return {
    dateLabel: startDate.toLocaleDateString(locale, {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }),
    timeLabel: `${startDate.toLocaleTimeString(locale, {
      hour: '2-digit',
      minute: '2-digit',
    })} – ${endDate.toLocaleTimeString(locale, {
      hour: '2-digit',
      minute: '2-digit',
    })}`,
    physicianName,
    packageName,
    specialization: physicianSpecialization,
  };
}

/**
 * Transforms an Appointment into a display item.
 */
export function toAppointmentDisplayItem(
  appointment: Appointment,
  physicianName: string,
  packageName: string,
  locale: string = 'en'
): AppointmentDisplayItem {
  const startDate = new Date(appointment.scheduledDate);
  const endDate = new Date(appointment.timeSlot.endTime);

  return {
    appointmentId: appointment.id,
    dateLabel: startDate.toLocaleDateString(locale, {
      weekday: 'long',
      month: 'short',
      day: 'numeric',
    }),
    timeLabel: `${startDate.toLocaleTimeString(locale, {
      hour: '2-digit',
      minute: '2-digit',
    })} – ${endDate.toLocaleTimeString(locale, {
      hour: '2-digit',
      minute: '2-digit',
    })}`,
    physicianName,
    packageName,
    status: appointment.status,
    canCancel: canCancelAppointment(appointment.status),
    canReschedule: canRescheduleAppointment(appointment.status),
  };
}

/**
 * Creates the initial state for the AppointmentActions component.
 */
export function createInitialAppointmentActionsState(): AppointmentActionsState {
  return {
    activeAction: null,
    actionStatus: 'idle',
    confirmation: null,
    cancellationResult: null,
    selectedRescheduleSlotId: null,
    error: null,
    successMessage: null,
  };
}

// ─── Page Configuration ──────────────────────────────────────────────────────

/** ARIA labels for the AppointmentActions region */
export const APPOINTMENT_ACTIONS_ARIA = {
  region: 'Appointment actions',
  confirmDialog: 'Confirm appointment',
  confirmButton: 'Confirm this appointment',
  cancelButton: 'Cancel this appointment',
  rescheduleButton: 'Reschedule this appointment',
  rescheduleOptions: 'Available rescheduling options',
  rescheduleOption: (date: string, time: string) => `Reschedule to ${date} at ${time}`,
  successAlert: 'Appointment action completed successfully',
  errorAlert: 'Appointment action failed',
  cancelConfirmPrompt: 'Are you sure you want to cancel this appointment?',
} as const;
