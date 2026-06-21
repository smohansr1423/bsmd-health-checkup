/**
 * Hook for theme switching in the Senior Citizen Health Checkup System.
 * Maps accessibility contrast mode preferences to theme objects.
 *
 * Requirements: 13.3
 */

import { useState, useCallback, useMemo } from 'react';
import { type Theme, type ThemeMode, themes, resolveTheme } from '../config/theme';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ThemeState {
  /** The currently active theme */
  theme: Theme;
  /** The current theme mode identifier */
  mode: ThemeMode;
  /** Switch to a specific theme mode */
  setThemeMode: (mode: ThemeMode) => void;
  /** All available theme modes */
  availableModes: ThemeMode[];
  /** Check if current theme is high contrast */
  isHighContrast: boolean;
}

// ─── Hook ────────────────────────────────────────────────────────────────────

/**
 * Hook to manage theme state and switching.
 *
 * @param initialMode Optional initial theme mode (defaults to 'default')
 * @returns Theme state with the active theme and switching function
 */
export function useTheme(initialMode: ThemeMode = 'default'): ThemeState {
  const [mode, setMode] = useState<ThemeMode>(initialMode);

  const theme = useMemo(() => themes[mode], [mode]);

  const setThemeMode = useCallback((newMode: ThemeMode) => {
    setMode(newMode);
  }, []);

  const availableModes: ThemeMode[] = ['default', 'high-contrast-light', 'high-contrast-dark'];

  const isHighContrast = mode !== 'default';

  return {
    theme,
    mode,
    setThemeMode,
    availableModes,
    isHighContrast,
  };
}

/**
 * Convert accessibility preferences contrastMode to ThemeMode.
 */
export function contrastModeToThemeMode(
  contrastMode: 'default' | 'high_contrast_light' | 'high_contrast_dark',
): ThemeMode {
  const mapping: Record<string, ThemeMode> = {
    default: 'default',
    high_contrast_light: 'high-contrast-light',
    high_contrast_dark: 'high-contrast-dark',
  };
  return mapping[contrastMode] ?? 'default';
}

export { resolveTheme };
