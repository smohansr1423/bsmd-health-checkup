/**
 * Health Reading Serialization/Deserialization
 * Converts between HealthReading domain objects and canonical JSON schema.
 * Validates: Requirements 10.1, 10.3
 */

import type { HealthReading, ReadingType, ReadingUnit } from './device-integration.types';
import { ValidationError } from './device-integration.errors';

/**
 * Canonical JSON representation of a HealthReading for API responses.
 */
export interface HealthReadingJson {
  id: string;
  deviceId: string;
  seniorId: string;
  dailyRecordId: string;
  readingType: ReadingType;
  measuredValue: number;
  secondaryValue: number | null;
  unit: ReadingUnit;
  timestamp: string;
  createdAt: string;
}

const VALID_READING_TYPES: ReadingType[] = [
  'blood_pressure',
  'blood_glucose',
  'heart_rate',
  'spo2',
  'temperature',
  'weight',
];

const VALID_UNITS: ReadingUnit[] = ['mmHg', 'mg/dL', 'bpm', 'percent', 'celsius', 'kg'];

/**
 * Converts a HealthReading domain object into the canonical JSON response format.
 * Dates are serialized as ISO 8601 strings. secondaryValue is included as null if absent.
 */
export function formatReading(reading: HealthReading): HealthReadingJson {
  return {
    id: reading.id,
    deviceId: reading.deviceId,
    seniorId: reading.seniorId,
    dailyRecordId: reading.dailyRecordId,
    readingType: reading.readingType,
    measuredValue: reading.measuredValue,
    secondaryValue: reading.secondaryValue ?? null,
    unit: reading.unit,
    timestamp: reading.timestamp.toISOString(),
    createdAt: reading.createdAt.toISOString(),
  };
}

/**
 * Parses a JSON object (from API response format) back into a typed HealthReading domain object.
 * Date strings are parsed back to Date objects. Throws ValidationError if parse fails.
 */
export function parseReading(json: unknown): HealthReading {
  const errors: Array<{ field: string; message: string; received?: unknown }> = [];

  if (json === null || json === undefined || typeof json !== 'object') {
    throw new ValidationError([{ field: 'payload', message: 'Expected a JSON object' }]);
  }

  const obj = json as Record<string, unknown>;

  // Validate required string fields
  const id = validateString(obj, 'id', errors);
  const deviceId = validateString(obj, 'deviceId', errors);
  const seniorId = validateString(obj, 'seniorId', errors);
  const dailyRecordId = validateString(obj, 'dailyRecordId', errors);

  // Validate readingType
  let readingType: ReadingType | undefined;
  if (typeof obj['readingType'] !== 'string') {
    errors.push({
      field: 'readingType',
      message: 'Required field must be a string',
      received: obj['readingType'],
    });
  } else if (!VALID_READING_TYPES.includes(obj['readingType'] as ReadingType)) {
    errors.push({
      field: 'readingType',
      message: `Must be one of: ${VALID_READING_TYPES.join(', ')}`,
      received: obj['readingType'],
    });
  } else {
    readingType = obj['readingType'] as ReadingType;
  }

  // Validate measuredValue
  let measuredValue: number | undefined;
  if (typeof obj['measuredValue'] !== 'number' || isNaN(obj['measuredValue'])) {
    errors.push({
      field: 'measuredValue',
      message: 'Required field must be a number',
      received: obj['measuredValue'],
    });
  } else {
    measuredValue = obj['measuredValue'];
  }

  // Validate secondaryValue (optional — null or number)
  let secondaryValue: number | undefined;
  if (obj['secondaryValue'] !== null && obj['secondaryValue'] !== undefined) {
    if (typeof obj['secondaryValue'] !== 'number' || isNaN(obj['secondaryValue'])) {
      errors.push({
        field: 'secondaryValue',
        message: 'Must be a number or null',
        received: obj['secondaryValue'],
      });
    } else {
      secondaryValue = obj['secondaryValue'];
    }
  }

  // Validate unit
  let unit: ReadingUnit | undefined;
  if (typeof obj['unit'] !== 'string') {
    errors.push({
      field: 'unit',
      message: 'Required field must be a string',
      received: obj['unit'],
    });
  } else if (!VALID_UNITS.includes(obj['unit'] as ReadingUnit)) {
    errors.push({
      field: 'unit',
      message: `Must be one of: ${VALID_UNITS.join(', ')}`,
      received: obj['unit'],
    });
  } else {
    unit = obj['unit'] as ReadingUnit;
  }

  // Validate timestamp
  const timestamp = validateDateString(obj, 'timestamp', errors);

  // Validate createdAt
  const createdAt = validateDateString(obj, 'createdAt', errors);

  if (errors.length > 0) {
    throw new ValidationError(errors);
  }

  const reading: HealthReading = {
    id: id!,
    deviceId: deviceId!,
    seniorId: seniorId!,
    dailyRecordId: dailyRecordId!,
    readingType: readingType!,
    measuredValue: measuredValue!,
    unit: unit!,
    timestamp: timestamp!,
    createdAt: createdAt!,
  };

  if (secondaryValue !== undefined) {
    reading.secondaryValue = secondaryValue;
  }

  return reading;
}

function validateString(
  obj: Record<string, unknown>,
  field: string,
  errors: Array<{ field: string; message: string; received?: unknown }>
): string | undefined {
  if (typeof obj[field] !== 'string' || obj[field] === '') {
    errors.push({
      field,
      message: 'Required field must be a non-empty string',
      received: obj[field],
    });
    return undefined;
  }
  return obj[field] as string;
}

function validateDateString(
  obj: Record<string, unknown>,
  field: string,
  errors: Array<{ field: string; message: string; received?: unknown }>
): Date | undefined {
  if (typeof obj[field] !== 'string') {
    errors.push({
      field,
      message: 'Required field must be an ISO 8601 date string',
      received: obj[field],
    });
    return undefined;
  }

  const date = new Date(obj[field] as string);
  if (isNaN(date.getTime())) {
    errors.push({
      field,
      message: 'Invalid date format, expected ISO 8601',
      received: obj[field],
    });
    return undefined;
  }

  return date;
}
