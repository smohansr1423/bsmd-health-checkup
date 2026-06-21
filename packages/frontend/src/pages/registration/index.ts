/**
 * Registration and Profile Management page barrel export.
 *
 * Requirements: 1.1, 1.2, 1.5, 1.6, 1.7
 */

// ─── Registration Form ───────────────────────────────────────────────────────
export {
  // Types
  type RegistrationFormState,
  type RegistrationFormProps,
  type ValidationErrors,
  type RegistrationFormSection,
  type EmergencyContactFormEntry,
  type MedicalHistoryFormEntry,
  type MedicationFormEntry,
  type AllergyFormEntry,
  type FormSectionConfig,
  // Constants
  MINIMUM_AGE,
  REQUIRED_FIELDS,
  DEFAULT_FORM_STATE,
  GENDER_OPTIONS,
  LANGUAGE_OPTIONS,
  TEXT_SIZE_OPTIONS,
  CONTRAST_MODE_OPTIONS,
  REGISTRATION_FORM_FIELDS,
  FORM_SECTIONS,
  // Validation functions
  calculateAge,
  validateAge,
  validatePhoneNumber,
  validateEmergencyContacts,
  validateRegistrationForm,
  isFormValid,
  getMissingRequiredFields,
} from './RegistrationForm';

// ─── Duplicate Warning ───────────────────────────────────────────────────────
export {
  // Types
  type ExistingProfileSummary,
  type DuplicateWarningProps,
  type DuplicateWarningState,
  // Constants
  DUPLICATE_WARNING_ROLE,
  DUPLICATE_WARNING_ARIA_LIVE,
  DUPLICATE_WARNING_MESSAGES,
  // Functions
  getDuplicateWarningAriaProps,
  formatExistingProfileDisplay,
  createDuplicateWarningState,
  shouldShowDuplicateWarning,
} from './DuplicateWarning';

// ─── Profile View ────────────────────────────────────────────────────────────
export {
  // Types
  type ProfileViewMode,
  type AuditTrailEntry,
  type ProfileData,
  type ProfileViewProps,
  type ProfileViewState,
  type ProfileSection,
  type ProfileSectionConfig,
  // Constants
  PROFILE_SECTIONS,
  AUDIT_TRAIL_CONFIG,
  // Functions
  createProfileViewState,
  getModifiedFields,
  buildChangeDescription,
  formatFieldName,
  getProfileViewAriaProps,
  getAuditTrailAriaProps,
  validateProfileEdits,
} from './ProfileView';
