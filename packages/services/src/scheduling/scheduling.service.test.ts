/**
 * Scheduling Service Unit Tests
 * Tests for appointment scheduling, slot management, cancellation, rescheduling,
 * physician selection, waiting list, and alternative physician suggestions.
 * Validates: Requirements 3.1, 3.4, 3.6, 3.7, 3.8
 */

import type { Physician, TimeSlot } from '@health-checkup/shared';
import {
  SchedulingService,
  InMemoryAppointmentRepository,
  InMemorySlotRepository,
  InMemoryPhysicianRepository,
  InMemoryWaitlistRepository,
} from './scheduling.service';
import {
  SlotNotAvailableError,
  AppointmentNotFoundError,
  AppointmentNotCancellableError,
} from './scheduling.errors';
import type { DateRange } from './scheduling.types';

describe('SchedulingService', () => {
  let service: SchedulingService;
  let appointmentRepo: InMemoryAppointmentRepository;
  let slotRepo: InMemorySlotRepository;
  let physicianRepo: InMemoryPhysicianRepository;
  let waitlistRepo: InMemoryWaitlistRepository;

  const fixedDate = new Date('2024-06-01T09:00:00.000Z');
  let idCounter = 0;

  const createPhysician = (overrides?: Partial<Physician>): Physician => ({
    id: `physician-${++idCounter}`,
    name: 'Dr. Smith',
    specialization: 'general',
    qualifications: ['MD'],
    department: 'Internal Medicine',
    availabilitySchedule: {
      monday: { isAvailable: true, startTime: '09:00', endTime: '17:00' },
      tuesday: { isAvailable: true, startTime: '09:00', endTime: '17:00' },
      wednesday: { isAvailable: true, startTime: '09:00', endTime: '17:00' },
      thursday: { isAvailable: true, startTime: '09:00', endTime: '17:00' },
      friday: { isAvailable: true, startTime: '09:00', endTime: '17:00' },
      saturday: { isAvailable: false },
      sunday: { isAvailable: false },
    },
    isActive: true,
    ...overrides,
  });

  const createSlot = (overrides?: Partial<TimeSlot>): TimeSlot => ({
    id: `slot-${++idCounter}`,
    startTime: new Date('2024-06-03T10:00:00.000Z'),
    endTime: new Date('2024-06-03T10:30:00.000Z'),
    physicianId: 'physician-1',
    isAvailable: true,
    ...overrides,
  });

  beforeEach(() => {
    idCounter = 0;
    appointmentRepo = new InMemoryAppointmentRepository();
    slotRepo = new InMemorySlotRepository();
    physicianRepo = new InMemoryPhysicianRepository();
    waitlistRepo = new InMemoryWaitlistRepository();

    service = new SchedulingService({
      idGenerator: () => `test-${++idCounter}`,
      dateProvider: () => fixedDate,
      appointmentRepository: appointmentRepo,
      slotRepository: slotRepo,
      physicianRepository: physicianRepo,
      waitlistRepository: waitlistRepo,
    });
  });

  describe('getAvailableSlots', () => {
    it('should return available slots within 30 days sorted by earliest', async () => {
      const slot1 = createSlot({
        id: 'slot-a',
        startTime: new Date('2024-06-05T14:00:00.000Z'),
        endTime: new Date('2024-06-05T14:30:00.000Z'),
      });
      const slot2 = createSlot({
        id: 'slot-b',
        startTime: new Date('2024-06-03T09:00:00.000Z'),
        endTime: new Date('2024-06-03T09:30:00.000Z'),
      });
      const slot3 = createSlot({
        id: 'slot-c',
        startTime: new Date('2024-06-03T10:00:00.000Z'),
        endTime: new Date('2024-06-03T10:30:00.000Z'),
      });

      await slotRepo.save(slot1);
      await slotRepo.save(slot2);
      await slotRepo.save(slot3);

      const dateRange: DateRange = {
        startDate: fixedDate,
        endDate: new Date('2024-06-30T23:59:59.000Z'),
      };

      const result = await service.getAvailableSlots(dateRange);

      expect(result).toHaveLength(3);
      expect(result[0].id).toBe('slot-b'); // earliest
      expect(result[1].id).toBe('slot-c');
      expect(result[2].id).toBe('slot-a');
    });

    it('should limit slots to maximum 20 per day', async () => {
      // Create 25 slots for the same day
      for (let i = 0; i < 25; i++) {
        const hour = 8 + Math.floor(i / 2);
        const minutes = (i % 2) * 30;
        await slotRepo.save(
          createSlot({
            id: `slot-day-${i}`,
            startTime: new Date(`2024-06-03T${String(hour).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00.000Z`),
            endTime: new Date(`2024-06-03T${String(hour).padStart(2, '0')}:${String(minutes + 29).padStart(2, '0')}:00.000Z`),
          })
        );
      }

      const dateRange: DateRange = {
        startDate: fixedDate,
        endDate: new Date('2024-06-30T23:59:59.000Z'),
      };

      const result = await service.getAvailableSlots(dateRange);

      expect(result.length).toBe(20);
    });

    it('should not return slots beyond 30 days', async () => {
      const slotWithin = createSlot({
        id: 'slot-within',
        startTime: new Date('2024-06-15T10:00:00.000Z'),
        endTime: new Date('2024-06-15T10:30:00.000Z'),
      });
      const slotBeyond = createSlot({
        id: 'slot-beyond',
        startTime: new Date('2024-08-01T10:00:00.000Z'),
        endTime: new Date('2024-08-01T10:30:00.000Z'),
      });

      await slotRepo.save(slotWithin);
      await slotRepo.save(slotBeyond);

      const dateRange: DateRange = {
        startDate: fixedDate,
        endDate: new Date('2024-08-01T23:59:59.000Z'),
      };

      const result = await service.getAvailableSlots(dateRange);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('slot-within');
    });

    it('should filter by physician when physicianId provided', async () => {
      const slot1 = createSlot({
        id: 'slot-doc1',
        physicianId: 'doc-1',
        startTime: new Date('2024-06-03T10:00:00.000Z'),
      });
      const slot2 = createSlot({
        id: 'slot-doc2',
        physicianId: 'doc-2',
        startTime: new Date('2024-06-03T11:00:00.000Z'),
      });

      await slotRepo.save(slot1);
      await slotRepo.save(slot2);

      const dateRange: DateRange = {
        startDate: fixedDate,
        endDate: new Date('2024-06-30T23:59:59.000Z'),
      };

      const result = await service.getAvailableSlots(dateRange, 'doc-1');

      expect(result).toHaveLength(1);
      expect(result[0].physicianId).toBe('doc-1');
    });

    it('should not return unavailable slots', async () => {
      const availableSlot = createSlot({ id: 'slot-available', isAvailable: true });
      const unavailableSlot = createSlot({ id: 'slot-unavailable', isAvailable: false });

      await slotRepo.save(availableSlot);
      await slotRepo.save(unavailableSlot);

      const dateRange: DateRange = {
        startDate: fixedDate,
        endDate: new Date('2024-06-30T23:59:59.000Z'),
      };

      const result = await service.getAvailableSlots(dateRange);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('slot-available');
    });
  });

  describe('bookAppointment', () => {
    it('should book an appointment for an available slot', async () => {
      const slot = createSlot({ id: 'slot-book', physicianId: 'doc-1' });
      await slotRepo.save(slot);

      const appointment = await service.bookAppointment({
        seniorId: 'senior-1',
        physicianId: 'doc-1',
        packageId: 'pkg-1',
        slotId: 'slot-book',
      });

      expect(appointment.seniorId).toBe('senior-1');
      expect(appointment.physicianId).toBe('doc-1');
      expect(appointment.packageId).toBe('pkg-1');
      expect(appointment.status).toBe('scheduled');
      expect(appointment.timeSlot.isAvailable).toBe(false);

      // Verify slot is marked unavailable
      const updatedSlot = await slotRepo.findById('slot-book');
      expect(updatedSlot?.isAvailable).toBe(false);
    });

    it('should throw SlotNotAvailableError when slot does not exist', async () => {
      await expect(
        service.bookAppointment({
          seniorId: 'senior-1',
          physicianId: 'doc-1',
          packageId: 'pkg-1',
          slotId: 'nonexistent-slot',
        })
      ).rejects.toThrow(SlotNotAvailableError);
    });

    it('should throw SlotNotAvailableError when slot is already taken', async () => {
      const slot = createSlot({ id: 'slot-taken', physicianId: 'doc-1', isAvailable: false });
      await slotRepo.save(slot);

      await expect(
        service.bookAppointment({
          seniorId: 'senior-1',
          physicianId: 'doc-1',
          packageId: 'pkg-1',
          slotId: 'slot-taken',
        })
      ).rejects.toThrow(SlotNotAvailableError);
    });

    it('should throw when physician does not match slot', async () => {
      const slot = createSlot({ id: 'slot-mismatch', physicianId: 'doc-1' });
      await slotRepo.save(slot);

      await expect(
        service.bookAppointment({
          seniorId: 'senior-1',
          physicianId: 'doc-2',
          packageId: 'pkg-1',
          slotId: 'slot-mismatch',
        })
      ).rejects.toThrow('does not match');
    });

    it('should throw when required fields are missing', async () => {
      await expect(
        service.bookAppointment({
          seniorId: '',
          physicianId: 'doc-1',
          packageId: 'pkg-1',
          slotId: 'slot-1',
        })
      ).rejects.toThrow('Senior ID is required');
    });
  });

  describe('cancelAppointment', () => {
    it('should cancel a scheduled appointment and offer rescheduling options', async () => {
      const slot = createSlot({ id: 'slot-cancel', physicianId: 'doc-1' });
      await slotRepo.save(slot);

      const appointment = await service.bookAppointment({
        seniorId: 'senior-1',
        physicianId: 'doc-1',
        packageId: 'pkg-1',
        slotId: 'slot-cancel',
      });

      // Add rescheduling options
      await slotRepo.save(
        createSlot({
          id: 'reschedule-1',
          startTime: new Date('2024-06-05T10:00:00.000Z'),
          endTime: new Date('2024-06-05T10:30:00.000Z'),
        })
      );
      await slotRepo.save(
        createSlot({
          id: 'reschedule-2',
          startTime: new Date('2024-06-06T10:00:00.000Z'),
          endTime: new Date('2024-06-06T10:30:00.000Z'),
        })
      );
      await slotRepo.save(
        createSlot({
          id: 'reschedule-3',
          startTime: new Date('2024-06-07T10:00:00.000Z'),
          endTime: new Date('2024-06-07T10:30:00.000Z'),
        })
      );

      const result = await service.cancelAppointment(appointment.id);

      expect(result.cancelledAppointmentId).toBe(appointment.id);
      // The released slot + the 3 new slots = at least 3 options
      expect(result.availableSlots.length).toBeGreaterThanOrEqual(3);

      // Verify slot is released
      const releasedSlot = await slotRepo.findById('slot-cancel');
      expect(releasedSlot?.isAvailable).toBe(true);
    });

    it('should throw AppointmentNotFoundError for nonexistent appointment', async () => {
      await expect(service.cancelAppointment('nonexistent')).rejects.toThrow(
        AppointmentNotFoundError
      );
    });

    it('should throw AppointmentNotCancellableError for completed appointment', async () => {
      const slot = createSlot({ id: 'slot-completed', physicianId: 'doc-1' });
      await slotRepo.save(slot);

      const appointment = await service.bookAppointment({
        seniorId: 'senior-1',
        physicianId: 'doc-1',
        packageId: 'pkg-1',
        slotId: 'slot-completed',
      });

      // Manually set status to completed
      await appointmentRepo.update({ ...appointment, status: 'completed' });

      await expect(service.cancelAppointment(appointment.id)).rejects.toThrow(
        AppointmentNotCancellableError
      );
    });
  });

  describe('rescheduleAppointment', () => {
    it('should reschedule an appointment to a new slot', async () => {
      const oldSlot = createSlot({ id: 'old-slot', physicianId: 'doc-1' });
      const newSlot = createSlot({
        id: 'new-slot',
        physicianId: 'doc-2',
        startTime: new Date('2024-06-10T14:00:00.000Z'),
        endTime: new Date('2024-06-10T14:30:00.000Z'),
      });

      await slotRepo.save(oldSlot);
      await slotRepo.save(newSlot);

      const appointment = await service.bookAppointment({
        seniorId: 'senior-1',
        physicianId: 'doc-1',
        packageId: 'pkg-1',
        slotId: 'old-slot',
      });

      const rescheduled = await service.rescheduleAppointment(appointment.id, 'new-slot');

      expect(rescheduled.physicianId).toBe('doc-2');
      expect(rescheduled.timeSlot.id).toBe('new-slot');
      expect(rescheduled.status).toBe('scheduled');

      // Old slot released
      const releasedSlot = await slotRepo.findById('old-slot');
      expect(releasedSlot?.isAvailable).toBe(true);

      // New slot taken
      const takenSlot = await slotRepo.findById('new-slot');
      expect(takenSlot?.isAvailable).toBe(false);
    });

    it('should throw when new slot is not available', async () => {
      const oldSlot = createSlot({ id: 'old-slot-2', physicianId: 'doc-1' });
      const takenSlot = createSlot({ id: 'taken-slot', physicianId: 'doc-1', isAvailable: false });

      await slotRepo.save(oldSlot);
      await slotRepo.save(takenSlot);

      const appointment = await service.bookAppointment({
        seniorId: 'senior-1',
        physicianId: 'doc-1',
        packageId: 'pkg-1',
        slotId: 'old-slot-2',
      });

      await expect(
        service.rescheduleAppointment(appointment.id, 'taken-slot')
      ).rejects.toThrow(SlotNotAvailableError);
    });
  });

  describe('markMissed', () => {
    it('should mark an appointment as missed', async () => {
      const slot = createSlot({ id: 'slot-miss', physicianId: 'doc-1' });
      await slotRepo.save(slot);

      const appointment = await service.bookAppointment({
        seniorId: 'senior-1',
        physicianId: 'doc-1',
        packageId: 'pkg-1',
        slotId: 'slot-miss',
      });

      await service.markMissed(appointment.id);

      const updated = await appointmentRepo.findById(appointment.id);
      expect(updated?.status).toBe('missed');
    });

    it('should throw for nonexistent appointment', async () => {
      await expect(service.markMissed('nonexistent')).rejects.toThrow(AppointmentNotFoundError);
    });
  });

  describe('joinWaitingList', () => {
    it('should create a waiting list entry', async () => {
      const entry = await service.joinWaitingList('senior-1', {
        preferredPhysicianId: 'doc-1',
        preferredTimeOfDay: 'morning',
      });

      expect(entry.seniorId).toBe('senior-1');
      expect(entry.preferences.preferredPhysicianId).toBe('doc-1');
      expect(entry.preferences.preferredTimeOfDay).toBe('morning');
      expect(entry.status).toBe('waiting');
      expect(entry.joinedAt).toEqual(fixedDate);
    });
  });

  describe('getAvailablePhysicians', () => {
    it('should return physicians available on the given date', async () => {
      // June 3 2024 is a Monday
      const doc1 = createPhysician({ id: 'doc-avail-1', name: 'Dr. Available' });
      const doc2 = createPhysician({
        id: 'doc-unavail',
        name: 'Dr. Unavailable',
        availabilitySchedule: {
          monday: { isAvailable: false },
          tuesday: { isAvailable: true, startTime: '09:00', endTime: '17:00' },
          wednesday: { isAvailable: true, startTime: '09:00', endTime: '17:00' },
          thursday: { isAvailable: true, startTime: '09:00', endTime: '17:00' },
          friday: { isAvailable: true, startTime: '09:00', endTime: '17:00' },
          saturday: { isAvailable: false },
          sunday: { isAvailable: false },
        },
      });

      physicianRepo.addPhysician(doc1);
      physicianRepo.addPhysician(doc2);

      const monday = new Date('2024-06-03T10:00:00.000Z');
      const result = await service.getAvailablePhysicians(monday);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('doc-avail-1');
    });

    it('should filter by specialization', async () => {
      const cardiologist = createPhysician({ id: 'doc-cardio', specialization: 'cardiology' });
      const generalDoc = createPhysician({ id: 'doc-general', specialization: 'general' });

      physicianRepo.addPhysician(cardiologist);
      physicianRepo.addPhysician(generalDoc);

      const monday = new Date('2024-06-03T10:00:00.000Z');
      const result = await service.getAvailablePhysicians(monday, 'cardiology');

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('doc-cardio');
    });
  });

  describe('suggestAlternativePhysicians', () => {
    it('should return empty when preferred physician has slots', async () => {
      await slotRepo.save(
        createSlot({
          id: 'pref-slot',
          physicianId: 'preferred-doc',
          startTime: new Date('2024-06-10T10:00:00.000Z'),
        })
      );

      const result = await service.suggestAlternativePhysicians('preferred-doc');

      expect(result).toHaveLength(0);
    });

    it('should suggest alternative physicians when preferred has no slots', async () => {
      // Preferred physician has no slots
      const doc1 = createPhysician({ id: 'alt-doc-1', specialization: 'general' });
      const doc2 = createPhysician({ id: 'alt-doc-2', specialization: 'general' });
      const doc3 = createPhysician({ id: 'alt-doc-3', specialization: 'general' });

      physicianRepo.addPhysician(doc1);
      physicianRepo.addPhysician(doc2);
      physicianRepo.addPhysician(doc3);

      // Add slots for alternative physicians
      await slotRepo.save(
        createSlot({ id: 'alt-slot-1', physicianId: 'alt-doc-1', startTime: new Date('2024-06-10T10:00:00.000Z') })
      );
      await slotRepo.save(
        createSlot({ id: 'alt-slot-2', physicianId: 'alt-doc-2', startTime: new Date('2024-06-12T10:00:00.000Z') })
      );
      await slotRepo.save(
        createSlot({ id: 'alt-slot-3', physicianId: 'alt-doc-3', startTime: new Date('2024-06-15T10:00:00.000Z') })
      );

      const result = await service.suggestAlternativePhysicians('preferred-doc', 'general');

      expect(result.length).toBeGreaterThanOrEqual(3);
      expect(result[0].physician.id).toBe('alt-doc-1');
      expect(result[0].availableSlots.length).toBeGreaterThan(0);
    });

    it('should filter alternatives by specialization', async () => {
      const cardiologist = createPhysician({ id: 'cardio-alt', specialization: 'cardiology' });
      const generalDoc = createPhysician({ id: 'general-alt', specialization: 'general' });

      physicianRepo.addPhysician(cardiologist);
      physicianRepo.addPhysician(generalDoc);

      await slotRepo.save(
        createSlot({ id: 'cardio-slot', physicianId: 'cardio-alt', startTime: new Date('2024-06-10T10:00:00.000Z') })
      );
      await slotRepo.save(
        createSlot({ id: 'general-slot', physicianId: 'general-alt', startTime: new Date('2024-06-10T11:00:00.000Z') })
      );

      const result = await service.suggestAlternativePhysicians('preferred-doc', 'cardiology');

      expect(result).toHaveLength(1);
      expect(result[0].physician.specialization).toBe('cardiology');
    });
  });
});
