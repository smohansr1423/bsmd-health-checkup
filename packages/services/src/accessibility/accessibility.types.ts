/**
 * Accessibility Service Types
 * Types and interfaces for WCAG 2.1 AA compliance, accessibility settings,
 * keyboard navigation, ARIA configuration, and simplified navigation.
 *
 * Validates: Requirements 13.1, 13.2, 13.3, 13.4, 13.5, 13.7, 13.8, 13.9
 */

import type { AccessibilityPreferences } from '@health-checkup/shared';

/**
 * Text size pixel values.
 * Requirement 13.2: Minimum 16px default, scaling up to 200%.
 */
export type TextSizeOption = 'normal' | 'large' | 'extra_large';

export const TEXT_SIZE_PX: Record<TextSizeOption, number> = {
  normal: 16,
  large: 24,
  extra_large: 32,
};

/**
 * Maximum scale factor for text (200%).
 * Requirement 13.2: Scaling up to 200% without loss of content.
 */
export const MAX_TEXT_SCALE_FACTOR = 2.0;

/**
 * Contrast mode options.
 * Requirement 13.3: High-contrast modes with minimum contrast ratios.
 */
export type ContrastMode = 'default' | 'high_contrast_light' | 'high_contrast_dark';

/**
 * Minimum contrast ratios per WCAG 2.1 AA.
 * Requirement 13.3: 4.5:1 normal text, 3:1 large text.
 * High contrast modes provide enhanced 7:1 ratios.
 */
export interface ContrastRatioConfig {
  normalText: number;
  largeText: number;
}

export const CONTRAST_RATIOS: Record<ContrastMode, ContrastRatioConfig> = {
  default: { normalText: 4.5, largeText: 3 },
  high_contrast_light: { normalText: 7, largeText: 4.5 },
  high_contrast_dark: { normalText: 7, largeText: 4.5 },
};

/**
 * Focus indicator configuration.
 * Requirement 13.4: Visible focus indicators with minimum 2px width.
 */
export interface FocusIndicatorConfig {
  widthPx: number;
  style: 'solid' | 'dashed' | 'dotted';
  color: string;
}

export const DEFAULT_FOCUS_INDICATOR: FocusIndicatorConfig = {
  widthPx: 2,
  style: 'solid',
  color: '#005fcc',
};

/**
 * Large button mode configuration.
 * Requirement 13.7: Min 44x44px targets with 8px spacing.
 */
export interface LargeButtonConfig {
  minWidthPx: number;
  minHeightPx: number;
  spacingPx: number;
}

export const LARGE_BUTTON_CONFIG: LargeButtonConfig = {
  minWidthPx: 44,
  minHeightPx: 44,
  spacingPx: 8,
};

/**
 * ARIA configuration for screen reader support.
 * Requirement 13.5: ARIA labels, roles, and live region announcements.
 */
export interface AriaConfig {
  role: string;
  label: string;
  liveRegion?: 'polite' | 'assertive' | 'off';
  describedBy?: string;
}

/**
 * Keyboard navigation shortcuts.
 * Requirement 13.4: Keyboard-only navigation for all interactive elements.
 */
export interface KeyboardShortcut {
  key: string;
  action: string;
  description: string;
}

export const DEFAULT_KEYBOARD_SHORTCUTS: KeyboardShortcut[] = [
  { key: 'Tab', action: 'focus_next', description: 'Move focus to next interactive element' },
  { key: 'Shift+Tab', action: 'focus_previous', description: 'Move focus to previous interactive element' },
  { key: 'Enter', action: 'activate', description: 'Activate the focused element' },
  { key: 'Space', action: 'activate', description: 'Activate the focused element' },
  { key: 'Escape', action: 'close', description: 'Close the current dialog or menu' },
  { key: 'ArrowDown', action: 'menu_next', description: 'Move to next item in a menu' },
  { key: 'ArrowUp', action: 'menu_previous', description: 'Move to previous item in a menu' },
];

/**
 * Media accessibility configuration.
 * Requirement 13.8: Captions/transcripts for all audio/video.
 */
export interface MediaAccessibilityConfig {
  captionsEnabled: boolean;
  transcriptsEnabled: boolean;
  audioDescriptionsEnabled: boolean;
}

export const DEFAULT_MEDIA_CONFIG: MediaAccessibilityConfig = {
  captionsEnabled: true,
  transcriptsEnabled: true,
  audioDescriptionsEnabled: false,
};

/**
 * Navigation item for simplified navigation.
 * Requirement 13.9: Max 6 top-level items.
 */
export interface NavigationItem {
  id: string;
  label: string;
  icon: string;
  route: string;
  ariaLabel: string;
  isProminent: boolean;
}

/**
 * Simplified navigation configuration.
 * Requirement 13.9: Max 6 top-level items, common actions prominent.
 */
export interface NavigationConfig {
  items: NavigationItem[];
  maxTopLevelItems: number;
}

export const MAX_SIMPLIFIED_NAV_ITEMS = 6;

/**
 * Full accessibility settings combining all WCAG configurations.
 */
export interface AccessibilitySettings {
  preferences: AccessibilityPreferences;
  textSizePx: number;
  scaleFactor: number;
  contrastRatios: ContrastRatioConfig;
  focusIndicator: FocusIndicatorConfig;
  largeButtonConfig: LargeButtonConfig | null;
  keyboardShortcuts: KeyboardShortcut[];
  mediaConfig: MediaAccessibilityConfig;
  ariaConfig: AriaConfig[];
}

/**
 * Repository interface for accessibility settings persistence.
 */
export interface AccessibilitySettingsRepository {
  findByUserId(userId: string): Promise<AccessibilityPreferences | null>;
  save(userId: string, preferences: AccessibilityPreferences): Promise<AccessibilityPreferences>;
  update(userId: string, preferences: AccessibilityPreferences): Promise<AccessibilityPreferences>;
}

/**
 * Dependencies injected into AccessibilityService for testability.
 */
export interface AccessibilityDependencies {
  settingsRepository: AccessibilitySettingsRepository;
}
