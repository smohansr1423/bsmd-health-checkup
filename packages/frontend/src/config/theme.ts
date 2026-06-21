/**
 * Theme definitions for the Senior Citizen Health Checkup System.
 * Provides 3 theme modes: default, high-contrast-light, high-contrast-dark.
 * All themes comply with WCAG 2.1 AA contrast ratios (4.5:1 normal text, 3:1 large text).
 *
 * Requirements: 13.3
 */

export type ThemeMode = 'default' | 'high-contrast-light' | 'high-contrast-dark';

export interface ThemeColors {
  /** Primary background */
  background: string;
  /** Primary foreground / text */
  foreground: string;
  /** Primary action color */
  primary: string;
  /** Primary action text */
  primaryForeground: string;
  /** Secondary/muted backgrounds */
  secondary: string;
  /** Secondary text */
  secondaryForeground: string;
  /** Destructive/error color */
  destructive: string;
  /** Destructive action text */
  destructiveForeground: string;
  /** Success indicator */
  success: string;
  /** Warning indicator */
  warning: string;
  /** Border color */
  border: string;
  /** Focus ring color */
  focusRing: string;
  /** Muted background for surfaces */
  muted: string;
  /** Muted foreground text */
  mutedForeground: string;
}

export interface ThemeTypography {
  /** Base font size in px (minimum 16px per requirement 13.2) */
  baseFontSize: number;
  /** Font family stack */
  fontFamily: string;
  /** Line height multiplier */
  lineHeight: number;
  /** Heading scale factor */
  headingScale: number;
}

export interface ThemeSpacing {
  /** Base spacing unit in px */
  unit: number;
  /** Minimum interactive element spacing in px */
  interactiveSpacing: number;
}

export interface Theme {
  mode: ThemeMode;
  colors: ThemeColors;
  typography: ThemeTypography;
  spacing: ThemeSpacing;
  /** Minimum contrast ratio for normal text */
  contrastRatioNormal: number;
  /** Minimum contrast ratio for large text */
  contrastRatioLarge: number;
}

const baseTypography: ThemeTypography = {
  baseFontSize: 16,
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  lineHeight: 1.5,
  headingScale: 1.25,
};

const baseSpacing: ThemeSpacing = {
  unit: 8,
  interactiveSpacing: 8,
};

export const defaultTheme: Theme = {
  mode: 'default',
  colors: {
    background: '#ffffff',
    foreground: '#1a1a2e',
    primary: '#0056b3',
    primaryForeground: '#ffffff',
    secondary: '#f0f4f8',
    secondaryForeground: '#2d3748',
    destructive: '#c53030',
    destructiveForeground: '#ffffff',
    success: '#2f855a',
    warning: '#c05621',
    border: '#cbd5e0',
    focusRing: '#0056b3',
    muted: '#f7fafc',
    mutedForeground: '#4a5568',
  },
  typography: baseTypography,
  spacing: baseSpacing,
  contrastRatioNormal: 4.5,
  contrastRatioLarge: 3,
};

export const highContrastLightTheme: Theme = {
  mode: 'high-contrast-light',
  colors: {
    background: '#ffffff',
    foreground: '#000000',
    primary: '#00008b',
    primaryForeground: '#ffffff',
    secondary: '#f5f5f5',
    secondaryForeground: '#000000',
    destructive: '#8b0000',
    destructiveForeground: '#ffffff',
    success: '#006400',
    warning: '#8b4513',
    border: '#000000',
    focusRing: '#000000',
    muted: '#f0f0f0',
    mutedForeground: '#1a1a1a',
  },
  typography: baseTypography,
  spacing: baseSpacing,
  contrastRatioNormal: 7,
  contrastRatioLarge: 4.5,
};

export const highContrastDarkTheme: Theme = {
  mode: 'high-contrast-dark',
  colors: {
    background: '#000000',
    foreground: '#ffffff',
    primary: '#6db3f8',
    primaryForeground: '#000000',
    secondary: '#1a1a1a',
    secondaryForeground: '#ffffff',
    destructive: '#ff6b6b',
    destructiveForeground: '#000000',
    success: '#68d391',
    warning: '#fbd38d',
    border: '#ffffff',
    focusRing: '#ffffff',
    muted: '#1a1a1a',
    mutedForeground: '#e2e8f0',
  },
  typography: baseTypography,
  spacing: baseSpacing,
  contrastRatioNormal: 7,
  contrastRatioLarge: 4.5,
};

/** All available themes indexed by mode */
export const themes: Record<ThemeMode, Theme> = {
  default: defaultTheme,
  'high-contrast-light': highContrastLightTheme,
  'high-contrast-dark': highContrastDarkTheme,
};

/**
 * Resolve theme from AccessibilityPreferences contrastMode value.
 */
export function resolveTheme(
  contrastMode: 'default' | 'high_contrast_light' | 'high_contrast_dark',
): Theme {
  const modeMap: Record<string, ThemeMode> = {
    default: 'default',
    high_contrast_light: 'high-contrast-light',
    high_contrast_dark: 'high-contrast-dark',
  };
  return themes[modeMap[contrastMode] ?? 'default'];
}
