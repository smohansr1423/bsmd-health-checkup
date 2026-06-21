/**
 * Scheduling Service
 * Manages appointment scheduling, time slot availability, physician selection,
 * cancellation with rescheduling, and waiting list management.
 * Validates: Requirements 3.1, 3.4, 3.6, 3.7, 3.8
 */

import type { Appointment, TimeSlot, Physician } from '@health-checkup/shared';
import type {
  AppointmentRequest,
  DateRange,
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
import {
  validateDateRange,
  validateAppointmentRequest,
  getMaxSlotsPerDay,
  getMaxDaysAhead,
  getRescheduleWindowDays,
  getMinAlternativePhysicians,
} from './scheduling.validators';
import {
  NoSlotsAvailableError,
  PhysicianUnavailableError,
  SlotNotAvailableError,
  AppointmentNotFoundError,
  AppointmentNotCancellableError,
} from './scheduling.errors';

/**
 * In-memory implementation of AppointmentRepository.
 */
export class InMemoryAppointmentRepository implements AppointmentRepository {
  private appointments: Appointment[] = [];

  async save(appointment: Appointment): Promise<Appointment> {
    this.appointments.push(appointment);
    return appointment;
  }

  async findById(id: string): Promise<Appointment | null> {
    return this.appointments.find((a) => a.id === id) ?? null;
  }

  async update(appointment: Appointment): Promise<Appointment> {
    const index = this.appointments.findIndex((a) => a.id === appointment.id);
    if (index === -1) {
      throw new Error(`Appointment not found: ${appointment.id}`);
    }
    this.appointments[index] = appointment;
    return appointment;
  }

  async findBySeniorId(seniorId: string): Promise<Appointment[]> {
    return this.appointments.filter((a) => a.seniorId === seniorId);
  }

  clear(): void {
    this.appointments = [];
  }
}

/**
 * In-memory implementation of SlotRepository.
 */
export class InMemorySlotRepository implements SlotRepository {
  private slots: TimeSlot[] = [];

  async save(slot: TimeSlot): Promise<TimeSlot> {
    this.slots.push(slot);
    return slot;
  }

  async findById(id: string): Promise<TimeSlot | null> {
    return this.slots.find((s) => s.id === id) ?? null;
  }

  async findAvailableSlots(dateRange: DateRange, physicianId?: string): Promise<TimeSlot[]> {
    return this.slots.filter((s) => {
      if (!s.isAvailable) return false;
      if (s.startTime < dateRange.startDate || s.startTime > dateRange.endDate) return false;
      if (physicianId && s.physicianId !== physicianId) return false;
      return true;
    });
  }

  async update(slot: TimeSlot): Promise<TimeSlot> {
    const index = this.slots.findIndex((s) => s.id === slot.id);
    if (index === -1) {
      throw new Error(`Slot not found: ${slot.id}`);
    }
    this.slots[index] = slot;
    return slot;
  }

  async findByPhysicianAndDateRange(physicianId: string, dateRange: DateRange): Promise<TimeSlot[]> {
    return this.slots.filter((s) => {
      if (s.physicianId !== physicianId) return false;
      if (s.startTime < dateRange.startDate || s.startTime > dateRange.endDate) return false;
      return s.isAvailable;
    });
  }

  clear(): void {
    this.slots = [];
  }
}

/**
 * In-memory implementation of PhysicianRepository.
 */
export class InMemoryPhysicianRepository implements PhysicianRepository {
  private physicians: Physician[] = [];

  async findById(id: string): Promise<Physician | null> {
    return this.physicians.find((p) => p.id === id) ?? null;
  }

  async findAvailableByDate(date: Date, specialization?: string): Promise<Physician[]> {
    const dayOfWeek = getDayName(date);
    return this.physicians.filter((p) => {
      if (!p.isActive) return false;
      if (specialization && p.specialization !== specialization) return false;
      const schedule = p.availabilitySchedule[dayOfWeek];
      return schedule.isAvailable;
    });
  }

  async findAll(): Promise<Physician[]> {
    return this.physicians.filter((p) => p.isActive);
  }

  addPhysician(physician: Physician): void {
    this.physicians.push(physician);
  }

  clear(): void {
    this.physicians = [];
  }
}

/**
 * In-memory implementation of WaitlistRepository.
 */
export class InMemoryWaitlistRepository implements WaitlistRepository {
  private entries: WaitlistEntry[] = [];

  async save(entry: WaitlistEntry): Promise<WaitlistEntry> {
    this.entries.push(entry);
    return entry;
  }

  async findBySeniorId(seniorId: string): Promise<WaitlistEntry[]> {
    return this.entries.filter((e) => e.seniorId === seniorId);
  }

  clear(): void {
    this.entries = [];
  }
}

/** Default ID generator using timestamp + random suffix */
const defaultIdGenerator = (): string => {
  return `SCHED_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
};

/** Default date provider returning the current system date */
const defaultDateProvider = (): Date => new Date();

/**
 * Helper to get the day name from a Date object matching WeeklySchedule keys.
 */
function getDayName(date: Date): 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday' {
  const days: Array<'sunday' | 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday'> = [
    'sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday',
  ];
  return days[date.getDay()];
}

/**
 * SchedulingService implementation.
 *
 * Uses dependency injection for ID generation, date provision, and repository
 * access to support testability.
 */
export class SchedulingService {
  private readonly idGenerator: () => string;
  private readonly dateProvider: () => Date;
  private readonly appointmentRepository: AppointmentRepository;
  private readonly slotRepository: SlotRepository;
  private readonly physicianRepository: PhysicianRepository;
  private readonly waitlistRepository: WaitlistRepository;

  constructor(deps?: Partial<SchedulingDependencies>) {
    this.idGenerator = deps?.idGenerator ?? defaultIdGenerator;
    this.dateProvider = deps?.dateProvider ?? defaultDateProvider;
    this.appointmentRepository = deps?.appointmentRepository ?? new InMemoryAppointmentRepository();
    this.slotRepository = deps?.slotRepository ?? new InMemorySlotRepository();
    this.physicianRepository = deps?.physicianRepository ?? new InMemoryPhysicianRepository();
    this.waitlistRepository = deps?.waitlistRepository ?? new InMemoryWaitlistRepository();
  }

  /**
   * Get available time slots within the next 30 calendar days.
   *
   * Requirement 3.1: Display available time slots for the next 30 calendar days,
   * maximum of 20 time slots per day, sorted by earliest availability.
   *
   * Requirement 3.6: Allow selection from available physicians for the slot.
   * Requirement 3.7: If preferred physician unavailable, suggest alternatives.
   */
  async getAvailableSlots(dateRange: DateRange, physicianId?: string): Promise<TimeSlot[]> {
    const currentDate = this.dateProvider();

    // Clamp the date range to the next 30 days
    const maxDate = new Date(currentDate);
    maxDate.setDate(maxDate.getDate() + getMaxDaysAhead());
    maxDate.setHours(23, 59, 59, 999);

    const effectiveRange: DateRange = {
      startDate: dateRange.startDate < currentDate ? currentDate : dateRange.startDate,
      endDate: dateRange.endDate > maxDate ? maxDate : dateRange.endDate,
    };

    const allSlots = await this.slotRepository.findAvailableSlots(effectiveRange, physicianId);

    // Sort by earliest start time
    allSlots.sort((a, b) => a.startTime.getTime() - b.startTime.getTime());

    // Limit to max 20 per day
    const maxPerDay = getMaxSlotsPerDay();
    const slotsByDay = new Map<string, TimeSlot[]>();

    for (const slot of allSlots) {
      const dayKey = slot.startTime.toISOString().split('T')[0];
      const daySlots = slotsByDay.get(dayKey) ?? [];
      if (daySlots.length < maxPerDay) {
        daySlots.push(slot);
        slotsByDay.set(dayKey, daySlots);
      }
    }

    // Flatten back into a sorted array
    const result: TimeSlot[] = [];
    const sortedDays = Array.from(slotsByDay.keys()).sort();
    for (const day of sortedDays) {
      result.push(...(slotsByDay.get(day) ?? []));
    }

    return result;
  }

  /**
   * Book an appointment for a specific time slot.
   *
   * Requirement 3.6: Allow physician selection from available physicians.
   */
  async bookAppointment(request: AppointmentRequest): Promise<Appointment> {
    // Validate request
    const validation = validateAppointmentRequest(request);
    if (!validation.valid) {
      throw new Error(validation.message);
    }

    // Find and validate the slot
    const slot = await this.slotRepository.findById(request.slotId);
    if (!slot) {
      throw new SlotNotAvailableError(request.slotId);
    }

    if (!slot.isAvailable) {
      throw new SlotNotAvailableError(request.slotId);
    }

    // Verify physician matches the slot
    if (slot.physicianId !== request.physicianId) {
      throw new Error(
        `Physician ${request.physicianId} does not match the slot's physician ${slot.physicianId}.`
      );
    }

    const now = this.dateProvider();

    // Mark the slot as unavailable
    await this.slotRepository.update({ ...slot, isAvailable: false });

    // Create the appointment
    const appointment: Appointment = {
      id: this.idGenerator(),
      seniorId: request.seniorId,
      physicianId: request.physicianId,
      packageId: request.packageId,
      scheduledDate: slot.startTime,
      timeSlot: { ...slot, isAvailable: false },
      status: 'scheduled',
      createdAt: now,
      updatedAt: now,
    };

    return this.appointmentRepository.save(appointment);
  }

  /**
   * Cancel an appointment and offer rescheduling options.
   *
   * Requirement 3.4: Release the time slot and offer a minimum of 3 rescheduling
   * options within the next 14 calendar days.
   */
  async cancelAppointment(appointmentId: string): Promise<RescheduleOptions> {
    const appointment = await this.appointmentRepository.findById(appointmentId);
    if (!appointment) {
      throw new AppointmentNotFoundError(appointmentId);
    }

    // Only scheduled or checked-in appointments can be cancelled
    if (appointment.status !== 'scheduled' && appointment.status !== 'checked_in') {
      throw new AppointmentNotCancellableError(appointmentId, appointment.status);
    }

    const now = this.dateProvider();

    // Release the time slot
    const slot = await this.slotRepository.findById(appointment.timeSlot.id);
    if (slot) {
      await this.slotRepository.update({ ...slot, isAvailable: true });
    }

    // Update appointment status
    await this.appointmentRepository.update({
      ...appointment,
      status: 'cancelled',
      updatedAt: now,
    });

    // Find rescheduling options within the next 14 days
    const rescheduleEndDate = new Date(now);
    rescheduleEndDate.setDate(rescheduleEndDate.getDate() + getRescheduleWindowDays());

    const rescheduleRange: DateRange = {
      startDate: now,
      endDate: rescheduleEndDate,
    };

    const availableSlots = await this.slotRepository.findAvailableSlots(rescheduleRange);

    // Sort by earliest and return minimum 3 (or all if fewer exist)
    availableSlots.sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
    const reschedulingSlots = availableSlots.slice(0, Math.max(3, availableSlots.length));

    return {
      cancelledAppointmentId: appointmentId,
      availableSlots: reschedulingSlots,
      message:
        reschedulingSlots.length >= 3
          ? `Appointment cancelled. ${reschedulingSlots.length} rescheduling option(s) available within the next ${getRescheduleWindowDays()} days.`
          : `Appointment cancelled. Only ${reschedulingSlots.length} rescheduling option(s) available within the next ${getRescheduleWindowDays()} days.`,
    };
  }

  /**
   * Reschedule an appointment to a new time slot.
   */
  async rescheduleAppointment(appointmentId: string, newSlotId: string): Promise<Appointment> {
    const appointment = await this.appointmentRepository.findById(appointmentId);
    if (!appointment) {
      throw new AppointmentNotFoundError(appointmentId);
    }

    // Find and validate the new slot
    const newSlot = await this.slotRepository.findById(newSlotId);
    if (!newSlot) {
      throw new SlotNotAvailableError(newSlotId);
    }

    if (!newSlot.isAvailable) {
      throw new SlotNotAvailableError(newSlotId);
    }

    const now = this.dateProvider();

    // Release old slot if appointment was scheduled (not already cancelled)
    if (appointment.status === 'scheduled') {
      const oldSlot = await this.slotRepository.findById(appointment.timeSlot.id);
      if (oldSlot) {
        await this.slotRepository.update({ ...oldSlot, isAvailable: true });
      }
    }

    // Mark new slot as unavailable
    await this.slotRepository.update({ ...newSlot, isAvailable: false });

    // Update the appointment
    const updatedAppointment: Appointment = {
      ...appointment,
      physicianId: newSlot.physicianId,
      scheduledDate: newSlot.startTime,
      timeSlot: { ...newSlot, isAvailable: false },
      status: 'scheduled',
      updatedAt: now,
    };

    return this.appointmentRepository.update(updatedAppointment);
  }

  /**
   * Mark an appointment as missed.
   *
   * Requirement 3.5: Mark the appointment as missed if no check-in within
   * 30 minutes after the scheduled start time.
   */
  async markMissed(appointmentId: string): Promise<void> {
    const appointment = await this.appointmentRepository.findById(appointmentId);
    if (!appointment) {
      throw new AppointmentNotFoundError(appointmentId);
    }

    const now = this.dateProvider();

    await this.appointmentRepository.update({
      ...appointment,
      status: 'missed',
      updatedAt: now,
    });
  }

  /**
   * Join the waiting list when no slots are available.
   *
   * Requirement 3.8: Offer to place the senior citizen on a waiting list.
   */
  async joinWaitingList(seniorId: string, preferences: WaitlistPreferences): Promise<WaitlistEntry> {
    const now = this.dateProvider();

    const entry: WaitlistEntry = {
      id: this.idGenerator(),
      seniorId,
      preferences,
      joinedAt: now,
      status: 'waiting',
    };

    return this.waitlistRepository.save(entry);
  }

  /**
   * Get available physicians for a given date and optional specialization.
   *
   * Requirement 3.6: Allow selection of a preferred physician from available physicians.
   */
  async getAvailablePhysicians(date: Date, specialization?: string): Promise<Physician[]> {
    return this.physicianRepository.findAvailableByDate(date, specialization);
  }

  /**
   * Suggest alternative physicians when the preferred one is unavailable.
   *
   * Requirement 3.7: If the selected physician has no available time slots within
   * the next 30 calendar days, inform and display alternative available physicians.
   * Suggests at least 3 alternatives (from Requirement 4.4).
   */
  async suggestAlternativePhysicians(
    preferredPhysicianId: string,
    specialization?: string
  ): Promise<AlternativePhysicianSuggestion[]> {
    const currentDate = this.dateProvider();
    const endDate = new Date(currentDate);
    endDate.setDate(endDate.getDate() + getMaxDaysAhead());

    const dateRange: DateRange = { startDate: currentDate, endDate };

    // Check if preferred physician has any slots
    const preferredSlots = await this.slotRepository.findByPhysicianAndDateRange(
      preferredPhysicianId,
      dateRange
    );

    if (preferredSlots.length > 0) {
      // Preferred physician is available — no alternatives needed
      return [];
    }

    // Find all active physicians (optionally filtered by specialization)
    const allPhysicians = await this.physicianRepository.findAll();
    const alternatives: AlternativePhysicianSuggestion[] = [];

    for (const physician of allPhysicians) {
      if (physician.id === preferredPhysicianId) continue;
      if (specialization && physician.specialization !== specialization) continue;

      const slots = await this.slotRepository.findByPhysicianAndDateRange(physician.id, dateRange);
      if (slots.length > 0) {
        alternatives.push({
          physician,
          availableSlots: slots.sort((a, b) => a.startTime.getTime() - b.startTime.getTime()),
        });
      }
    }

    return alternatives;
  }
}
