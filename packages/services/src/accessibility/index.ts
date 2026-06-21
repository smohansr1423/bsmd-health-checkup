/**
 * Accessibility Service barrel export
 */
export {
  AccessibilityService,
  InMemoryAccessibilitySettingsRepository,
} from './accessibility.service';
export type {
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
  TextSizeOption,
  ContrastMode,
} from './accessibility.types';
export {
  TEXT_SIZE_PX,
  MAX_TEXT_SCALE_FACTOR,
  CONTRAST_RATIOS,
  DEFAULT_FOCUS_INDICATOR,
  LARGE_BUTTON_CONFIG,
  DEFAULT_KEYBOARD_SHORTCUTS,
  DEFAULT_MEDIA_CONFIG,
  MAX_SIMPLIFIED_NAV_ITEMS,
} from './accessibility.types';

// Voice Assistance
export { VoiceAssistanceService } from './voice-assistance';
export type {
  VoiceCommandResult,
  VoiceCommand,
  VoiceAction,
  VoiceCommandName,
  AudioFeedback,
  PlaybackState,
  PageContext,
  ErrorContext,
} from './voice-assistance';
export {
  SUPPORTED_VOICE_COMMANDS,
  MAX_RESPONSE_TIME_MS,
  MAX_PAUSE_LATENCY_MS,
  SILENCE_THRESHOLD_MS,
  UNRECOGNIZED_COMMAND_TIMEOUT_MS,
} from './voice-assistance';
