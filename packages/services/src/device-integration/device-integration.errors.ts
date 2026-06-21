/**
 * Device Integration Service Errors
 * Custom error types for the device integration domain.
 * Validates: Requirements 1.3, 2.3, 2.6, 5.2, 10.1, 10.4
 */

/**
 * Thrown when a device registration request specifies a serial number
 * already registered to a different Senior.
 *
 * HTTP 409 — DEVICE_CONFLICT
 */
export class DeviceConflictError extends Error {
  public readonly serialNumber: string;
  public readonly existingSeniorId: string;

  constructor(serialNumber: string, existingSeniorId: string) {
    super(
      `Device with serial number "${serialNumber}" is already registered to senior ${existingSeniorId}.`
    );
    this.name = 'DeviceConflictError';
    this.serialNumber = serialNumber;
    this.existingSeniorId = existingSeniorId;
  }
}

/**
 * Thrown when a reading is submitted from an unregistered or inactive device.
 *
 * HTTP 401 — UNAUTHORIZED_DEVICE
 */
export class UnauthorizedDeviceError extends Error {
  public readonly deviceId: string;

  constructor(deviceId: string) {
    super(`Device "${deviceId}" is not registered or is inactive.`);
    this.name = 'UnauthorizedDeviceError';
    this.deviceId = deviceId;
  }
}

/**
 * Thrown when a reading timestamp is more than 24 hours in the past
 * or any time in the future.
 *
 * HTTP 400 — TIMESTAMP_OUT_OF_RANGE
 */
export class TimestampOutOfRangeError extends Error {
  public readonly timestamp: string;

  constructor(timestamp: string) {
    super(
      `Timestamp "${timestamp}" is out of range. Must be within 24 hours in the past and not in the future.`
    );
    this.name = 'TimestampOutOfRangeError';
    this.timestamp = timestamp;
  }
}

/**
 * Thrown when a reading value is outside the physically plausible range
 * for its reading type.
 *
 * HTTP 400 — IMPLAUSIBLE_VALUE
 */
export class ImplausibleValueError extends Error {
  public readonly readingType: string;
  public readonly value: number;
  public readonly min: number;
  public readonly max: number;

  constructor(readingType: string, value: number, min: number, max: number) {
    super(
      `Value ${value} is outside the plausible range [${min}, ${max}] for reading type "${readingType}".`
    );
    this.name = 'ImplausibleValueError';
    this.readingType = readingType;
    this.value = value;
    this.min = min;
    this.max = max;
  }
}

/**
 * Thrown when a Normal Range configuration violates the ordering constraint:
 * criticalLow ≤ borderlineLow ≤ normalLow ≤ normalHigh ≤ borderlineHigh ≤ criticalHigh
 *
 * HTTP 422 — RANGE_ORDER_INVALID
 */
export class RangeOrderInvalidError extends Error {
  public readonly details: string;

  constructor(details: string) {
    super(`Normal range ordering is invalid: ${details}`);
    this.name = 'RangeOrderInvalidError';
    this.details = details;
  }
}

/**
 * Thrown when a reading payload fails schema validation.
 * Contains structured field-level validation errors.
 *
 * HTTP 400 — VALIDATION_ERROR
 */
export class ValidationError extends Error {
  public readonly errors: Array<{ field: string; message: string; received?: unknown }>;

  constructor(errors: Array<{ field: string; message: string; received?: unknown }>) {
    const summary = errors.map((e) => `${e.field}: ${e.message}`).join('; ');
    super(`Validation failed: ${summary}`);
    this.name = 'ValidationError';
    this.errors = errors;
  }
}
