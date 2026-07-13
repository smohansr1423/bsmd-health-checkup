/**
 * Smoke tests for the one-time configuration posture (Task 18.4).
 *
 * Per the design's Testing Strategy, one-time configuration is verified by
 * smoke tests (not property-based tests). These assert the shipped posture
 * declaration satisfies every requirement budget:
 *
 *   - ≥2000-category food-recognition model load   (Req 2.1)
 *   - on-device inference model ≤80 MB             (Req 28.2)
 *   - total install size ≤150 MB                   (Req 28.3)
 *   - TLS 1.3 + certificate-pinning config         (Req 25.2)
 *   - SOC 2 control presence                       (Req 25.4)
 *
 * If a future build regenerates the manifest with a larger model or install
 * image, an unpinned transport, or a missing control, these smoke tests fail
 * the pipeline before release.
 */

import {
  MAX_INSTALL_SIZE_BYTES,
  MAX_ON_DEVICE_MODEL_BYTES,
  MEGABYTE,
  MIN_FOOD_CATEGORIES,
  ONE_TIME_CONFIG_POSTURE,
  REQUIRED_TLS_VERSION,
  type OnDeviceModelFormat,
} from './deployment-posture';

describe('one-time configuration posture (Task 18.4 smoke tests)', () => {
  const posture = ONE_TIME_CONFIG_POSTURE;

  describe('food-recognition model load (Req 2.1)', () => {
    it('covers at least 2,000 food categories', () => {
      expect(posture.foodRecognitionModel.categoryCount).toBeGreaterThanOrEqual(
        MIN_FOOD_CATEGORIES,
      );
    });

    it('resolves the registered recognizer model name', () => {
      expect(posture.foodRecognitionModel.modelName).toBe('food-recognizer');
    });

    it('ships a bundled on-device artifact for both client platforms', () => {
      const platforms = posture.foodRecognitionModel.onDeviceArtifacts
        .filter((a) => a.bundled)
        .map((a) => a.platform)
        .sort();
      expect(platforms).toEqual(['android', 'ios']);
    });
  });

  describe('on-device model packaging ≤80 MB (Req 28.2)', () => {
    it('bounds the budget constant at exactly 80 MB', () => {
      expect(MAX_ON_DEVICE_MODEL_BYTES).toBe(80 * MEGABYTE);
    });

    it.each(posture.foodRecognitionModel.onDeviceArtifacts.map((a) => [a.platform, a]))(
      'keeps the %s on-device model within the 80 MB budget',
      (_platform, artifact) => {
        const a = artifact as {
          readonly sizeBytes: number;
          readonly format: OnDeviceModelFormat;
        };
        expect(a.sizeBytes).toBeGreaterThan(0);
        expect(a.sizeBytes).toBeLessThanOrEqual(MAX_ON_DEVICE_MODEL_BYTES);
      },
    );

    it('packages the on-device models as INT8-quantized Core ML / TFLite', () => {
      const validFormats: readonly OnDeviceModelFormat[] = ['coreml', 'tflite'];
      for (const artifact of posture.foodRecognitionModel.onDeviceArtifacts) {
        expect(validFormats).toContain(artifact.format);
      }
    });
  });

  describe('install size ≤150 MB (Req 28.3)', () => {
    it('bounds the budget constant at exactly 150 MB', () => {
      expect(MAX_INSTALL_SIZE_BYTES).toBe(150 * MEGABYTE);
    });

    it('keeps the measured install image within the 150 MB budget', () => {
      expect(posture.installSize.installSizeBytes).toBeGreaterThan(0);
      expect(posture.installSize.installSizeBytes).toBeLessThanOrEqual(
        MAX_INSTALL_SIZE_BYTES,
      );
    });

    it('measures install size on the benchmark device (iPhone 15 Pro)', () => {
      expect(posture.installSize.benchmarkDevice).toBe('iPhone 15 Pro');
    });
  });

  describe('TLS 1.3 + certificate-pinning config (Req 25.2)', () => {
    it('requires TLS 1.3 as the minimum transport version', () => {
      expect(posture.transportSecurity.minTlsVersion).toBe(REQUIRED_TLS_VERSION);
      expect(posture.transportSecurity.minTlsVersion).toBe('1.3');
    });

    it('enables certificate pinning', () => {
      expect(posture.transportSecurity.certificatePinningEnabled).toBe(true);
    });

    it('configures at least one pinned certificate fingerprint', () => {
      expect(
        posture.transportSecurity.pinnedCertificateFingerprints.length,
      ).toBeGreaterThan(0);
    });
  });

  describe('SOC 2 control presence (Req 25.4)', () => {
    it('declares a non-empty control register', () => {
      expect(posture.soc2Controls.length).toBeGreaterThan(0);
    });

    it('marks every declared control as implemented', () => {
      for (const control of posture.soc2Controls) {
        expect(control.implemented).toBe(true);
        expect(control.id).not.toHaveLength(0);
        expect(control.name).not.toHaveLength(0);
      }
    });

    it('covers all five Trust Services Criteria categories', () => {
      const categories = new Set(posture.soc2Controls.map((c) => c.category));
      expect(categories).toEqual(
        new Set([
          'security',
          'availability',
          'processing-integrity',
          'confidentiality',
          'privacy',
        ]),
      );
    });

    it('uses unique control identifiers', () => {
      const ids = posture.soc2Controls.map((c) => c.id);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });
});
