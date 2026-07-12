/**
 * Unit tests for the Device Gateway ingestion validation layer.
 * Validates: Requirements 2.1, 2.4, 2.5, 2.6, 10.4
 */

import {
  validateReadingPayload,
  validateTimestamp,
  validatePlausibleRange,
  validateBloodPressure,
} from './device-gateway';
import {
  ValidationError,
  TimestampOutOfRangeError,
  ImplausibleValueError,
} from './device-integration.errors';
import { PLAUSIBLE_RANGES, type ReadingType, type ReadingUnit } from './device-integration.types';

// Fixed "now" so timestamp-boundary assertions are deterministic.
const NOW = new Date('2024-06-15T12:00:00.000Z').getTime();
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

/** An ISO timestamp guaranteed to be within the accepted 24h window. */
const RECENT_TIMESTAMP = new Date(NOW - 60 * 1000).toISOString();

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
});

afterEach(() => {
  jest.useRealTimers();
});

describe('device-gateway: validateReadingPayload', () => {
  describe('valid reading type + unit pairs', () => {
    // Each of the 6 supported reading type -> unit pairs with a plausible value.
    const validCases: Array<{
      readingType: ReadingType;
      unit: ReadingUnit;
      measuredValue: number;
      secondaryValue?: number;
    }> = [
      { readingType: 'blood_pressure', unit: 'mmHg', measuredValue: 120, secondaryValue: 80 },
      { readingType: 'blood_glucose', unit: 'mg/dL', measuredValue: 100 },
      { readingType: 'heart_rate', unit: 'bpm', measuredValue: 72 },
      { readingType: 'spo2', unit: 'percent', measuredValue: 98 },
      { readingType: 'temperature', unit: 'celsius', measuredValue: 37 },
      { readingType: 'weight', unit: 'kg', measuredValue: 70 },
    ];

    it.each(validCases)(
      'accepts $readingType with unit $unit',
      ({ readingType, unit, measuredValue, secondaryValue }) => {
        const payload = {
          deviceId: 'device-123',
          timestamp: RECENT_TIMESTAMP,
          readingType,
          measuredValue,
          unit,
          ...(secondaryValue !== undefined ? { secondaryValue } : {}),
        };

        const result = validateReadingPayload(payload);

        expect(result.readingType).toBe(readingType);
        expect(result.unit).toBe(unit);
        expect(result.measuredValue).toBe(measuredValue);
      }
    );

    it('rejects a mismatched reading type + unit pair', () => {
      const payload = {
        deviceId: 'device-123',
        timestamp: RECENT_TIMESTAMP,
        readingType: 'heart_rate',
        measuredValue: 72,
        unit: 'mmHg', // wrong unit for heart_rate
      };

      expect(() => validateReadingPayload(payload)).toThrow(ValidationError);
    });
  });

  describe('blood pressure dual-value handling', () => {
    it('stores systolic=120 and diastolic=80 correctly', () => {
      const payload = {
        deviceId: 'device-bp',
        timestamp: RECENT_TIMESTAMP,
        readingType: 'blood_pressure',
        measuredValue: 120,
        secondaryValue: 80,
        unit: 'mmHg',
      };

      const result = validateReadingPayload(payload);

      expect(result.measuredValue).toBe(120); // systolic
      expect(result.secondaryValue).toBe(80); // diastolic
    });

    it('rejects blood pressure missing the diastolic (secondaryValue)', () => {
      const payload = {
        deviceId: 'device-bp',
        timestamp: RECENT_TIMESTAMP,
        readingType: 'blood_pressure',
        measuredValue: 120,
        unit: 'mmHg',
      };

      expect(() => validateReadingPayload(payload)).toThrow(ValidationError);
    });
  });

  describe('required field validation', () => {
    const basePayload = {
      deviceId: 'device-123',
      timestamp: RECENT_TIMESTAMP,
      readingType: 'heart_rate',
      measuredValue: 72,
      unit: 'bpm',
    };

    it.each(['deviceId', 'timestamp', 'readingType', 'measuredValue', 'unit'])(
      'rejects payload missing %s',
      (missingField) => {
        const payload: Record<string, unknown> = { ...basePayload };
        delete payload[missingField];

        try {
          validateReadingPayload(payload);
          fail('Expected ValidationError');
        } catch (err) {
          expect(err).toBeInstanceOf(ValidationError);
          const fields = (err as ValidationError).errors.map((e) => e.field);
          expect(fields).toContain(missingField);
        }
      }
    );

    it('rejects a non-object payload', () => {
      expect(() => validateReadingPayload(null)).toThrow(ValidationError);
      expect(() => validateReadingPayload('nope')).toThrow(ValidationError);
    });
  });
});

describe('device-gateway: timestamp boundary validation', () => {
  it('accepts a timestamp exactly 24 hours in the past', () => {
    const exactly24hAgo = new Date(NOW - TWENTY_FOUR_HOURS_MS).toISOString();
    expect(() => validateTimestamp(exactly24hAgo)).not.toThrow();
  });

  it('rejects a timestamp 24 hours + 1ms in the past', () => {
    const over24h = new Date(NOW - TWENTY_FOUR_HOURS_MS - 1).toISOString();
    expect(() => validateTimestamp(over24h)).toThrow(TimestampOutOfRangeError);
  });

  it('accepts the current timestamp', () => {
    const nowIso = new Date(NOW).toISOString();
    expect(() => validateTimestamp(nowIso)).not.toThrow();
  });

  it('rejects a timestamp in the future', () => {
    const future = new Date(NOW + 1000).toISOString();
    expect(() => validateTimestamp(future)).toThrow(TimestampOutOfRangeError);
  });

  it('rejects an invalid (non-parseable) timestamp', () => {
    expect(() => validateTimestamp('not-a-date')).toThrow(TimestampOutOfRangeError);
  });

  it('rejects the boundary case through the full payload validation', () => {
    const over24h = new Date(NOW - TWENTY_FOUR_HOURS_MS - 1).toISOString();
    const payload = {
      deviceId: 'device-123',
      timestamp: over24h,
      readingType: 'heart_rate',
      measuredValue: 72,
      unit: 'bpm',
    };
    expect(() => validateReadingPayload(payload)).toThrow(TimestampOutOfRangeError);
  });
});

describe('device-gateway: plausible range boundaries', () => {
  // Non-blood-pressure reading types (validated via validatePlausibleRange).
  const singleValueTypes: ReadingType[] = [
    'blood_glucose',
    'heart_rate',
    'spo2',
    'temperature',
    'weight',
  ];

  describe.each(singleValueTypes)('%s', (readingType) => {
    const { min, max } = PLAUSIBLE_RANGES[readingType];

    it(`accepts the minimum plausible value (${min})`, () => {
      expect(() => validatePlausibleRange(readingType, min)).not.toThrow();
    });

    it(`accepts the maximum plausible value (${max})`, () => {
      expect(() => validatePlausibleRange(readingType, max)).not.toThrow();
    });

    it(`rejects just below the minimum (${min - 1})`, () => {
      expect(() => validatePlausibleRange(readingType, min - 1)).toThrow(ImplausibleValueError);
    });

    it(`rejects just above the maximum (${max + 1})`, () => {
      expect(() => validatePlausibleRange(readingType, max + 1)).toThrow(ImplausibleValueError);
    });
  });

  describe('blood_pressure', () => {
    const { min, max } = PLAUSIBLE_RANGES.blood_pressure;

    it(`accepts systolic at the minimum plausible value (${min})`, () => {
      expect(() => validateBloodPressure(min, 80)).not.toThrow();
    });

    it(`accepts systolic at the maximum plausible value (${max})`, () => {
      expect(() => validateBloodPressure(max, 80)).not.toThrow();
    });

    it(`rejects systolic just below the minimum (${min - 1})`, () => {
      expect(() => validateBloodPressure(min - 1, 80)).toThrow(ImplausibleValueError);
    });

    it(`rejects systolic just above the maximum (${max + 1})`, () => {
      expect(() => validateBloodPressure(max + 1, 80)).toThrow(ImplausibleValueError);
    });

    it(`rejects diastolic just below the minimum (${min - 1})`, () => {
      expect(() => validateBloodPressure(120, min - 1)).toThrow(ImplausibleValueError);
    });

    it(`rejects diastolic just above the maximum (${max + 1})`, () => {
      expect(() => validateBloodPressure(120, max + 1)).toThrow(ImplausibleValueError);
    });
  });

  it('rejects an implausible value through the full payload validation', () => {
    const payload = {
      deviceId: 'device-123',
      timestamp: RECENT_TIMESTAMP,
      readingType: 'heart_rate',
      measuredValue: PLAUSIBLE_RANGES.heart_rate.max + 1,
      unit: 'bpm',
    };
    expect(() => validateReadingPayload(payload)).toThrow(ImplausibleValueError);
  });
});
