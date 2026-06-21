/**
 * Accessibility Service
 * Manages WCAG 2.1 AA compliance, accessibility settings, keyboard navigation,
 * ARIA configuration, large button mode, media accessibility, and simplified navigation.
 *
 * Validates: Requirements 13.1, 13.2, 13.3, 13.4, 13.5, 13.7, 13.8, 13.9
 */

import type { AccessibilityPreferences } from '@health-checkup/shared';
import type {
  AccessibilitySettings,
  AccessibilitySettingsRepository,
  AccessibilityDependencies,
  NavigationConfig,
  NavigationItem,
  ContrastRatioConfig,
  FocusIndicatorConfig,
  LargeButtonConfig,
  KeyboardShortcut,
  MediaAccessibilityConfig,
  AriaConfig,
} from './accessibility.types';
import {
  TEXT_SIZE_PX,
  MAX_TEXT_SCALE_FACTOR,
  CONTRAST_RATIOS,
  DEFAULT_FOCUS_INDICATOR,
  LARGE_BUTTON_CONFIG,
  DEFAULT_KEYBOARD_SHORTCUTS,
  DEFAULT_MEDIA_CONFIG,
  MAX_SIMPLIFIED_NAV_ITEMS,
} from './accessibility.types';

/**
 * Default accessibility preferences for new users.
 * Requirement 13.2: Minimum 16px default font.
 */
const DEFAULT_PREFERENCES: AccessibilityPreferences = {
  textSize: 'normal',
  contrastMode: 'default',
  voiceAssistance: false,
  largeButtonMode: false,
  simplifiedNavigation: false,
};

/**
 * Default ARIA configurations for common UI components.
 * Requirement 13.5: ARIA labels, roles, and live region announcements.
 */
const DEFAULT_ARIA_CONFIG: AriaConfig[] = [
  { role: 'navigation', label: 'Main navigation', liveRegion: 'off' },
  { role: 'main', label: 'Main content', liveRegion: 'off' },
  { role: 'alert', label: 'Alert notification', liveRegion: 'assertive' },
  { role: 'status', label: 'Status update', liveRegion: 'polite' },
  { role: 'form', label: 'Data entry form', liveRegion: 'off' },
  { role: 'dialog', label: 'Dialog window', liveRegion: 'assertive' },
];

/**
 * Simplified navigation items.
 * Requirement 13.9: Max 6 items, common actions (appointments, reports, notifications) prominent.
 */
const SIMPLIFIED_NAV_ITEMS: NavigationItem[] = [
  { id: 'home', label: 'Home', icon: 'home', route: '/', ariaLabel: 'Go to home page', isProminent: false },
  { id: 'appointments', label: 'Appointments', icon: 'calendar', route: '/appointments', ariaLabel: 'View and manage appointments', isProminent: true },
  { id: 'reports', label: 'Reports', icon: 'file-text', route: '/reports', ariaLabel: 'View health reports', isProminent: true },
  { id: 'notifications', label: 'Notifications', icon: 'bell', route: '/notifications', ariaLabel: 'View notifications', isProminent: true },
  { id: 'profile', label: 'Profile', icon: 'user', route: '/profile', ariaLabel: 'View and edit profile', isProminent: false },
  { id: 'help', label: 'Help', icon: 'help-circle', route: '/help', ariaLabel: 'Get help and support', isProminent: false },
];

/**
 * In-memory implementation of AccessibilitySettingsRepository.
 */
export class InMemoryAccessibilitySettingsRepository implements AccessibilitySettingsRepository {
  private settings: Map<string, AccessibilityPreferences> = new Map();

  async findByUserId(userId: string): Promise<AccessibilityPreferences | null> {
    return this.settings.get(userId) ?? null;
  }

  async save(userId: string, preferences: AccessibilityPreferences): Promise<AccessibilityPreferences> {
    this.settings.set(userId, preferences);
    return preferences;
  }

  async update(userId: string, preferences: AccessibilityPreferences): Promise<AccessibilityPreferences> {
    this.settings.set(userId, preferences);
    return preferences;
  }

  clear(): void {
    this.settings.clear();
  }
}

/**
 * AccessibilityService implementation.
 *
 * Provides:
 * - getAccessibilitySettings: Returns full WCAG-compliant settings for a user
 * - updateAccessibilitySettings: Persists updated accessibility preferences
 * - getSimplifiedNavigation: Returns navigation config with ≤6 top-level items
 *
 * Business rules:
 * - Text sizes: normal=16px, large=24px, extra_large=32px (Req 13.2)
 * - All text scales to 200% without loss (Req 13.2)
 * - Contrast: default ≥4.5:1/3:1, high contrast ≥7:1/4.5:1 (Req 13.3)
 * - Focus indicators: 2px solid border on all focusable elements (Req 13.4)
 * - ARIA: roles, labels, live regions for all dynamic content (Req 13.5)
 * - Large button mode: 44x44px min, 8px spacing (Req 13.7)
 * - Captions/transcripts for all audio/video (Req 13.8)
 * - Simplified nav: ≤6 top-level items, prominent common actions (Req 13.9)
 */
export class AccessibilityService {
  private readonly settingsRepository: AccessibilitySettingsRepository;

  constructor(deps?: Partial<AccessibilityDependencies>) {
    this.settingsRepository = deps?.settingsRepository ?? new InMemoryAccessibilitySettingsRepository();
  }

  /**
   * Get full accessibility settings for a user.
   *
   * Requirement 13.1: WCAG 2.1 Level AA compliance configuration.
   * Requirement 13.2: Text size with scaling support.
   * Requirement 13.3: Contrast ratio configuration.
   * Requirement 13.4: Keyboard navigation and focus indicators.
   * Requirement 13.5: ARIA configuration.
   * Requirement 13.7: Large button mode when enabled.
   * Requirement 13.8: Media accessibility configuration.
   */
  async getAccessibilitySettings(userId: string): Promise<AccessibilitySettings> {
    const preferences = await this.getOrCreateDefaultPreferences(userId);
    return this.buildAccessibilitySettings(preferences);
  }

  /**
   * Update accessibility settings for a user.
   *
   * Validates and persists the new preferences, then returns
   * the full computed settings.
   */
  async updateAccessibilitySettings(
    userId: string,
    settings: AccessibilitySettings,
  ): Promise<void> {
    const preferences = settings.preferences;
    this.validatePreferences(preferences);

    const existing = await this.settingsRepository.findByUserId(userId);
    if (existing) {
      await this.settingsRepository.update(userId, preferences);
    } else {
      await this.settingsRepository.save(userId, preferences);
    }
  }

  /**
   * Get simplified navigation configuration.
   *
   * Requirement 13.9: Max 6 top-level items with prominent common actions
   * (appointments, reports, notifications).
   */
  getSimplifiedNavigation(): NavigationConfig {
    return {
      items: SIMPLIFIED_NAV_ITEMS.slice(0, MAX_SIMPLIFIED_NAV_ITEMS),
      maxTopLevelItems: MAX_SIMPLIFIED_NAV_ITEMS,
    };
  }

  /**
   * Compute the text size in pixels for a given text size preference.
   * Requirement 13.2: normal=16px, large=24px, extra_large=32px.
   */
  getTextSizePx(textSize: AccessibilityPreferences['textSize']): number {
    return TEXT_SIZE_PX[textSize];
  }

  /**
   * Get the maximum scaled text size for a given base size.
   * Requirement 13.2: Scaling up to 200%.
   */
  getMaxScaledSize(baseSizePx: number): number {
    return baseSizePx * MAX_TEXT_SCALE_FACTOR;
  }

  /**
   * Get contrast ratio requirements for a given mode.
   * Requirement 13.3: Minimum ratios per mode.
   */
  getContrastRatios(mode: AccessibilityPreferences['contrastMode']): ContrastRatioConfig {
    return CONTRAST_RATIOS[mode];
  }

  /**
   * Get focus indicator configuration.
   * Requirement 13.4: 2px solid border on all focusable elements.
   */
  getFocusIndicator(): FocusIndicatorConfig {
    return { ...DEFAULT_FOCUS_INDICATOR };
  }

  /**
   * Get large button mode configuration.
   * Requirement 13.7: Min 44x44px with 8px spacing.
   */
  getLargeButtonConfig(): LargeButtonConfig {
    return { ...LARGE_BUTTON_CONFIG };
  }

  /**
   * Get keyboard shortcuts.
   * Requirement 13.4: Tab navigation, Escape to close, Enter to activate.
   */
  getKeyboardShortcuts(): KeyboardShortcut[] {
    return [...DEFAULT_KEYBOARD_SHORTCUTS];
  }

  /**
   * Get media accessibility configuration.
   * Requirement 13.8: Captions and transcripts for all audio/video.
   */
  getMediaConfig(): MediaAccessibilityConfig {
    return { ...DEFAULT_MEDIA_CONFIG };
  }

  /**
   * Get ARIA configuration for UI components.
   * Requirement 13.5: Roles, labels, and live region announcement types.
   */
  getAriaConfig(): AriaConfig[] {
    return [...DEFAULT_ARIA_CONFIG];
  }

  /**
   * Validate that a contrast ratio meets WCAG requirements for a given mode.
   * Returns true if the ratio meets or exceeds the required minimum.
   */
  validateContrastRatio(
    ratio: number,
    textType: 'normal' | 'large',
    mode: AccessibilityPreferences['contrastMode'],
  ): boolean {
    const requirements = CONTRAST_RATIOS[mode];
    const minimumRatio = textType === 'normal' ? requirements.normalText : requirements.largeText;
    return ratio >= minimumRatio;
  }

  /**
   * Validate that a touch target meets large button mode requirements.
   * Requirement 13.7: Min 44x44px.
   */
  validateTouchTarget(widthPx: number, heightPx: number): boolean {
    return widthPx >= LARGE_BUTTON_CONFIG.minWidthPx && heightPx >= LARGE_BUTTON_CONFIG.minHeightPx;
  }

  /**
   * Validate that spacing between interactive elements meets requirements.
   * Requirement 13.7: Min 8px spacing.
   */
  validateElementSpacing(spacingPx: number): boolean {
    return spacingPx >= LARGE_BUTTON_CONFIG.spacingPx;
  }

  // --- Private Methods ---

  /**
   * Get or create default preferences for a user.
   */
  private async getOrCreateDefaultPreferences(userId: string): Promise<AccessibilityPreferences> {
    const existing = await this.settingsRepository.findByUserId(userId);
    if (existing) {
      return existing;
    }

    const defaults = { ...DEFAULT_PREFERENCES };
    await this.settingsRepository.save(userId, defaults);
    return defaults;
  }

  /**
   * Build full accessibility settings from user preferences.
   */
  private buildAccessibilitySettings(preferences: AccessibilityPreferences): AccessibilitySettings {
    const textSizePx = TEXT_SIZE_PX[preferences.textSize];
    const contrastRatios = CONTRAST_RATIOS[preferences.contrastMode];
    const largeButtonConfig = preferences.largeButtonMode ? LARGE_BUTTON_CONFIG : null;

    return {
      preferences,
      textSizePx,
      scaleFactor: MAX_TEXT_SCALE_FACTOR,
      contrastRatios,
      focusIndicator: { ...DEFAULT_FOCUS_INDICATOR },
      largeButtonConfig,
      keyboardShortcuts: [...DEFAULT_KEYBOARD_SHORTCUTS],
      mediaConfig: { ...DEFAULT_MEDIA_CONFIG },
      ariaConfig: [...DEFAULT_ARIA_CONFIG],
    };
  }

  /**
   * Validate accessibility preferences are within acceptable bounds.
   */
  private validatePreferences(preferences: AccessibilityPreferences): void {
    const validTextSizes: AccessibilityPreferences['textSize'][] = ['normal', 'large', 'extra_large'];
    const validContrastModes: AccessibilityPreferences['contrastMode'][] = [
      'default',
      'high_contrast_light',
      'high_contrast_dark',
    ];

    if (!validTextSizes.includes(preferences.textSize)) {
      throw new Error(`Invalid text size: ${preferences.textSize}. Must be one of: ${validTextSizes.join(', ')}`);
    }

    if (!validContrastModes.includes(preferences.contrastMode)) {
      throw new Error(
        `Invalid contrast mode: ${preferences.contrastMode}. Must be one of: ${validContrastModes.join(', ')}`,
      );
    }
  }
}
