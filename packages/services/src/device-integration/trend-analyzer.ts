/**
 * Trend Analyzer
 * Computes statistical summaries over configurable time periods and determines
 * trend direction from historical readings.
 * Validates: Requirements 6.1
 */

import type {
  HealthReading,
  ReadingType,
  TrendSummary,
} from './device-integration.types';

// ─── Interfaces ─────────────────────────────────────────────────────────────────

/**
 * Data source interface for querying health readings by senior, type, and date range.
 */
export interface ReadingsDataSource {
  findBySeniorAndTypeInRange(
    seniorId: string,
    readingType: ReadingType,
    startDate: Date,
    endDate: Date
  ): Promise<HealthReading[]>;
}

/**
 * Date provider interface for testable date/time operations.
 */
export interface DateProvider {
  now(): Date;
}

/**
 * Default date provider using system clock.
 */
export class SystemDateProvider implements DateProvider {
  now(): Date {
    return new Date();
  }
}

// ─── Trend Direction Type ───────────────────────────────────────────────────────

export type TrendDirection = 'improving' | 'stable' | 'declining';

export type TrendPeriod = 'daily' | '7day' | '30day';

// ─── In-Memory Data Source ──────────────────────────────────────────────────────

/**
 * In-memory implementation of ReadingsDataSource for testing.
 */
export class InMemoryReadingsDataSource implements ReadingsDataSource {
  private readings: HealthReading[] = [];

  addReading(reading: HealthReading): void {
    this.readings.push(reading);
  }

  addReadings(readings: HealthReading[]): void {
    this.readings.push(...readings);
  }

  clear(): void {
    this.readings = [];
  }

  async findBySeniorAndTypeInRange(
    seniorId: string,
    readingType: ReadingType,
    startDate: Date,
    endDate: Date
  ): Promise<HealthReading[]> {
    return this.readings.filter(
      (r) =>
        r.seniorId === seniorId &&
        r.readingType === readingType &&
        r.timestamp >= startDate &&
        r.timestamp <= endDate
    );
  }
}

// ─── Trend Analyzer ─────────────────────────────────────────────────────────────

/**
 * TrendAnalyzer computes statistical summaries and trend direction
 * for health readings over configurable time periods.
 */
export class TrendAnalyzer {
  private readonly dataSource: ReadingsDataSource;
  private readonly dateProvider: DateProvider;

  constructor(dataSource: ReadingsDataSource, dateProvider?: DateProvider) {
    this.dataSource = dataSource;
    this.dateProvider = dateProvider ?? new SystemDateProvider();
  }

  /**
   * Computes trend summary (mean, min, max, count) for a given senior,
   * reading type, and time period.
   *
   * Periods:
   * - 'daily': last 24 hours
   * - '7day': last 7 days
   * - '30day': last 30 days
   *
   * If no readings exist in the range, returns mean=0, min=0, max=0, count=0.
   */
  async computeTrend(
    seniorId: string,
    readingType: ReadingType,
    period: TrendPeriod
  ): Promise<TrendSummary> {
    const now = this.dateProvider.now();
    const startDate = this.getStartDate(now, period);

    const readings = await this.dataSource.findBySeniorAndTypeInRange(
      seniorId,
      readingType,
      startDate,
      now
    );

    if (readings.length === 0) {
      return {
        readingType,
        period,
        mean: 0,
        min: 0,
        max: 0,
        count: 0,
        startDate: startDate.toISOString(),
        endDate: now.toISOString(),
      };
    }

    const values = readings.map((r) => r.measuredValue);
    const sum = values.reduce((acc, v) => acc + v, 0);
    const mean = sum / values.length;
    const min = Math.min(...values);
    const max = Math.max(...values);

    return {
      readingType,
      period,
      mean,
      min,
      max,
      count: values.length,
      startDate: startDate.toISOString(),
      endDate: now.toISOString(),
    };
  }

  /**
   * Determines the trend direction by comparing the mean of the last 7 days
   * against the mean of the 7 days before that.
   *
   * Direction logic (for most vitals, lower is healthier):
   * - If current mean is more than 5% lower than previous → 'improving'
   * - If current mean is more than 5% higher than previous → 'declining'
   * - Otherwise → 'stable'
   *
   * Special case: for spo2, higher is better (logic is reversed).
   */
  async getTrendDirection(
    seniorId: string,
    readingType: ReadingType
  ): Promise<TrendDirection> {
    const now = this.dateProvider.now();

    // Current period: last 7 days
    const currentStart = this.subtractDays(now, 7);
    // Previous period: 7 days before the current period
    const previousStart = this.subtractDays(now, 14);
    const previousEnd = currentStart;

    const currentReadings = await this.dataSource.findBySeniorAndTypeInRange(
      seniorId,
      readingType,
      currentStart,
      now
    );

    const previousReadings = await this.dataSource.findBySeniorAndTypeInRange(
      seniorId,
      readingType,
      previousStart,
      previousEnd
    );

    // If either period has no readings, cannot determine direction → stable
    if (currentReadings.length === 0 || previousReadings.length === 0) {
      return 'stable';
    }

    const currentMean = this.computeMean(currentReadings);
    const previousMean = this.computeMean(previousReadings);

    // Avoid division by zero
    if (previousMean === 0) {
      return 'stable';
    }

    const percentChange = ((currentMean - previousMean) / previousMean) * 100;

    // For spo2, higher is better (reverse logic)
    if (readingType === 'spo2') {
      if (percentChange > 5) {
        return 'improving';
      } else if (percentChange < -5) {
        return 'declining';
      }
      return 'stable';
    }

    // For all other vitals, lower is healthier
    if (percentChange < -5) {
      return 'improving';
    } else if (percentChange > 5) {
      return 'declining';
    }
    return 'stable';
  }

  // ─── Private Helpers ────────────────────────────────────────────────────────

  private getStartDate(now: Date, period: TrendPeriod): Date {
    switch (period) {
      case 'daily':
        return new Date(now.getTime() - 24 * 60 * 60 * 1000);
      case '7day':
        return this.subtractDays(now, 7);
      case '30day':
        return this.subtractDays(now, 30);
    }
  }

  private subtractDays(date: Date, days: number): Date {
    return new Date(date.getTime() - days * 24 * 60 * 60 * 1000);
  }

  private computeMean(readings: HealthReading[]): number {
    if (readings.length === 0) return 0;
    const sum = readings.reduce((acc, r) => acc + r.measuredValue, 0);
    return sum / readings.length;
  }
}
