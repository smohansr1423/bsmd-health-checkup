/**
 * Profile View and Edit component types and logic
 * for the Senior Citizen Health Checkup System.
 *
 * Provides profile display, editing capabilities, and
 * audit trail awareness for tracking profile modifications.
 *
 * Requirements: 1.1, 1.3, 1.6
 */

import type { AccessibilityPreferences } from '@health-checkup/shared';
import type { Gender, SupportedLanguage } from '@health-checkup/shared';
import type {
  EmergencyContactFormEntry,
  MedicalHistoryFormEntry,
  MedicationFormEntry,
  AllergyFormEntry,
  ValidationErrors,
} from './RegistrationForm';

// ─── Types ───────────────────────────────────────────────────────────────────

/** View mode for the profile component */
export type ProfileViewMode = 'view' | 'edit';

/** An audit trail entry showing who changed the profile and when (Req 1.3) */
export interface AuditTrailEntry {
  /** Unique ID of the audit entry */
  id: string;
  /** ID of the user who made the change */
  userId: string;
  /** Display name of the user who made the change */
  userName: string;
  /** Action performed (e.g., 'profile_updated', 'profile_created') */
  action: string;
  /** Timestamp of the modification (ISO string) */
  timestamp: string;
  /** Human-readable description of what was changed */
  description?: string;
  /** Detailed changes (field name → old/new values) */
  changes?: Record<string, { oldValue: string; newValue: string }>;
}

/** Profile data displayed in the view/edit component */
export interface ProfileData {
  /** System-generated immutable ID (Req 1.4) */
  id: string;
  /** Personal details */
  fullName: string;
  dateOfBirth: string;
  gender: Gender;
  phoneNumber: string;
  /** Address */
  street: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  /** Emergency contacts */
  emergencyContacts: EmergencyContactFormEntry[];
  /** Medical info */
  medicalHistory: MedicalHistoryFormEntry[];
  currentMedications: MedicationFormEntry[];
  allergies: AllergyFormEntry[];
  /** Preferences (Req 1.6) */
  preferredLanguage: SupportedLanguage;
  accessibilityPreferences: AccessibilityPreferences;
  /** Metadata */
  createdAt: string;
  updatedAt: string;
}

/** Props for the ProfileView component */
export interface ProfileViewProps {
  /** The profile data to display */
  profile: ProfileData;
  /** Current view/edit mode */
  mode: ProfileViewMode;
  /** Audit trail entries for this profile (Req 1.3) */
  auditTrail: AuditTrailEntry[];
  /** Whether audit trail section is expanded */
  auditTrailExpanded?: boolean;
  /** Callback when mode changes between view and edit */
  onModeChange: (mode: ProfileViewMode) => void;
  /** Callback when profile is saved after editing */
  onSave: (updatedProfile: Partial<ProfileData>, userId: string) => void;
  /** Callback to load more audit trail entries */
  onLoadMoreAudit?: () => void;
  /** Whether a save operation is in progress */
  isSaving?: boolean;
  /** Server-side validation errors */
  serverErrors?: ValidationErrors;
  /** The ID of the currently logged-in user (for audit) */
  currentUserId: string;
  /** Whether the current user has edit permissions */
  canEdit?: boolean;
  /** Current UI language */
  language?: SupportedLanguage;
  /** Whether there are more audit entries to load */
  hasMoreAuditEntries?: boolean;
}

/** State for the profile view/edit component */
export interface ProfileViewState {
  /** Current view mode */
  mode: ProfileViewMode;
  /** Edited fields (only populated in edit mode) */
  editedFields: Partial<ProfileData>;
  /** Validation errors from local validation */
  validationErrors: ValidationErrors;
  /** Whether unsaved changes exist */
  isDirty: boolean;
  /** Whether audit trail section is expanded */
  auditTrailExpanded: boolean;
}

// ─── Constants ───────────────────────────────────────────────────────────────

/** Profile sections for organized display */
export type ProfileSection =
  | 'personalInfo'
  | 'address'
  | 'emergencyContacts'
  | 'medicalHistory'
  | 'medications'
  | 'allergies'
  | 'preferences'
  | 'auditTrail';

/** Configuration for profile display sections */
export interface ProfileSectionConfig {
  id: ProfileSection;
  title: string;
  ariaLabel: string;
  editable: boolean;
}

/** Ordered profile sections for display */
export const PROFILE_SECTIONS: ProfileSectionConfig[] = [
  {
    id: 'personalInfo',
    title: 'Personal Information',
    ariaLabel: 'Personal information section',
    editable: true,
  },
  {
    id: 'address',
    title: 'Address',
    ariaLabel: 'Address section',
    editable: true,
  },
  {
    id: 'emergencyContacts',
    title: 'Emergency Contacts',
    ariaLabel: 'Emergency contacts section',
    editable: true,
  },
  {
    id: 'medicalHistory',
    title: 'Medical History',
    ariaLabel: 'Medical history section',
    editable: true,
  },
  {
    id: 'medications',
    title: 'Current Medications',
    ariaLabel: 'Current medications section',
    editable: true,
  },
  {
    id: 'allergies',
    title: 'Allergies',
    ariaLabel: 'Allergies section',
    editable: true,
  },
  {
    id: 'preferences',
    title: 'Language & Accessibility Preferences',
    ariaLabel: 'Language and accessibility preferences section',
    editable: true,
  },
  {
    id: 'auditTrail',
    title: 'Modification History',
    ariaLabel: 'Profile modification history and audit trail',
    editable: false,
  },
];

/** Audit trail display configuration */
export const AUDIT_TRAIL_CONFIG = {
  /** Maximum entries shown initially before "load more" */
  initialDisplayCount: 10,
  /** Entries loaded per "load more" action */
  loadMoreCount: 10,
  /** Date/time format for audit timestamps */
  timestampFormat: 'full' as const,
  /** ARIA label for the audit trail list */
  ariaLabel: 'Profile modification history',
  /** ARIA description for audit entries */
  entryAriaLabel: (entry: AuditTrailEntry) =>
    `${entry.action} by ${entry.userName} on ${entry.timestamp}`,
} as const;

// ─── Helper Functions ────────────────────────────────────────────────────────

/**
 * Create initial state for the profile view component.
 */
export function createProfileViewState(mode: ProfileViewMode = 'view'): ProfileViewState {
  return {
    mode,
    editedFields: {},
    validationErrors: {},
    isDirty: false,
    auditTrailExpanded: false,
  };
}

/**
 * Determine which fields have been modified from the original profile.
 */
export function getModifiedFields(
  original: ProfileData,
  edited: Partial<ProfileData>,
): string[] {
  const modified: string[] = [];

  for (const [key, value] of Object.entries(edited)) {
    const originalValue = original[key as keyof ProfileData];
    if (JSON.stringify(originalValue) !== JSON.stringify(value)) {
      modified.push(key);
    }
  }

  return modified;
}

/**
 * Build a human-readable description of changes for the audit trail.
 */
export function buildChangeDescription(modifiedFields: string[]): string {
  if (modifiedFields.length === 0) return 'No changes';
  if (modifiedFields.length === 1) return `Updated ${formatFieldName(modifiedFields[0])}`;
  return `Updated ${modifiedFields.length} fields: ${modifiedFields.map(formatFieldName).join(', ')}`;
}

/**
 * Format a field key to a human-readable label.
 */
export function formatFieldName(fieldKey: string): string {
  const fieldLabels: Record<string, string> = {
    fullName: 'Full Name',
    dateOfBirth: 'Date of Birth',
    gender: 'Gender',
    phoneNumber: 'Phone Number',
    street: 'Street Address',
    city: 'City',
    state: 'State',
    postalCode: 'Postal Code',
    country: 'Country',
    emergencyContacts: 'Emergency Contacts',
    medicalHistory: 'Medical History',
    currentMedications: 'Medications',
    allergies: 'Allergies',
    preferredLanguage: 'Preferred Language',
    accessibilityPreferences: 'Accessibility Preferences',
  };

  return fieldLabels[fieldKey] ?? fieldKey;
}

/**
 * Generate ARIA attributes for the profile view container.
 */
export function getProfileViewAriaProps(props: ProfileViewProps): Record<string, string> {
  return {
    role: 'region',
    'aria-label': `Health profile for ${props.profile.fullName}`,
    'aria-live': 'polite',
  };
}

/**
 * Generate ARIA attributes for the audit trail section.
 */
export function getAuditTrailAriaProps(): Record<string, string> {
  return {
    role: 'log',
    'aria-label': AUDIT_TRAIL_CONFIG.ariaLabel,
    'aria-live': 'polite',
    'aria-relevant': 'additions',
  };
}

/**
 * Validate profile edits before saving (subset of registration validation).
 */
export function validateProfileEdits(edited: Partial<ProfileData>): ValidationErrors {
  const errors: ValidationErrors = {};

  if (edited.fullName !== undefined && !edited.fullName.trim()) {
    errors.fullName = 'Full name cannot be empty';
  }

  if (edited.phoneNumber !== undefined && !edited.phoneNumber.trim()) {
    errors.phoneNumber = 'Phone number cannot be empty';
  }

  if (edited.emergencyContacts !== undefined) {
    if (edited.emergencyContacts.length === 0) {
      errors.emergencyContacts = 'At least one emergency contact is required';
    } else {
      const hasComplete = edited.emergencyContacts.some(
        (c) => c.name.trim() && c.relationship.trim() && c.phoneNumber.trim(),
      );
      if (!hasComplete) {
        errors.emergencyContacts = 'Emergency contact must include name, relationship, and phone number';
      }
    }
  }

  return errors;
}
