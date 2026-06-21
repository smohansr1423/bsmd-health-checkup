/**
 * Device Gateway — Ingestion validation layer
 * Validates incoming device reading payloads before they reach the Device Integration Service.
 *
 * Validates: Requirements 2.1, 2.4, 2.5, 2.6, 10.1, 10.2, 10.4
 */

import {
  type ReadingType,
  type ReadingUnit,
  type HealthReadingRequest,
  PLAUSIBLE_RANGES,
} from './device-integration.types';

import {
  ValidationError,
  TimestampOutOfRangeError,
  ImplausibleValueError,
} from './device-integration.errors';

/** Valid reading types */
const VALID_READING_TYPES: ReadingType[] = [
  'blood_pressure',
  'blood_glucose',
  'heart_rate',
  'spo2',
  'temperature',
  'weight',
];

/** Valid reading units */
const VALID_READING_UNITS: ReadingUnit[] = [
  'mmHg',
  'mg/dL',
  'bpm',
  'percent',
  'celsius',
  'kg',
];

/** Maps each reading type to its compatible unit */
const READING_TYPE_UNIT_MAP: Record<ReadingType, ReadingUnit> = {
  blood_pressure: 'mmHg',
  blood_glucose: 'mg/dL',
  heart_rate: 'bpm',
  spo2: 'percent',
  temperature: 'celsius',
  weight: 'kg',
};

/** 24 hours in milliseconds */
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

/**
 * Validates that a timestamp string is a valid ISO 8601 date and
 * falls within acceptable bounds (not >24h in the past, not in the future).
 *
 * @throws TimestampOutOfRangeError if the timestamp is out of bounds
 */
export function validateTimestamp(timestamp: string): void {
  const parsedDate = new Date(timestamp);

  if (isNaN(parsedDate.getTime())) {
    throw new TimestampOutOfRangeError(timestamp);
  }

  const now = Date.now();
  const timestampMs = parsedDate.getTime();

  // Reject timestamps in the future
  if (timestampMs > now) {
    throw new TimestampOutOfRangeError(timestamp);
  }

  // Reject timestamps more than 24 hours in the past
  if (now - timestampMs > TWENTY_FOUR_HOURS_MS) {
    throw new TimestampOutOfRangeError(timestamp);
  }
}

/**
 * Validates that a measured value falls within the plausible range for its reading type.
 *
 * @throws ImplausibleValueError if value is outside the plausible range
 */
export function validatePlausibleRange(readingType: ReadingType, value: number): void {
  const range = PLAUSIBLE_RANGES[readingType];

  if (value < range.min || value > range.max) {
    throw new ImplausibleValueError(readingType, value, range.min, range.max);
  }
}

/**
 * Validates blood pressure readings: both systolic (measuredValue) and diastolic
 * (secondaryValue) must be present and within plausible range.
 *
 * @throws ValidationError if secondaryValue is missing for blood pressure
 * @throws ImplausibleValueError if either value is outside plausible range
 */
export function validateBloodPressure(measuredValue: number, secondaryValue?: number): void {
  if (secondaryValue === undefined || secondaryValue === null) {
    throw new ValidationError([
      {
        field: 'secondaryValue',
        message: 'secondaryValue (diastolic) is required for blood_pressure readings',
        received: secondaryValue,
      },
    ]);
  }

  // Validate systolic (measuredValue) is plausible
  validatePlausibleRange('blood_pressure', measuredValue);

  // Validate diastolic (secondaryValue) is also plausible — uses same range
  const range = PLAUSIBLE_RANGES['blood_pressure'];
  if (secondaryValue < range.min || secondaryValue > range.max) {
    throw new ImplausibleValueError('blood_pressure', secondaryValue, range.min, range.max);
  }
}

/**
 * Validates a raw reading payload and returns a typed HealthReadingRequest.
 * Checks required fields, correct types, readingType/unit compatibility,
 * timestamp bounds, and plausible value ranges.
 *
 * @throws ValidationError with field-level errors if the payload is invalid
 * @throws TimestampOutOfRangeError if timestamp is out of bounds
 * @throws ImplausibleValueError if value is outside plausible range
 */
export function validateReadingPayload(rawPayload: unknown): HealthReadingRequest {
  const fieldErrors: Array<{ field: string; message: string; received?: unknown }> = [];

  // Must be a non-null object
  if (rawPayload === null || rawPayload === undefined || typeof rawPayload !== 'object') {
    throw new ValidationError([
      { field: 'payload', message: 'Payload must be a non-null object', received: rawPayload },
    ]);
  }

  const payload = rawPayload as Record<string, unknown>;

  // ─── deviceId ──────────────────────────────────────────────────────────────
  if (payload.deviceId === undefined || payload.deviceId === null) {
    fieldErrors.push({ field: 'deviceId', message: 'deviceId is required', received: undefined });
  } else if (typeof payload.deviceId !== 'string' || payload.deviceId.trim() === '') {
    fieldErrors.push({
      field: 'deviceId',
      message: 'deviceId must be a non-empty string',
      received: payload.deviceId,
    });
  }

  // ─── timestamp ─────────────────────────────────────────────────────────────
  if (payload.timestamp === undefined || payload.timestamp === null) {
    fieldErrors.push({ field: 'timestamp', message: 'timestamp is required', received: undefined });
  } else if (typeof payload.timestamp !== 'string') {
    fieldErrors.push({
      field: 'timestamp',
      message: 'timestamp must be a string in ISO 8601 format',
      received: payload.timestamp,
    });
  } else {
    const parsedDate = new Date(payload.timestamp);
    if (isNaN(parsedDate.getTime())) {
      fieldErrors.push({
        field: 'timestamp',
        message: 'timestamp must be a valid ISO 8601 date string',
        received: payload.timestamp,
      });
    }
  }

  // ─── readingType ───────────────────────────────────────────────────────────
  if (payload.readingType === undefined || payload.readingType === null) {
    fieldErrors.push({
      field: 'readingType',
      message: 'readingType is required',
      received: undefined,
    });
  } else if (!VALID_READING_TYPES.includes(payload.readingType as ReadingType)) {
    fieldErrors.push({
      field: 'readingType',
      message: `readingType must be one of: ${VALID_READING_TYPES.join(', ')}`,
      received: payload.readingType,
    });
  }

  // ─── measuredValue ─────────────────────────────────────────────────────────
  if (payload.measuredValue === undefined || payload.measuredValue === null) {
    fieldErrors.push({
      field: 'measuredValue',
      message: 'measuredValue is required',
      received: undefined,
    });
  } else if (typeof payload.measuredValue !== 'number' || isNaN(payload.measuredValue)) {
    fieldErrors.push({
      field: 'measuredValue',
      message: 'measuredValue must be a number',
      received: payload.measuredValue,
    });
  }

  // ─── unit ──────────────────────────────────────────────────────────────────
  if (payload.unit === undefined || payload.unit === null) {
    fieldErrors.push({ field: 'unit', message: 'unit is required', received: undefined });
  } else if (!VALID_READING_UNITS.includes(payload.unit as ReadingUnit)) {
    fieldErrors.push({
      field: 'unit',
      message: `unit must be one of: ${VALID_READING_UNITS.join(', ')}`,
      received: payload.unit,
    });
  }

  // If there are basic field validation errors, throw early before semantic checks
  if (fieldErrors.length > 0) {
    throw new ValidationError(fieldErrors);
  }

  // At this point all basic fields are valid — do semantic cross-field checks
  const readingType = payload.readingType as ReadingType;
  const unit = payload.unit as ReadingUnit;
  const measuredValue = payload.measuredValue as number;
  const timestamp = payload.timestamp as string;
  const deviceId = payload.deviceId as string;
  const secondaryValue = payload.secondaryValue as number | undefined;

  // ─── readingType / unit compatibility ──────────────────────────────────────
  const expectedUnit = READING_TYPE_UNIT_MAP[readingType];
  if (unit !== expectedUnit) {
    throw new ValidationError([
      {
        field: 'unit',
        message: `Unit "${unit}" is not compatible with reading type "${readingType}". Expected "${expectedUnit}"`,
        received: unit,
      },
    ]);
  }

  // ─── Timestamp boundary validation ─────────────────────────────────────────
  validateTimestamp(timestamp);

  // ─── Blood pressure dual-value handling ────────────────────────────────────
  if (readingType === 'blood_pressure') {
    validateBloodPressure(measuredValue, secondaryValue);
  } else {
    // ─── Plausible range check for non-blood-pressure ────────────────────────
    validatePlausibleRange(readingType, measuredValue);
  }

  // Build and return the typed request object
  const result: HealthReadingRequest = {
    deviceId,
    timestamp,
    readingType,
    measuredValue,
    unit,
  };

  if (secondaryValue !== undefined) {
    result.secondaryValue = secondaryValue;
  }

  return result;
}
