/**
 * Trend Analyzer Tests
 * Unit tests for computeTrend() and getTrendDirection().
 * Validates: Requirements 6.1
 */

import type { HealthReading, ReadingType } from './device-integration.types';
import {
  TrendAnalyzer,
  InMemoryReadingsDataSource,
  type DateProvider,
} from './trend-analyzer';

// ─── Test Helpers ───────────────────────────────────────────────────────────────

function createFixedDateProvider(date: Date): DateProvider {
  return { now: () => date };
}

function createReading(overrides: Partial<HealthReading> = {}): HealthReading {
  return {
    id: 'reading-1',
    deviceId: 'device-1',
    seniorId: 'senior-1',
    dailyRecordId: 'record-1',
    readingType: 'heart_rate',
    measuredValue: 72,
    unit: 'bpm',
    timestamp: new Date('2024-01-15T10:00:00Z'),
    createdAt: new Date('2024-01-15T10:00:00Z'),
    ...overrides,
  };
}

// ─── computeTrend Tests ─────────────────────────────────────────────────────────

describe('TrendAnalyzer', () => {
  describe('computeTrend', () => {
    it('should return zero values when no readings exist in range', async () => {
      const dataSource = new InMemoryReadingsDataSource();
      const now = new Date('2024-01-15T12:00:00Z');
      const analyzer = new TrendAnalyzer(dataSource, createFixedDateProvider(now));

      const result = await analyzer.computeTrend('senior-1', 'heart_rate', 'daily');

      expect(result.mean).toBe(0);
      expect(result.min).toBe(0);
      expect(result.max).toBe(0);
      expect(result.count).toBe(0);
      expect(result.readingType).toBe('heart_rate');
      expect(result.period).toBe('daily');
    });

    it('should compute correct mean, min, max, count for daily period', async () => {
      const dataSource = new InMemoryReadingsDataSource();
      const now = new Date('2024-01-15T12:00:00Z');
      const analyzer = new TrendAnalyzer(dataSource, createFixedDateProvider(now));

      // Add readings within the last 24 hours
      dataSource.addReadings([
        createReading({ measuredValue: 60, timestamp: new Date('2024-01-15T08:00:00Z') }),
        createReading({ measuredValue: 80, timestamp: new Date('2024-01-15T09:00:00Z') }),
        createReading({ measuredValue: 70, timestamp: new Date('2024-01-15T10:00:00Z') }),
      ]);

      const result = await analyzer.computeTrend('senior-1', 'heart_rate', 'daily');

      expect(result.mean).toBe(70); // (60+80+70)/3
      expect(result.min).toBe(60);
      expect(result.max).toBe(80);
      expect(result.count).toBe(3);
    });

    it('should use 7-day window for 7day period', async () => {
      const dataSource = new InMemoryReadingsDataSource();
      const now = new Date('2024-01-15T12:00:00Z');
      const analyzer = new TrendAnalyzer(dataSource, createFixedDateProvider(now));

      // Reading within 7-day window
      dataSource.addReading(
        createReading({ measuredValue: 100, timestamp: new Date('2024-01-10T12:00:00Z') })
      );
      // Reading outside 7-day window (8 days ago)
      dataSource.addReading(
        createReading({ measuredValue: 200, timestamp: new Date('2024-01-06T12:00:00Z') })
      );

      const result = await analyzer.computeTrend('senior-1', 'heart_rate', '7day');

      expect(result.count).toBe(1);
      expect(result.mean).toBe(100);
    });

    it('should use 30-day window for 30day period', async () => {
      const dataSource = new InMemoryReadingsDataSource();
      const now = new Date('2024-01-31T12:00:00Z');
      const analyzer = new TrendAnalyzer(dataSource, createFixedDateProvider(now));

      // Reading within 30-day window
      dataSource.addReading(
        createReading({ measuredValue: 75, timestamp: new Date('2024-01-05T12:00:00Z') })
      );
      // Reading outside 30-day window (31 days ago)
      dataSource.addReading(
        createReading({ measuredValue: 90, timestamp: new Date('2023-12-30T12:00:00Z') })
      );

      const result = await analyzer.computeTrend('senior-1', 'heart_rate', '30day');

      expect(result.count).toBe(1);
      expect(result.mean).toBe(75);
    });

    it('should handle single reading correctly', async () => {
      const dataSource = new InMemoryReadingsDataSource();
      const now = new Date('2024-01-15T12:00:00Z');
      const analyzer = new TrendAnalyzer(dataSource, createFixedDateProvider(now));

      dataSource.addReading(
        createReading({ measuredValue: 98, timestamp: new Date('2024-01-15T10:00:00Z') })
      );

      const result = await analyzer.computeTrend('senior-1', 'heart_rate', 'daily');

      expect(result.mean).toBe(98);
      expect(result.min).toBe(98);
      expect(result.max).toBe(98);
      expect(result.count).toBe(1);
    });

    it('should filter by reading type', async () => {
      const dataSource = new InMemoryReadingsDataSource();
      const now = new Date('2024-01-15T12:00:00Z');
      const analyzer = new TrendAnalyzer(dataSource, createFixedDateProvider(now));

      dataSource.addReading(
        createReading({
          readingType: 'heart_rate',
          measuredValue: 72,
          timestamp: new Date('2024-01-15T10:00:00Z'),
        })
      );
      dataSource.addReading(
        createReading({
          readingType: 'temperature',
          unit: 'celsius',
          measuredValue: 37.0,
          timestamp: new Date('2024-01-15T10:00:00Z'),
        })
      );

      const result = await analyzer.computeTrend('senior-1', 'heart_rate', 'daily');

      expect(result.count).toBe(1);
      expect(result.mean).toBe(72);
    });

    it('should filter by senior ID', async () => {
      const dataSource = new InMemoryReadingsDataSource();
      const now = new Date('2024-01-15T12:00:00Z');
      const analyzer = new TrendAnalyzer(dataSource, createFixedDateProvider(now));

      dataSource.addReading(
        createReading({
          seniorId: 'senior-1',
          measuredValue: 72,
          timestamp: new Date('2024-01-15T10:00:00Z'),
        })
      );
      dataSource.addReading(
        createReading({
          seniorId: 'senior-2',
          measuredValue: 90,
          timestamp: new Date('2024-01-15T10:00:00Z'),
        })
      );

      const result = await analyzer.computeTrend('senior-1', 'heart_rate', 'daily');

      expect(result.count).toBe(1);
      expect(result.mean).toBe(72);
    });
  });

  // ─── getTrendDirection Tests ────────────────────────────────────────────────

  describe('getTrendDirection', () => {
    it('should return stable when no readings exist in either period', async () => {
      const dataSource = new InMemoryReadingsDataSource();
      const now = new Date('2024-01-15T12:00:00Z');
      const analyzer = new TrendAnalyzer(dataSource, createFixedDateProvider(now));

      const direction = await analyzer.getTrendDirection('senior-1', 'heart_rate');

      expect(direction).toBe('stable');
    });

    it('should return stable when only current period has readings', async () => {
      const dataSource = new InMemoryReadingsDataSource();
      const now = new Date('2024-01-15T12:00:00Z');
      const analyzer = new TrendAnalyzer(dataSource, createFixedDateProvider(now));

      // Only current period (last 7 days)
      dataSource.addReading(
        createReading({ measuredValue: 72, timestamp: new Date('2024-01-14T10:00:00Z') })
      );

      const direction = await analyzer.getTrendDirection('senior-1', 'heart_rate');

      expect(direction).toBe('stable');
    });

    it('should return improving when current mean is >5% lower (for non-spo2)', async () => {
      const dataSource = new InMemoryReadingsDataSource();
      const now = new Date('2024-01-21T12:00:00Z');
      const analyzer = new TrendAnalyzer(dataSource, createFixedDateProvider(now));

      // Previous period (days 8-14 before now): mean = 100
      dataSource.addReading(
        createReading({ measuredValue: 100, timestamp: new Date('2024-01-10T10:00:00Z') })
      );
      // Current period (last 7 days): mean = 90 (10% lower)
      dataSource.addReading(
        createReading({ measuredValue: 90, timestamp: new Date('2024-01-18T10:00:00Z') })
      );

      const direction = await analyzer.getTrendDirection('senior-1', 'heart_rate');

      expect(direction).toBe('improving');
    });

    it('should return declining when current mean is >5% higher (for non-spo2)', async () => {
      const dataSource = new InMemoryReadingsDataSource();
      const now = new Date('2024-01-21T12:00:00Z');
      const analyzer = new TrendAnalyzer(dataSource, createFixedDateProvider(now));

      // Previous period: mean = 80
      dataSource.addReading(
        createReading({ measuredValue: 80, timestamp: new Date('2024-01-10T10:00:00Z') })
      );
      // Current period: mean = 90 (12.5% higher)
      dataSource.addReading(
        createReading({ measuredValue: 90, timestamp: new Date('2024-01-18T10:00:00Z') })
      );

      const direction = await analyzer.getTrendDirection('senior-1', 'heart_rate');

      expect(direction).toBe('declining');
    });

    it('should return stable when change is within 5% threshold', async () => {
      const dataSource = new InMemoryReadingsDataSource();
      const now = new Date('2024-01-21T12:00:00Z');
      const analyzer = new TrendAnalyzer(dataSource, createFixedDateProvider(now));

      // Previous period: mean = 100
      dataSource.addReading(
        createReading({ measuredValue: 100, timestamp: new Date('2024-01-10T10:00:00Z') })
      );
      // Current period: mean = 98 (2% lower, within threshold)
      dataSource.addReading(
        createReading({ measuredValue: 98, timestamp: new Date('2024-01-18T10:00:00Z') })
      );

      const direction = await analyzer.getTrendDirection('senior-1', 'heart_rate');

      expect(direction).toBe('stable');
    });

    it('should reverse logic for spo2 - higher is improving', async () => {
      const dataSource = new InMemoryReadingsDataSource();
      const now = new Date('2024-01-21T12:00:00Z');
      const analyzer = new TrendAnalyzer(dataSource, createFixedDateProvider(now));

      // Previous period: mean = 90
      dataSource.addReading(
        createReading({
          readingType: 'spo2',
          unit: 'percent',
          measuredValue: 90,
          timestamp: new Date('2024-01-10T10:00:00Z'),
        })
      );
      // Current period: mean = 96 (6.7% higher → improving for spo2)
      dataSource.addReading(
        createReading({
          readingType: 'spo2',
          unit: 'percent',
          measuredValue: 96,
          timestamp: new Date('2024-01-18T10:00:00Z'),
        })
      );

      const direction = await analyzer.getTrendDirection('senior-1', 'spo2');

      expect(direction).toBe('improving');
    });

    it('should reverse logic for spo2 - lower is declining', async () => {
      const dataSource = new InMemoryReadingsDataSource();
      const now = new Date('2024-01-21T12:00:00Z');
      const analyzer = new TrendAnalyzer(dataSource, createFixedDateProvider(now));

      // Previous period: mean = 97
      dataSource.addReading(
        createReading({
          readingType: 'spo2',
          unit: 'percent',
          measuredValue: 97,
          timestamp: new Date('2024-01-10T10:00:00Z'),
        })
      );
      // Current period: mean = 90 (7.2% lower → declining for spo2)
      dataSource.addReading(
        createReading({
          readingType: 'spo2',
          unit: 'percent',
          measuredValue: 90,
          timestamp: new Date('2024-01-18T10:00:00Z'),
        })
      );

      const direction = await analyzer.getTrendDirection('senior-1', 'spo2');

      expect(direction).toBe('declining');
    });

    it('should compute mean from multiple readings in each period', async () => {
      const dataSource = new InMemoryReadingsDataSource();
      const now = new Date('2024-01-21T12:00:00Z');
      const analyzer = new TrendAnalyzer(dataSource, createFixedDateProvider(now));

      // Previous period: mean = (100 + 110) / 2 = 105
      dataSource.addReadings([
        createReading({ measuredValue: 100, timestamp: new Date('2024-01-09T10:00:00Z') }),
        createReading({ measuredValue: 110, timestamp: new Date('2024-01-10T10:00:00Z') }),
      ]);
      // Current period: mean = (80 + 90) / 2 = 85 (19% lower → improving)
      dataSource.addReadings([
        createReading({ measuredValue: 80, timestamp: new Date('2024-01-17T10:00:00Z') }),
        createReading({ measuredValue: 90, timestamp: new Date('2024-01-18T10:00:00Z') }),
      ]);

      const direction = await analyzer.getTrendDirection('senior-1', 'heart_rate');

      expect(direction).toBe('improving');
    });
  });
});
