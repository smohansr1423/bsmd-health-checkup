/**
 * Types for the Localization Service
 * Validates: Requirements 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7, 12.9
 */

import { SupportedLanguage } from '@health-checkup/shared';

/**
 * Locale information for formatting functions.
 */
export interface Locale {
  language: SupportedLanguage;
  /** BCP 47 locale tag (e.g., 'en-US', 'hi-IN', 'ar-SA') */
  tag: string;
}

/**
 * Currency descriptor for formatting.
 */
export interface Currency {
  code: string; // ISO 4217 currency code (e.g., 'USD', 'INR', 'EUR')
  symbol?: string;
}

/**
 * Result of translating a medical term with a plain-language explanation.
 * Requirement 12.6: ≤6th-grade reading level.
 */
export interface TranslatedMedicalContent {
  term: string;
  translation: string;
  explanation: string;
  language: SupportedLanguage;
  isFallback: boolean;
}

/**
 * Result of a language switch operation.
 */
export interface LanguageSwitchResult {
  success: boolean;
  activeLanguage: SupportedLanguage;
  switchDurationMs: number;
  error?: string;
}

/**
 * Notification emitted when fallback to English is used.
 */
export interface FallbackNotification {
  type: 'translation_fallback';
  originalLanguage: SupportedLanguage;
  fallbackLanguage: SupportedLanguage;
  key: string;
  message: string;
}

/**
 * Notification emitted on language switch failure.
 */
export interface LanguageSwitchErrorNotification {
  type: 'language_switch_error';
  requestedLanguage: SupportedLanguage;
  retainedLanguage: SupportedLanguage;
  message: string;
}

/**
 * Translation dictionary: key → language → translation string.
 */
export type TranslationDictionary = Record<string, Partial<Record<SupportedLanguage, string>>>;

/**
 * Medical term dictionary: term → language → { translation, explanation }.
 */
export type MedicalTermDictionary = Record<
  string,
  Partial<Record<SupportedLanguage, { translation: string; explanation: string }>>
>;

/**
 * Dependencies for the LocalizationService (for dependency injection and testability).
 */
export interface LocalizationDependencies {
  translations: TranslationDictionary;
  medicalTerms: MedicalTermDictionary;
  onFallback?: (notification: FallbackNotification) => void;
  onSwitchError?: (notification: LanguageSwitchErrorNotification) => void;
}
