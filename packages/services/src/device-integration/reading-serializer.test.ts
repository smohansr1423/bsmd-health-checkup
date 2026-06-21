/**
 * Unit tests for Health Reading serialization/deserialization.
 * Validates: Requirements 10.1, 10.3
 */

import { formatReading, parseReading } from './reading-serializer';
import { ValidationError } from './device-integration.errors';
import type { HealthReading } from './device-integration.types';

describe('reading-serializer', () => {
  const sampleReading: HealthReading = {
    id: '550e8400-e29b-41d4-a716-446655440000',
    deviceId: '660e8400-e29b-41d4-a716-446655440001',
    seniorId: '770e8400-e29b-41d4-a716-446655440002',
    dailyRecordId: '880e8400-e29b-41d4-a716-446655440003',
    readingType: 'heart_rate',
    measuredValue: 72,
    unit: 'bpm',
    timestamp: new Date('2024-01-01T12:00:00.000Z'),
    createdAt: new Date('2024-01-01T12:00:01.000Z'),
  };

  const sampleBloodPressureReading: HealthReading = {
    id: '550e8400-e29b-41d4-a716-446655440010',
    deviceId: '660e8400-e29b-41d4-a716-446655440011',
    seniorId: '770e8400-e29b-41d4-a716-446655440012',
    dailyRecordId: '880e8400-e29b-41d4-a716-446655440013',
    readingType: 'blood_pressure',
    measuredValue: 120,
    secondaryValue: 80,
    unit: 'mmHg',
    timestamp: new Date('2024-01-01T14:30:00.000Z'),
    createdAt: new Date('2024-01-01T14:30:01.000Z'),
  };

  describe('formatReading', () => {
    it('should format a reading without secondaryValue', () => {
      const result = formatReading(sampleReading);

      expect(result).toEqual({
        id: '550e8400-e29b-41d4-a716-446655440000',
        deviceId: '660e8400-e29b-41d4-a716-446655440001',
        seniorId: '770e8400-e29b-41d4-a716-446655440002',
        dailyRecordId: '880e8400-e29b-41d4-a716-446655440003',
        readingType: 'heart_rate',
        measuredValue: 72,
        secondaryValue: null,
        unit: 'bpm',
        timestamp: '2024-01-01T12:00:00.000Z',
        createdAt: '2024-01-01T12:00:01.000Z',
      });
    });

    it('should format a blood pressure reading with secondaryValue', () => {
      const result = formatReading(sampleBloodPressureReading);

      expect(result).toEqual({
        id: '550e8400-e29b-41d4-a716-446655440010',
        deviceId: '660e8400-e29b-41d4-a716-446655440011',
        seniorId: '770e8400-e29b-41d4-a716-446655440012',
        dailyRecordId: '880e8400-e29b-41d4-a716-446655440013',
        readingType: 'blood_pressure',
        measuredValue: 120,
        secondaryValue: 80,
        unit: 'mmHg',
        timestamp: '2024-01-01T14:30:00.000Z',
        createdAt: '2024-01-01T14:30:01.000Z',
      });
    });

    it('should serialize dates as ISO 8601 strings', () => {
      const result = formatReading(sampleReading);

      expect(result.timestamp).toBe('2024-01-01T12:00:00.000Z');
      expect(result.createdAt).toBe('2024-01-01T12:00:01.000Z');
    });
  });

  describe('parseReading', () => {
    it('should parse a valid JSON object into a HealthReading', () => {
      const json = {
        id: '550e8400-e29b-41d4-a716-446655440000',
        deviceId: '660e8400-e29b-41d4-a716-446655440001',
        seniorId: '770e8400-e29b-41d4-a716-446655440002',
        dailyRecordId: '880e8400-e29b-41d4-a716-446655440003',
        readingType: 'heart_rate',
        measuredValue: 72,
        secondaryValue: null,
        unit: 'bpm',
        timestamp: '2024-01-01T12:00:00.000Z',
        createdAt: '2024-01-01T12:00:01.000Z',
      };

      const result = parseReading(json);

      expect(result.id).toBe('550e8400-e29b-41d4-a716-446655440000');
      expect(result.readingType).toBe('heart_rate');
      expect(result.measuredValue).toBe(72);
      expect(result.secondaryValue).toBeUndefined();
      expect(result.unit).toBe('bpm');
      expect(result.timestamp).toEqual(new Date('2024-01-01T12:00:00.000Z'));
      expect(result.createdAt).toEqual(new Date('2024-01-01T12:00:01.000Z'));
    });

    it('should parse a blood pressure reading with secondaryValue', () => {
      const json = {
        id: '550e8400-e29b-41d4-a716-446655440010',
        deviceId: '660e8400-e29b-41d4-a716-446655440011',
        seniorId: '770e8400-e29b-41d4-a716-446655440012',
        dailyRecordId: '880e8400-e29b-41d4-a716-446655440013',
        readingType: 'blood_pressure',
        measuredValue: 120,
        secondaryValue: 80,
        unit: 'mmHg',
        timestamp: '2024-01-01T14:30:00.000Z',
        createdAt: '2024-01-01T14:30:01.000Z',
      };

      const result = parseReading(json);

      expect(result.secondaryValue).toBe(80);
    });

    it('should throw ValidationError for null input', () => {
      expect(() => parseReading(null)).toThrow(ValidationError);
    });

    it('should throw ValidationError for undefined input', () => {
      expect(() => parseReading(undefined)).toThrow(ValidationError);
    });

    it('should throw ValidationError for non-object input', () => {
      expect(() => parseReading('string')).toThrow(ValidationError);
    });

    it('should throw ValidationError with field-level errors for missing fields', () => {
      try {
        parseReading({});
        fail('Expected ValidationError');
      } catch (err) {
        expect(err).toBeInstanceOf(ValidationError);
        const validationErr = err as ValidationError;
        expect(validationErr.errors.length).toBeGreaterThan(0);
        const fields = validationErr.errors.map((e) => e.field);
        expect(fields).toContain('id');
        expect(fields).toContain('deviceId');
        expect(fields).toContain('readingType');
        expect(fields).toContain('measuredValue');
        expect(fields).toContain('unit');
        expect(fields).toContain('timestamp');
        expect(fields).toContain('createdAt');
      }
    });

    it('should throw ValidationError for invalid readingType', () => {
      const json = {
        id: 'abc',
        deviceId: 'def',
        seniorId: 'ghi',
        dailyRecordId: 'jkl',
        readingType: 'invalid_type',
        measuredValue: 72,
        secondaryValue: null,
        unit: 'bpm',
        timestamp: '2024-01-01T12:00:00.000Z',
        createdAt: '2024-01-01T12:00:01.000Z',
      };

      try {
        parseReading(json);
        fail('Expected ValidationError');
      } catch (err) {
        expect(err).toBeInstanceOf(ValidationError);
        const validationErr = err as ValidationError;
        const readingTypeError = validationErr.errors.find((e) => e.field === 'readingType');
        expect(readingTypeError).toBeDefined();
      }
    });

    it('should throw ValidationError for invalid date format', () => {
      const json = {
        id: 'abc',
        deviceId: 'def',
        seniorId: 'ghi',
        dailyRecordId: 'jkl',
        readingType: 'heart_rate',
        measuredValue: 72,
        secondaryValue: null,
        unit: 'bpm',
        timestamp: 'not-a-date',
        createdAt: '2024-01-01T12:00:01.000Z',
      };

      try {
        parseReading(json);
        fail('Expected ValidationError');
      } catch (err) {
        expect(err).toBeInstanceOf(ValidationError);
        const validationErr = err as ValidationError;
        const timestampError = validationErr.errors.find((e) => e.field === 'timestamp');
        expect(timestampError).toBeDefined();
      }
    });
  });

  describe('round-trip: parseReading(formatReading(reading))', () => {
    it('should produce an equivalent object for a reading without secondaryValue', () => {
      const formatted = formatReading(sampleReading);
      const parsed = parseReading(formatted);

      expect(parsed.id).toBe(sampleReading.id);
      expect(parsed.deviceId).toBe(sampleReading.deviceId);
      expect(parsed.seniorId).toBe(sampleReading.seniorId);
      expect(parsed.dailyRecordId).toBe(sampleReading.dailyRecordId);
      expect(parsed.readingType).toBe(sampleReading.readingType);
      expect(parsed.measuredValue).toBe(sampleReading.measuredValue);
      expect(parsed.secondaryValue).toBeUndefined();
      expect(parsed.unit).toBe(sampleReading.unit);
      expect(parsed.timestamp.getTime()).toBe(sampleReading.timestamp.getTime());
      expect(parsed.createdAt.getTime()).toBe(sampleReading.createdAt.getTime());
    });

    it('should produce an equivalent object for a blood pressure reading', () => {
      const formatted = formatReading(sampleBloodPressureReading);
      const parsed = parseReading(formatted);

      expect(parsed.id).toBe(sampleBloodPressureReading.id);
      expect(parsed.deviceId).toBe(sampleBloodPressureReading.deviceId);
      expect(parsed.seniorId).toBe(sampleBloodPressureReading.seniorId);
      expect(parsed.dailyRecordId).toBe(sampleBloodPressureReading.dailyRecordId);
      expect(parsed.readingType).toBe(sampleBloodPressureReading.readingType);
      expect(parsed.measuredValue).toBe(sampleBloodPressureReading.measuredValue);
      expect(parsed.secondaryValue).toBe(sampleBloodPressureReading.secondaryValue);
      expect(parsed.unit).toBe(sampleBloodPressureReading.unit);
      expect(parsed.timestamp.getTime()).toBe(sampleBloodPressureReading.timestamp.getTime());
      expect(parsed.createdAt.getTime()).toBe(sampleBloodPressureReading.createdAt.getTime());
    });
  });
});
