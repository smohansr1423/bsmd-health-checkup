/**
 * Health Profile and Registration-related interfaces
 */
import { Gender, SupportedLanguage } from '../enums';
import { AccessibilityPreferences } from './accessibility';

export interface Address {
  street: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
}

export interface EmergencyContact {
  name: string;
  relationship: string;
  phoneNumber: string;
}

export interface Allergy {
  substance: string;
  severity: 'mild' | 'moderate' | 'severe';
  notes?: string;
}

export interface MedicalHistoryEntry {
  condition: string;
  diagnosedDate?: Date;
  status: 'active' | 'resolved';
  notes?: string;
}

export interface Medication {
  name: string;
  dosage: string;
  frequency: string;
  startDate: Date;
  endDate?: Date;
}

export interface InsurancePolicy {
  id: string;
  seniorId: string;
  provider: string;
  policyNumber: string;
  coveragePercentage: number; // 0-100
  maxClaimableAmount: number;
  validUntil: Date;
}

export interface HealthProfile {
  id: string; // system-generated, immutable
  fullName: string;
  dateOfBirth: Date;
  gender: Gender;
  address: Address;
  phoneNumber: string;
  medicalHistory: MedicalHistoryEntry[];
  currentMedications: Medication[];
  allergies: Allergy[];
  emergencyContacts: EmergencyContact[]; // min 1
  preferredLanguage: SupportedLanguage;
  accessibilityPreferences: AccessibilityPreferences;
  insuranceDetails?: InsurancePolicy;
  createdAt: Date;
  updatedAt: Date;
}
