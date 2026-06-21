/**
 * Scheduling Validators
 * Validation logic for scheduling requests.
 * Validates: Requirements 3.1, 3.4, 3.6
 */

import type { AppointmentRequest, DateRange } from './scheduling.types';

export interface ValidationResult {
  valid: boolean;
  message?: string;
}

const MAX_DAYS_AHEAD = 30;
const MAX_SLOTS_PER_DAY = 20;
const RESCHEDULE_DAYS_WINDOW = 14;
const MIN_ALTERNATIVE_PHYSICIANS = 3;

/**
 * Validates that a date range is within the allowed 30-day window.
 *
 * Requirement 3.1: Available time slots for the next 30 calendar days.
 */
export function validateDateRange(dateRange: DateRange, currentDate: Date): ValidationResult {
  const maxDate = new Date(currentDate);
  maxDate.setDate(maxDate.getDate() + MAX_DAYS_AHEAD);

  if (dateRange.startDate < currentDate) {
    return {
      valid: false,
      message: 'Start date cannot be in the past.',
    };
  }

  if (dateRange.endDate > maxDate) {
    return {
      valid: false,
      message: `End date cannot be more than ${MAX_DAYS_AHEAD} calendar days from today.`,
    };
  }

  if (dateRange.startDate > dateRange.endDate) {
    return {
      valid: false,
      message: 'Start date must be before or equal to end date.',
    };
  }

  return { valid: true };
}

/**
 * Validates that an appointment request has all required fields.
 */
export function validateAppointmentRequest(request: AppointmentRequest): ValidationResult {
  if (!request.seniorId || request.seniorId.trim().length === 0) {
    return { valid: false, message: 'Senior ID is required.' };
  }

  if (!request.physicianId || request.physicianId.trim().length === 0) {
    return { valid: false, message: 'Physician ID is required.' };
  }

  if (!request.packageId || request.packageId.trim().length === 0) {
    return { valid: false, message: 'Package ID is required.' };
  }

  if (!request.slotId || request.slotId.trim().length === 0) {
    return { valid: false, message: 'Slot ID is required.' };
  }

  return { valid: true };
}

/**
 * Returns the maximum number of slots allowed per day.
 *
 * Requirement 3.1: Maximum of 20 time slots per day.
 */
export function getMaxSlotsPerDay(): number {
  return MAX_SLOTS_PER_DAY;
}

/**
 * Returns the reschedule window in days.
 *
 * Requirement 3.4: Offer rescheduling within 14 calendar days.
 */
export function getRescheduleWindowDays(): number {
  return RESCHEDULE_DAYS_WINDOW;
}

/**
 * Returns the minimum number of alternative physicians to suggest.
 *
 * Requirement 3.7: Display alternative available physicians.
 */
export function getMinAlternativePhysicians(): number {
  return MIN_ALTERNATIVE_PHYSICIANS;
}

/**
 * Returns the max days ahead for available slots.
 *
 * Requirement 3.1: Next 30 calendar days.
 */
export function getMaxDaysAhead(): number {
  return MAX_DAYS_AHEAD;
}
