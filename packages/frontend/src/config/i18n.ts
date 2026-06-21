/**
 * Internationalization (i18n) configuration for the Senior Citizen Health Checkup System.
 * Supports 10 languages with RTL detection and locale-specific formatting.
 *
 * Requirements: 12.1, 12.2, 12.4, 12.5, 12.8
 */

import { SupportedLanguage } from '@health-checkup/shared';

export interface LocaleConfig {
  /** Language code (BCP 47) */
  code: SupportedLanguage;
  /** Display name in the language itself */
  nativeName: string;
  /** Display name in English */
  englishName: string;
  /** Whether this is a right-to-left language */
  isRTL: boolean;
  /** Date format pattern */
  dateFormat: string;
  /** Time format (12h or 24h) */
  timeFormat: '12h' | '24h';
  /** Number formatting locale (BCP 47 tag) */
  numberLocale: string;
  /** Currency formatting locale (BCP 47 tag) */
  currencyLocale: string;
  /** Default reading direction */
  direction: 'ltr' | 'rtl';
}

/**
 * Configuration for all 10 supported languages.
 */
export const localeConfigs: Record<SupportedLanguage, LocaleConfig> = {
  [SupportedLanguage.English]: {
    code: SupportedLanguage.English,
    nativeName: 'English',
    englishName: 'English',
    isRTL: false,
    dateFormat: 'MM/DD/YYYY',
    timeFormat: '12h',
    numberLocale: 'en-US',
    currencyLocale: 'en-US',
    direction: 'ltr',
  },
  [SupportedLanguage.Hindi]: {
    code: SupportedLanguage.Hindi,
    nativeName: 'हिन्दी',
    englishName: 'Hindi',
    isRTL: false,
    dateFormat: 'DD/MM/YYYY',
    timeFormat: '12h',
    numberLocale: 'hi-IN',
    currencyLocale: 'hi-IN',
    direction: 'ltr',
  },
  [SupportedLanguage.Spanish]: {
    code: SupportedLanguage.Spanish,
    nativeName: 'Español',
    englishName: 'Spanish',
    isRTL: false,
    dateFormat: 'DD/MM/YYYY',
    timeFormat: '24h',
    numberLocale: 'es-ES',
    currencyLocale: 'es-ES',
    direction: 'ltr',
  },
  [SupportedLanguage.Chinese]: {
    code: SupportedLanguage.Chinese,
    nativeName: '中文',
    englishName: 'Chinese (Mandarin)',
    isRTL: false,
    dateFormat: 'YYYY/MM/DD',
    timeFormat: '24h',
    numberLocale: 'zh-CN',
    currencyLocale: 'zh-CN',
    direction: 'ltr',
  },
  [SupportedLanguage.Arabic]: {
    code: SupportedLanguage.Arabic,
    nativeName: 'العربية',
    englishName: 'Arabic',
    isRTL: true,
    dateFormat: 'DD/MM/YYYY',
    timeFormat: '12h',
    numberLocale: 'ar-SA',
    currencyLocale: 'ar-SA',
    direction: 'rtl',
  },
  [SupportedLanguage.French]: {
    code: SupportedLanguage.French,
    nativeName: 'Français',
    englishName: 'French',
    isRTL: false,
    dateFormat: 'DD/MM/YYYY',
    timeFormat: '24h',
    numberLocale: 'fr-FR',
    currencyLocale: 'fr-FR',
    direction: 'ltr',
  },
  [SupportedLanguage.Portuguese]: {
    code: SupportedLanguage.Portuguese,
    nativeName: 'Português',
    englishName: 'Portuguese',
    isRTL: false,
    dateFormat: 'DD/MM/YYYY',
    timeFormat: '24h',
    numberLocale: 'pt-BR',
    currencyLocale: 'pt-BR',
    direction: 'ltr',
  },
  [SupportedLanguage.Bengali]: {
    code: SupportedLanguage.Bengali,
    nativeName: 'বাংলা',
    englishName: 'Bengali',
    isRTL: false,
    dateFormat: 'DD/MM/YYYY',
    timeFormat: '12h',
    numberLocale: 'bn-BD',
    currencyLocale: 'bn-BD',
    direction: 'ltr',
  },
  [SupportedLanguage.Japanese]: {
    code: SupportedLanguage.Japanese,
    nativeName: '日本語',
    englishName: 'Japanese',
    isRTL: false,
    dateFormat: 'YYYY/MM/DD',
    timeFormat: '24h',
    numberLocale: 'ja-JP',
    currencyLocale: 'ja-JP',
    direction: 'ltr',
  },
  [SupportedLanguage.German]: {
    code: SupportedLanguage.German,
    nativeName: 'Deutsch',
    englishName: 'German',
    isRTL: false,
    dateFormat: 'DD.MM.YYYY',
    timeFormat: '24h',
    numberLocale: 'de-DE',
    currencyLocale: 'de-DE',
    direction: 'ltr',
  },
};

/**
 * Determine whether a language uses right-to-left writing direction.
 */
export function isRTLLanguage(language: SupportedLanguage): boolean {
  return localeConfigs[language]?.isRTL ?? false;
}

/**
 * Get the document direction attribute value for a given language.
 */
export function getTextDirection(language: SupportedLanguage): 'ltr' | 'rtl' {
  return localeConfigs[language]?.direction ?? 'ltr';
}

/**
 * Get all supported language codes.
 */
export function getSupportedLanguages(): SupportedLanguage[] {
  return Object.values(SupportedLanguage);
}

/**
 * Get locale config for a given language, falling back to English.
 */
export function getLocaleConfig(language: SupportedLanguage): LocaleConfig {
  return localeConfigs[language] ?? localeConfigs[SupportedLanguage.English];
}

/**
 * Default language for the system.
 */
export const DEFAULT_LANGUAGE = SupportedLanguage.English;
