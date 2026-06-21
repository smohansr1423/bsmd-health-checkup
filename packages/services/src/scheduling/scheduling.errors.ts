/**
 * Scheduling Errors
 * Custom error types for the scheduling workflow.
 * Validates: Requirements 3.1, 3.4, 3.7, 3.8
 */

import type { Physician, TimeSlot } from '@health-checkup/shared';
import type { AlternativePhysicianSuggestion } from './scheduling.types';

/**
 * Thrown when no time slots are available within the requested date range.
 *
 * Requirement 3.8: Notify senior citizen that no appointments are available
 * and offer to place them on a waiting list.
 */
export class NoSlotsAvailableError extends Error {
  constructor() {
    super(
      'No time slots are available within the next 30 calendar days. ' +
      'You may join the waiting list to be notified when a slot becomes available.'
    );
    this.name = 'NoSlotsAvailableError';
  }
}

/**
 * Thrown when the preferred physician has no available slots.
 *
 * Requirement 3.7: Inform senior citizen and display alternative available
 * physicians for the requested time period.
 */
export class PhysicianUnavailableError extends Error {
  public readonly preferredPhysicianId: string;
  public readonly alternatives: AlternativePhysicianSuggestion[];

  constructor(preferredPhysicianId: string, alternatives: AlternativePhysicianSuggestion[]) {
    super(
      `The selected physician (${preferredPhysicianId}) has no available time slots within the next 30 calendar days. ` +
      `${alternatives.length} alternative physician(s) are available.`
    );
    this.name = 'PhysicianUnavailableError';
    this.preferredPhysicianId = preferredPhysicianId;
    this.alternatives = alternatives;
  }
}

/**
 * Thrown when the requested time slot is no longer available.
 */
export class SlotNotAvailableError extends Error {
  public readonly slotId: string;

  constructor(slotId: string) {
    super(`The requested time slot (${slotId}) is no longer available.`);
    this.name = 'SlotNotAvailableError';
    this.slotId = slotId;
  }
}

/**
 * Thrown when an appointment is not found.
 */
export class AppointmentNotFoundError extends Error {
  public readonly appointmentId: string;

  constructor(appointmentId: string) {
    super(`Appointment not found: ${appointmentId}`);
    this.name = 'AppointmentNotFoundError';
    this.appointmentId = appointmentId;
  }
}

/**
 * Thrown when an appointment cannot be cancelled (e.g., already completed or missed).
 */
export class AppointmentNotCancellableError extends Error {
  public readonly appointmentId: string;
  public readonly currentStatus: string;

  constructor(appointmentId: string, currentStatus: string) {
    super(
      `Appointment ${appointmentId} cannot be cancelled. Current status: ${currentStatus}.`
    );
    this.name = 'AppointmentNotCancellableError';
    this.appointmentId = appointmentId;
    this.currentStatus = currentStatus;
  }
}
