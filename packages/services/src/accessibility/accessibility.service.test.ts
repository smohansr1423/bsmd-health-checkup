/**
 * Accessibility Service - Unit Tests
 * Validates: Requirements 13.1, 13.2, 13.3, 13.4, 13.5, 13.7, 13.8, 13.9
 */

import {
  AccessibilityService,
  InMemoryAccessibilitySettingsRepository,
} from './accessibility.service';
import type {
  AccessibilitySettings,
  AccessibilityDependencies,
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
import type { AccessibilityPreferences } from '@health-checkup/shared';

// --- Test Helpers ---

function createService(overrides?: Partial<AccessibilityDependencies>): {
  service: AccessibilityService;
  settingsRepo: InMemoryAccessibilitySettingsRepository;
} {
  const settingsRepo = new InMemoryAccessibilitySettingsRepository();
  const deps: AccessibilityDependencies = {
    settingsRepository: settingsRepo,
    ...overrides,
  };
  const service = new AccessibilityService(deps);
  return { service, settingsRepo };
}

function createPreferences(overrides?: Partial<AccessibilityPreferences>): AccessibilityPreferences {
  return {
    textSize: 'normal',
    contrastMode: 'default',
    voiceAssistance: false,
    largeButtonMode: false,
    simplifiedNavigation: false,
    ...overrides,
  };
}

// --- Tests ---

describe('AccessibilityService', () => {
  describe('getAccessibilitySettings', () => {
    it('should return default settings for a new user', async () => {
      const { service } = createService();

      const settings = await service.getAccessibilitySettings('user-1');

      expect(settings.preferences.textSize).toBe('normal');
      expect(settings.preferences.contrastMode).toBe('default');
      expect(settings.preferences.voiceAssistance).toBe(false);
      expect(settings.preferences.largeButtonMode).toBe(false);
      expect(settings.preferences.simplifiedNavigation).toBe(false);
    });

    it('should return 16px text size for normal preference (Req 13.2)', async () => {
      const { service } = createService();

      const settings = await service.getAccessibilitySettings('user-1');

      expect(settings.textSizePx).toBe(16);
    });

    it('should return 24px text size for large preference (Req 13.2)', async () => {
      const { service, settingsRepo } = createService();
      await settingsRepo.save('user-1', createPreferences({ textSize: 'large' }));

      const settings = await service.getAccessibilitySettings('user-1');

      expect(settings.textSizePx).toBe(24);
    });

    it('should return 32px text size for extra_large preference (Req 13.2)', async () => {
      const { service, settingsRepo } = createService();
      await settingsRepo.save('user-1', createPreferences({ textSize: 'extra_large' }));

      const settings = await service.getAccessibilitySettings('user-1');

      expect(settings.textSizePx).toBe(32);
    });

    it('should include scale factor of 2.0 for 200% scaling (Req 13.2)', async () => {
      const { service } = createService();

      const settings = await service.getAccessibilitySettings('user-1');

      expect(settings.scaleFactor).toBe(2.0);
    });

    it('should return default contrast ratios of 4.5:1 normal / 3:1 large (Req 13.3)', async () => {
      const { service } = createService();

      const settings = await service.getAccessibilitySettings('user-1');

      expect(settings.contrastRatios.normalText).toBe(4.5);
      expect(settings.contrastRatios.largeText).toBe(3);
    });

    it('should return high contrast ratios of 7:1 / 4.5:1 for high_contrast_light (Req 13.3)', async () => {
      const { service, settingsRepo } = createService();
      await settingsRepo.save('user-1', createPreferences({ contrastMode: 'high_contrast_light' }));

      const settings = await service.getAccessibilitySettings('user-1');

      expect(settings.contrastRatios.normalText).toBe(7);
      expect(settings.contrastRatios.largeText).toBe(4.5);
    });

    it('should return high contrast ratios of 7:1 / 4.5:1 for high_contrast_dark (Req 13.3)', async () => {
      const { service, settingsRepo } = createService();
      await settingsRepo.save('user-1', createPreferences({ contrastMode: 'high_contrast_dark' }));

      const settings = await service.getAccessibilitySettings('user-1');

      expect(settings.contrastRatios.normalText).toBe(7);
      expect(settings.contrastRatios.largeText).toBe(4.5);
    });

    it('should include 2px focus indicator configuration (Req 13.4)', async () => {
      const { service } = createService();

      const settings = await service.getAccessibilitySettings('user-1');

      expect(settings.focusIndicator.widthPx).toBe(2);
      expect(settings.focusIndicator.style).toBe('solid');
    });

    it('should include keyboard shortcuts for Tab, Enter, Escape (Req 13.4)', async () => {
      const { service } = createService();

      const settings = await service.getAccessibilitySettings('user-1');

      const actions = settings.keyboardShortcuts.map((s) => s.action);
      expect(actions).toContain('focus_next');
      expect(actions).toContain('activate');
      expect(actions).toContain('close');
    });

    it('should include ARIA config with roles and live regions (Req 13.5)', async () => {
      const { service } = createService();

      const settings = await service.getAccessibilitySettings('user-1');

      expect(settings.ariaConfig.length).toBeGreaterThan(0);
      const roles = settings.ariaConfig.map((a) => a.role);
      expect(roles).toContain('navigation');
      expect(roles).toContain('main');
      expect(roles).toContain('alert');
      expect(roles).toContain('status');
    });

    it('should include live region announcements in ARIA config (Req 13.5)', async () => {
      const { service } = createService();

      const settings = await service.getAccessibilitySettings('user-1');

      const alertConfig = settings.ariaConfig.find((a) => a.role === 'alert');
      expect(alertConfig?.liveRegion).toBe('assertive');
      const statusConfig = settings.ariaConfig.find((a) => a.role === 'status');
      expect(statusConfig?.liveRegion).toBe('polite');
    });

    it('should not include large button config when mode is disabled (Req 13.7)', async () => {
      const { service } = createService();

      const settings = await service.getAccessibilitySettings('user-1');

      expect(settings.largeButtonConfig).toBeNull();
    });

    it('should include large button config with 44x44px and 8px spacing when enabled (Req 13.7)', async () => {
      const { service, settingsRepo } = createService();
      await settingsRepo.save('user-1', createPreferences({ largeButtonMode: true }));

      const settings = await service.getAccessibilitySettings('user-1');

      expect(settings.largeButtonConfig).not.toBeNull();
      expect(settings.largeButtonConfig!.minWidthPx).toBe(44);
      expect(settings.largeButtonConfig!.minHeightPx).toBe(44);
      expect(settings.largeButtonConfig!.spacingPx).toBe(8);
    });

    it('should include media config with captions and transcripts enabled (Req 13.8)', async () => {
      const { service } = createService();

      const settings = await service.getAccessibilitySettings('user-1');

      expect(settings.mediaConfig.captionsEnabled).toBe(true);
      expect(settings.mediaConfig.transcriptsEnabled).toBe(true);
    });

    it('should persist default preferences for new user', async () => {
      const { service, settingsRepo } = createService();

      await service.getAccessibilitySettings('user-1');

      const stored = await settingsRepo.findByUserId('user-1');
      expect(stored).not.toBeNull();
      expect(stored!.textSize).toBe('normal');
    });
  });

  describe('updateAccessibilitySettings', () => {
    it('should save new preferences for a user', async () => {
      const { service, settingsRepo } = createService();
      const preferences = createPreferences({ textSize: 'large', largeButtonMode: true });
      const settings: AccessibilitySettings = {
        preferences,
        textSizePx: 24,
        scaleFactor: 2.0,
        contrastRatios: CONTRAST_RATIOS.default,
        focusIndicator: DEFAULT_FOCUS_INDICATOR,
        largeButtonConfig: LARGE_BUTTON_CONFIG,
        keyboardShortcuts: DEFAULT_KEYBOARD_SHORTCUTS,
        mediaConfig: DEFAULT_MEDIA_CONFIG,
        ariaConfig: [],
      };

      await service.updateAccessibilitySettings('user-1', settings);

      const stored = await settingsRepo.findByUserId('user-1');
      expect(stored).not.toBeNull();
      expect(stored!.textSize).toBe('large');
      expect(stored!.largeButtonMode).toBe(true);
    });

    it('should update existing preferences for a user', async () => {
      const { service, settingsRepo } = createService();
      await settingsRepo.save('user-1', createPreferences({ textSize: 'normal' }));

      const updatedPrefs = createPreferences({ textSize: 'extra_large', contrastMode: 'high_contrast_dark' });
      const settings: AccessibilitySettings = {
        preferences: updatedPrefs,
        textSizePx: 32,
        scaleFactor: 2.0,
        contrastRatios: CONTRAST_RATIOS.high_contrast_dark,
        focusIndicator: DEFAULT_FOCUS_INDICATOR,
        largeButtonConfig: null,
        keyboardShortcuts: DEFAULT_KEYBOARD_SHORTCUTS,
        mediaConfig: DEFAULT_MEDIA_CONFIG,
        ariaConfig: [],
      };

      await service.updateAccessibilitySettings('user-1', settings);

      const stored = await settingsRepo.findByUserId('user-1');
      expect(stored!.textSize).toBe('extra_large');
      expect(stored!.contrastMode).toBe('high_contrast_dark');
    });
  });

  describe('getSimplifiedNavigation', () => {
    it('should return max 6 top-level navigation items (Req 13.9)', () => {
      const { service } = createService();

      const nav = service.getSimplifiedNavigation();

      expect(nav.items.length).toBeLessThanOrEqual(6);
      expect(nav.maxTopLevelItems).toBe(6);
    });

    it('should include appointments, reports, and notifications as prominent (Req 13.9)', () => {
      const { service } = createService();

      const nav = service.getSimplifiedNavigation();

      const prominentItems = nav.items.filter((item) => item.isProminent);
      const prominentIds = prominentItems.map((item) => item.id);
      expect(prominentIds).toContain('appointments');
      expect(prominentIds).toContain('reports');
      expect(prominentIds).toContain('notifications');
    });

    it('should include ARIA labels for all navigation items (Req 13.5)', () => {
      const { service } = createService();

      const nav = service.getSimplifiedNavigation();

      for (const item of nav.items) {
        expect(item.ariaLabel).toBeDefined();
        expect(item.ariaLabel.length).toBeGreaterThan(0);
      }
    });

    it('should have valid route for each navigation item', () => {
      const { service } = createService();

      const nav = service.getSimplifiedNavigation();

      for (const item of nav.items) {
        expect(item.route).toMatch(/^\//);
      }
    });
  });

  describe('WCAG compliance helpers', () => {
    it('should validate contrast ratio meets default mode requirements', () => {
      const { service } = createService();

      expect(service.validateContrastRatio(4.5, 'normal', 'default')).toBe(true);
      expect(service.validateContrastRatio(4.4, 'normal', 'default')).toBe(false);
      expect(service.validateContrastRatio(3.0, 'large', 'default')).toBe(true);
      expect(service.validateContrastRatio(2.9, 'large', 'default')).toBe(false);
    });

    it('should validate contrast ratio meets high contrast mode requirements', () => {
      const { service } = createService();

      expect(service.validateContrastRatio(7.0, 'normal', 'high_contrast_light')).toBe(true);
      expect(service.validateContrastRatio(6.9, 'normal', 'high_contrast_light')).toBe(false);
      expect(service.validateContrastRatio(4.5, 'large', 'high_contrast_dark')).toBe(true);
      expect(service.validateContrastRatio(4.4, 'large', 'high_contrast_dark')).toBe(false);
    });

    it('should validate touch target meets 44x44px minimum (Req 13.7)', () => {
      const { service } = createService();

      expect(service.validateTouchTarget(44, 44)).toBe(true);
      expect(service.validateTouchTarget(100, 100)).toBe(true);
      expect(service.validateTouchTarget(43, 44)).toBe(false);
      expect(service.validateTouchTarget(44, 43)).toBe(false);
    });

    it('should validate element spacing meets 8px minimum (Req 13.7)', () => {
      const { service } = createService();

      expect(service.validateElementSpacing(8)).toBe(true);
      expect(service.validateElementSpacing(16)).toBe(true);
      expect(service.validateElementSpacing(7)).toBe(false);
    });

    it('should return correct text size for all options (Req 13.2)', () => {
      const { service } = createService();

      expect(service.getTextSizePx('normal')).toBe(16);
      expect(service.getTextSizePx('large')).toBe(24);
      expect(service.getTextSizePx('extra_large')).toBe(32);
    });

    it('should return correct max scaled size at 200% (Req 13.2)', () => {
      const { service } = createService();

      expect(service.getMaxScaledSize(16)).toBe(32);
      expect(service.getMaxScaledSize(24)).toBe(48);
      expect(service.getMaxScaledSize(32)).toBe(64);
    });
  });

  describe('InMemoryAccessibilitySettingsRepository', () => {
    it('should return null for unknown user', async () => {
      const repo = new InMemoryAccessibilitySettingsRepository();

      const result = await repo.findByUserId('unknown');

      expect(result).toBeNull();
    });

    it('should save and retrieve preferences', async () => {
      const repo = new InMemoryAccessibilitySettingsRepository();
      const prefs = createPreferences({ textSize: 'large' });

      await repo.save('user-1', prefs);
      const result = await repo.findByUserId('user-1');

      expect(result).not.toBeNull();
      expect(result!.textSize).toBe('large');
    });

    it('should update existing preferences', async () => {
      const repo = new InMemoryAccessibilitySettingsRepository();
      await repo.save('user-1', createPreferences({ textSize: 'normal' }));

      await repo.update('user-1', createPreferences({ textSize: 'extra_large' }));
      const result = await repo.findByUserId('user-1');

      expect(result!.textSize).toBe('extra_large');
    });

    it('should clear all stored settings', async () => {
      const repo = new InMemoryAccessibilitySettingsRepository();
      await repo.save('user-1', createPreferences());
      await repo.save('user-2', createPreferences());

      repo.clear();

      expect(await repo.findByUserId('user-1')).toBeNull();
      expect(await repo.findByUserId('user-2')).toBeNull();
    });
  });
});
