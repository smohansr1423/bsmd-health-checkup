/**
 * Accessibility Preferences interface
 */

export interface AccessibilityPreferences {
  textSize: 'normal' | 'large' | 'extra_large';
  contrastMode: 'default' | 'high_contrast_light' | 'high_contrast_dark';
  voiceAssistance: boolean;
  largeButtonMode: boolean;
  simplifiedNavigation: boolean;
}
