/**
 * Registration Form configuration, types, and validation logic
 * for the Senior Citizen Health Checkup System.
 *
 * Provides form field definitions, validation rules, and business logic
 * for senior citizen registration including language and accessibility
 * preference selection.
 *
 * Requirements: 1.1, 1.2, 1.6, 1.7
 */

import type { FormFieldProps } from '../../components/base/FormField';
import type { AccessibilityPreferences } from '@health-checkup/shared';
import { Gender, SupportedLanguage } from '@health-checkup/shared';

// ─── Types ───────────────────────────────────────────────────────────────────

/** State shape for the registration form */
export interface RegistrationFormState {
  /** Personal details */
  fullName: string;
  dateOfBirth: string; // ISO date string for form input
  gender: Gender | '';
  phoneNumber: string;
  /** Address */
  street: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  /** Emergency contact (at least one required) */
  emergencyContacts: EmergencyContactFormEntry[];
  /** Medical info */
  medicalHistory: MedicalHistoryFormEntry[];
  currentMedications: MedicationFormEntry[];
  allergies: AllergyFormEntry[];
  /** Language and accessibility preferences (Req 1.6) */
  preferredLanguage: SupportedLanguage;
  accessibilityPreferences: AccessibilityPreferences;
}

export interface EmergencyContactFormEntry {
  name: string;
  relationship: string;
  phoneNumber: string;
}

export interface MedicalHistoryFormEntry {
  condition: string;
  diagnosedDate: string;
  status: 'active' | 'resolved';
  notes: string;
}

export interface MedicationFormEntry {
  name: string;
  dosage: string;
  frequency: string;
  startDate: string;
  endDate: string;
}

export interface AllergyFormEntry {
  substance: string;
  severity: 'mild' | 'moderate' | 'severe';
  notes: string;
}

/** Props for the RegistrationForm component */
export interface RegistrationFormProps {
  /** Initial form values (for pre-filling) */
  initialValues?: Partial<RegistrationFormState>;
  /** Callback on successful form submission */
  onSubmit: (data: RegistrationFormState) => void;
  /** Callback when duplicate is detected — receives existing profile ID */
  onDuplicateDetected?: (existingProfileId: string) => void;
  /** Whether the form is currently submitting */
  isSubmitting?: boolean;
  /** Server-side validation errors keyed by field name */
  serverErrors?: Record<string, string>;
  /** Current UI language for labels/messages */
  language?: SupportedLanguage;
}

/** Validation error map — field name to error message */
export type ValidationErrors = Partial<Record<keyof RegistrationFormState | string, string>>;

/** Form section identifiers for step/section navigation */
export type RegistrationFormSection =
  | 'personalDetails'
  | 'address'
  | 'emergencyContacts'
  | 'medicalHistory'
  | 'preferences';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Minimum age requirement for registration (Req 1.2) */
export const MINIMUM_AGE = 60;

/** Required fields that must be present for submission (Req 1.7) */
export const REQUIRED_FIELDS: (keyof RegistrationFormState)[] = [
  'fullName',
  'dateOfBirth',
  'gender',
  'phoneNumber',
  'emergencyContacts',
];

/** Default initial state for the registration form */
export const DEFAULT_FORM_STATE: RegistrationFormState = {
  fullName: '',
  dateOfBirth: '',
  gender: '',
  phoneNumber: '',
  street: '',
  city: '',
  state: '',
  postalCode: '',
  country: '',
  emergencyContacts: [{ name: '', relationship: '', phoneNumber: '' }],
  medicalHistory: [],
  currentMedications: [],
  allergies: [],
  preferredLanguage: SupportedLanguage.English,
  accessibilityPreferences: {
    textSize: 'normal',
    contrastMode: 'default',
    voiceAssistance: false,
    largeButtonMode: false,
    simplifiedNavigation: false,
  },
};

/** Gender options for the select field */
export const GENDER_OPTIONS: Array<{ value: Gender; label: string }> = [
  { value: Gender.Male, label: 'Male' },
  { value: Gender.Female, label: 'Female' },
  { value: Gender.Other, label: 'Other' },
];

/** Language options for the preference select (Req 1.6) */
export const LANGUAGE_OPTIONS: Array<{ value: SupportedLanguage; label: string }> = [
  { value: SupportedLanguage.English, label: 'English' },
  { value: SupportedLanguage.Hindi, label: 'हिन्दी (Hindi)' },
  { value: SupportedLanguage.Spanish, label: 'Español (Spanish)' },
  { value: SupportedLanguage.Chinese, label: '中文 (Chinese)' },
  { value: SupportedLanguage.Arabic, label: 'العربية (Arabic)' },
  { value: SupportedLanguage.French, label: 'Français (French)' },
  { value: SupportedLanguage.Portuguese, label: 'Português (Portuguese)' },
  { value: SupportedLanguage.Bengali, label: 'বাংলা (Bengali)' },
  { value: SupportedLanguage.Japanese, label: '日本語 (Japanese)' },
  { value: SupportedLanguage.German, label: 'Deutsch (German)' },
];

/** Text size options for accessibility preferences (Req 1.6) */
export const TEXT_SIZE_OPTIONS: Array<{ value: AccessibilityPreferences['textSize']; label: string }> = [
  { value: 'normal', label: 'Normal (16px)' },
  { value: 'large', label: 'Large (20px)' },
  { value: 'extra_large', label: 'Extra Large (24px)' },
];

/** Contrast mode options for accessibility preferences (Req 1.6) */
export const CONTRAST_MODE_OPTIONS: Array<{ value: AccessibilityPreferences['contrastMode']; label: string }> = [
  { value: 'default', label: 'Default' },
  { value: 'high_contrast_light', label: 'High Contrast (Light)' },
  { value: 'high_contrast_dark', label: 'High Contrast (Dark)' },
];

// ─── Form Field Configuration ────────────────────────────────────────────────

/** Configuration for each form field used by the base FormField component */
export const REGISTRATION_FORM_FIELDS: Record<string, Omit<FormFieldProps, 'value' | 'onChange' | 'onBlur' | 'error'>> = {
  fullName: {
    id: 'fullName',
    label: 'Full Name',
    type: 'text',
    required: true,
    placeholder: 'Enter full name',
    autoComplete: 'name',
    ariaLabel: 'Full name of the senior citizen',
  },
  dateOfBirth: {
    id: 'dateOfBirth',
    label: 'Date of Birth',
    type: 'date',
    required: true,
    helpText: 'Must be 60 years or older',
    autoComplete: 'bday',
    ariaLabel: 'Date of birth — must be 60 years or older',
  },
  gender: {
    id: 'gender',
    label: 'Gender',
    type: 'select',
    required: true,
    options: GENDER_OPTIONS.map((o) => ({ value: o.value, label: o.label })),
    ariaLabel: 'Gender selection',
  },
  phoneNumber: {
    id: 'phoneNumber',
    label: 'Phone Number',
    type: 'tel',
    required: true,
    placeholder: 'Enter phone number',
    autoComplete: 'tel',
    ariaLabel: 'Phone number',
  },
  street: {
    id: 'street',
    label: 'Street Address',
    type: 'text',
    placeholder: 'Street address',
    autoComplete: 'street-address',
  },
  city: {
    id: 'city',
    label: 'City',
    type: 'text',
    placeholder: 'City',
    autoComplete: 'address-level2',
  },
  state: {
    id: 'state',
    label: 'State / Province',
    type: 'text',
    placeholder: 'State or province',
    autoComplete: 'address-level1',
  },
  postalCode: {
    id: 'postalCode',
    label: 'Postal Code',
    type: 'text',
    placeholder: 'Postal code',
    autoComplete: 'postal-code',
  },
  country: {
    id: 'country',
    label: 'Country',
    type: 'text',
    placeholder: 'Country',
    autoComplete: 'country-name',
  },
  preferredLanguage: {
    id: 'preferredLanguage',
    label: 'Preferred Language',
    type: 'select',
    required: false,
    options: LANGUAGE_OPTIONS.map((o) => ({ value: o.value, label: o.label })),
    helpText: 'Select the language for all communications and UI',
    ariaLabel: 'Preferred language for the application interface',
  },
  textSize: {
    id: 'textSize',
    label: 'Text Size',
    type: 'select',
    options: TEXT_SIZE_OPTIONS.map((o) => ({ value: o.value, label: o.label })),
    helpText: 'Choose a comfortable text size',
    ariaLabel: 'Text size preference for accessibility',
  },
  contrastMode: {
    id: 'contrastMode',
    label: 'Contrast Mode',
    type: 'select',
    options: CONTRAST_MODE_OPTIONS.map((o) => ({ value: o.value, label: o.label })),
    helpText: 'High contrast modes improve readability',
    ariaLabel: 'Display contrast mode preference',
  },
};

// ─── Validation Logic ────────────────────────────────────────────────────────

/**
 * Calculate age from a date of birth string relative to a reference date.
 */
export function calculateAge(dateOfBirth: string, referenceDate: Date = new Date()): number {
  const dob = new Date(dateOfBirth);
  if (isNaN(dob.getTime())) return -1;

  let age = referenceDate.getFullYear() - dob.getFullYear();
  const monthDiff = referenceDate.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && referenceDate.getDate() < dob.getDate())) {
    age--;
  }
  return age;
}

/**
 * Validate that the date of birth meets the minimum age requirement (Req 1.2).
 */
export function validateAge(dateOfBirth: string): { valid: boolean; message?: string } {
  if (!dateOfBirth) {
    return { valid: false, message: 'Date of birth is required' };
  }

  const age = calculateAge(dateOfBirth);
  if (age < 0) {
    return { valid: false, message: 'Invalid date format' };
  }
  if (age < MINIMUM_AGE) {
    return {
      valid: false,
      message: `Registration requires a minimum age of ${MINIMUM_AGE} years. Current age: ${age}`,
    };
  }
  return { valid: true };
}

/**
 * Validate a phone number format (basic international format).
 */
export function validatePhoneNumber(phone: string): { valid: boolean; message?: string } {
  if (!phone.trim()) {
    return { valid: false, message: 'Phone number is required' };
  }
  // Accept digits, spaces, dashes, parentheses, and optional leading +
  const phoneRegex = /^\+?[\d\s\-()]{7,20}$/;
  if (!phoneRegex.test(phone.trim())) {
    return { valid: false, message: 'Invalid phone number format' };
  }
  return { valid: true };
}

/**
 * Validate that at least one emergency contact has all required fields (Req 1.7).
 */
export function validateEmergencyContacts(
  contacts: EmergencyContactFormEntry[],
): { valid: boolean; message?: string } {
  if (!contacts || contacts.length === 0) {
    return { valid: false, message: 'At least one emergency contact is required' };
  }

  const hasComplete = contacts.some(
    (c) => c.name.trim() && c.relationship.trim() && c.phoneNumber.trim(),
  );

  if (!hasComplete) {
    return {
      valid: false,
      message: 'Emergency contact must include name, relationship, and phone number',
    };
  }
  return { valid: true };
}

/**
 * Validate the entire registration form and return all errors (Req 1.7).
 * Returns an empty object if valid.
 */
export function validateRegistrationForm(state: RegistrationFormState): ValidationErrors {
  const errors: ValidationErrors = {};

  // Full name
  if (!state.fullName.trim()) {
    errors.fullName = 'Full name is required';
  }

  // Date of birth and age (Req 1.2)
  const ageResult = validateAge(state.dateOfBirth);
  if (!ageResult.valid) {
    errors.dateOfBirth = ageResult.message;
  }

  // Gender
  if (!state.gender) {
    errors.gender = 'Gender is required';
  }

  // Phone number
  const phoneResult = validatePhoneNumber(state.phoneNumber);
  if (!phoneResult.valid) {
    errors.phoneNumber = phoneResult.message;
  }

  // Emergency contacts (Req 1.7)
  const contactResult = validateEmergencyContacts(state.emergencyContacts);
  if (!contactResult.valid) {
    errors.emergencyContacts = contactResult.message;
  }

  return errors;
}

/**
 * Check if the form has any validation errors.
 */
export function isFormValid(errors: ValidationErrors): boolean {
  return Object.keys(errors).length === 0;
}

/**
 * Get the list of missing required field names from the form state (Req 1.7).
 */
export function getMissingRequiredFields(state: RegistrationFormState): string[] {
  const missing: string[] = [];

  if (!state.fullName.trim()) missing.push('Full Name');
  if (!state.dateOfBirth) missing.push('Date of Birth');
  if (!state.gender) missing.push('Gender');
  if (!state.phoneNumber.trim()) missing.push('Phone Number');

  const contactResult = validateEmergencyContacts(state.emergencyContacts);
  if (!contactResult.valid) missing.push('Emergency Contact');

  return missing;
}

// ─── Form Section Definitions ────────────────────────────────────────────────

/** Describes a section of the registration form for step-by-step navigation */
export interface FormSectionConfig {
  id: RegistrationFormSection;
  title: string;
  description: string;
  fields: string[];
  ariaLabel: string;
}

/** Ordered sections of the registration form */
export const FORM_SECTIONS: FormSectionConfig[] = [
  {
    id: 'personalDetails',
    title: 'Personal Details',
    description: 'Basic identification information',
    fields: ['fullName', 'dateOfBirth', 'gender', 'phoneNumber'],
    ariaLabel: 'Step 1: Personal details',
  },
  {
    id: 'address',
    title: 'Address',
    description: 'Residential address',
    fields: ['street', 'city', 'state', 'postalCode', 'country'],
    ariaLabel: 'Step 2: Address information',
  },
  {
    id: 'emergencyContacts',
    title: 'Emergency Contacts',
    description: 'At least one emergency contact is required',
    fields: ['emergencyContacts'],
    ariaLabel: 'Step 3: Emergency contacts',
  },
  {
    id: 'medicalHistory',
    title: 'Medical Information',
    description: 'Medical history, medications, and allergies',
    fields: ['medicalHistory', 'currentMedications', 'allergies'],
    ariaLabel: 'Step 4: Medical information',
  },
  {
    id: 'preferences',
    title: 'Language & Accessibility',
    description: 'Communication language and accessibility preferences',
    fields: ['preferredLanguage', 'textSize', 'contrastMode'],
    ariaLabel: 'Step 5: Language and accessibility preferences',
  },
];
