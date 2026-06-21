/**
 * Accessibility constants and configuration for the Senior Citizen Health Checkup System.
 * Defines focus indicators, button sizes, ARIA roles, and keyboard navigation mappings.
 *
 * Requirements: 13.1, 13.2, 13.4, 13.5, 13.7, 13.9
 */

// ─── Focus Indicators (Requirement 13.4) ───────────────────────────────────────

export interface FocusIndicatorConfig {
  /** Width of the focus outline in px */
  width: number;
  /** Style of the focus outline */
  style: 'solid' | 'dashed' | 'dotted';
  /** Offset from the element edge in px */
  offset: number;
}

/** Default visible focus indicator: 2px solid, 2px offset */
export const FOCUS_INDICATOR: FocusIndicatorConfig = {
  width: 2,
  style: 'solid',
  offset: 2,
};

/**
 * CSS string for focus ring — apply to all focusable elements.
 * Uses focusRing color from the active theme.
 */
export const FOCUS_INDICATOR_CSS = `
  outline-width: ${FOCUS_INDICATOR.width}px;
  outline-style: ${FOCUS_INDICATOR.style};
  outline-offset: ${FOCUS_INDICATOR.offset}px;
`;

// ─── Button Sizing (Requirement 13.7) ────────────────────────────────────────

export interface ButtonSizeConfig {
  /** Minimum width in px */
  minWidth: number;
  /** Minimum height in px */
  minHeight: number;
  /** Minimum spacing between adjacent buttons in px */
  spacing: number;
}

/** Large button mode dimensions: 44×44px, 8px spacing */
export const LARGE_BUTTON_SIZE: ButtonSizeConfig = {
  minWidth: 44,
  minHeight: 44,
  spacing: 8,
};

/** Default (non-large) button dimensions */
export const DEFAULT_BUTTON_SIZE: ButtonSizeConfig = {
  minWidth: 36,
  minHeight: 36,
  spacing: 4,
};

// ─── Text Sizing (Requirement 13.2) ──────────────────────────────────────────

export interface TextSizeConfig {
  /** Base font size in px */
  baseFontSize: number;
  /** Scale factor relative to base */
  scaleFactor: number;
}

export const TEXT_SIZES: Record<'normal' | 'large' | 'extra_large', TextSizeConfig> = {
  normal: { baseFontSize: 16, scaleFactor: 1 },
  large: { baseFontSize: 20, scaleFactor: 1.25 },
  extra_large: { baseFontSize: 24, scaleFactor: 1.5 },
};

/** Maximum text scale (200%) per requirement 13.2 */
export const MAX_TEXT_SCALE = 2.0;

// ─── Navigation (Requirement 13.9) ───────────────────────────────────────────

/** Maximum number of top-level navigation items in simplified mode */
export const SIMPLIFIED_NAV_MAX_ITEMS = 6;

/** Default navigation items for simplified mode */
export const SIMPLIFIED_NAV_ITEMS = [
  'appointments',
  'reports',
  'notifications',
  'profile',
  'help',
  'settings',
] as const;

export type SimplifiedNavItem = (typeof SIMPLIFIED_NAV_ITEMS)[number];

// ─── ARIA Roles & Landmarks (Requirement 13.5) ──────────────────────────────

export interface LandmarkConfig {
  role: string;
  label: string;
}

/** Standard landmark regions for the application layout */
export const LANDMARKS: Record<string, LandmarkConfig> = {
  header: { role: 'banner', label: 'Site header' },
  navigation: { role: 'navigation', label: 'Main navigation' },
  main: { role: 'main', label: 'Main content' },
  complementary: { role: 'complementary', label: 'Supplementary content' },
  footer: { role: 'contentinfo', label: 'Site footer' },
};

/** ARIA live region politeness levels for dynamic content */
export type AriaLiveRegion = 'polite' | 'assertive' | 'off';

// ─── Keyboard Navigation ─────────────────────────────────────────────────────

export interface KeyboardShortcut {
  key: string;
  description: string;
}

/** Standard keyboard navigation keys */
export const KEYBOARD_KEYS = {
  TAB: 'Tab',
  SHIFT_TAB: 'Shift+Tab',
  ENTER: 'Enter',
  SPACE: ' ',
  ESCAPE: 'Escape',
  ARROW_UP: 'ArrowUp',
  ARROW_DOWN: 'ArrowDown',
  ARROW_LEFT: 'ArrowLeft',
  ARROW_RIGHT: 'ArrowRight',
  HOME: 'Home',
  END: 'End',
} as const;

/** Application-level keyboard shortcuts */
export const APP_KEYBOARD_SHORTCUTS: KeyboardShortcut[] = [
  { key: 'Alt+1', description: 'Skip to main content' },
  { key: 'Alt+2', description: 'Go to navigation' },
  { key: 'Alt+3', description: 'Go to search' },
  { key: 'Escape', description: 'Close dialog or menu' },
];

// ─── Screen Reader Announcements ─────────────────────────────────────────────

/** Standard screen reader announcement categories */
export const SR_ANNOUNCEMENTS = {
  PAGE_LOADED: 'page-loaded',
  NAVIGATION_CHANGED: 'navigation-changed',
  FORM_ERROR: 'form-error',
  FORM_SUCCESS: 'form-success',
  LOADING_START: 'loading-start',
  LOADING_COMPLETE: 'loading-complete',
  ALERT: 'alert',
} as const;

export type SRAnnouncement = (typeof SR_ANNOUNCEMENTS)[keyof typeof SR_ANNOUNCEMENTS];

// ─── Contrast Ratios ─────────────────────────────────────────────────────────

/** Minimum WCAG AA contrast ratios */
export const CONTRAST_RATIOS = {
  normalText: 4.5,
  largeText: 3.0,
  uiComponent: 3.0,
} as const;
