/**
 * Localization Service
 * Translates UI content, notifications, and reports; handles locale-specific formatting;
 * manages RTL layouts and language switching.
 *
 * Validates: Requirements 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7, 12.9
 */

import { SupportedLanguage } from '@health-checkup/shared';
import type {
  Locale,
  Currency,
  TranslatedMedicalContent,
  LanguageSwitchResult,
  FallbackNotification,
  LanguageSwitchErrorNotification,
  LocalizationDependencies,
  TranslationDictionary,
  MedicalTermDictionary,
} from './localization.types';
import { defaultTranslations, defaultMedicalTerms, languageToLocaleTag } from './translations';

/**
 * All supported languages as defined in Requirement 12.1.
 */
const ALL_SUPPORTED_LANGUAGES: SupportedLanguage[] = [
  SupportedLanguage.English,
  SupportedLanguage.Hindi,
  SupportedLanguage.Spanish,
  SupportedLanguage.Chinese,
  SupportedLanguage.Arabic,
  SupportedLanguage.French,
  SupportedLanguage.Portuguese,
  SupportedLanguage.Bengali,
  SupportedLanguage.Japanese,
  SupportedLanguage.German,
];

/**
 * Default fallback language (English).
 */
const FALLBACK_LANGUAGE = SupportedLanguage.English;

/**
 * Maximum time allowed for a language switch (3 seconds / 3000ms).
 * Requirement 12.4: Apply language switch within 3 seconds without re-login.
 */
const MAX_SWITCH_DURATION_MS = 3000;

/**
 * LocalizationService implementation.
 *
 * Provides translation, medical term translation, locale-specific formatting,
 * RTL detection, and language switch with error handling.
 *
 * Uses dependency injection for translations and callbacks to support testability.
 */
export class LocalizationService {
  private readonly translations: TranslationDictionary;
  private readonly medicalTerms: MedicalTermDictionary;
  private readonly onFallback?: (notification: FallbackNotification) => void;
  private readonly onSwitchError?: (notification: LanguageSwitchErrorNotification) => void;

  private currentLanguage: SupportedLanguage = SupportedLanguage.English;

  constructor(deps?: Partial<LocalizationDependencies>) {
    this.translations = deps?.translations ?? defaultTranslations;
    this.medicalTerms = deps?.medicalTerms ?? defaultMedicalTerms;
    this.onFallback = deps?.onFallback;
    this.onSwitchError = deps?.onSwitchError;
  }

  /**
   * Translate a UI key into the specified language.
   * Supports parameter interpolation using {paramName} syntax.
   *
   * Requirement 12.2: Render all UI elements in selected language.
   * Requirement 12.3: Translate notifications and alerts into preferred language.
   * Requirement 12.7: Fallback to English with visible notification when unavailable.
   *
   * @param key - The translation key (e.g., 'nav.home', 'notification.appointment_confirmed')
   * @param language - The target language
   * @param params - Optional interpolation parameters
   * @returns The translated string, falling back to English if unavailable
   */
  translate(
    key: string,
    language: SupportedLanguage,
    params?: Record<string, string>
  ): string {
    const entry = this.translations[key];
    let text: string | undefined;
    let isFallback = false;

    if (entry) {
      text = entry[language];
      if (text === undefined) {
        // Fallback to English (Requirement 12.7)
        text = entry[FALLBACK_LANGUAGE];
        isFallback = true;
      }
    }

    if (text === undefined) {
      // Key not found at all — return key itself with fallback notification
      isFallback = true;
      text = key;
    }

    if (isFallback && language !== FALLBACK_LANGUAGE) {
      this.emitFallbackNotification(key, language);
    }

    // Interpolate parameters
    if (params) {
      text = this.interpolate(text, params);
    }

    return text;
  }

  /**
   * Translate a medical term with a plain-language explanation.
   *
   * Requirement 12.6: Provide translated medical terminology with plain-language
   * explanations readable at or below a 6th-grade reading level.
   * Requirement 12.7: Fallback to English with notification when unavailable.
   *
   * @param term - The medical term key (e.g., 'blood_pressure', 'cholesterol')
   * @param language - The target language
   * @returns TranslatedMedicalContent with translation, explanation, and fallback indicator
   */
  translateMedicalTerm(term: string, language: SupportedLanguage): TranslatedMedicalContent {
    const entry = this.medicalTerms[term];

    if (entry) {
      const content = entry[language];
      if (content) {
        return {
          term,
          translation: content.translation,
          explanation: content.explanation,
          language,
          isFallback: false,
        };
      }

      // Fallback to English
      const fallbackContent = entry[FALLBACK_LANGUAGE];
      if (fallbackContent) {
        this.emitFallbackNotification(term, language);
        return {
          term,
          translation: fallbackContent.translation,
          explanation: fallbackContent.explanation,
          language: FALLBACK_LANGUAGE,
          isFallback: true,
        };
      }
    }

    // Term not found at all
    this.emitFallbackNotification(term, language);
    return {
      term,
      translation: term,
      explanation: '',
      language: FALLBACK_LANGUAGE,
      isFallback: true,
    };
  }

  /**
   * Format a date according to locale conventions.
   *
   * Requirement 12.5: Format dates according to locale conventions.
   *
   * @param date - The date to format
   * @param locale - The locale specification
   * @returns Locale-formatted date string
   */
  formatDate(date: Date, locale: Locale): string {
    const tag = locale.tag || languageToLocaleTag[locale.language] || 'en-US';
    try {
      return new Intl.DateTimeFormat(tag, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      }).format(date);
    } catch {
      // Fallback to ISO date string if locale is not supported
      return date.toISOString().split('T')[0];
    }
  }

  /**
   * Format a currency value according to locale conventions.
   *
   * Requirement 12.5: Format currency values according to locale conventions.
   *
   * @param amount - The monetary amount
   * @param currency - The currency specification
   * @param locale - The locale specification
   * @returns Locale-formatted currency string
   */
  formatCurrency(amount: number, currency: Currency, locale: Locale): string {
    const tag = locale.tag || languageToLocaleTag[locale.language] || 'en-US';
    try {
      return new Intl.NumberFormat(tag, {
        style: 'currency',
        currency: currency.code,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(amount);
    } catch {
      // Fallback to simple formatting
      return `${currency.symbol || currency.code} ${amount.toFixed(2)}`;
    }
  }

  /**
   * Format a number according to locale conventions.
   *
   * Requirement 12.5: Format numbers according to locale conventions.
   *
   * @param value - The number to format
   * @param locale - The locale specification
   * @returns Locale-formatted number string
   */
  formatNumber(value: number, locale: Locale): string {
    const tag = locale.tag || languageToLocaleTag[locale.language] || 'en-US';
    try {
      return new Intl.NumberFormat(tag).format(value);
    } catch {
      // Fallback to plain toString
      return value.toString();
    }
  }

  /**
   * Determine if a language uses right-to-left text direction.
   *
   * Requirement 12.8: Mirror interface layout for RTL languages (Arabic).
   *
   * @param language - The language to check
   * @returns true if the language is RTL (Arabic), false otherwise
   */
  isRTL(language: SupportedLanguage): boolean {
    return language === SupportedLanguage.Arabic;
  }

  /**
   * Get the list of all available/supported languages.
   *
   * Requirement 12.1: Support minimum 10 languages.
   *
   * @returns Array of all supported languages
   */
  getAvailableLanguages(): SupportedLanguage[] {
    return [...ALL_SUPPORTED_LANGUAGES];
  }

  /**
   * Switch the active language for the service.
   *
   * Requirement 12.4: Apply language switch within 3 seconds without re-login.
   * Requirement 12.9: Retain previous language if switch fails; show error notification.
   *
   * @param newLanguage - The language to switch to
   * @returns Result indicating success/failure, timing, and active language
   */
  switchLanguage(newLanguage: SupportedLanguage): LanguageSwitchResult {
    const previousLanguage = this.currentLanguage;
    const startTime = Date.now();

    try {
      // Validate the language is supported
      if (!ALL_SUPPORTED_LANGUAGES.includes(newLanguage)) {
        throw new Error(`Unsupported language: ${newLanguage}`);
      }

      // Apply the language switch
      this.currentLanguage = newLanguage;

      const switchDurationMs = Date.now() - startTime;

      // Requirement 12.4: Must complete within 3 seconds
      if (switchDurationMs > MAX_SWITCH_DURATION_MS) {
        // Revert on timeout
        this.currentLanguage = previousLanguage;
        this.emitSwitchError(newLanguage, previousLanguage);
        return {
          success: false,
          activeLanguage: previousLanguage,
          switchDurationMs,
          error: 'Language switch exceeded maximum allowed time of 3 seconds.',
        };
      }

      return {
        success: true,
        activeLanguage: newLanguage,
        switchDurationMs,
      };
    } catch (error) {
      // Requirement 12.9: Retain previous language if switch fails
      this.currentLanguage = previousLanguage;
      const switchDurationMs = Date.now() - startTime;

      this.emitSwitchError(newLanguage, previousLanguage);

      return {
        success: false,
        activeLanguage: previousLanguage,
        switchDurationMs,
        error: error instanceof Error ? error.message : 'Unknown error during language switch.',
      };
    }
  }

  /**
   * Get the currently active language.
   */
  getCurrentLanguage(): SupportedLanguage {
    return this.currentLanguage;
  }

  /**
   * Set the current language directly (for initialization without switch semantics).
   */
  setCurrentLanguage(language: SupportedLanguage): void {
    this.currentLanguage = language;
  }

  /**
   * Create a Locale object from a SupportedLanguage.
   * Utility for callers who need a Locale but only have a language.
   */
  createLocale(language: SupportedLanguage): Locale {
    return {
      language,
      tag: languageToLocaleTag[language] || 'en-US',
    };
  }

  /**
   * Check if a translation exists for a given key and language (without fallback).
   */
  hasTranslation(key: string, language: SupportedLanguage): boolean {
    const entry = this.translations[key];
    return entry !== undefined && entry[language] !== undefined;
  }

  /**
   * Check if a medical term translation exists for a given term and language (without fallback).
   */
  hasMedicalTermTranslation(term: string, language: SupportedLanguage): boolean {
    const entry = this.medicalTerms[term];
    return entry !== undefined && entry[language] !== undefined;
  }

  // --- Private Helpers ---

  /**
   * Interpolate parameters into a template string.
   * Replaces {paramName} with the corresponding value.
   */
  private interpolate(text: string, params: Record<string, string>): string {
    let result = text;
    for (const [key, value] of Object.entries(params)) {
      result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
    }
    return result;
  }

  /**
   * Emit a fallback notification indicating translation was unavailable.
   * Requirement 12.7: Display content in English with visible notification.
   */
  private emitFallbackNotification(key: string, requestedLanguage: SupportedLanguage): void {
    if (this.onFallback) {
      this.onFallback({
        type: 'translation_fallback',
        originalLanguage: requestedLanguage,
        fallbackLanguage: FALLBACK_LANGUAGE,
        key,
        message: `Translation unavailable for key "${key}" in language "${requestedLanguage}". Displaying in English.`,
      });
    }
  }

  /**
   * Emit a language switch error notification.
   * Requirement 12.9: Show error notification when language switch fails.
   */
  private emitSwitchError(
    requestedLanguage: SupportedLanguage,
    retainedLanguage: SupportedLanguage
  ): void {
    if (this.onSwitchError) {
      this.onSwitchError({
        type: 'language_switch_error',
        requestedLanguage,
        retainedLanguage,
        message: `Language change to "${requestedLanguage}" was unsuccessful. Retaining "${retainedLanguage}".`,
      });
    }
  }
}
