/**
 * Unit tests for LocalizationService
 * Validates: Requirements 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7, 12.9
 */

import { SupportedLanguage } from '@health-checkup/shared';
import { LocalizationService } from './localization.service';
import type {
  FallbackNotification,
  LanguageSwitchErrorNotification,
  Locale,
  Currency,
} from './localization.types';

describe('LocalizationService', () => {
  let service: LocalizationService;

  beforeEach(() => {
    service = new LocalizationService();
  });

  describe('getAvailableLanguages', () => {
    it('should return exactly 10 supported languages (Req 12.1)', () => {
      const languages = service.getAvailableLanguages();
      expect(languages).toHaveLength(10);
      expect(languages).toContain(SupportedLanguage.English);
      expect(languages).toContain(SupportedLanguage.Hindi);
      expect(languages).toContain(SupportedLanguage.Spanish);
      expect(languages).toContain(SupportedLanguage.Chinese);
      expect(languages).toContain(SupportedLanguage.Arabic);
      expect(languages).toContain(SupportedLanguage.French);
      expect(languages).toContain(SupportedLanguage.Portuguese);
      expect(languages).toContain(SupportedLanguage.Bengali);
      expect(languages).toContain(SupportedLanguage.Japanese);
      expect(languages).toContain(SupportedLanguage.German);
    });

    it('should return a new array (not mutable reference)', () => {
      const languages1 = service.getAvailableLanguages();
      const languages2 = service.getAvailableLanguages();
      expect(languages1).not.toBe(languages2);
      expect(languages1).toEqual(languages2);
    });
  });

  describe('translate', () => {
    it('should return translation for a known key in English (Req 12.2)', () => {
      const result = service.translate('nav.home', SupportedLanguage.English);
      expect(result).toBe('Home');
    });

    it('should return translation for a known key in Hindi (Req 12.2)', () => {
      const result = service.translate('nav.home', SupportedLanguage.Hindi);
      expect(result).toBe('होम');
    });

    it('should return translation for a known key in Arabic (Req 12.2)', () => {
      const result = service.translate('nav.home', SupportedLanguage.Arabic);
      expect(result).toBe('الرئيسية');
    });

    it('should return translation for a known key in Japanese (Req 12.2)', () => {
      const result = service.translate('nav.appointments', SupportedLanguage.Japanese);
      expect(result).toBe('予約');
    });

    it('should interpolate parameters (Req 12.3)', () => {
      const result = service.translate(
        'notification.appointment_confirmed',
        SupportedLanguage.English,
        { date: '2024-03-15' }
      );
      expect(result).toBe('Your appointment has been confirmed for 2024-03-15.');
    });

    it('should interpolate parameters in non-English languages (Req 12.3)', () => {
      const result = service.translate(
        'notification.payment_confirmed',
        SupportedLanguage.Spanish,
        { amount: '$100.00' }
      );
      expect(result).toBe('El pago de $100.00 se ha procesado correctamente.');
    });

    it('should fallback to English when translation is unavailable (Req 12.7)', () => {
      const fallbackNotifications: FallbackNotification[] = [];
      const svc = new LocalizationService({
        onFallback: (n) => fallbackNotifications.push(n),
        translations: {
          'test.partial': {
            en: 'English Only',
            // No Hindi translation
          },
        },
      });

      const result = svc.translate('test.partial', SupportedLanguage.Hindi);
      expect(result).toBe('English Only');
      expect(fallbackNotifications).toHaveLength(1);
      expect(fallbackNotifications[0].originalLanguage).toBe(SupportedLanguage.Hindi);
      expect(fallbackNotifications[0].fallbackLanguage).toBe(SupportedLanguage.English);
    });

    it('should return the key itself when key is not found at all (Req 12.7)', () => {
      const fallbackNotifications: FallbackNotification[] = [];
      const svc = new LocalizationService({
        onFallback: (n) => fallbackNotifications.push(n),
      });

      const result = svc.translate('nonexistent.key', SupportedLanguage.French);
      expect(result).toBe('nonexistent.key');
      expect(fallbackNotifications).toHaveLength(1);
    });

    it('should not emit fallback notification when English is requested and available', () => {
      const fallbackNotifications: FallbackNotification[] = [];
      const svc = new LocalizationService({
        onFallback: (n) => fallbackNotifications.push(n),
      });

      svc.translate('nav.home', SupportedLanguage.English);
      expect(fallbackNotifications).toHaveLength(0);
    });
  });

  describe('translateMedicalTerm', () => {
    it('should return translated medical term with explanation (Req 12.6)', () => {
      const result = service.translateMedicalTerm('blood_pressure', SupportedLanguage.English);
      expect(result.term).toBe('blood_pressure');
      expect(result.translation).toBe('Blood Pressure');
      expect(result.explanation).toBe(
        'The force of blood pushing against the walls of your blood vessels.'
      );
      expect(result.language).toBe(SupportedLanguage.English);
      expect(result.isFallback).toBe(false);
    });

    it('should translate medical terms to Hindi (Req 12.6)', () => {
      const result = service.translateMedicalTerm('cholesterol', SupportedLanguage.Hindi);
      expect(result.translation).toBe('कोलेस्ट्रॉल');
      expect(result.language).toBe(SupportedLanguage.Hindi);
      expect(result.isFallback).toBe(false);
    });

    it('should fallback to English for unavailable medical term translations (Req 12.7)', () => {
      const fallbackNotifications: FallbackNotification[] = [];
      const svc = new LocalizationService({
        onFallback: (n) => fallbackNotifications.push(n),
        medicalTerms: {
          'rare_condition': {
            en: {
              translation: 'Rare Condition',
              explanation: 'A condition that does not happen often.',
            },
            // No Hindi translation
          },
        },
      });

      const result = svc.translateMedicalTerm('rare_condition', SupportedLanguage.Hindi);
      expect(result.translation).toBe('Rare Condition');
      expect(result.isFallback).toBe(true);
      expect(result.language).toBe(SupportedLanguage.English);
      expect(fallbackNotifications).toHaveLength(1);
    });

    it('should handle unknown medical terms gracefully (Req 12.7)', () => {
      const result = service.translateMedicalTerm('unknown_term', SupportedLanguage.German);
      expect(result.term).toBe('unknown_term');
      expect(result.translation).toBe('unknown_term');
      expect(result.explanation).toBe('');
      expect(result.isFallback).toBe(true);
    });
  });

  describe('formatDate', () => {
    const testDate = new Date(2024, 2, 15); // March 15, 2024

    it('should format date in English locale (Req 12.5)', () => {
      const locale: Locale = { language: SupportedLanguage.English, tag: 'en-US' };
      const result = service.formatDate(testDate, locale);
      expect(result).toBe('March 15, 2024');
    });

    it('should format date in German locale (Req 12.5)', () => {
      const locale: Locale = { language: SupportedLanguage.German, tag: 'de-DE' };
      const result = service.formatDate(testDate, locale);
      // German format: "15. März 2024"
      expect(result).toContain('15');
      expect(result).toContain('2024');
    });

    it('should format date in Japanese locale (Req 12.5)', () => {
      const locale: Locale = { language: SupportedLanguage.Japanese, tag: 'ja-JP' };
      const result = service.formatDate(testDate, locale);
      // Japanese format includes year, month, day
      expect(result).toContain('2024');
    });

    it('should use language-based tag when locale tag is empty', () => {
      const locale: Locale = { language: SupportedLanguage.French, tag: '' };
      const result = service.formatDate(testDate, locale);
      expect(result).toContain('2024');
      expect(result).toContain('15');
    });
  });

  describe('formatCurrency', () => {
    it('should format currency in US English locale (Req 12.5)', () => {
      const locale: Locale = { language: SupportedLanguage.English, tag: 'en-US' };
      const currency: Currency = { code: 'USD', symbol: '$' };
      const result = service.formatCurrency(1234.56, currency, locale);
      expect(result).toContain('1,234.56');
      expect(result).toContain('$');
    });

    it('should format currency in Indian locale (Req 12.5)', () => {
      const locale: Locale = { language: SupportedLanguage.Hindi, tag: 'hi-IN' };
      const currency: Currency = { code: 'INR', symbol: '₹' };
      const result = service.formatCurrency(1234.56, currency, locale);
      expect(result).toContain('₹');
    });

    it('should format currency in German locale with EUR (Req 12.5)', () => {
      const locale: Locale = { language: SupportedLanguage.German, tag: 'de-DE' };
      const currency: Currency = { code: 'EUR', symbol: '€' };
      const result = service.formatCurrency(1234.56, currency, locale);
      // German uses comma as decimal separator and period as thousands separator
      expect(result).toContain('€');
    });

    it('should always show 2 decimal places', () => {
      const locale: Locale = { language: SupportedLanguage.English, tag: 'en-US' };
      const currency: Currency = { code: 'USD', symbol: '$' };
      const result = service.formatCurrency(100, currency, locale);
      expect(result).toContain('100.00');
    });
  });

  describe('formatNumber', () => {
    it('should format numbers in US English locale (Req 12.5)', () => {
      const locale: Locale = { language: SupportedLanguage.English, tag: 'en-US' };
      const result = service.formatNumber(1234567.89, locale);
      expect(result).toBe('1,234,567.89');
    });

    it('should format numbers in German locale (Req 12.5)', () => {
      const locale: Locale = { language: SupportedLanguage.German, tag: 'de-DE' };
      const result = service.formatNumber(1234567.89, locale);
      // German uses period for thousands and comma for decimal
      expect(result).toContain('1.234.567,89');
    });

    it('should format numbers in Hindi locale (Req 12.5)', () => {
      const locale: Locale = { language: SupportedLanguage.Hindi, tag: 'hi-IN' };
      const result = service.formatNumber(1234567, locale);
      // Indian numbering system: 12,34,567
      expect(result).toContain('12,34,567');
    });

    it('should handle zero', () => {
      const locale: Locale = { language: SupportedLanguage.English, tag: 'en-US' };
      const result = service.formatNumber(0, locale);
      expect(result).toBe('0');
    });

    it('should handle negative numbers', () => {
      const locale: Locale = { language: SupportedLanguage.English, tag: 'en-US' };
      const result = service.formatNumber(-1234.5, locale);
      expect(result).toContain('-');
      expect(result).toContain('1,234.5');
    });
  });

  describe('isRTL', () => {
    it('should return true for Arabic (Req 12.8)', () => {
      expect(service.isRTL(SupportedLanguage.Arabic)).toBe(true);
    });

    it('should return false for English', () => {
      expect(service.isRTL(SupportedLanguage.English)).toBe(false);
    });

    it('should return false for Hindi', () => {
      expect(service.isRTL(SupportedLanguage.Hindi)).toBe(false);
    });

    it('should return false for all non-Arabic languages', () => {
      const nonArabicLanguages = [
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

      for (const lang of nonArabicLanguages) {
        expect(service.isRTL(lang)).toBe(false);
      }
    });
  });

  describe('switchLanguage', () => {
    it('should switch language successfully (Req 12.4)', () => {
      const result = service.switchLanguage(SupportedLanguage.Spanish);
      expect(result.success).toBe(true);
      expect(result.activeLanguage).toBe(SupportedLanguage.Spanish);
      expect(result.switchDurationMs).toBeLessThanOrEqual(3000);
      expect(service.getCurrentLanguage()).toBe(SupportedLanguage.Spanish);
    });

    it('should apply language within 3 seconds without re-login (Req 12.4)', () => {
      const result = service.switchLanguage(SupportedLanguage.Japanese);
      expect(result.success).toBe(true);
      expect(result.switchDurationMs).toBeLessThan(3000);
    });

    it('should retain previous language if switch fails (Req 12.9)', () => {
      service.setCurrentLanguage(SupportedLanguage.French);

      const switchErrors: LanguageSwitchErrorNotification[] = [];
      const svc = new LocalizationService({
        onSwitchError: (n) => switchErrors.push(n),
      });
      svc.setCurrentLanguage(SupportedLanguage.French);

      // Attempt to switch to an invalid language
      const result = svc.switchLanguage('invalid' as SupportedLanguage);
      expect(result.success).toBe(false);
      expect(result.activeLanguage).toBe(SupportedLanguage.French);
      expect(svc.getCurrentLanguage()).toBe(SupportedLanguage.French);
      expect(switchErrors).toHaveLength(1);
      expect(switchErrors[0].retainedLanguage).toBe(SupportedLanguage.French);
    });

    it('should emit error notification on switch failure (Req 12.9)', () => {
      const switchErrors: LanguageSwitchErrorNotification[] = [];
      const svc = new LocalizationService({
        onSwitchError: (n) => switchErrors.push(n),
      });
      svc.setCurrentLanguage(SupportedLanguage.German);

      svc.switchLanguage('xx' as SupportedLanguage);

      expect(switchErrors).toHaveLength(1);
      expect(switchErrors[0].type).toBe('language_switch_error');
      expect(switchErrors[0].requestedLanguage).toBe('xx');
      expect(switchErrors[0].retainedLanguage).toBe(SupportedLanguage.German);
    });

    it('should successfully switch between multiple languages', () => {
      service.switchLanguage(SupportedLanguage.Hindi);
      expect(service.getCurrentLanguage()).toBe(SupportedLanguage.Hindi);

      service.switchLanguage(SupportedLanguage.Arabic);
      expect(service.getCurrentLanguage()).toBe(SupportedLanguage.Arabic);

      service.switchLanguage(SupportedLanguage.English);
      expect(service.getCurrentLanguage()).toBe(SupportedLanguage.English);
    });
  });

  describe('createLocale', () => {
    it('should create locale with correct tag for English', () => {
      const locale = service.createLocale(SupportedLanguage.English);
      expect(locale.language).toBe(SupportedLanguage.English);
      expect(locale.tag).toBe('en-US');
    });

    it('should create locale with correct tag for Arabic', () => {
      const locale = service.createLocale(SupportedLanguage.Arabic);
      expect(locale.language).toBe(SupportedLanguage.Arabic);
      expect(locale.tag).toBe('ar-SA');
    });

    it('should create locale with correct tag for Japanese', () => {
      const locale = service.createLocale(SupportedLanguage.Japanese);
      expect(locale.language).toBe(SupportedLanguage.Japanese);
      expect(locale.tag).toBe('ja-JP');
    });
  });

  describe('hasTranslation', () => {
    it('should return true for existing translation', () => {
      expect(service.hasTranslation('nav.home', SupportedLanguage.English)).toBe(true);
    });

    it('should return false for missing translation', () => {
      expect(service.hasTranslation('nonexistent.key', SupportedLanguage.English)).toBe(false);
    });
  });

  describe('hasMedicalTermTranslation', () => {
    it('should return true for existing medical term translation', () => {
      expect(
        service.hasMedicalTermTranslation('blood_pressure', SupportedLanguage.English)
      ).toBe(true);
    });

    it('should return false for missing medical term', () => {
      expect(
        service.hasMedicalTermTranslation('nonexistent_term', SupportedLanguage.English)
      ).toBe(false);
    });
  });
});
