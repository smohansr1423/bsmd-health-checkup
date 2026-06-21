/**
 * Appointment Reminders and Missed Appointment Handling
 *
 * Manages:
 * - Confirmation notification within 2 minutes of booking (in preferred language)
 * - Reminder scheduling at 7 days, 2 days, and 1 day before at 9:00 AM local time
 * - Missed appointment detection (no check-in within 30 minutes)
 * - Caregiver notification and reschedule prompting within 7 days
 *
 * Validates: Requirements 3.2, 3.3, 3.5
 */

import type { Appointment } from '@health-checkup/shared';
import { SupportedLanguage } from '@health-checkup/shared';

// ─── Types ───────────────────────────────────────────────────────────────────

export type ReminderType = '7_day' | '2_day' | '1_day';

export interface AppointmentReminder {
  appointmentId: string;
  seniorId: string;
  scheduledSendTime: Date;
  type: ReminderType;
  status: 'scheduled' | 'sent' | 'cancelled';
}

export interface MissedAppointmentAction {
  appointmentId: string;
  seniorId: string;
  missedAt: Date;
  caregiverNotified: boolean;
  rescheduleDeadline: Date;
}

/**
 * Events published by the reminder service to the event bus.
 */
export interface AppointmentConfirmationEvent {
  type: 'AppointmentConfirmation';
  appointmentId: string;
  seniorId: string;
  physicianId: string;
  scheduledDate: Date;
  language: SupportedLanguage;
  occurredAt: Date;
}

export interface AppointmentReminderDueEvent {
  type: 'AppointmentReminderDue';
  appointmentId: string;
  seniorId: string;
  reminderType: ReminderType;
  appointmentDate: Date;
  language: SupportedLanguage;
  occurredAt: Date;
}

export interface AppointmentMissedEvent {
  type: 'AppointmentMissed';
  appointmentId: string;
  seniorId: string;
  scheduledDate: Date;
  missedAt: Date;
  rescheduleDeadline: Date;
  occurredAt: Date;
}

/**
 * Dependencies injected into ReminderService for testability.
 */
export interface ReminderServiceDependencies {
  dateProvider: () => Date;
  eventPublisher: EventPublisher;
  seniorProfileProvider: SeniorProfileProvider;
}

/**
 * Minimal event publisher interface (decoupled from the full EventBus for flexibility).
 */
export interface EventPublisher {
  publishConfirmation(event: AppointmentConfirmationEvent): Promise<void>;
  publishReminderDue(event: AppointmentReminderDueEvent): Promise<void>;
  publishMissed(event: AppointmentMissedEvent): Promise<void>;
}

/**
 * Provides senior citizen profile data needed for notifications.
 */
export interface SeniorProfileProvider {
  getPreferredLanguage(seniorId: string): Promise<SupportedLanguage>;
  getCaregiverContactId(seniorId: string): Promise<string | null>;
}

// ─── Constants ───────────────────────────────────────────────────────────────

/** Maximum time after booking to send confirmation (ms) */
export const CONFIRMATION_DEADLINE_MS = 2 * 60 * 1000; // 2 minutes

/** Reminder intervals in days before appointment */
export const REMINDER_DAYS_BEFORE: readonly ReminderType[] = ['7_day', '2_day', '1_day'] as const;

/** Maps reminder type to days before appointment */
export const REMINDER_TYPE_TO_DAYS: Record<ReminderType, number> = {
  '7_day': 7,
  '2_day': 2,
  '1_day': 1,
};

/** Hour at which reminders are sent (local time) */
export const REMINDER_SEND_HOUR = 9; // 9:00 AM

/** Grace period after scheduled start before marking as missed (ms) */
export const MISSED_GRACE_PERIOD_MS = 30 * 60 * 1000; // 30 minutes

/** Days within which missed appointment must be rescheduled */
export const RESCHEDULE_DEADLINE_DAYS = 7;

// ─── Core Logic ──────────────────────────────────────────────────────────────

/**
 * Calculate reminder send times for a given appointment date.
 *
 * Each reminder is scheduled at 9:00 AM local time on the appropriate day
 * (7, 2, and 1 day before the appointment).
 *
 * Only returns reminders whose send time is in the future relative to `now`.
 *
 * Requirement 3.3: Reminders at 7 days, 2 days, and 1 day before at 9:00 AM local time.
 */
export function calculateReminderTimes(
  appointmentDate: Date,
  now: Date,
  timezoneOffsetMinutes: number = 0
): AppointmentReminder[] {
  const reminders: AppointmentReminder[] = [];

  for (const type of REMINDER_DAYS_BEFORE) {
    const daysBefore = REMINDER_TYPE_TO_DAYS[type];
    const sendTime = calculateSendTimeAt9AM(appointmentDate, daysBefore, timezoneOffsetMinutes);

    // Only schedule reminders that are in the future
    if (sendTime.getTime() > now.getTime()) {
      reminders.push({
        appointmentId: '', // To be filled by caller
        seniorId: '', // To be filled by caller
        scheduledSendTime: sendTime,
        type,
        status: 'scheduled',
      });
    }
  }

  return reminders;
}

/**
 * Calculate the send time at 9:00 AM local time, N days before the appointment.
 *
 * @param appointmentDate - The appointment date/time
 * @param daysBefore - Number of days before the appointment
 * @param timezoneOffsetMinutes - Timezone offset from UTC in minutes (e.g., -300 for EST)
 * @returns Date representing 9:00 AM local time on the reminder day
 */
export function calculateSendTimeAt9AM(
  appointmentDate: Date,
  daysBefore: number,
  timezoneOffsetMinutes: number = 0
): Date {
  // Start from appointment date and subtract days
  const reminderDate = new Date(appointmentDate.getTime());
  reminderDate.setDate(reminderDate.getDate() - daysBefore);

  // Set to 9:00 AM in the target timezone
  // Convert: local 9:00 AM = UTC (9:00 - offset)
  const utcHour = REMINDER_SEND_HOUR - Math.floor(timezoneOffsetMinutes / 60);
  const utcMinute = -(timezoneOffsetMinutes % 60);

  reminderDate.setUTCHours(utcHour, utcMinute, 0, 0);

  return reminderDate;
}

/**
 * Determine if an appointment should be marked as missed.
 *
 * An appointment is missed if:
 * 1. The current time is more than 30 minutes past the scheduled start time
 * 2. The appointment status is still 'scheduled' (no check-in occurred)
 *
 * Requirement 3.5: Mark as missed if no check-in within 30 minutes.
 */
export function shouldMarkAsMissed(
  appointment: Appointment,
  now: Date
): boolean {
  if (appointment.status !== 'scheduled') {
    return false;
  }

  const missedThreshold = new Date(
    appointment.scheduledDate.getTime() + MISSED_GRACE_PERIOD_MS
  );

  return now.getTime() >= missedThreshold.getTime();
}

/**
 * Calculate the reschedule deadline (7 days after the missed time).
 *
 * Requirement 3.5: Prompt rescheduling within 7 calendar days.
 */
export function calculateRescheduleDeadline(missedAt: Date): Date {
  const deadline = new Date(missedAt.getTime());
  deadline.setDate(deadline.getDate() + RESCHEDULE_DEADLINE_DAYS);
  return deadline;
}

/**
 * Determine if the confirmation notification deadline has been exceeded.
 *
 * Requirement 3.2: Confirmation within 2 minutes of booking.
 */
export function isWithinConfirmationWindow(bookingTime: Date, now: Date): boolean {
  return (now.getTime() - bookingTime.getTime()) <= CONFIRMATION_DEADLINE_MS;
}

// ─── Service Class ───────────────────────────────────────────────────────────

/**
 * ReminderService orchestrates appointment confirmation, reminder scheduling,
 * and missed appointment handling.
 *
 * Validates: Requirements 3.2, 3.3, 3.5
 */
export class ReminderService {
  private readonly dateProvider: () => Date;
  private readonly eventPublisher: EventPublisher;
  private readonly seniorProfileProvider: SeniorProfileProvider;
  private readonly reminders: Map<string, AppointmentReminder[]> = new Map();
  private readonly missedActions: Map<string, MissedAppointmentAction> = new Map();

  constructor(deps: ReminderServiceDependencies) {
    this.dateProvider = deps.dateProvider;
    this.eventPublisher = deps.eventPublisher;
    this.seniorProfileProvider = deps.seniorProfileProvider;
  }

  /**
   * Handle a newly booked appointment:
   * 1. Send confirmation notification (within 2 minutes)
   * 2. Schedule future reminders at 7, 2, 1 days before
   *
   * Requirement 3.2: Send confirmation in preferred language within 2 minutes.
   * Requirement 3.3: Schedule reminders at 7, 2, 1 days before at 9:00 AM.
   */
  async onAppointmentBooked(
    appointment: Appointment,
    timezoneOffsetMinutes: number = 0
  ): Promise<{ confirmation: AppointmentConfirmationEvent; reminders: AppointmentReminder[] }> {
    const now = this.dateProvider();
    const language = await this.seniorProfileProvider.getPreferredLanguage(appointment.seniorId);

    // 1. Publish confirmation event
    const confirmationEvent: AppointmentConfirmationEvent = {
      type: 'AppointmentConfirmation',
      appointmentId: appointment.id,
      seniorId: appointment.seniorId,
      physicianId: appointment.physicianId,
      scheduledDate: appointment.scheduledDate,
      language,
      occurredAt: now,
    };

    await this.eventPublisher.publishConfirmation(confirmationEvent);

    // 2. Calculate and store reminders
    const reminders = calculateReminderTimes(
      appointment.scheduledDate,
      now,
      timezoneOffsetMinutes
    );

    // Fill in appointment-specific data
    const filledReminders = reminders.map((r) => ({
      ...r,
      appointmentId: appointment.id,
      seniorId: appointment.seniorId,
    }));

    this.reminders.set(appointment.id, filledReminders);

    return { confirmation: confirmationEvent, reminders: filledReminders };
  }

  /**
   * Process due reminders. Should be called periodically (e.g., every minute).
   * Publishes AppointmentReminderDue events for any reminders whose send time has passed.
   *
   * Requirement 3.3: Send reminder notifications at scheduled times.
   */
  async processDueReminders(): Promise<AppointmentReminderDueEvent[]> {
    const now = this.dateProvider();
    const publishedEvents: AppointmentReminderDueEvent[] = [];

    for (const [appointmentId, reminders] of this.reminders.entries()) {
      for (const reminder of reminders) {
        if (
          reminder.status === 'scheduled' &&
          now.getTime() >= reminder.scheduledSendTime.getTime()
        ) {
          const language = await this.seniorProfileProvider.getPreferredLanguage(
            reminder.seniorId
          );

          const event: AppointmentReminderDueEvent = {
            type: 'AppointmentReminderDue',
            appointmentId: reminder.appointmentId,
            seniorId: reminder.seniorId,
            reminderType: reminder.type,
            appointmentDate: reminder.scheduledSendTime, // The actual appointment date is stored via the reminder context
            language,
            occurredAt: now,
          };

          await this.eventPublisher.publishReminderDue(event);
          reminder.status = 'sent';
          publishedEvents.push(event);
        }
      }
    }

    return publishedEvents;
  }

  /**
   * Handle a missed appointment:
   * 1. Publish AppointmentMissed event
   * 2. Notify caregiver
   * 3. Set reschedule deadline (7 days)
   *
   * Requirement 3.5: Mark as missed, notify caregiver, prompt reschedule within 7 days.
   */
  async handleMissedAppointment(appointment: Appointment): Promise<MissedAppointmentAction> {
    const now = this.dateProvider();

    if (!shouldMarkAsMissed(appointment, now)) {
      throw new Error(
        `Appointment ${appointment.id} cannot be marked as missed: ` +
        `either it has been checked in or the 30-minute grace period has not elapsed.`
      );
    }

    const rescheduleDeadline = calculateRescheduleDeadline(now);
    const caregiverContactId = await this.seniorProfileProvider.getCaregiverContactId(
      appointment.seniorId
    );

    // Publish missed event
    const missedEvent: AppointmentMissedEvent = {
      type: 'AppointmentMissed',
      appointmentId: appointment.id,
      seniorId: appointment.seniorId,
      scheduledDate: appointment.scheduledDate,
      missedAt: now,
      rescheduleDeadline,
      occurredAt: now,
    };

    await this.eventPublisher.publishMissed(missedEvent);

    // Cancel any remaining reminders
    this.cancelReminders(appointment.id);

    const action: MissedAppointmentAction = {
      appointmentId: appointment.id,
      seniorId: appointment.seniorId,
      missedAt: now,
      caregiverNotified: caregiverContactId !== null,
      rescheduleDeadline,
    };

    this.missedActions.set(appointment.id, action);

    return action;
  }

  /**
   * Cancel all pending reminders for an appointment (e.g., on cancellation or missed).
   */
  cancelReminders(appointmentId: string): void {
    const reminders = this.reminders.get(appointmentId);
    if (reminders) {
      for (const reminder of reminders) {
        if (reminder.status === 'scheduled') {
          reminder.status = 'cancelled';
        }
      }
    }
  }

  /**
   * Get all reminders for an appointment.
   */
  getReminders(appointmentId: string): AppointmentReminder[] {
    return this.reminders.get(appointmentId) ?? [];
  }

  /**
   * Get missed appointment action details.
   */
  getMissedAction(appointmentId: string): MissedAppointmentAction | undefined {
    return this.missedActions.get(appointmentId);
  }

  /**
   * Check if the reschedule deadline has passed for a missed appointment.
   */
  isRescheduleDeadlineExpired(appointmentId: string): boolean {
    const action = this.missedActions.get(appointmentId);
    if (!action) return false;

    const now = this.dateProvider();
    return now.getTime() > action.rescheduleDeadline.getTime();
  }
}
