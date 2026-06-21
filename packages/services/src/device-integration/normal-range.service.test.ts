/**
 * Normal Range Configuration Service — Unit Tests
 * Tests CRUD operations, ordering validation, and default seeding.
 * Validates: Requirements 5.1, 5.2, 5.3, 5.4
 */

import {
  NormalRangeService,
  InMemoryNormalRangeRepository,
  validateRangeOrdering,
  DEFAULT_NORMAL_RANGES,
} from './normal-range.service';
import { RangeOrderInvalidError } from './device-integration.errors';
import type { NormalRangeRequest, ReadingType, AgeGroup } from './device-integration.types';

describe('NormalRangeService', () => {
  let repository: InMemoryNormalRangeRepository;
  let service: NormalRangeService;
  let idCounter: number;

  beforeEach(() => {
    repository = new InMemoryNormalRangeRepository();
    idCounter = 0;
    service = new NormalRangeService({
      repository,
      idGenerator: () => `NR_TEST_${++idCounter}`,
      dateProvider: () => new Date('2024-01-15T10:00:00Z'),
    });
  });

  const validRequest: NormalRangeRequest = {
    readingType: 'blood_pressure',
    ageGroup: '60-69',
    criticalLow: 60,
    borderlineLow: 80,
    normalLow: 90,
    normalHigh: 140,
    borderlineHigh: 160,
    criticalHigh: 180,
  };

  describe('configure()', () => {
    it('should create a NormalRange with all fields stored', async () => {
      const result = await service.configure(validRequest);

      expect(result.id).toBe('NR_TEST_1');
      expect(result.readingType).toBe('blood_pressure');
      expect(result.ageGroup).toBe('60-69');
      expect(result.criticalLow).toBe(60);
      expect(result.borderlineLow).toBe(80);
      expect(result.normalLow).toBe(90);
      expect(result.normalHigh).toBe(140);
      expect(result.borderlineHigh).toBe(160);
      expect(result.criticalHigh).toBe(180);
      expect(result.createdAt).toEqual(new Date('2024-01-15T10:00:00Z'));
      expect(result.updatedAt).toEqual(new Date('2024-01-15T10:00:00Z'));
    });

    it('should accept ranges where all thresholds are equal', async () => {
      const equalRequest: NormalRangeRequest = {
        readingType: 'spo2',
        ageGroup: '70-79',
        criticalLow: 100,
        borderlineLow: 100,
        normalLow: 100,
        normalHigh: 100,
        borderlineHigh: 100,
        criticalHigh: 100,
      };

      const result = await service.configure(equalRequest);
      expect(result.criticalLow).toBe(100);
      expect(result.criticalHigh).toBe(100);
    });

    it('should throw RangeOrderInvalidError when criticalLow > borderlineLow', async () => {
      const invalid: NormalRangeRequest = {
        ...validRequest,
        criticalLow: 100,
        borderlineLow: 80,
      };

      await expect(service.configure(invalid)).rejects.toThrow(RangeOrderInvalidError);
    });

    it('should throw RangeOrderInvalidError when borderlineLow > normalLow', async () => {
      const invalid: NormalRangeRequest = {
        ...validRequest,
        borderlineLow: 95,
        normalLow: 90,
      };

      await expect(service.configure(invalid)).rejects.toThrow(RangeOrderInvalidError);
    });

    it('should throw RangeOrderInvalidError when normalLow > normalHigh', async () => {
      const invalid: NormalRangeRequest = {
        ...validRequest,
        normalLow: 150,
        normalHigh: 140,
      };

      await expect(service.configure(invalid)).rejects.toThrow(RangeOrderInvalidError);
    });

    it('should throw RangeOrderInvalidError when normalHigh > borderlineHigh', async () => {
      const invalid: NormalRangeRequest = {
        ...validRequest,
        normalHigh: 170,
        borderlineHigh: 160,
      };

      await expect(service.configure(invalid)).rejects.toThrow(RangeOrderInvalidError);
    });

    it('should throw RangeOrderInvalidError when borderlineHigh > criticalHigh', async () => {
      const invalid: NormalRangeRequest = {
        ...validRequest,
        borderlineHigh: 190,
        criticalHigh: 180,
      };

      await expect(service.configure(invalid)).rejects.toThrow(RangeOrderInvalidError);
    });
  });

  describe('update()', () => {
    it('should update specific fields and preserve others', async () => {
      const range = await service.configure(validRequest);

      const updated = await service.update(range.id, { normalHigh: 130 });

      expect(updated.normalHigh).toBe(130);
      expect(updated.normalLow).toBe(90); // preserved
      expect(updated.criticalLow).toBe(60); // preserved
      expect(updated.updatedAt).toEqual(new Date('2024-01-15T10:00:00Z'));
    });

    it('should validate ordering of merged result', async () => {
      const range = await service.configure(validRequest);

      // Try to set normalHigh below normalLow (90)
      await expect(
        service.update(range.id, { normalHigh: 80 })
      ).rejects.toThrow(RangeOrderInvalidError);
    });

    it('should throw error when range ID is not found', async () => {
      await expect(
        service.update('non-existent-id', { normalHigh: 130 })
      ).rejects.toThrow('Normal range not found: non-existent-id');
    });

    it('should apply update non-retroactively (only modifies stored range)', async () => {
      const range = await service.configure(validRequest);
      const originalCreatedAt = range.createdAt;

      const updated = await service.update(range.id, { normalHigh: 135 });

      // The original createdAt is preserved
      expect(updated.createdAt).toEqual(originalCreatedAt);
      // updatedAt is changed
      expect(updated.updatedAt).toEqual(new Date('2024-01-15T10:00:00Z'));
      // The ID remains the same
      expect(updated.id).toBe(range.id);
    });
  });

  describe('getRange()', () => {
    it('should return the range for a given readingType and ageGroup', async () => {
      await service.configure(validRequest);

      const found = await service.getRange('blood_pressure', '60-69');
      expect(found).not.toBeNull();
      expect(found!.readingType).toBe('blood_pressure');
      expect(found!.ageGroup).toBe('60-69');
    });

    it('should return null when no range is configured', async () => {
      const found = await service.getRange('heart_rate', '90+');
      expect(found).toBeNull();
    });
  });

  describe('getAllRanges()', () => {
    it('should return all configured ranges', async () => {
      await service.configure(validRequest);
      await service.configure({
        ...validRequest,
        readingType: 'heart_rate',
        criticalLow: 40,
        borderlineLow: 50,
        normalLow: 60,
        normalHigh: 100,
        borderlineHigh: 120,
        criticalHigh: 150,
      });

      const all = await service.getAllRanges();
      expect(all).toHaveLength(2);
    });

    it('should return empty array when no ranges configured', async () => {
      const all = await service.getAllRanges();
      expect(all).toHaveLength(0);
    });
  });

  describe('seedDefaults()', () => {
    it('should seed default ranges for all reading types and age groups', async () => {
      await service.seedDefaults();

      const allRanges = await service.getAllRanges();
      // 6 reading types × 4 age groups = 24 ranges
      expect(allRanges).toHaveLength(24);
    });

    it('should not overwrite existing ranges when seeding', async () => {
      // Configure a custom range for blood_pressure / 60-69
      const customRequest: NormalRangeRequest = {
        readingType: 'blood_pressure',
        ageGroup: '60-69',
        criticalLow: 50,
        borderlineLow: 70,
        normalLow: 85,
        normalHigh: 135,
        borderlineHigh: 155,
        criticalHigh: 175,
      };
      await service.configure(customRequest);

      // Seed defaults
      await service.seedDefaults();

      // The custom range should be preserved
      const range = await service.getRange('blood_pressure', '60-69');
      expect(range!.criticalLow).toBe(50); // custom value, not default 60
    });

    it('should use correct default values for each reading type', async () => {
      await service.seedDefaults();

      const readingTypes: ReadingType[] = [
        'blood_pressure',
        'blood_glucose',
        'heart_rate',
        'spo2',
        'temperature',
        'weight',
      ];

      for (const readingType of readingTypes) {
        const range = await service.getRange(readingType, '60-69');
        expect(range).not.toBeNull();
        const defaults = DEFAULT_NORMAL_RANGES[readingType];
        expect(range!.criticalLow).toBe(defaults.criticalLow);
        expect(range!.borderlineLow).toBe(defaults.borderlineLow);
        expect(range!.normalLow).toBe(defaults.normalLow);
        expect(range!.normalHigh).toBe(defaults.normalHigh);
        expect(range!.borderlineHigh).toBe(defaults.borderlineHigh);
        expect(range!.criticalHigh).toBe(defaults.criticalHigh);
      }
    });
  });
});

describe('validateRangeOrdering()', () => {
  it('should not throw for valid ordering', () => {
    expect(() =>
      validateRangeOrdering(60, 80, 90, 140, 160, 180)
    ).not.toThrow();
  });

  it('should not throw when all values are equal', () => {
    expect(() =>
      validateRangeOrdering(100, 100, 100, 100, 100, 100)
    ).not.toThrow();
  });

  it('should throw RangeOrderInvalidError for multiple violations', () => {
    try {
      validateRangeOrdering(200, 100, 90, 80, 70, 60);
      fail('Expected RangeOrderInvalidError');
    } catch (error) {
      expect(error).toBeInstanceOf(RangeOrderInvalidError);
      expect((error as RangeOrderInvalidError).details).toContain('criticalLow');
      expect((error as RangeOrderInvalidError).details).toContain('borderlineLow');
      expect((error as RangeOrderInvalidError).details).toContain('normalLow');
      expect((error as RangeOrderInvalidError).details).toContain('normalHigh');
      expect((error as RangeOrderInvalidError).details).toContain('borderlineHigh');
    }
  });
});
