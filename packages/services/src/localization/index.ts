/**
 * Localization Service module exports.
 */

export { LocalizationService } from './localization.service';
export type {
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
export { defaultTranslations, defaultMedicalTerms, languageToLocaleTag } from './translations';

// RTL layout support (Requirement 12.8)
export type {
  TextDirection,
  DirectionalAlignment,
  RTLLayoutConfig,
  NavigationMirrorConfig,
  DirectionalIconConfig,
  DocumentDirectionAttributes,
  LogicalCSSProperties,
} from './rtl.types';
export {
  isRTLLanguage,
  getTextDirection,
  getTextAlignment,
  getNavigationMirrorConfig,
  getDirectionalIconConfig,
  getDocumentDirectionAttributes,
  getRTLLayoutConfig,
  getLogicalCSSProperties,
  getDirectionalStyles,
} from './rtl.utils';
