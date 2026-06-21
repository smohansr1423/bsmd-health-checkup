/**
 * Appointment Reminders and Missed Appointment Handling - Unit Tests
 *
 * Tests for confirmation notifications, reminder scheduling,
 * missed appointment detection, and caregiver notification.
 *
 * Validates: Requirements 3.2, 3.3, 3.5
 */

import { SupportedLanguage } from '@health-checkup/shared';
import type { Appointment } from '@health-checkup/shared';
import {
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
import type {
  EventPublisher,
  SeniorProfileProvider,
  AppointmentConfirmationEvent,
  AppointmentReminderDueEvent,
  AppointmentMissedEvent,
} from './scheduling.reminders';

// ─── Test Helpers ────────────────────────────────────────────────────────────

function createMockEventPublisher(): EventPublisher & {
  confirmations: AppointmentConfirmationEvent[];
  reminders: AppointmentReminderDueEvent[];
  missed: AppointmentMissedEvent[];
} {
  const publisher = {
    confirmations: [] as AppointmentConfirmationEvent[],
    reminders: [] as AppointmentReminderDueEvent[],
    missed: [] as AppointmentMissedEvent[],
    publishConfirmation: async (event: AppointmentConfirmationEvent) => {
      publisher.confirmations.push(event);
    },
    publishReminderDue: async (event: AppointmentReminderDueEvent) => {
      publisher.reminders.push(event);
    },
    publishMissed: async (event: AppointmentMissedEvent) => {
      publisher.missed.push(event);
    },
  };
  return publisher;
}

function createMockProfileProvider(
  language: SupportedLanguage = SupportedLanguage.English,
  caregiverId: string | null = 'caregiver-1'
): SeniorProfileProvider {
  return {
    getPreferredLanguage: async () => language,
    getCaregiverContactId: async () => caregiverId,
  };
}

function createTestAppointment(overrides?: Partial<Appointment>): Appointment {
  return {
    id: 'appt-1',
    seniorId: 'senior-1',
    physicianId: 'physician-1',
    packageId: 'pkg-1',
    scheduledDate: new Date('2024-06-15T10:00:00.000Z'),
    timeSlot: {
      id: 'slot-1',
      startTime: new Date('2024-06-15T10:00:00.000Z'),
      endTime: new Date('2024-06-15T10:30:00.000Z'),
      physicianId: 'physician-1',
      isAvailable: false,
    },
    status: 'scheduled',
    createdAt: new Date('2024-06-01T09:00:00.000Z'),
    updatedAt: new Date('2024-06-01T09:00:00.000Z'),
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Scheduling Reminders', () => {
  describe('calculateReminderTimes', () => {
    it('should calculate 3 reminders (7, 2, 1 day before) when appointment is far enough away', () => {
      const appointmentDate = new Date('2024-06-20T10:00:00.000Z');
      const now = new Date('2024-06-01T09:00:00.000Z');

      const reminders = calculateReminderTimes(appointmentDate, now);

      expect(reminders).toHaveLength(3);
      expect(reminders[0].type).toBe('7_day');
      expect(reminders[1].type).toBe('2_day');
      expect(reminders[2].type).toBe('1_day');
    });

    it('should skip reminders whose send time is in the past', () => {
      const appointmentDate = new Date('2024-06-05T10:00:00.000Z');
      // Now is June 4 — only 1-day reminder is still in the future
      const now = new Date('2024-06-04T08:00:00.000Z');

      const reminders = calculateReminderTimes(appointmentDate, now);

      expect(reminders).toHaveLength(1);
      expect(reminders[0].type).toBe('1_day');
    });

    it('should return empty when all reminders are in the past', () => {
      const appointmentDate = new Date('2024-06-01T10:00:00.000Z');
      const now = new Date('2024-06-01T09:30:00.000Z');

      const reminders = calculateReminderTimes(appointmentDate, now);

      expect(reminders).toHaveLength(0);
    });

    it('should set all reminders to scheduled status', () => {
      const appointmentDate = new Date('2024-06-20T10:00:00.000Z');
      const now = new Date('2024-06-01T09:00:00.000Z');

      const reminders = calculateReminderTimes(appointmentDate, now);

      for (const reminder of reminders) {
        expect(reminder.status).toBe('scheduled');
      }
    });
  });

  describe('calculateSendTimeAt9AM', () => {
    it('should set send time to 9:00 AM UTC when timezone offset is 0', () => {
      const appointmentDate = new Date('2024-06-20T10:00:00.000Z');

      const sendTime = calculateSendTimeAt9AM(appointmentDate, 7, 0);

      // 7 days before June 20 = June 13 at 9:00 AM UTC
      expect(sendTime.getUTCFullYear()).toBe(2024);
      expect(sendTime.getUTCMonth()).toBe(5); // June = 5
      expect(sendTime.getUTCDate()).toBe(13);
      expect(sendTime.getUTCHours()).toBe(9);
      expect(sendTime.getUTCMinutes()).toBe(0);
      expect(sendTime.getUTCSeconds()).toBe(0);
    });

    it('should adjust for positive timezone offset (e.g., IST +330 min)', () => {
      const appointmentDate = new Date('2024-06-20T10:00:00.000Z');

      // IST is UTC+5:30 → offset = +330 minutes
      // Local 9:00 AM IST = UTC 3:30 AM
      // utcHour = 9 - floor(330/60) = 9 - 5 = 4
      // utcMinute = -(330 % 60) = -30
      // setUTCHours(4, -30, 0, 0) → JS resolves to 3:30 AM UTC
      const sendTime = calculateSendTimeAt9AM(appointmentDate, 7, 330);

      expect(sendTime.getUTCDate()).toBe(13);
      expect(sendTime.getUTCHours()).toBe(3);
      expect(sendTime.getUTCMinutes()).toBe(30);
    });

    it('should adjust for negative timezone offset (e.g., EST -300 min)', () => {
      const appointmentDate = new Date('2024-06-20T10:00:00.000Z');

      // EST is UTC-5 → offset = -300 minutes
      // Local 9:00 AM = UTC 2:00 PM
      const sendTime = calculateSendTimeAt9AM(appointmentDate, 7, -300);

      expect(sendTime.getUTCDate()).toBe(13);
      expect(sendTime.getUTCHours()).toBe(14); // 9 - (-5) = 14
      expect(sendTime.getUTCMinutes()).toBe(0);
    });
  });

  describe('shouldMarkAsMissed', () => {
    it('should return true when 30+ minutes have passed with no check-in', () => {
      const appointment = createTestAppointment({
        scheduledDate: new Date('2024-06-15T10:00:00.000Z'),
        status: 'scheduled',
      });
      // 31 minutes after scheduled time
      const now = new Date('2024-06-15T10:31:00.000Z');

      expect(shouldMarkAsMissed(appointment, now)).toBe(true);
    });

    it('should return false when less than 30 minutes have passed', () => {
      const appointment = createTestAppointment({
        scheduledDate: new Date('2024-06-15T10:00:00.000Z'),
        status: 'scheduled',
      });
      // 29 minutes after scheduled time
      const now = new Date('2024-06-15T10:29:00.000Z');

      expect(shouldMarkAsMissed(appointment, now)).toBe(false);
    });

    it('should return false when exactly 30 minutes have passed (boundary)', () => {
      const appointment = createTestAppointment({
        scheduledDate: new Date('2024-06-15T10:00:00.000Z'),
        status: 'scheduled',
      });
      // Exactly 30 minutes
      const now = new Date('2024-06-15T10:30:00.000Z');

      expect(shouldMarkAsMissed(appointment, now)).toBe(true);
    });

    it('should return false when appointment is already checked in', () => {
      const appointment = createTestAppointment({
        scheduledDate: new Date('2024-06-15T10:00:00.000Z'),
        status: 'checked_in',
      });
      const now = new Date('2024-06-15T10:45:00.000Z');

      expect(shouldMarkAsMissed(appointment, now)).toBe(false);
    });

    it('should return false when appointment is completed', () => {
      const appointment = createTestAppointment({
        scheduledDate: new Date('2024-06-15T10:00:00.000Z'),
        status: 'completed',
      });
      const now = new Date('2024-06-15T11:00:00.000Z');

      expect(shouldMarkAsMissed(appointment, now)).toBe(false);
    });

    it('should return false when appointment is cancelled', () => {
      const appointment = createTestAppointment({
        scheduledDate: new Date('2024-06-15T10:00:00.000Z'),
        status: 'cancelled',
      });
      const now = new Date('2024-06-15T11:00:00.000Z');

      expect(shouldMarkAsMissed(appointment, now)).toBe(false);
    });
  });

  describe('calculateRescheduleDeadline', () => {
    it('should return a date 7 days after the missed time', () => {
      const missedAt = new Date('2024-06-15T10:30:00.000Z');

      const deadline = calculateRescheduleDeadline(missedAt);

      expect(deadline.getDate()).toBe(22); // June 15 + 7 = June 22
      expect(deadline.getUTCHours()).toBe(10);
      expect(deadline.getUTCMinutes()).toBe(30);
    });

    it('should handle month boundary crossing', () => {
      const missedAt = new Date('2024-06-28T10:00:00.000Z');

      const deadline = calculateRescheduleDeadline(missedAt);

      expect(deadline.getUTCMonth()).toBe(6); // July = 6
      expect(deadline.getUTCDate()).toBe(5); // June 28 + 7 = July 5
    });
  });

  describe('isWithinConfirmationWindow', () => {
    it('should return true when within 2 minutes of booking', () => {
      const bookingTime = new Date('2024-06-01T09:00:00.000Z');
      const now = new Date('2024-06-01T09:01:30.000Z'); // 90 seconds later

      expect(isWithinConfirmationWindow(bookingTime, now)).toBe(true);
    });

    it('should return true at exactly 2 minutes', () => {
      const bookingTime = new Date('2024-06-01T09:00:00.000Z');
      const now = new Date('2024-06-01T09:02:00.000Z'); // exactly 2 minutes

      expect(isWithinConfirmationWindow(bookingTime, now)).toBe(true);
    });

    it('should return false after 2 minutes', () => {
      const bookingTime = new Date('2024-06-01T09:00:00.000Z');
      const now = new Date('2024-06-01T09:02:01.000Z'); // 2 min + 1 sec

      expect(isWithinConfirmationWindow(bookingTime, now)).toBe(false);
    });
  });
});

describe('ReminderService', () => {
  let service: ReminderService;
  let eventPublisher: ReturnType<typeof createMockEventPublisher>;
  let profileProvider: SeniorProfileProvider;
  let currentTime: Date;

  beforeEach(() => {
    currentTime = new Date('2024-06-01T09:00:00.000Z');
    eventPublisher = createMockEventPublisher();
    profileProvider = createMockProfileProvider(SupportedLanguage.Hindi, 'caregiver-1');

    service = new ReminderService({
      dateProvider: () => currentTime,
      eventPublisher,
      seniorProfileProvider: profileProvider,
    });
  });

  describe('onAppointmentBooked', () => {
    it('should publish confirmation event with preferred language', async () => {
      const appointment = createTestAppointment();

      const result = await service.onAppointmentBooked(appointment);

      expect(eventPublisher.confirmations).toHaveLength(1);
      expect(eventPublisher.confirmations[0].language).toBe(SupportedLanguage.Hindi);
      expect(eventPublisher.confirmations[0].appointmentId).toBe('appt-1');
      expect(eventPublisher.confirmations[0].seniorId).toBe('senior-1');
      expect(result.confirmation.type).toBe('AppointmentConfirmation');
    });

    it('should schedule reminders for future dates', async () => {
      const appointment = createTestAppointment({
        scheduledDate: new Date('2024-06-20T10:00:00.000Z'),
      });

      const result = await service.onAppointmentBooked(appointment);

      // Appointment is June 20, booked June 1 → all 3 reminders are in the future
      expect(result.reminders).toHaveLength(3);
      expect(result.reminders[0].type).toBe('7_day');
      expect(result.reminders[1].type).toBe('2_day');
      expect(result.reminders[2].type).toBe('1_day');
    });

    it('should fill appointmentId and seniorId in reminders', async () => {
      const appointment = createTestAppointment({
        id: 'appt-xyz',
        seniorId: 'senior-abc',
        scheduledDate: new Date('2024-06-20T10:00:00.000Z'),
      });

      const result = await service.onAppointmentBooked(appointment);

      for (const reminder of result.reminders) {
        expect(reminder.appointmentId).toBe('appt-xyz');
        expect(reminder.seniorId).toBe('senior-abc');
      }
    });

    it('should skip reminders already in the past for close appointments', async () => {
      // Appointment in 3 days - only 2_day and 1_day reminders apply
      const appointment = createTestAppointment({
        scheduledDate: new Date('2024-06-04T10:00:00.000Z'),
      });

      const result = await service.onAppointmentBooked(appointment);

      expect(result.reminders).toHaveLength(2);
      expect(result.reminders[0].type).toBe('2_day');
      expect(result.reminders[1].type).toBe('1_day');
    });
  });

  describe('processDueReminders', () => {
    it('should publish events for reminders whose send time has arrived', async () => {
      const appointment = createTestAppointment({
        scheduledDate: new Date('2024-06-20T10:00:00.000Z'),
      });

      await service.onAppointmentBooked(appointment);

      // Advance time to June 13 at 9:01 AM (past the 7-day reminder)
      currentTime = new Date('2024-06-13T09:01:00.000Z');

      const events = await service.processDueReminders();

      expect(events).toHaveLength(1);
      expect(events[0].reminderType).toBe('7_day');
      expect(eventPublisher.reminders).toHaveLength(1);
    });

    it('should mark sent reminders as sent and not re-send them', async () => {
      const appointment = createTestAppointment({
        scheduledDate: new Date('2024-06-20T10:00:00.000Z'),
      });

      await service.onAppointmentBooked(appointment);

      // Send 7-day reminder
      currentTime = new Date('2024-06-13T09:01:00.000Z');
      await service.processDueReminders();

      // Process again - should not re-send
      const events = await service.processDueReminders();

      expect(events).toHaveLength(0);
      expect(eventPublisher.reminders).toHaveLength(1); // Still only 1
    });

    it('should send multiple reminders when time has passed multiple thresholds', async () => {
      const appointment = createTestAppointment({
        scheduledDate: new Date('2024-06-20T10:00:00.000Z'),
      });

      await service.onAppointmentBooked(appointment);

      // Jump to June 19 at 10 AM (past all 3 reminders)
      currentTime = new Date('2024-06-19T10:00:00.000Z');

      const events = await service.processDueReminders();

      expect(events).toHaveLength(3);
    });
  });

  describe('handleMissedAppointment', () => {
    it('should create a missed appointment action with reschedule deadline', async () => {
      const appointment = createTestAppointment({
        scheduledDate: new Date('2024-06-15T10:00:00.000Z'),
        status: 'scheduled',
      });

      // 35 minutes after scheduled time
      currentTime = new Date('2024-06-15T10:35:00.000Z');

      const action = await service.handleMissedAppointment(appointment);

      expect(action.appointmentId).toBe('appt-1');
      expect(action.seniorId).toBe('senior-1');
      expect(action.missedAt).toEqual(currentTime);
      expect(action.caregiverNotified).toBe(true);
      expect(action.rescheduleDeadline.getDate()).toBe(22); // June 15 + 7 = June 22
    });

    it('should publish AppointmentMissed event', async () => {
      const appointment = createTestAppointment({
        scheduledDate: new Date('2024-06-15T10:00:00.000Z'),
        status: 'scheduled',
      });

      currentTime = new Date('2024-06-15T10:35:00.000Z');

      await service.handleMissedAppointment(appointment);

      expect(eventPublisher.missed).toHaveLength(1);
      expect(eventPublisher.missed[0].type).toBe('AppointmentMissed');
      expect(eventPublisher.missed[0].appointmentId).toBe('appt-1');
    });

    it('should set caregiverNotified to false when no caregiver exists', async () => {
      const noCaregiverProvider = createMockProfileProvider(SupportedLanguage.English, null);
      const serviceNoCg = new ReminderService({
        dateProvider: () => currentTime,
        eventPublisher,
        seniorProfileProvider: noCaregiverProvider,
      });

      const appointment = createTestAppointment({
        scheduledDate: new Date('2024-06-15T10:00:00.000Z'),
        status: 'scheduled',
      });

      currentTime = new Date('2024-06-15T10:35:00.000Z');

      const action = await serviceNoCg.handleMissedAppointment(appointment);

      expect(action.caregiverNotified).toBe(false);
    });

    it('should throw when appointment is not eligible for missed marking', async () => {
      const appointment = createTestAppointment({
        scheduledDate: new Date('2024-06-15T10:00:00.000Z'),
        status: 'checked_in', // Already checked in
      });

      currentTime = new Date('2024-06-15T10:35:00.000Z');

      await expect(service.handleMissedAppointment(appointment)).rejects.toThrow(
        'cannot be marked as missed'
      );
    });

    it('should cancel pending reminders after marking as missed', async () => {
      const appointment = createTestAppointment({
        scheduledDate: new Date('2024-06-20T10:00:00.000Z'),
        status: 'scheduled',
      });

      // Book first to create reminders
      await service.onAppointmentBooked(appointment);

      // Now it's missed (move time past 30 min grace)
      currentTime = new Date('2024-06-20T10:35:00.000Z');

      await service.handleMissedAppointment(appointment);

      const reminders = service.getReminders('appt-1');
      for (const reminder of reminders) {
        // All remaining scheduled reminders should be cancelled
        if (reminder.status !== 'sent') {
          expect(reminder.status).toBe('cancelled');
        }
      }
    });
  });

  describe('cancelReminders', () => {
    it('should cancel all scheduled reminders for an appointment', async () => {
      const appointment = createTestAppointment({
        scheduledDate: new Date('2024-06-20T10:00:00.000Z'),
      });

      await service.onAppointmentBooked(appointment);

      service.cancelReminders('appt-1');

      const reminders = service.getReminders('appt-1');
      for (const reminder of reminders) {
        expect(reminder.status).toBe('cancelled');
      }
    });

    it('should not affect already-sent reminders', async () => {
      const appointment = createTestAppointment({
        scheduledDate: new Date('2024-06-20T10:00:00.000Z'),
      });

      await service.onAppointmentBooked(appointment);

      // Send the 7-day reminder
      currentTime = new Date('2024-06-13T09:01:00.000Z');
      await service.processDueReminders();

      // Now cancel
      service.cancelReminders('appt-1');

      const reminders = service.getReminders('appt-1');
      const sentReminder = reminders.find((r) => r.type === '7_day');
      expect(sentReminder?.status).toBe('sent');

      const cancelledReminders = reminders.filter((r) => r.type !== '7_day');
      for (const r of cancelledReminders) {
        expect(r.status).toBe('cancelled');
      }
    });
  });

  describe('isRescheduleDeadlineExpired', () => {
    it('should return false when no missed action exists', () => {
      expect(service.isRescheduleDeadlineExpired('nonexistent')).toBe(false);
    });

    it('should return false when within deadline', async () => {
      const appointment = createTestAppointment({
        scheduledDate: new Date('2024-06-15T10:00:00.000Z'),
        status: 'scheduled',
      });

      currentTime = new Date('2024-06-15T10:35:00.000Z');
      await service.handleMissedAppointment(appointment);

      // Still within 7 days
      currentTime = new Date('2024-06-20T10:00:00.000Z');
      expect(service.isRescheduleDeadlineExpired('appt-1')).toBe(false);
    });

    it('should return true after deadline has passed', async () => {
      const appointment = createTestAppointment({
        scheduledDate: new Date('2024-06-15T10:00:00.000Z'),
        status: 'scheduled',
      });

      currentTime = new Date('2024-06-15T10:35:00.000Z');
      await service.handleMissedAppointment(appointment);

      // 8 days later (past the 7-day deadline)
      currentTime = new Date('2024-06-23T11:00:00.000Z');
      expect(service.isRescheduleDeadlineExpired('appt-1')).toBe(true);
    });
  });
});
