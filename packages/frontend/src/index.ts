// @health-checkup/frontend
// React/Next.js accessible UI
// for the Senior Citizen Health Checkup System

// ─── Configuration ───────────────────────────────────────────────────────────
export {
  type Theme,
  type ThemeMode,
  type ThemeColors,
  type ThemeTypography,
  type ThemeSpacing,
  themes,
  defaultTheme,
  highContrastLightTheme,
  highContrastDarkTheme,
  resolveTheme,
} from './config/theme';

export {
  type LocaleConfig,
  localeConfigs,
  isRTLLanguage,
  getTextDirection,
  getSupportedLanguages,
  getLocaleConfig,
  DEFAULT_LANGUAGE,
} from './config/i18n';

export {
  type FocusIndicatorConfig,
  type ButtonSizeConfig,
  type TextSizeConfig,
  type LandmarkConfig,
  type AriaLiveRegion,
  type KeyboardShortcut,
  type SRAnnouncement,
  FOCUS_INDICATOR,
  FOCUS_INDICATOR_CSS,
  LARGE_BUTTON_SIZE,
  DEFAULT_BUTTON_SIZE,
  TEXT_SIZES,
  MAX_TEXT_SCALE,
  SIMPLIFIED_NAV_MAX_ITEMS,
  SIMPLIFIED_NAV_ITEMS,
  LANDMARKS,
  KEYBOARD_KEYS,
  APP_KEYBOARD_SHORTCUTS,
  SR_ANNOUNCEMENTS,
  CONTRAST_RATIOS,
} from './config/accessibility';

// ─── Base Components ─────────────────────────────────────────────────────────
export {
  Button,
  type ButtonProps,
  type ButtonVariant,
  type ButtonSize,
  getButtonStyles,
  getButtonAriaProps,
} from './components/base/Button';

export {
  FormField,
  type FormFieldProps,
  type FormFieldType,
  getFormFieldAriaProps,
  getFieldFocusStyles,
} from './components/base/FormField';

export {
  Navigation,
  type NavigationProps,
  type NavigationItem,
  getVisibleItems,
  handleNavKeyDown,
} from './components/base/Navigation';

export { SkipLink, type SkipLinkProps } from './components/base/SkipLink';

// ─── Layout Components ───────────────────────────────────────────────────────
export { AppLayout, type AppLayoutProps } from './components/layout/AppLayout';

// ─── Hooks ───────────────────────────────────────────────────────────────────
export {
  useTheme,
  contrastModeToThemeMode,
  type ThemeState,
} from './hooks/useTheme';

export {
  useAccessibility,
  DEFAULT_ACCESSIBILITY_SETTINGS,
  type AccessibilitySettings,
  type AccessibilityState,
  type TextSizePreference,
  type ContrastMode,
} from './hooks/useAccessibility';

// ─── Pages ───────────────────────────────────────────────────────────────────
export * from './pages/registration';
