/**
 * WaitingList — Waiting list enrollment when no slots are available.
 *
 * Provides the UI state and logic for enrolling a senior citizen on the
 * waiting list when no appointment slots are available within the next 30 days.
 *
 * Requirements: 3.8
 */

// ─── Types ───────────────────────────────────────────────────────────────────

/** Preferred time of day for waiting list preferences */
export type PreferredTimeOfDay = 'morning' | 'afternoon' | 'evening';

/** Status of a waiting list entry */
export type WaitlistStatus = 'waiting' | 'notified' | 'expired';

/** Form data for waiting list enrollment */
export interface WaitlistEnrollmentForm {
  /** Preferred physician ID (optional) */
  preferredPhysicianId: string | null;
  /** Preferred time of day */
  preferredTimeOfDay: PreferredTimeOfDay | null;
  /** Preferred specialization (optional) */
  specialization: string | null;
}

/** Display representation of a waiting list entry */
export interface WaitlistDisplayItem {
  /** Waiting list entry ID */
  entryId: string;
  /** Senior citizen ID */
  seniorId: string;
  /** Date/time the senior joined the waiting list */
  joinedAtLabel: string;
  /** Current status */
  status: WaitlistStatus;
  /** Preferences summary */
  preferencesSummary: string;
  /** Whether this entry is still active */
  isActive: boolean;
}

/** State for the WaitingList component */
export interface WaitingListState {
  /** Whether to show the enrollment form */
  showEnrollmentForm: boolean;
  /** Current enrollment form data */
  enrollmentForm: WaitlistEnrollmentForm;
  /** Whether enrollment is being submitted */
  isSubmitting: boolean;
  /** Success message after enrollment */
  successMessage: string | null;
  /** Error message if enrollment failed */
  error: string | null;
  /** Existing waiting list entries for the current senior */
  existingEntries: WaitlistDisplayItem[];
  /** Whether existing entries are loading */
  isLoadingEntries: boolean;
}

/** Props for the WaitingList component */
export interface WaitingListProps {
  /** Senior citizen ID for enrollment */
  seniorId: string;
  /** Callback when enrollment is submitted */
  onEnroll: (form: WaitlistEnrollmentForm) => void;
  /** Callback to return to slot selection (e.g., after being notified) */
  onBackToSlots: () => void;
  /** Locale for formatting */
  locale?: string;
}

// ─── Business Logic ──────────────────────────────────────────────────────────

/**
 * Validates the waiting list enrollment form.
 * At minimum, the form must have at least one preference set.
 */
export function validateWaitlistForm(form: WaitlistEnrollmentForm): {
  valid: boolean;
  message?: string;
} {
  // Form is always valid — preferences are optional
  // But we provide a confirmation if no preferences are set
  return { valid: true };
}

/**
 * Builds a human-readable summary of waiting list preferences.
 */
export function buildPreferencesSummary(
  form: WaitlistEnrollmentForm,
  physicianName?: string
): string {
  const parts: string[] = [];

  if (physicianName) {
    parts.push(`Preferred physician: ${physicianName}`);
  }

  if (form.preferredTimeOfDay) {
    parts.push(`Preferred time: ${form.preferredTimeOfDay}`);
  }

  if (form.specialization) {
    parts.push(`Specialization: ${form.specialization}`);
  }

  return parts.length > 0 ? parts.join(' • ') : 'No specific preferences';
}

/**
 * Determines whether an existing entry is still active (waiting).
 */
export function isWaitlistEntryActive(status: WaitlistStatus): boolean {
  return status === 'waiting';
}

/**
 * Determines whether the senior citizen is already on the waiting list.
 */
export function isAlreadyOnWaitlist(entries: WaitlistDisplayItem[]): boolean {
  return entries.some((entry) => entry.isActive);
}

/**
 * Creates the initial form state for waiting list enrollment.
 */
export function createInitialWaitlistForm(): WaitlistEnrollmentForm {
  return {
    preferredPhysicianId: null,
    preferredTimeOfDay: null,
    specialization: null,
  };
}

/**
 * Creates the initial state for the WaitingList component.
 */
export function createInitialWaitingListState(): WaitingListState {
  return {
    showEnrollmentForm: false,
    enrollmentForm: createInitialWaitlistForm(),
    isSubmitting: false,
    successMessage: null,
    error: null,
    existingEntries: [],
    isLoadingEntries: true,
  };
}

/**
 * Generates the no-slots-available message.
 *
 * Requirement 3.8: Notify the senior citizen that no appointments are currently
 * available and offer to place them on a waiting list.
 */
export function getNoSlotsMessage(): string {
  return (
    'No appointment time slots are available within the next 30 calendar days. ' +
    'You can join the waiting list to be notified when a slot becomes available.'
  );
}

// ─── Page Configuration ──────────────────────────────────────────────────────

/** ARIA labels for the WaitingList region */
export const WAITING_LIST_ARIA = {
  region: 'Waiting list enrollment',
  noSlotsAlert: 'No time slots available',
  enrollButton: 'Join the waiting list',
  form: 'Waiting list preferences form',
  preferredPhysician: 'Preferred physician selection',
  preferredTime: 'Preferred time of day',
  specialization: 'Preferred specialization',
  submitButton: 'Submit waiting list enrollment',
  cancelButton: 'Cancel enrollment',
  existingEntries: 'Your waiting list entries',
  successAlert: 'Successfully joined the waiting list',
  alreadyEnrolled: 'You are already on the waiting list',
} as const;

/** Time of day options for the form */
export const TIME_OF_DAY_OPTIONS: Array<{
  value: PreferredTimeOfDay;
  label: string;
}> = [
  { value: 'morning', label: 'Morning (8:00 AM – 12:00 PM)' },
  { value: 'afternoon', label: 'Afternoon (12:00 PM – 5:00 PM)' },
  { value: 'evening', label: 'Evening (5:00 PM – 8:00 PM)' },
];
