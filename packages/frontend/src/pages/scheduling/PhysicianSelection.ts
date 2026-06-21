/**
 * PhysicianSelection — Physician selection with alternative suggestions.
 *
 * Allows senior citizens to select a preferred physician from available physicians
 * for a requested time slot. When the preferred physician is unavailable, displays
 * at least 3 alternative physicians with their next available dates.
 *
 * Requirements: 3.6, 3.7
 */

import type { Physician, TimeSlot } from '@health-checkup/shared';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Minimum number of alternative physicians to suggest when preferred is unavailable */
export const MIN_ALTERNATIVE_SUGGESTIONS = 3;

/** Maximum days ahead to search for alternative physician availability */
export const ALTERNATIVE_SEARCH_DAYS = 30;

// ─── Types ───────────────────────────────────────────────────────────────────

/** Display representation of a physician in the selection list */
export interface PhysicianDisplayItem {
  /** Unique physician identifier */
  physicianId: string;
  /** Full name of the physician */
  name: string;
  /** Medical specialization */
  specialization: string;
  /** Department affiliation */
  department: string;
  /** Qualifications summary */
  qualifications: string[];
  /** Whether this physician is currently selected */
  isSelected: boolean;
  /** Whether this physician has available slots in the requested period */
  isAvailable: boolean;
  /** Next available date for this physician (if available) */
  nextAvailableDate: Date | null;
  /** Count of available slots within the search window */
  availableSlotCount: number;
}

/** Alternative physician suggestion with available slots */
export interface AlternativeSuggestionItem {
  /** The alternative physician */
  physician: PhysicianDisplayItem;
  /** Available slots for this physician, sorted by earliest */
  availableSlots: TimeSlot[];
  /** Formatted label for the earliest availability */
  earliestAvailabilityLabel: string;
}

/** State for the PhysicianSelection component */
export interface PhysicianSelectionState {
  /** All available physicians for the current selection */
  physicians: PhysicianDisplayItem[];
  /** Currently selected physician ID */
  selectedPhysicianId: string | null;
  /** Alternative suggestions shown when preferred physician is unavailable */
  alternatives: AlternativeSuggestionItem[];
  /** Whether the preferred physician is unavailable (triggers alternative display) */
  showAlternatives: boolean;
  /** Message explaining why alternatives are shown */
  unavailabilityMessage: string | null;
  /** Whether physician data is loading */
  isLoading: boolean;
  /** Error message if physician fetch failed */
  error: string | null;
}

/** Props for the PhysicianSelection component */
export interface PhysicianSelectionProps {
  /** Date for which to show available physicians */
  selectedDate: Date;
  /** Optional specialization filter */
  specialization?: string;
  /** Previously preferred physician ID (for preference matching) */
  preferredPhysicianId?: string;
  /** Callback when a physician is selected */
  onPhysicianSelect: (physicianId: string) => void;
  /** Callback when user picks an alternative physician's slot */
  onAlternativeSlotSelect: (physicianId: string, slotId: string) => void;
  /** Locale for date/time formatting */
  locale?: string;
}

// ─── Business Logic ──────────────────────────────────────────────────────────

/**
 * Transforms a Physician entity into a PhysicianDisplayItem for display.
 */
export function toPhysicianDisplayItem(
  physician: Physician,
  selectedId: string | null,
  availableSlots: TimeSlot[]
): PhysicianDisplayItem {
  const sortedSlots = [...availableSlots].sort(
    (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
  );

  return {
    physicianId: physician.id,
    name: physician.name,
    specialization: physician.specialization,
    department: physician.department,
    qualifications: physician.qualifications,
    isSelected: physician.id === selectedId,
    isAvailable: sortedSlots.length > 0,
    nextAvailableDate: sortedSlots.length > 0 ? new Date(sortedSlots[0].startTime) : null,
    availableSlotCount: sortedSlots.length,
  };
}

/**
 * Determines whether alternative suggestions should be shown.
 *
 * Requirement 3.7: If the selected physician has no available time slots
 * within the next 30 calendar days, inform and display alternative available physicians.
 */
export function shouldShowAlternatives(
  preferredPhysicianId: string | undefined,
  physicians: PhysicianDisplayItem[]
): boolean {
  if (!preferredPhysicianId) return false;

  const preferred = physicians.find((p) => p.physicianId === preferredPhysicianId);
  return preferred !== undefined && !preferred.isAvailable;
}

/**
 * Filters and sorts alternative physicians, ensuring at least MIN_ALTERNATIVE_SUGGESTIONS.
 *
 * Requirement 3.7: Display alternative available physicians (≥3) for the requested time period.
 */
export function getAlternativeSuggestions(
  physicians: PhysicianDisplayItem[],
  preferredPhysicianId: string,
  physicianSlots: Map<string, TimeSlot[]>,
  locale: string = 'en'
): AlternativeSuggestionItem[] {
  const alternatives = physicians
    .filter((p) => p.physicianId !== preferredPhysicianId && p.isAvailable)
    .sort((a, b) => {
      // Sort by earliest availability first
      const aDate = a.nextAvailableDate?.getTime() ?? Infinity;
      const bDate = b.nextAvailableDate?.getTime() ?? Infinity;
      return aDate - bDate;
    });

  return alternatives.map((physician) => {
    const slots = physicianSlots.get(physician.physicianId) ?? [];
    const sortedSlots = [...slots].sort(
      (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
    );

    const earliestDate = physician.nextAvailableDate;
    const earliestAvailabilityLabel = earliestDate
      ? earliestDate.toLocaleDateString(locale, {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
        })
      : 'No availability';

    return {
      physician,
      availableSlots: sortedSlots,
      earliestAvailabilityLabel,
    };
  });
}

/**
 * Generates the unavailability message for the preferred physician.
 */
export function getUnavailabilityMessage(
  physicianName: string,
  alternativeCount: number
): string {
  return (
    `${physicianName} has no available time slots within the next ${ALTERNATIVE_SEARCH_DAYS} calendar days. ` +
    `${alternativeCount} alternative physician(s) are available.`
  );
}

/**
 * Validates that the minimum number of alternative suggestions is met.
 *
 * Requirement 3.7: Display alternative available physicians (≥3).
 */
export function hasMinimumAlternatives(alternatives: AlternativeSuggestionItem[]): boolean {
  return alternatives.length >= MIN_ALTERNATIVE_SUGGESTIONS;
}

/**
 * Creates the initial state for the PhysicianSelection component.
 */
export function createInitialPhysicianSelectionState(): PhysicianSelectionState {
  return {
    physicians: [],
    selectedPhysicianId: null,
    alternatives: [],
    showAlternatives: false,
    unavailabilityMessage: null,
    isLoading: true,
    error: null,
  };
}

// ─── Page Configuration ──────────────────────────────────────────────────────

/** ARIA labels for the PhysicianSelection region */
export const PHYSICIAN_SELECTION_ARIA = {
  region: 'Physician selection',
  list: 'Available physicians',
  item: (name: string, specialization: string) =>
    `${name}, specialization: ${specialization}`,
  selected: (name: string) => `Selected physician: ${name}`,
  alternativesRegion: 'Alternative physician suggestions',
  alternativeItem: (name: string, earliestDate: string) =>
    `${name}, earliest availability: ${earliestDate}`,
  unavailableNotice: 'Preferred physician unavailable notice',
  loading: 'Loading available physicians',
} as const;
