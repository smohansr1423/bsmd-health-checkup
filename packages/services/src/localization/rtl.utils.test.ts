/**
 * Unit tests for RTL Layout Utilities
 * Validates: Requirements 12.8
 */

import { SupportedLanguage } from '@health-checkup/shared';
import {
  isRTLLanguage,
  getTextDirection,
  getTextAlignment,
  getNavigationMirrorConfig,
  getDirectionalIconConfig,
  getDocumentDirectionAttributes,
  getRTLLayoutConfig,
  getLogicalCSSProperties,
  getDirectionalStyles,
} from './rtl.utils';

describe('RTL Layout Utilities', () => {
  const NON_RTL_LANGUAGES: SupportedLanguage[] = [
    SupportedLanguage.English,
    SupportedLanguage.Hindi,
    SupportedLanguage.Spanish,
    SupportedLanguage.Chinese,
    SupportedLanguage.French,
    SupportedLanguage.Portuguese,
    SupportedLanguage.Bengali,
    SupportedLanguage.Japanese,
    SupportedLanguage.German,
  ];

  describe('isRTLLanguage', () => {
    it('should return true for Arabic (Req 12.8)', () => {
      expect(isRTLLanguage(SupportedLanguage.Arabic)).toBe(true);
    });

    it('should return false for all non-Arabic supported languages', () => {
      for (const lang of NON_RTL_LANGUAGES) {
        expect(isRTLLanguage(lang)).toBe(false);
      }
    });
  });

  describe('getTextDirection', () => {
    it('should return "rtl" for Arabic', () => {
      expect(getTextDirection(SupportedLanguage.Arabic)).toBe('rtl');
    });

    it('should return "ltr" for English', () => {
      expect(getTextDirection(SupportedLanguage.English)).toBe('ltr');
    });

    it('should return "ltr" for all non-Arabic languages', () => {
      for (const lang of NON_RTL_LANGUAGES) {
        expect(getTextDirection(lang)).toBe('ltr');
      }
    });
  });

  describe('getTextAlignment', () => {
    it('should return "right" for Arabic (RTL text aligns right)', () => {
      expect(getTextAlignment(SupportedLanguage.Arabic)).toBe('right');
    });

    it('should return "left" for English (LTR text aligns left)', () => {
      expect(getTextAlignment(SupportedLanguage.English)).toBe('left');
    });

    it('should return "left" for all non-Arabic languages', () => {
      for (const lang of NON_RTL_LANGUAGES) {
        expect(getTextAlignment(lang)).toBe('left');
      }
    });
  });

  describe('getNavigationMirrorConfig', () => {
    it('should mirror navigation for Arabic', () => {
      const config = getNavigationMirrorConfig(SupportedLanguage.Arabic);
      expect(config.sidebarPosition).toBe('right');
      expect(config.menuDirection).toBe('row-reverse');
      expect(config.breadcrumbDirection).toBe('row-reverse');
      expect(config.scrollDirection).toBe('rtl');
    });

    it('should use standard LTR navigation for English', () => {
      const config = getNavigationMirrorConfig(SupportedLanguage.English);
      expect(config.sidebarPosition).toBe('left');
      expect(config.menuDirection).toBe('row');
      expect(config.breadcrumbDirection).toBe('row');
      expect(config.scrollDirection).toBe('ltr');
    });

    it('should use standard LTR navigation for Hindi', () => {
      const config = getNavigationMirrorConfig(SupportedLanguage.Hindi);
      expect(config.sidebarPosition).toBe('left');
      expect(config.menuDirection).toBe('row');
      expect(config.breadcrumbDirection).toBe('row');
      expect(config.scrollDirection).toBe('ltr');
    });
  });

  describe('getDirectionalIconConfig', () => {
    it('should mirror icons for Arabic', () => {
      const config = getDirectionalIconConfig(SupportedLanguage.Arabic);
      expect(config.shouldMirror).toBe(true);
      expect(config.mirrorTransform).toBe('scaleX(-1)');
      expect(config.backIcon).toBe('arrow-right');
      expect(config.forwardIcon).toBe('arrow-left');
      expect(config.listMarkerSide).toBe('right');
    });

    it('should not mirror icons for English', () => {
      const config = getDirectionalIconConfig(SupportedLanguage.English);
      expect(config.shouldMirror).toBe(false);
      expect(config.mirrorTransform).toBe('none');
      expect(config.backIcon).toBe('arrow-left');
      expect(config.forwardIcon).toBe('arrow-right');
      expect(config.listMarkerSide).toBe('left');
    });

    it('should not mirror icons for Japanese', () => {
      const config = getDirectionalIconConfig(SupportedLanguage.Japanese);
      expect(config.shouldMirror).toBe(false);
      expect(config.mirrorTransform).toBe('none');
      expect(config.backIcon).toBe('arrow-left');
      expect(config.forwardIcon).toBe('arrow-right');
      expect(config.listMarkerSide).toBe('left');
    });
  });

  describe('getDocumentDirectionAttributes', () => {
    it('should set dir="rtl" and correct lang for Arabic', () => {
      const attrs = getDocumentDirectionAttributes(SupportedLanguage.Arabic);
      expect(attrs.dir).toBe('rtl');
      expect(attrs.lang).toBe('ar-SA');
    });

    it('should set dir="ltr" and correct lang for English', () => {
      const attrs = getDocumentDirectionAttributes(SupportedLanguage.English);
      expect(attrs.dir).toBe('ltr');
      expect(attrs.lang).toBe('en-US');
    });

    it('should set dir="ltr" and correct lang for Hindi', () => {
      const attrs = getDocumentDirectionAttributes(SupportedLanguage.Hindi);
      expect(attrs.dir).toBe('ltr');
      expect(attrs.lang).toBe('hi-IN');
    });

    it('should set dir="ltr" and correct lang for Japanese', () => {
      const attrs = getDocumentDirectionAttributes(SupportedLanguage.Japanese);
      expect(attrs.dir).toBe('ltr');
      expect(attrs.lang).toBe('ja-JP');
    });
  });

  describe('getRTLLayoutConfig', () => {
    it('should produce a complete RTL config for Arabic', () => {
      const config = getRTLLayoutConfig(SupportedLanguage.Arabic);

      expect(config.language).toBe(SupportedLanguage.Arabic);
      expect(config.isRTL).toBe(true);
      expect(config.direction).toBe('rtl');
      expect(config.textAlign).toBe('right');

      // Navigation mirrored
      expect(config.navigation.sidebarPosition).toBe('right');
      expect(config.navigation.menuDirection).toBe('row-reverse');
      expect(config.navigation.breadcrumbDirection).toBe('row-reverse');
      expect(config.navigation.scrollDirection).toBe('rtl');

      // Icons mirrored
      expect(config.icons.shouldMirror).toBe(true);
      expect(config.icons.mirrorTransform).toBe('scaleX(-1)');
      expect(config.icons.backIcon).toBe('arrow-right');
      expect(config.icons.forwardIcon).toBe('arrow-left');
      expect(config.icons.listMarkerSide).toBe('right');

      // Document attributes
      expect(config.documentAttributes.dir).toBe('rtl');
      expect(config.documentAttributes.lang).toBe('ar-SA');
    });

    it('should produce a complete LTR config for English', () => {
      const config = getRTLLayoutConfig(SupportedLanguage.English);

      expect(config.language).toBe(SupportedLanguage.English);
      expect(config.isRTL).toBe(false);
      expect(config.direction).toBe('ltr');
      expect(config.textAlign).toBe('left');

      // Navigation standard
      expect(config.navigation.sidebarPosition).toBe('left');
      expect(config.navigation.menuDirection).toBe('row');
      expect(config.navigation.breadcrumbDirection).toBe('row');
      expect(config.navigation.scrollDirection).toBe('ltr');

      // Icons not mirrored
      expect(config.icons.shouldMirror).toBe(false);
      expect(config.icons.mirrorTransform).toBe('none');
      expect(config.icons.backIcon).toBe('arrow-left');
      expect(config.icons.forwardIcon).toBe('arrow-right');
      expect(config.icons.listMarkerSide).toBe('left');

      // Document attributes
      expect(config.documentAttributes.dir).toBe('ltr');
      expect(config.documentAttributes.lang).toBe('en-US');
    });

    it('should produce LTR configs for all non-Arabic languages', () => {
      for (const lang of NON_RTL_LANGUAGES) {
        const config = getRTLLayoutConfig(lang);
        expect(config.isRTL).toBe(false);
        expect(config.direction).toBe('ltr');
        expect(config.textAlign).toBe('left');
        expect(config.navigation.sidebarPosition).toBe('left');
        expect(config.icons.shouldMirror).toBe(false);
        expect(config.documentAttributes.dir).toBe('ltr');
      }
    });
  });

  describe('getLogicalCSSProperties', () => {
    it('should return correct CSS logical property names', () => {
      const props = getLogicalCSSProperties();
      expect(props.marginStart).toBe('margin-inline-start');
      expect(props.marginEnd).toBe('margin-inline-end');
      expect(props.paddingStart).toBe('padding-inline-start');
      expect(props.paddingEnd).toBe('padding-inline-end');
      expect(props.borderStart).toBe('border-inline-start');
      expect(props.borderEnd).toBe('border-inline-end');
      expect(props.insetStart).toBe('inset-inline-start');
      expect(props.insetEnd).toBe('inset-inline-end');
    });
  });

  describe('getDirectionalStyles', () => {
    it('should return RTL styles for Arabic', () => {
      const styles = getDirectionalStyles(SupportedLanguage.Arabic);
      expect(styles.direction).toBe('rtl');
      expect(styles.textAlign).toBe('right');
      expect(styles.unicodeBidi).toBe('embed');
    });

    it('should return LTR styles for English', () => {
      const styles = getDirectionalStyles(SupportedLanguage.English);
      expect(styles.direction).toBe('ltr');
      expect(styles.textAlign).toBe('left');
      expect(styles.unicodeBidi).toBe('normal');
    });

    it('should return LTR styles for all non-Arabic languages', () => {
      for (const lang of NON_RTL_LANGUAGES) {
        const styles = getDirectionalStyles(lang);
        expect(styles.direction).toBe('ltr');
        expect(styles.textAlign).toBe('left');
        expect(styles.unicodeBidi).toBe('normal');
      }
    });
  });
});
