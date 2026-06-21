/**
 * Scheduling Service Types
 * Request/response types for appointment scheduling, slot management, and waiting lists.
 * Validates: Requirements 3.1, 3.4, 3.6, 3.7, 3.8
 */

import type { Appointment, TimeSlot, Physician } from '@health-checkup/shared';

/**
 * Date range for querying available slots.
 */
export interface DateRange {
  startDate: Date;
  endDate: Date;
}

/**
 * Request payload for booking an appointment.
 */
export interface AppointmentRequest {
  seniorId: string;
  physicianId: string;
  packageId: string;
  slotId: string;
}

/**
 * Rescheduling options returned after cancellation.
 */
export interface RescheduleOptions {
  cancelledAppointmentId: string;
  availableSlots: TimeSlot[];
  message: string;
}

/**
 * Preferences for the waiting list.
 */
export interface WaitlistPreferences {
  preferredPhysicianId?: string;
  preferredTimeOfDay?: 'morning' | 'afternoon' | 'evening';
  specialization?: string;
}

/**
 * Waiting list entry.
 */
export interface WaitlistEntry {
  id: string;
  seniorId: string;
  preferences: WaitlistPreferences;
  joinedAt: Date;
  status: 'waiting' | 'notified' | 'expired';
}

/**
 * Result of alternative physician suggestion.
 */
export interface AlternativePhysicianSuggestion {
  physician: Physician;
  availableSlots: TimeSlot[];
}

/**
 * Dependencies injected into the SchedulingService for testability.
 */
export interface SchedulingDependencies {
  idGenerator: () => string;
  dateProvider: () => Date;
  appointmentRepository: AppointmentRepository;
  slotRepository: SlotRepository;
  physicianRepository: PhysicianRepository;
  waitlistRepository: WaitlistRepository;
}

/**
 * Repository interface for Appointment persistence.
 */
export interface AppointmentRepository {
  save(appointment: Appointment): Promise<Appointment>;
  findById(id: string): Promise<Appointment | null>;
  update(appointment: Appointment): Promise<Appointment>;
  findBySeniorId(seniorId: string): Promise<Appointment[]>;
}

/**
 * Repository interface for TimeSlot persistence.
 */
export interface SlotRepository {
  save(slot: TimeSlot): Promise<TimeSlot>;
  findById(id: string): Promise<TimeSlot | null>;
  findAvailableSlots(dateRange: DateRange, physicianId?: string): Promise<TimeSlot[]>;
  update(slot: TimeSlot): Promise<TimeSlot>;
  findByPhysicianAndDateRange(physicianId: string, dateRange: DateRange): Promise<TimeSlot[]>;
}

/**
 * Repository interface for Physician persistence.
 */
export interface PhysicianRepository {
  findById(id: string): Promise<Physician | null>;
  findAvailableByDate(date: Date, specialization?: string): Promise<Physician[]>;
  findAll(): Promise<Physician[]>;
}

/**
 * Repository interface for Waitlist persistence.
 */
export interface WaitlistRepository {
  save(entry: WaitlistEntry): Promise<WaitlistEntry>;
  findBySeniorId(seniorId: string): Promise<WaitlistEntry[]>;
}
