import { useCallback, useEffect, useMemo, useState } from 'react';
import { AccessibilityInfo, PixelRatio } from 'react-native';
import {
  AccessibilityConfig,
  AccessibilityEngine,
  MobileTheme,
  createAccessibilityEngine,
  getSystemFontScale,
} from '../utils/accessibility';

// ─── Accessibility Store (simple module-level state) ─────────────────────────

let accessibilityConfig: AccessibilityConfig = {
  highContrastEnabled: false,
  voiceAssistanceEnabled: false,
  textScaleFactor: getSystemFontScale(),
};

type ConfigListener = (config: AccessibilityConfig) => void;
const listeners: Set<ConfigListener> = new Set();

function notifyListeners(): void {
  listeners.forEach((listener) => listener(accessibilityConfig));
}

/**
 * Updates the accessibility configuration globally.
 * All useAccessibility hooks will re-render with the new config.
 */
export function updateAccessibilityConfig(
  updates: Partial<AccessibilityConfig>
): void {
  accessibilityConfig = { ...accessibilityConfig, ...updates };
  notifyListeners();
}

/**
 * Returns the current accessibility configuration (non-reactive).
 */
export function getAccessibilityConfig(): AccessibilityConfig {
  return { ...accessibilityConfig };
}

// ─── Hook Return Type ────────────────────────────────────────────────────────

export interface UseAccessibilityResult {
  /** The current AccessibilityEngine instance */
  engine: AccessibilityEngine;
  /** The current theme (default or high-contrast) */
  theme: MobileTheme;
  /** Current text scale factor (1.0 to 2.0) */
  scaleFactor: number;
  /** Whether high-contrast theme is active */
  isHighContrast: boolean;
  /** Whether voice assistance is enabled */
  isVoiceAssistanceEnabled: boolean;
  /** Whether a screen reader is currently active */
  isScreenReaderActive: boolean;
  /** Toggle high-contrast theme */
  toggleHighContrast: () => void;
  /** Toggle voice assistance */
  toggleVoiceAssistance: () => void;
  /** Set text scale factor (clamped to 1.0-2.0) */
  setTextScaleFactor: (factor: number) => void;
  /** Announce a message to screen readers */
  announce: (message: string, priority: 'polite' | 'assertive') => void;
  /** Get the minimum touch target dimensions */
  minTouchTarget: { width: number; height: number };
  /** Get scaled text size for a variant */
  getTextSize: (variant: 'body' | 'heading' | 'caption') => number;
}

// ─── useAccessibility Hook ───────────────────────────────────────────────────

/**
 * Hook that provides reactive access to accessibility settings and the
 * AccessibilityEngine. Automatically responds to:
 * - Configuration changes (theme toggle, voice assistance, text scale)
 * - System font scale changes
 * - Screen reader activation/deactivation
 */
export function useAccessibility(): UseAccessibilityResult {
  const [config, setConfig] = useState<AccessibilityConfig>(accessibilityConfig);
  const [isScreenReaderActive, setIsScreenReaderActive] = useState(false);

  // Subscribe to config changes
  useEffect(() => {
    const listener: ConfigListener = (newConfig) => {
      setConfig({ ...newConfig });
    };
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  // Listen for screen reader status changes
  useEffect(() => {
    const checkScreenReader = async () => {
      const enabled = await AccessibilityInfo.isScreenReaderEnabled();
      setIsScreenReaderActive(enabled);
    };

    checkScreenReader();

    const subscription = AccessibilityInfo.addEventListener(
      'screenReaderChanged',
      (enabled: boolean) => {
        setIsScreenReaderActive(enabled);
      }
    );

    return () => {
      subscription.remove();
    };
  }, []);

  // Listen for system font scale changes (when user changes OS text size)
  useEffect(() => {
    // Poll font scale on mount - PixelRatio doesn't have change events
    const systemScale = getSystemFontScale();
    if (systemScale !== config.textScaleFactor) {
      updateAccessibilityConfig({ textScaleFactor: systemScale });
    }
  }, []);

  // Create the engine based on current config
  const engine = useMemo(() => createAccessibilityEngine(config), [config]);
  const theme = useMemo(() => engine.getTheme(), [engine]);

  const toggleHighContrast = useCallback(() => {
    updateAccessibilityConfig({
      highContrastEnabled: !accessibilityConfig.highContrastEnabled,
    });
  }, []);

  const toggleVoiceAssistance = useCallback(() => {
    updateAccessibilityConfig({
      voiceAssistanceEnabled: !accessibilityConfig.voiceAssistanceEnabled,
    });
  }, []);

  const setTextScaleFactor = useCallback((factor: number) => {
    const clamped = Math.min(Math.max(factor, 1.0), 2.0);
    updateAccessibilityConfig({ textScaleFactor: clamped });
  }, []);

  const announce = useCallback(
    (message: string, priority: 'polite' | 'assertive') => {
      engine.announce(message, priority);
    },
    [engine]
  );

  const minTouchTarget = useMemo(() => engine.getMinTouchTarget(), [engine]);

  const getTextSize = useCallback(
    (variant: 'body' | 'heading' | 'caption') => engine.getTextSize(variant),
    [engine]
  );

  return {
    engine,
    theme,
    scaleFactor: engine.getScaleFactor(),
    isHighContrast: config.highContrastEnabled,
    isVoiceAssistanceEnabled: config.voiceAssistanceEnabled,
    isScreenReaderActive,
    toggleHighContrast,
    toggleVoiceAssistance,
    setTextScaleFactor,
    announce,
    minTouchTarget,
    getTextSize,
  };
}
