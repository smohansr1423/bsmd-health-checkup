/**
 * Duplicate Detection Warning component types and logic
 * for the Senior Citizen Health Checkup System.
 *
 * Displays a warning when a duplicate registration is detected,
 * showing the existing Health Profile for review and allowing
 * the user to proceed or cancel.
 *
 * Requirements: 1.5
 */

import type { SupportedLanguage, Gender } from '@health-checkup/shared';

// ─── Types ───────────────────────────────────────────────────────────────────

/** Summary of an existing profile shown in the duplicate warning */
export interface ExistingProfileSummary {
  /** System-generated profile ID */
  id: string;
  /** Full name of the existing profile */
  fullName: string;
  /** Date of birth (ISO string) */
  dateOfBirth: string;
  /** Gender */
  gender: Gender;
  /** Phone number */
  phoneNumber: string;
  /** Preferred language */
  preferredLanguage: SupportedLanguage;
  /** Registration date (ISO string) */
  registeredAt: string;
}

/** Props for the DuplicateWarning component */
export interface DuplicateWarningProps {
  /** The existing profile that matches the new registration attempt */
  existingProfile: ExistingProfileSummary;
  /** The name entered by the user that triggered the duplicate detection */
  attemptedName: string;
  /** The date of birth entered that triggered the duplicate detection */
  attemptedDateOfBirth: string;
  /** Callback to proceed with registration despite duplicate (Req 1.5 — allow after review) */
  onProceed: () => void;
  /** Callback to cancel and view existing profile */
  onViewExisting: (profileId: string) => void;
  /** Callback to dismiss the warning and go back to form */
  onDismiss: () => void;
  /** Whether the proceed action is loading */
  isProceeding?: boolean;
  /** Current UI language */
  language?: SupportedLanguage;
}

/** State for the duplicate warning display */
export interface DuplicateWarningState {
  /** Whether the warning is currently visible */
  isVisible: boolean;
  /** The detected existing profile, if any */
  existingProfile: ExistingProfileSummary | null;
  /** Whether the user has acknowledged the warning */
  acknowledged: boolean;
}

// ─── Constants ───────────────────────────────────────────────────────────────

/** ARIA role for the warning banner */
export const DUPLICATE_WARNING_ROLE = 'alertdialog' as const;

/** ARIA live region politeness for the warning announcement */
export const DUPLICATE_WARNING_ARIA_LIVE = 'assertive' as const;

/** Default warning messages */
export const DUPLICATE_WARNING_MESSAGES = {
  title: 'Duplicate Registration Detected',
  description:
    'A profile with the same name and date of birth already exists in the system. Please review the existing profile before proceeding.',
  proceedButton: 'Register Anyway',
  viewExistingButton: 'View Existing Profile',
  dismissButton: 'Go Back',
  matchFields: 'Matching fields: Full Name, Date of Birth',
} as const;

// ─── Helper Functions ────────────────────────────────────────────────────────

/**
 * Generate ARIA attributes for the duplicate warning dialog.
 * Ensures screen reader announces the warning (Req 13.5 — ARIA compatibility).
 */
export function getDuplicateWarningAriaProps(props: DuplicateWarningProps): Record<string, string> {
  return {
    role: DUPLICATE_WARNING_ROLE,
    'aria-modal': 'true',
    'aria-labelledby': 'duplicate-warning-title',
    'aria-describedby': 'duplicate-warning-description',
    'aria-live': DUPLICATE_WARNING_ARIA_LIVE,
  };
}

/**
 * Format the existing profile for display in the warning.
 */
export function formatExistingProfileDisplay(profile: ExistingProfileSummary): {
  displayName: string;
  displayDob: string;
  displayGender: string;
  displayPhone: string;
  displayRegisteredAt: string;
} {
  return {
    displayName: profile.fullName,
    displayDob: profile.dateOfBirth,
    displayGender: profile.gender,
    displayPhone: profile.phoneNumber,
    displayRegisteredAt: profile.registeredAt,
  };
}

/**
 * Create initial state for the duplicate warning.
 */
export function createDuplicateWarningState(): DuplicateWarningState {
  return {
    isVisible: false,
    existingProfile: null,
    acknowledged: false,
  };
}

/**
 * Determine if the duplicate warning should be shown based on a duplicate check result.
 */
export function shouldShowDuplicateWarning(
  isDuplicate: boolean,
  existingProfile: ExistingProfileSummary | null,
): boolean {
  return isDuplicate && existingProfile !== null;
}
