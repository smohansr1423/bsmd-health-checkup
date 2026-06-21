/**
 * Device Integration Service
 * Manages health reading ingestion, daily record aggregation, and alert retrieval.
 * Validates: Requirements 2.2, 2.3, 3.1, 3.2, 3.3, 3.4, 7.1
 */

import type {
  HealthReading,
  HealthReadingRequest,
  DailyHealthRecord,
  LatestReadingSummary,
  ReadingAlert,
  AlertFilters,
  ReadingType,
  AgeGroup,
} from './device-integration.types';

import { UnauthorizedDeviceError } from './device-integration.errors';

import {
  validateTimestamp,
  validatePlausibleRange,
  validateBloodPressure,
} from './device-gateway';

import type { DeviceRepository } from './device-registration.service';
import type { ReadingAlertEngine } from './reading-alert-engine';

// ─── Repository Interfaces ─────────────────────────────────────────────────────

/**
 * Repository interface for HealthReading persistence.
 */
export interface HealthReadingRepository {
  findById(id: string): Promise<HealthReading | null>;
  findByDailyRecordId(dailyRecordId: string): Promise<HealthReading[]>;
  create(reading: HealthReading): Promise<HealthReading>;
}

/**
 * Repository interface for DailyHealthRecord persistence.
 */
export interface DailyHealthRecordRepository {
  findBySeniorAndDate(seniorId: string, date: string): Promise<DailyHealthRecord | null>;
  findBySeniorAndDateRange(
    seniorId: string,
    startDate: string,
    endDate: string
  ): Promise<DailyHealthRecord[]>;
  create(record: DailyHealthRecord): Promise<DailyHealthRecord>;
  update(record: DailyHealthRecord): Promise<DailyHealthRecord>;
}

// ─── In-Memory Repository Implementations ──────────────────────────────────────

/**
 * In-memory implementation of HealthReadingRepository.
 * Suitable for development and testing.
 */
export class InMemoryHealthReadingRepository implements HealthReadingRepository {
  private readings: HealthReading[] = [];

  async findById(id: string): Promise<HealthReading | null> {
    return this.readings.find((r) => r.id === id) ?? null;
  }

  async findByDailyRecordId(dailyRecordId: string): Promise<HealthReading[]> {
    return this.readings.filter((r) => r.dailyRecordId === dailyRecordId);
  }

  async create(reading: HealthReading): Promise<HealthReading> {
    this.readings.push(reading);
    return reading;
  }

  /** Utility for testing: clear all stored readings */
  clear(): void {
    this.readings = [];
  }
}

/**
 * In-memory implementation of DailyHealthRecordRepository.
 * Suitable for development and testing.
 */
export class InMemoryDailyHealthRecordRepository implements DailyHealthRecordRepository {
  private records: DailyHealthRecord[] = [];

  async findBySeniorAndDate(seniorId: string, date: string): Promise<DailyHealthRecord | null> {
    return (
      this.records.find((r) => r.seniorId === seniorId && r.date === date) ?? null
    );
  }

  async findBySeniorAndDateRange(
    seniorId: string,
    startDate: string,
    endDate: string
  ): Promise<DailyHealthRecord[]> {
    return this.records.filter(
      (r) => r.seniorId === seniorId && r.date >= startDate && r.date <= endDate
    );
  }

  async create(record: DailyHealthRecord): Promise<DailyHealthRecord> {
    this.records.push(record);
    return record;
  }

  async update(record: DailyHealthRecord): Promise<DailyHealthRecord> {
    const index = this.records.findIndex((r) => r.id === record.id);
    if (index === -1) {
      throw new Error(`DailyHealthRecord not found: ${record.id}`);
    }
    this.records[index] = record;
    return record;
  }

  /** Utility for testing: clear all stored records */
  clear(): void {
    this.records = [];
  }
}

// ─── Service Dependencies ──────────────────────────────────────────────────────

export interface DeviceIntegrationDependencies {
  deviceRepository: DeviceRepository;
  readingRepository: HealthReadingRepository;
  dailyRecordRepository: DailyHealthRecordRepository;
  alertEngine?: ReadingAlertEngine;
  seniorAgeGroupProvider?: (seniorId: string) => Promise<AgeGroup>;
  idGenerator: () => string;
  dateProvider: () => Date;
}

/** Default ID generator using timestamp + random suffix */
const defaultIdGenerator = (): string => {
  return `RDG_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
};

/** Default date provider returning the current system date */
const defaultDateProvider = (): Date => new Date();

// ─── Service Implementation ────────────────────────────────────────────────────

/**
 * DeviceIntegrationService implementation.
 *
 * Handles reading ingestion, daily record management, and alert retrieval.
 * Uses dependency injection for repositories, ID generation, and date provision.
 */
export class DeviceIntegrationService {
  private readonly deviceRepository: DeviceRepository;
  private readonly readingRepository: HealthReadingRepository;
  private readonly dailyRecordRepository: DailyHealthRecordRepository;
  private readonly alertEngine?: ReadingAlertEngine;
  private readonly seniorAgeGroupProvider?: (seniorId: string) => Promise<AgeGroup>;
  private readonly idGenerator: () => string;
  private readonly dateProvider: () => Date;

  constructor(deps: DeviceIntegrationDependencies) {
    this.deviceRepository = deps.deviceRepository;
    this.readingRepository = deps.readingRepository;
    this.dailyRecordRepository = deps.dailyRecordRepository;
    this.alertEngine = deps.alertEngine;
    this.seniorAgeGroupProvider = deps.seniorAgeGroupProvider;
    this.idGenerator = deps.idGenerator ?? defaultIdGenerator;
    this.dateProvider = deps.dateProvider ?? defaultDateProvider;
  }

  /**
   * Ingest a health reading from a registered, active device.
   *
   * Requirement 2.2: Store the Health_Reading and associate it with the Senior and DailyHealthRecord.
   * Requirement 2.3: Reject readings from unregistered or inactive devices.
   * Requirement 3.1: Create a new DailyHealthRecord if none exists for this Senior+date.
   * Requirement 3.2: Append to existing DailyHealthRecord if one already exists.
   * Requirement 3.4: Update latest-reading summary per reading type.
   * Requirement 7.1: Update device lastSyncTimestamp on successful ingestion.
   *
   * @throws UnauthorizedDeviceError if device is not found or inactive
   * @throws TimestampOutOfRangeError if timestamp is out of bounds
   * @throws ImplausibleValueError if value is outside plausible range
   * @throws ValidationError if blood pressure is missing secondaryValue
   */
  async ingestReading(request: HealthReadingRequest): Promise<HealthReading> {
    // 1. Verify device is registered and active (Req 2.3)
    const device = await this.deviceRepository.findById(request.deviceId);
    if (!device || !device.isActive) {
      throw new UnauthorizedDeviceError(request.deviceId);
    }

    // 2. Validate using gateway functions
    validateTimestamp(request.timestamp);

    if (request.readingType === 'blood_pressure') {
      validateBloodPressure(request.measuredValue, request.secondaryValue);
    } else {
      validatePlausibleRange(request.readingType, request.measuredValue);
    }

    // 3. Determine the calendar date for this reading
    const readingDate = this.extractDate(request.timestamp);

    // 4. Find or create DailyHealthRecord (Req 3.1, 3.2) — atomic operation
    let dailyRecord = await this.dailyRecordRepository.findBySeniorAndDate(
      device.seniorId,
      readingDate
    );

    const now = this.dateProvider();

    if (!dailyRecord) {
      // Create new DailyHealthRecord (Req 3.1)
      dailyRecord = {
        id: this.idGenerator(),
        seniorId: device.seniorId,
        date: readingDate,
        readings: [],
        latestReadings: [],
        createdAt: now,
        updatedAt: now,
      };
      dailyRecord = await this.dailyRecordRepository.create(dailyRecord);
    }

    // 5. Create HealthReading linked to device, senior, and daily record (Req 2.2)
    const healthReading: HealthReading = {
      id: this.idGenerator(),
      deviceId: request.deviceId,
      seniorId: device.seniorId,
      dailyRecordId: dailyRecord.id,
      readingType: request.readingType,
      measuredValue: request.measuredValue,
      secondaryValue: request.secondaryValue,
      unit: request.unit,
      timestamp: new Date(request.timestamp),
      createdAt: now,
    };

    await this.readingRepository.create(healthReading);

    // 6. Update daily record: append reading + update latestReadings summary (Req 3.4)
    dailyRecord.readings.push(healthReading);
    dailyRecord.latestReadings = this.updateLatestReadings(
      dailyRecord.latestReadings,
      healthReading
    );
    dailyRecord.updatedAt = now;
    await this.dailyRecordRepository.update(dailyRecord);

    // 7. Update device lastSyncTimestamp (Req 7.1)
    const updatedDevice = { ...device, lastSyncTimestamp: now };
    await this.deviceRepository.update(updatedDevice);

    // 8. Evaluate reading against Normal Range (Req 4.1)
    if (this.alertEngine && this.seniorAgeGroupProvider) {
      const ageGroup = await this.seniorAgeGroupProvider(device.seniorId);
      await this.alertEngine.evaluateReading(healthReading, ageGroup);
    }

    return healthReading;
  }

  /**
   * Get the daily health record for a specific Senior and date.
   * Returns all readings grouped by readingType.
   *
   * Requirement 3.3: Return all Health_Readings for that Senior on that date grouped by reading type.
   */
  async getDailyRecord(
    seniorId: string,
    date: string
  ): Promise<DailyHealthRecordGrouped | null> {
    const record = await this.dailyRecordRepository.findBySeniorAndDate(seniorId, date);
    if (!record) {
      return null;
    }

    // Fetch all readings for this daily record
    const readings = await this.readingRepository.findByDailyRecordId(record.id);

    return {
      ...record,
      readings,
      readingsByType: this.groupReadingsByType(readings),
    };
  }

  /**
   * Get daily health records for a Senior within a date range.
   * Each record includes readings grouped by type.
   *
   * Requirement 3.3: Return all Health_Readings grouped by reading type.
   */
  async getDailyRecords(
    seniorId: string,
    startDate: string,
    endDate: string
  ): Promise<DailyHealthRecordGrouped[]> {
    const records = await this.dailyRecordRepository.findBySeniorAndDateRange(
      seniorId,
      startDate,
      endDate
    );

    const grouped: DailyHealthRecordGrouped[] = [];
    for (const record of records) {
      const readings = await this.readingRepository.findByDailyRecordId(record.id);
      grouped.push({
        ...record,
        readings,
        readingsByType: this.groupReadingsByType(readings),
      });
    }

    return grouped;
  }

  /**
   * Get alerts for a Senior with optional filters.
   * Delegates to the Reading Alert Engine for persistence queries.
   *
   * Requirement 4.4: Retrieve persisted alerts.
   */
  async getAlerts(seniorId: string, filters?: AlertFilters): Promise<ReadingAlert[]> {
    if (this.alertEngine) {
      return this.alertEngine.getAlerts(seniorId, filters);
    }
    return [];
  }

  // ─── Private Helpers ───────────────────────────────────────────────────────────

  /**
   * Extract YYYY-MM-DD date string from an ISO 8601 timestamp.
   */
  private extractDate(timestamp: string): string {
    const date = new Date(timestamp);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  /**
   * Update the latest readings summary for a daily record.
   * Keeps only the most recent reading per readingType.
   *
   * Requirement 3.4: Compute latest-reading summary per reading type.
   */
  private updateLatestReadings(
    currentSummary: LatestReadingSummary[],
    newReading: HealthReading
  ): LatestReadingSummary[] {
    const updatedSummary = [...currentSummary];

    const existingIndex = updatedSummary.findIndex(
      (s) => s.readingType === newReading.readingType
    );

    const newEntry: LatestReadingSummary = {
      readingType: newReading.readingType,
      measuredValue: newReading.measuredValue,
      secondaryValue: newReading.secondaryValue,
      unit: newReading.unit,
      timestamp: newReading.timestamp,
    };

    if (existingIndex === -1) {
      // No existing entry for this type — add it
      updatedSummary.push(newEntry);
    } else {
      // Replace if the new reading is more recent
      const existing = updatedSummary[existingIndex];
      if (newReading.timestamp >= existing.timestamp) {
        updatedSummary[existingIndex] = newEntry;
      }
    }

    return updatedSummary;
  }

  /**
   * Group an array of readings by their readingType.
   */
  private groupReadingsByType(
    readings: HealthReading[]
  ): Record<string, HealthReading[]> {
    const grouped: Record<string, HealthReading[]> = {};

    for (const reading of readings) {
      if (!grouped[reading.readingType]) {
        grouped[reading.readingType] = [];
      }
      grouped[reading.readingType].push(reading);
    }

    return grouped;
  }
}

// ─── Response Types ────────────────────────────────────────────────────────────

/**
 * A DailyHealthRecord with readings grouped by type for API responses.
 */
export interface DailyHealthRecordGrouped extends DailyHealthRecord {
  readingsByType: Record<string, HealthReading[]>;
}
