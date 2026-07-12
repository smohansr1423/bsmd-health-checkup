import {
  createAccessibilityEngine,
  defaultTheme,
  highContrastTheme,
  getSystemFontScale,
  resetDefaultEngine,
  getDefaultAccessibilityEngine,
  AccessibilityConfig,
  MobileTheme,
} from './accessibility';

// Mock react-native modules
jest.mock('react-native', () => ({
  AccessibilityInfo: {
    announceForAccessibility: jest.fn(),
  },
  PixelRatio: {
    getFontScale: jest.fn(() => 1.0),
  },
  Platform: {
    OS: 'ios',
  },
}));

describe('AccessibilityEngine', () => {
  describe('createAccessibilityEngine with default config', () => {
    const engine = createAccessibilityEngine({
      highContrastEnabled: false,
      voiceAssistanceEnabled: false,
      textScaleFactor: 1.0,
    });

    it('returns minimum touch target of 48x48dp', () => {
      const target = engine.getMinTouchTarget();
      expect(target.width).toBe(48);
      expect(target.height).toBe(48);
    });

    it('returns body text size of at least 18sp', () => {
      const size = engine.getTextSize('body');
      expect(size).toBeGreaterThanOrEqual(18);
    });

    it('returns heading text size of at least 24sp', () => {
      const size = engine.getTextSize('heading');
      expect(size).toBeGreaterThanOrEqual(24);
    });

    it('returns caption text size of at least 14sp', () => {
      const size = engine.getTextSize('caption');
      expect(size).toBeGreaterThanOrEqual(14);
    });

    it('returns the default theme when high contrast is disabled', () => {
      const theme = engine.getTheme();
      expect(theme.name).toBe('default');
    });

    it('returns voice assistance as disabled', () => {
      expect(engine.isVoiceAssistanceEnabled()).toBe(false);
    });

    it('returns scale factor of 1.0', () => {
      expect(engine.getScaleFactor()).toBe(1.0);
    });
  });

  describe('createAccessibilityEngine with high contrast', () => {
    const engine = createAccessibilityEngine({
      highContrastEnabled: true,
      voiceAssistanceEnabled: true,
      textScaleFactor: 1.5,
    });

    it('returns the high-contrast theme', () => {
      const theme = engine.getTheme();
      expect(theme.name).toBe('high-contrast');
      expect(theme.colors.background).toBe('#000000');
      expect(theme.colors.text).toBe('#FFFFFF');
    });

    it('returns voice assistance as enabled', () => {
      expect(engine.isVoiceAssistanceEnabled()).toBe(true);
    });

    it('applies text scale factor of 1.5', () => {
      expect(engine.getScaleFactor()).toBe(1.5);
    });

    it('scales body text by 1.5x (18 * 1.5 = 27)', () => {
      expect(engine.getTextSize('body')).toBe(27);
    });

    it('scales heading text by 1.5x (24 * 1.5 = 36)', () => {
      expect(engine.getTextSize('heading')).toBe(36);
    });

    it('scales caption text by 1.5x (14 * 1.5 = 21)', () => {
      expect(engine.getTextSize('caption')).toBe(21);
    });
  });

  describe('getScaleFactor clamping', () => {
    it('clamps scale factor below 1.0 to 1.0', () => {
      const engine = createAccessibilityEngine({
        highContrastEnabled: false,
        voiceAssistanceEnabled: false,
        textScaleFactor: 0.5,
      });
      expect(engine.getScaleFactor()).toBe(1.0);
    });

    it('clamps scale factor above 2.0 to 2.0', () => {
      const engine = createAccessibilityEngine({
        highContrastEnabled: false,
        voiceAssistanceEnabled: false,
        textScaleFactor: 3.0,
      });
      expect(engine.getScaleFactor()).toBe(2.0);
    });

    it('supports maximum 200% text scaling', () => {
      const engine = createAccessibilityEngine({
        highContrastEnabled: false,
        voiceAssistanceEnabled: false,
        textScaleFactor: 2.0,
      });
      // body: 18 * 2.0 = 36
      expect(engine.getTextSize('body')).toBe(36);
      // heading: 24 * 2.0 = 48
      expect(engine.getTextSize('heading')).toBe(48);
    });
  });

  describe('announce', () => {
    it('calls AccessibilityInfo.announceForAccessibility', () => {
      const { AccessibilityInfo } = require('react-native');
      const engine = createAccessibilityEngine({
        highContrastEnabled: false,
        voiceAssistanceEnabled: false,
        textScaleFactor: 1.0,
      });

      engine.announce('Test message', 'assertive');
      expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith(
        'Test message'
      );
    });
  });

  describe('high-contrast theme increased border widths', () => {
    it('has thicker borders than default theme', () => {
      expect(highContrastTheme.borderWidth.thin).toBeGreaterThan(
        defaultTheme.borderWidth.thin
      );
      expect(highContrastTheme.borderWidth.medium).toBeGreaterThan(
        defaultTheme.borderWidth.medium
      );
      expect(highContrastTheme.borderWidth.thick).toBeGreaterThan(
        defaultTheme.borderWidth.thick
      );
    });

    it('uses black background and white text', () => {
      expect(highContrastTheme.colors.background).toBe('#000000');
      expect(highContrastTheme.colors.text).toBe('#FFFFFF');
    });
  });

  describe('default theme WCAG compliance', () => {
    it('enforces minimum touch target in theme', () => {
      expect(defaultTheme.touchTarget.minWidth).toBe(48);
      expect(defaultTheme.touchTarget.minHeight).toBe(48);
    });

    it('enforces minimum body text size of 18sp', () => {
      expect(defaultTheme.typography.body).toBeGreaterThanOrEqual(18);
    });

    it('enforces minimum heading text size of 24sp', () => {
      expect(defaultTheme.typography.heading).toBeGreaterThanOrEqual(24);
    });
  });

  describe('getDefaultAccessibilityEngine', () => {
    beforeEach(() => {
      resetDefaultEngine();
    });

    it('returns a singleton engine instance', () => {
      const engine1 = getDefaultAccessibilityEngine();
      const engine2 = getDefaultAccessibilityEngine();
      expect(engine1).toBe(engine2);
    });

    it('resetDefaultEngine clears the singleton', () => {
      const engine1 = getDefaultAccessibilityEngine();
      resetDefaultEngine();
      const engine2 = getDefaultAccessibilityEngine();
      expect(engine1).not.toBe(engine2);
    });
  });
});
