/**
 * Hook for accessing and managing current accessibility settings.
 * Provides the active accessibility preferences and methods to update them.
 *
 * Requirements: 13.1, 13.2, 13.3, 13.4, 13.7, 13.9
 */

import { useState, useCallback, useMemo } from 'react';
import {
  TEXT_SIZES,
  LARGE_BUTTON_SIZE,
  DEFAULT_BUTTON_SIZE,
  SIMPLIFIED_NAV_MAX_ITEMS,
  type ButtonSizeConfig,
  type TextSizeConfig,
} from '../config/accessibility';

// ─── Types ───────────────────────────────────────────────────────────────────

export type TextSizePreference = 'normal' | 'large' | 'extra_large';
export type ContrastMode = 'default' | 'high_contrast_light' | 'high_contrast_dark';

export interface AccessibilitySettings {
  /** Current text size preference */
  textSize: TextSizePreference;
  /** Current contrast mode */
  contrastMode: ContrastMode;
  /** Whether voice assistance is enabled */
  voiceAssistance: boolean;
  /** Whether large button mode is active */
  largeButtonMode: boolean;
  /** Whether simplified navigation is active */
  simplifiedNavigation: boolean;
}

export interface AccessibilityState {
  /** Current settings */
  settings: AccessibilitySettings;
  /** Computed text size config based on current preference */
  textSizeConfig: TextSizeConfig;
  /** Computed button size config based on large button mode */
  buttonSizeConfig: ButtonSizeConfig;
  /** Maximum navigation items for current mode */
  maxNavItems: number | null;
  /** Update a single accessibility setting */
  updateSetting: <K extends keyof AccessibilitySettings>(
    key: K,
    value: AccessibilitySettings[K],
  ) => void;
  /** Reset all settings to defaults */
  resetToDefaults: () => void;
}

// ─── Default Settings ────────────────────────────────────────────────────────

export const DEFAULT_ACCESSIBILITY_SETTINGS: AccessibilitySettings = {
  textSize: 'normal',
  contrastMode: 'default',
  voiceAssistance: false,
  largeButtonMode: false,
  simplifiedNavigation: false,
};

// ─── Hook ────────────────────────────────────────────────────────────────────

/**
 * Hook to manage accessibility preferences.
 *
 * @param initialSettings Optional initial settings (defaults to system defaults)
 * @returns Current accessibility state and update methods
 */
export function useAccessibility(
  initialSettings?: Partial<AccessibilitySettings>,
): AccessibilityState {
  const [settings, setSettings] = useState<AccessibilitySettings>({
    ...DEFAULT_ACCESSIBILITY_SETTINGS,
    ...initialSettings,
  });

  const textSizeConfig = useMemo(() => TEXT_SIZES[settings.textSize], [settings.textSize]);

  const buttonSizeConfig = useMemo(
    () => (settings.largeButtonMode ? LARGE_BUTTON_SIZE : DEFAULT_BUTTON_SIZE),
    [settings.largeButtonMode],
  );

  const maxNavItems = useMemo(
    () => (settings.simplifiedNavigation ? SIMPLIFIED_NAV_MAX_ITEMS : null),
    [settings.simplifiedNavigation],
  );

  const updateSetting = useCallback(
    <K extends keyof AccessibilitySettings>(key: K, value: AccessibilitySettings[K]) => {
      setSettings((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  const resetToDefaults = useCallback(() => {
    setSettings(DEFAULT_ACCESSIBILITY_SETTINGS);
  }, []);

  return {
    settings,
    textSizeConfig,
    buttonSizeConfig,
    maxNavItems,
    updateSetting,
    resetToDefaults,
  };
}
