/**
 * SlotPicker — Available slot display for appointment scheduling.
 *
 * Displays available time slots for the next 30 calendar days,
 * limited to a maximum of 20 slots per day, sorted by earliest availability.
 *
 * Requirements: 3.1
 */

import type { TimeSlot } from '@health-checkup/shared';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Maximum calendar days ahead to display available slots */
export const SLOT_DISPLAY_DAYS = 30;

/** Maximum number of time slots to display per day */
export const MAX_SLOTS_PER_DAY = 20;

// ─── Types ───────────────────────────────────────────────────────────────────

/** Visual representation of a time slot in the UI */
export interface SlotDisplayItem {
  /** Unique slot identifier */
  slotId: string;
  /** Formatted date string (locale-aware) */
  dateLabel: string;
  /** Formatted start time string (locale-aware) */
  startTimeLabel: string;
  /** Formatted end time string (locale-aware) */
  endTimeLabel: string;
  /** Physician assigned to this slot */
  physicianId: string;
  /** Physician name for display */
  physicianName: string;
  /** Whether the slot is currently selected */
  isSelected: boolean;
  /** Whether the slot is available for booking */
  isAvailable: boolean;
}

/** Grouped slots for day-by-day display */
export interface DaySlotGroup {
  /** ISO date string (YYYY-MM-DD) */
  date: string;
  /** Human-readable day label (e.g., "Monday, Jan 15") */
  dayLabel: string;
  /** Slots for this day, sorted by start time, max 20 */
  slots: SlotDisplayItem[];
  /** Total available slots for this day (may be > displayed if capped) */
  totalAvailable: number;
}

/** State for the SlotPicker component */
export interface SlotPickerState {
  /** All day groups within the 30-day window */
  dayGroups: DaySlotGroup[];
  /** Currently selected slot ID, if any */
  selectedSlotId: string | null;
  /** Whether slot data is loading */
  isLoading: boolean;
  /** Error message if slot fetch failed */
  error: string | null;
  /** The date range being displayed (start) */
  displayStartDate: Date;
  /** The date range being displayed (end) */
  displayEndDate: Date;
}

/** Props for the SlotPicker component */
export interface SlotPickerProps {
  /** Optional physician ID to filter slots */
  physicianId?: string;
  /** Callback when a slot is selected */
  onSlotSelect: (slotId: string) => void;
  /** Callback when no slots are available (triggers waiting list flow) */
  onNoSlotsAvailable: () => void;
  /** Locale for date/time formatting */
  locale?: string;
}

// ─── Business Logic ──────────────────────────────────────────────────────────

/**
 * Computes the 30-day date range from the current date.
 *
 * Requirement 3.1: Display available time slots for the next 30 calendar days.
 */
export function computeSlotDateRange(currentDate: Date): { startDate: Date; endDate: Date } {
  const startDate = new Date(currentDate);
  startDate.setHours(0, 0, 0, 0);

  const endDate = new Date(currentDate);
  endDate.setDate(endDate.getDate() + SLOT_DISPLAY_DAYS);
  endDate.setHours(23, 59, 59, 999);

  return { startDate, endDate };
}

/**
 * Groups time slots by day, caps each day at MAX_SLOTS_PER_DAY,
 * and sorts slots within each group by earliest start time.
 *
 * Requirement 3.1: Maximum of 20 time slots per day sorted by earliest availability.
 */
export function groupSlotsByDay(slots: TimeSlot[]): Map<string, TimeSlot[]> {
  // Sort all slots by start time first
  const sorted = [...slots].sort(
    (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
  );

  const groups = new Map<string, TimeSlot[]>();

  for (const slot of sorted) {
    const dayKey = new Date(slot.startTime).toISOString().split('T')[0];
    const daySlots = groups.get(dayKey) ?? [];

    if (daySlots.length < MAX_SLOTS_PER_DAY) {
      daySlots.push(slot);
      groups.set(dayKey, daySlots);
    }
  }

  return groups;
}

/**
 * Transforms raw TimeSlot data into display-ready SlotDisplayItem format.
 */
export function toSlotDisplayItem(
  slot: TimeSlot,
  physicianName: string,
  selectedSlotId: string | null,
  locale: string = 'en'
): SlotDisplayItem {
  const startDate = new Date(slot.startTime);
  const endDate = new Date(slot.endTime);

  return {
    slotId: slot.id,
    dateLabel: startDate.toLocaleDateString(locale, {
      weekday: 'long',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    }),
    startTimeLabel: startDate.toLocaleTimeString(locale, {
      hour: '2-digit',
      minute: '2-digit',
    }),
    endTimeLabel: endDate.toLocaleTimeString(locale, {
      hour: '2-digit',
      minute: '2-digit',
    }),
    physicianId: slot.physicianId,
    physicianName,
    isSelected: slot.id === selectedSlotId,
    isAvailable: slot.isAvailable,
  };
}

/**
 * Determines whether the "no slots available" state should be shown.
 * This triggers the waiting list enrollment flow.
 *
 * Requirement 3.8: Offer waiting list when no appointments available.
 */
export function shouldShowNoSlotsMessage(dayGroups: DaySlotGroup[]): boolean {
  return dayGroups.every((group) => group.slots.length === 0);
}

/**
 * Creates the initial state for the SlotPicker component.
 */
export function createInitialSlotPickerState(currentDate: Date): SlotPickerState {
  const { startDate, endDate } = computeSlotDateRange(currentDate);

  return {
    dayGroups: [],
    selectedSlotId: null,
    isLoading: true,
    error: null,
    displayStartDate: startDate,
    displayEndDate: endDate,
  };
}

// ─── Page Configuration ──────────────────────────────────────────────────────

/** ARIA labels for the SlotPicker region */
export const SLOT_PICKER_ARIA = {
  region: 'Available appointment time slots',
  dayGroup: (dayLabel: string) => `Time slots for ${dayLabel}`,
  slot: (time: string, physician: string) => `Appointment at ${time} with ${physician}`,
  selected: 'Selected time slot',
  noSlots: 'No time slots available within the next 30 days',
  loading: 'Loading available time slots',
} as const;
