/**
 * RTL (Right-to-Left) Layout Types and Interfaces
 * Validates: Requirements 12.8
 *
 * Provides type definitions for RTL layout support, including
 * text direction, navigation mirroring, and directional UI configuration.
 */

import { SupportedLanguage } from '@health-checkup/shared';

/**
 * Text direction values for document and element-level layout.
 */
export type TextDirection = 'ltr' | 'rtl';

/**
 * Text alignment values adjusted for directionality.
 */
export type DirectionalAlignment = 'start' | 'end' | 'left' | 'right' | 'center';

/**
 * Complete RTL layout configuration for the interface.
 * Used by frontend components to apply correct directional styling.
 */
export interface RTLLayoutConfig {
  /** The active language */
  language: SupportedLanguage;
  /** Whether the current language is RTL */
  isRTL: boolean;
  /** Document text direction ('ltr' or 'rtl') */
  direction: TextDirection;
  /** Text alignment for body text */
  textAlign: DirectionalAlignment;
  /** Configuration for mirrored navigation */
  navigation: NavigationMirrorConfig;
  /** Configuration for directional icons */
  icons: DirectionalIconConfig;
  /** CSS properties to apply at the document/root level */
  documentAttributes: DocumentDirectionAttributes;
}

/**
 * Navigation mirroring configuration.
 * Swaps navigation positions for RTL languages.
 */
export interface NavigationMirrorConfig {
  /** Side where the primary navigation appears ('left' for LTR, 'right' for RTL) */
  sidebarPosition: 'left' | 'right';
  /** Direction for horizontal menu items */
  menuDirection: 'row' | 'row-reverse';
  /** Alignment for breadcrumb navigation */
  breadcrumbDirection: 'row' | 'row-reverse';
  /** Scroll direction for horizontal scrollable content */
  scrollDirection: 'ltr' | 'rtl';
}

/**
 * Configuration for mirroring directional icons.
 * Certain icons (arrows, chevrons) need to be flipped in RTL layouts.
 */
export interface DirectionalIconConfig {
  /** Whether directional icons should be mirrored (flipped horizontally) */
  shouldMirror: boolean;
  /** CSS transform to apply to directional icons */
  mirrorTransform: string;
  /** Icon name mapping for back/forward navigation */
  backIcon: 'arrow-left' | 'arrow-right';
  /** Icon name mapping for forward/next navigation */
  forwardIcon: 'arrow-right' | 'arrow-left';
  /** Icon name for list item bullets/markers */
  listMarkerSide: 'left' | 'right';
}

/**
 * Attributes to apply on the document root (html element) for proper RTL rendering.
 */
export interface DocumentDirectionAttributes {
  /** The 'dir' attribute value for the HTML element */
  dir: TextDirection;
  /** The 'lang' attribute value (BCP 47 tag) */
  lang: string;
}

/**
 * CSS logical properties mapping for RTL-aware styling.
 * Maps physical properties to their RTL-aware equivalents.
 */
export interface LogicalCSSProperties {
  /** Maps to margin-inline-start */
  marginStart: string;
  /** Maps to margin-inline-end */
  marginEnd: string;
  /** Maps to padding-inline-start */
  paddingStart: string;
  /** Maps to padding-inline-end */
  paddingEnd: string;
  /** Maps to border-inline-start */
  borderStart: string;
  /** Maps to border-inline-end */
  borderEnd: string;
  /** Maps to inset-inline-start (replaces left/right positioning) */
  insetStart: string;
  /** Maps to inset-inline-end */
  insetEnd: string;
}
