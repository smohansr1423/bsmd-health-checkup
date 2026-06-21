/**
 * Reading Alert Engine
 * Evaluates health readings against configured Normal Ranges and generates alerts.
 * Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5
 */

import type {
  HealthReading,
  ReadingAlert,
  AlertResult,
  AlertFilters,
  ReadingType,
  AgeGroup,
} from './device-integration.types';

import type { NormalRangeRepository } from './normal-range.service';

// ─── Repository Interface ──────────────────────────────────────────────────────

/**
 * Repository interface for ReadingAlert persistence.
 * Implementations can be in-memory (testing) or database-backed (production).
 */
export interface ReadingAlertRepository {
  findBySeniorId(seniorId: string, filters?: AlertFilters): Promise<ReadingAlert[]>;
  create(alert: ReadingAlert): Promise<ReadingAlert>;
}

// ─── In-Memory Repository ──────────────────────────────────────────────────────

/**
 * In-memory implementation of ReadingAlertRepository.
 * Suitable for development and testing.
 */
export class InMemoryReadingAlertRepository implements ReadingAlertRepository {
  private alerts: ReadingAlert[] = [];

  async findBySeniorId(seniorId: string, filters?: AlertFilters): Promise<ReadingAlert[]> {
    let results = this.alerts.filter((a) => a.seniorId === seniorId);

    if (filters?.severity) {
      results = results.filter((a) => a.severity === filters.severity);
    }

    if (filters?.readingType) {
      results = results.filter((a) => a.readingType === filters.readingType);
    }

    if (filters?.startDate) {
      const start = new Date(filters.startDate);
      results = results.filter((a) => a.createdAt >= start);
    }

    if (filters?.endDate) {
      const end = new Date(filters.endDate);
      results = results.filter((a) => a.createdAt <= end);
    }

    return results;
  }

  async create(alert: ReadingAlert): Promise<ReadingAlert> {
    this.alerts.push(alert);
    return alert;
  }

  /** Utility for testing: clear all stored alerts */
  clear(): void {
    this.alerts = [];
  }
}

// ─── Event Publisher Interface ──────────────────────────────────────────────────

/**
 * Interface for publishing domain events to the event bus.
 * Abstracts the underlying event bus implementation.
 */
export interface EventPublisher {
  publish(event: unknown): void;
}

// ─── Service Dependencies ──────────────────────────────────────────────────────

export interface ReadingAlertEngineDependencies {
  normalRangeRepository: NormalRangeRepository;
  alertRepository: ReadingAlertRepository;
  eventPublisher?: EventPublisher;
  idGenerator: () => string;
  dateProvider: () => Date;
}

/** Default ID generator using timestamp + random suffix */
const defaultIdGenerator = (): string => {
  return `ALT_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
};

/** Default date provider returning the current system date */
const defaultDateProvider = (): Date => new Date();

// ─── Reading Alert Engine Implementation ───────────────────────────────────────

/**
 * ReadingAlertEngine implementation.
 *
 * Evaluates health readings against configured Normal Ranges and:
 * - Classifies readings as normal, warning, or critical
 * - Persists alerts for warning and critical classifications
 * - Publishes DeviceReadingAlertRaisedEvent for critical alerts
 *
 * Alert classification logic:
 * - value < criticalLow → severity: 'critical', direction: 'below'
 * - value > criticalHigh → severity: 'critical', direction: 'above'
 * - criticalLow ≤ value < normalLow → severity: 'warning', direction: 'below'
 * - normalHigh < value ≤ criticalHigh → severity: 'warning', direction: 'above'
 * - normalLow ≤ value ≤ normalHigh → no alert (triggered: false)
 */
export class ReadingAlertEngine {
  private readonly normalRangeRepository: NormalRangeRepository;
  private readonly alertRepository: ReadingAlertRepository;
  private readonly eventPublisher?: EventPublisher;
  private readonly idGenerator: () => string;
  private readonly dateProvider: () => Date;

  constructor(deps: ReadingAlertEngineDependencies) {
    this.normalRangeRepository = deps.normalRangeRepository;
    this.alertRepository = deps.alertRepository;
    this.eventPublisher = deps.eventPublisher;
    this.idGenerator = deps.idGenerator ?? defaultIdGenerator;
    this.dateProvider = deps.dateProvider ?? defaultDateProvider;
  }

  /**
   * Evaluate a health reading against the applicable Normal Range.
   *
   * Requirement 4.1: Evaluate the measured value against the configured Normal_Range
   *                  for the reading type and the Senior's age group.
   * Requirement 4.2: Generate a critical alert when value is below critical low
   *                  or above critical high.
   * Requirement 4.3: Generate a warning alert when value is in the borderline range.
   * Requirement 4.4: Persist the alert with all required fields.
   * Requirement 4.5: Publish DeviceReadingAlertRaisedEvent for critical alerts.
   *
   * For blood_pressure readings, evaluates the measuredValue (systolic) against the range.
   *
   * @param reading - The health reading to evaluate
   * @param seniorAgeGroup - The age group of the senior for range lookup
   * @returns AlertResult indicating whether an alert was triggered and its details
   */
  async evaluateReading(
    reading: HealthReading,
    seniorAgeGroup: AgeGroup
  ): Promise<AlertResult> {
    // 1. Lookup the Normal Range for this reading type + age group
    const normalRange = await this.normalRangeRepository.findByReadingTypeAndAgeGroup(
      reading.readingType,
      seniorAgeGroup
    );

    // If no range is configured, no alert can be generated
    if (!normalRange) {
      return { triggered: false };
    }

    // 2. Classify the value against thresholds
    const value = reading.measuredValue;
    const { criticalLow, normalLow, normalHigh, criticalHigh } = normalRange;

    let severity: 'warning' | 'critical' | undefined;
    let direction: 'above' | 'below' | undefined;
    let thresholdBreached: number | undefined;

    if (value < criticalLow) {
      // Critical: below critical low
      severity = 'critical';
      direction = 'below';
      thresholdBreached = criticalLow;
    } else if (value > criticalHigh) {
      // Critical: above critical high
      severity = 'critical';
      direction = 'above';
      thresholdBreached = criticalHigh;
    } else if (value < normalLow) {
      // Warning: between criticalLow (inclusive) and normalLow (exclusive)
      severity = 'warning';
      direction = 'below';
      thresholdBreached = normalLow;
    } else if (value > normalHigh) {
      // Warning: between normalHigh (exclusive) and criticalHigh (inclusive)
      severity = 'warning';
      direction = 'above';
      thresholdBreached = normalHigh;
    } else {
      // Normal: normalLow ≤ value ≤ normalHigh
      return { triggered: false };
    }

    // 3. Persist the alert (Req 4.4)
    const now = this.dateProvider();
    const alertId = this.idGenerator();

    const alert: ReadingAlert = {
      id: alertId,
      seniorId: reading.seniorId,
      readingId: reading.id,
      readingType: reading.readingType,
      measuredValue: reading.measuredValue,
      thresholdBreached: thresholdBreached!,
      severity: severity!,
      direction: direction!,
      createdAt: now,
    };

    await this.alertRepository.create(alert);

    // 4. Publish event for critical alerts (Req 4.5)
    if (severity === 'critical' && this.eventPublisher) {
      this.eventPublisher.publish({
        id: this.idGenerator(),
        type: 'DeviceReadingAlertRaised' as const,
        occurredAt: now.toISOString(),
        sourceId: alertId,
        payload: {
          alertId,
          seniorId: reading.seniorId,
          readingId: reading.id,
          readingType: reading.readingType,
          measuredValue: reading.measuredValue,
          thresholdBreached: thresholdBreached!,
          severity: 'critical',
          direction: direction!,
          assignedProviderId: '', // To be resolved by the notification service
        },
      });
    }

    // 5. Return the alert result
    return {
      triggered: true,
      severity,
      thresholdBreached,
      direction,
    };
  }

  /**
   * Retrieve alerts for a senior with optional filters.
   *
   * @param seniorId - The senior citizen ID
   * @param filters - Optional filters for severity, readingType, and date range
   * @returns Array of ReadingAlert matching the criteria
   */
  async getAlerts(seniorId: string, filters?: AlertFilters): Promise<ReadingAlert[]> {
    return this.alertRepository.findBySeniorId(seniorId, filters);
  }
}
