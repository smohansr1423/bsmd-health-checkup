/**
 * RTL (Right-to-Left) Layout Utilities
 * Validates: Requirements 12.8
 *
 * Provides utilities for detecting RTL languages, generating layout
 * configurations, and producing CSS-ready directional values for
 * mirroring the interface when Arabic is active.
 */

import { SupportedLanguage } from '@health-checkup/shared';
import type {
  RTLLayoutConfig,
  NavigationMirrorConfig,
  DirectionalIconConfig,
  DocumentDirectionAttributes,
  TextDirection,
  DirectionalAlignment,
  LogicalCSSProperties,
} from './rtl.types';
import { languageToLocaleTag } from './translations';

/**
 * Set of RTL languages among supported languages.
 * Currently only Arabic is RTL.
 */
const RTL_LANGUAGES: ReadonlySet<SupportedLanguage> = new Set([
  SupportedLanguage.Arabic,
]);

/**
 * Check if a given language is RTL.
 *
 * @param language - The language to check
 * @returns true if the language uses right-to-left text direction
 */
export function isRTLLanguage(language: SupportedLanguage): boolean {
  return RTL_LANGUAGES.has(language);
}

/**
 * Get the text direction for a given language.
 *
 * @param language - The language to get direction for
 * @returns 'rtl' for Arabic, 'ltr' for all other supported languages
 */
export function getTextDirection(language: SupportedLanguage): TextDirection {
  return isRTLLanguage(language) ? 'rtl' : 'ltr';
}

/**
 * Get the default text alignment for a given language.
 * RTL languages align text to the right; LTR languages to the left.
 *
 * @param language - The language to get alignment for
 * @returns 'right' for RTL languages, 'left' for LTR languages
 */
export function getTextAlignment(language: SupportedLanguage): DirectionalAlignment {
  return isRTLLanguage(language) ? 'right' : 'left';
}

/**
 * Generate the navigation mirroring configuration for a given language.
 * In RTL mode, sidebar moves to the right, menus and breadcrumbs reverse.
 *
 * @param language - The active language
 * @returns NavigationMirrorConfig with mirrored positions for RTL
 */
export function getNavigationMirrorConfig(language: SupportedLanguage): NavigationMirrorConfig {
  const rtl = isRTLLanguage(language);
  return {
    sidebarPosition: rtl ? 'right' : 'left',
    menuDirection: rtl ? 'row-reverse' : 'row',
    breadcrumbDirection: rtl ? 'row-reverse' : 'row',
    scrollDirection: rtl ? 'rtl' : 'ltr',
  };
}

/**
 * Generate the directional icon configuration for a given language.
 * In RTL mode, directional icons (arrows, chevrons) are mirrored.
 *
 * @param language - The active language
 * @returns DirectionalIconConfig with icon mirroring settings
 */
export function getDirectionalIconConfig(language: SupportedLanguage): DirectionalIconConfig {
  const rtl = isRTLLanguage(language);
  return {
    shouldMirror: rtl,
    mirrorTransform: rtl ? 'scaleX(-1)' : 'none',
    backIcon: rtl ? 'arrow-right' : 'arrow-left',
    forwardIcon: rtl ? 'arrow-left' : 'arrow-right',
    listMarkerSide: rtl ? 'right' : 'left',
  };
}

/**
 * Generate the document-level direction attributes for the HTML element.
 * Sets the dir and lang attributes for proper browser RTL rendering.
 *
 * @param language - The active language
 * @returns DocumentDirectionAttributes to apply on <html> element
 */
export function getDocumentDirectionAttributes(
  language: SupportedLanguage
): DocumentDirectionAttributes {
  return {
    dir: getTextDirection(language),
    lang: languageToLocaleTag[language] || language,
  };
}

/**
 * Generate the complete RTL layout configuration for a given language.
 * Combines all directional settings into a single configuration object
 * that frontend components can consume.
 *
 * @param language - The active language
 * @returns Complete RTLLayoutConfig for the interface
 */
export function getRTLLayoutConfig(language: SupportedLanguage): RTLLayoutConfig {
  const rtl = isRTLLanguage(language);
  return {
    language,
    isRTL: rtl,
    direction: getTextDirection(language),
    textAlign: getTextAlignment(language),
    navigation: getNavigationMirrorConfig(language),
    icons: getDirectionalIconConfig(language),
    documentAttributes: getDocumentDirectionAttributes(language),
  };
}

/**
 * Get CSS logical property names for RTL-aware styling.
 * These map physical left/right to logical start/end, which automatically
 * adapts to the document direction.
 *
 * @returns LogicalCSSProperties with CSS logical property names
 */
export function getLogicalCSSProperties(): LogicalCSSProperties {
  return {
    marginStart: 'margin-inline-start',
    marginEnd: 'margin-inline-end',
    paddingStart: 'padding-inline-start',
    paddingEnd: 'padding-inline-end',
    borderStart: 'border-inline-start',
    borderEnd: 'border-inline-end',
    insetStart: 'inset-inline-start',
    insetEnd: 'inset-inline-end',
  };
}

/**
 * Generate inline CSS style object for RTL-aware element positioning.
 * Useful for dynamically applying direction-aware styles in JS frameworks.
 *
 * @param language - The active language
 * @returns Object with CSS properties for RTL-aware layout
 */
export function getDirectionalStyles(language: SupportedLanguage): Record<string, string> {
  const rtl = isRTLLanguage(language);
  return {
    direction: rtl ? 'rtl' : 'ltr',
    textAlign: rtl ? 'right' : 'left',
    unicodeBidi: rtl ? 'embed' : 'normal',
  };
}
