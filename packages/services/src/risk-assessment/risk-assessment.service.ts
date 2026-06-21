/**
 * Risk Assessment Engine Service
 * Categorizes test results, computes health scores, detects deterioration,
 * and generates critical alerts to physicians.
 *
 * Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5
 */

import type { TestResult, ReferenceRange } from '@health-checkup/shared';
import type { EventBus, CriticalAlertRaisedEvent } from '@health-checkup/shared';
import { AgeGroup, RiskCategory } from '@health-checkup/shared';
import type {
  IRiskAssessmentEngine,
  RiskAssessmentDependencies,
  RiskReferenceRangeProvider,
  HealthScore,
  ScoreBreakdown,
  DeteriorationFlag,
} from './risk-assessment.types';

/** Default ID generator using timestamp + random suffix */
const defaultIdGenerator = (): string => {
  return `RA_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
};

/** Default date provider returning the current system date */
const defaultDateProvider = (): Date => new Date();

/**
 * Default reference range data for common tests by age group.
 * Mirrors the data from test-execution service for consistency.
 * In production, this would come from a shared database or configuration.
 */
const DEFAULT_REFERENCE_RANGES: Record<string, Record<string, ReferenceRange>> = {
  blood_sugar: {
    [AgeGroup.SixtyToSixtyNine]: {
      min: 70, max: 130, borderlineLow: 60, borderlineHigh: 140,
      criticalLow: 40, criticalHigh: 200, ageGroup: AgeGroup.SixtyToSixtyNine,
    },
    [AgeGroup.SeventyToSeventyNine]: {
      min: 70, max: 140, borderlineLow: 60, borderlineHigh: 150,
      criticalLow: 40, criticalHigh: 220, ageGroup: AgeGroup.SeventyToSeventyNine,
    },
    [AgeGroup.EightyToEightyNine]: {
      min: 70, max: 150, borderlineLow: 60, borderlineHigh: 160,
      criticalLow: 40, criticalHigh: 240, ageGroup: AgeGroup.EightyToEightyNine,
    },
    [AgeGroup.NinetyPlus]: {
      min: 70, max: 160, borderlineLow: 60, borderlineHigh: 170,
      criticalLow: 40, criticalHigh: 260, ageGroup: AgeGroup.NinetyPlus,
    },
  },
  lipid_profile: {
    [AgeGroup.SixtyToSixtyNine]: {
      min: 100, max: 200, borderlineLow: 90, borderlineHigh: 240,
      criticalLow: 70, criticalHigh: 300, ageGroup: AgeGroup.SixtyToSixtyNine,
    },
    [AgeGroup.SeventyToSeventyNine]: {
      min: 100, max: 210, borderlineLow: 90, borderlineHigh: 250,
      criticalLow: 70, criticalHigh: 320, ageGroup: AgeGroup.SeventyToSeventyNine,
    },
    [AgeGroup.EightyToEightyNine]: {
      min: 100, max: 220, borderlineLow: 90, borderlineHigh: 260,
      criticalLow: 70, criticalHigh: 340, ageGroup: AgeGroup.EightyToEightyNine,
    },
    [AgeGroup.NinetyPlus]: {
      min: 100, max: 230, borderlineLow: 90, borderlineHigh: 270,
      criticalLow: 70, criticalHigh: 360, ageGroup: AgeGroup.NinetyPlus,
    },
  },
  complete_blood_count: {
    [AgeGroup.SixtyToSixtyNine]: {
      min: 4, max: 11, borderlineLow: 3, borderlineHigh: 13,
      criticalLow: 1, criticalHigh: 20, ageGroup: AgeGroup.SixtyToSixtyNine,
    },
    [AgeGroup.SeventyToSeventyNine]: {
      min: 4, max: 11, borderlineLow: 3, borderlineHigh: 13,
      criticalLow: 1, criticalHigh: 20, ageGroup: AgeGroup.SeventyToSeventyNine,
    },
    [AgeGroup.EightyToEightyNine]: {
      min: 3.5, max: 10.5, borderlineLow: 2.5, borderlineHigh: 12,
      criticalLow: 1, criticalHigh: 18, ageGroup: AgeGroup.EightyToEightyNine,
    },
    [AgeGroup.NinetyPlus]: {
      min: 3.5, max: 10.5, borderlineLow: 2.5, borderlineHigh: 12,
      criticalLow: 1, criticalHigh: 18, ageGroup: AgeGroup.NinetyPlus,
    },
  },
};

/**
 * Default ReferenceRangeProvider using the in-memory lookup table.
 * Follows the same pattern as DefaultReferenceRangeProvider in test-execution.
 */
export class RiskDefaultReferenceRangeProvider implements RiskReferenceRangeProvider {
  private ranges: Record<string, Record<string, ReferenceRange>>;

  constructor(ranges?: Record<string, Record<string, ReferenceRange>>) {
    this.ranges = ranges ?? DEFAULT_REFERENCE_RANGES;
  }

  getRange(testType: string, ageGroup: AgeGroup): ReferenceRange | null {
    const testRanges = this.ranges[testType];
    if (!testRanges) return null;
    return testRanges[ageGroup] ?? null;
  }

  addRange(testType: string, ageGroup: AgeGroup, range: ReferenceRange): void {
    if (!this.ranges[testType]) {
      this.ranges[testType] = {};
    }
    this.ranges[testType][ageGroup] = range;
  }
}

/**
 * RiskAssessmentEngine implementation.
 *
 * Business rules:
 * - Categorize results based on age-adjusted reference ranges
 * - Compute health scores with penalty system
 * - Detect deterioration by comparing current vs previous results
 * - Publish CriticalAlertRaised events within 30 seconds of categorization
 *
 * Requirement 6.1: Categorize as Normal/Borderline/Critical based on age-adjusted thresholds
 * Requirement 6.2: Generate critical alert to physician within 30 seconds
 * Requirement 6.3: Compute health score 0–100
 * Requirement 6.5: Mark as Uncategorized when no reference range defined
 */
export class RiskAssessmentEngine implements IRiskAssessmentEngine {
  private readonly referenceRangeProvider: RiskReferenceRangeProvider;
  private readonly eventBus?: EventBus;
  private readonly idGenerator: () => string;
  private readonly dateProvider: () => Date;

  constructor(deps?: Partial<RiskAssessmentDependencies>) {
    this.referenceRangeProvider = deps?.referenceRangeProvider ?? new RiskDefaultReferenceRangeProvider();
    this.eventBus = deps?.eventBus;
    this.idGenerator = deps?.idGenerator ?? defaultIdGenerator;
    this.dateProvider = deps?.dateProvider ?? defaultDateProvider;
  }

  /**
   * Categorize a single test result based on age-adjusted thresholds.
   *
   * Rules:
   * - If value is within [min, max]: Normal
   * - If value is in [borderlineLow, min) or (max, borderlineHigh]: Borderline
   * - If value is < criticalLow or > criticalHigh: Critical
   * - If value is in [criticalLow, borderlineLow) or (borderlineHigh, criticalHigh]: Critical
   * - If no reference range exists: Uncategorized
   *
   * Requirement 6.1: Categorize based on age-adjusted thresholds
   * Requirement 6.5: Uncategorized when no range defined
   */
  categorizeResult(testResult: TestResult, ageGroup: AgeGroup): RiskCategory {
    const range = this.referenceRangeProvider.getRange(testResult.testType, ageGroup);

    if (!range) {
      return RiskCategory.Uncategorized;
    }

    const value = testResult.measuredValue;

    // Normal: value is within [min, max]
    if (value >= range.min && value <= range.max) {
      return RiskCategory.Normal;
    }

    // Borderline: value is in [borderlineLow, min) or (max, borderlineHigh]
    if (
      (value >= range.borderlineLow && value < range.min) ||
      (value > range.max && value <= range.borderlineHigh)
    ) {
      return RiskCategory.Borderline;
    }

    // Critical: value is < criticalLow or > criticalHigh
    // or value is in [criticalLow, borderlineLow) or (borderlineHigh, criticalHigh]
    return RiskCategory.Critical;
  }

  /**
   * Compute a health score (0–100) from session test results.
   *
   * Rules:
   * - Start at 100
   * - Each Normal result: 0 penalty
   * - Each Borderline result: reduce by (100 / totalTestCount) * 0.3
   * - Each Critical result: reduce by (100 / totalTestCount) * 0.7
   * - Each Uncategorized result: no impact (excluded from scoring)
   * - Floor at 0, ceiling at 100
   * - Round to nearest integer
   *
   * Requirement 6.3: Compute health score 0–100
   */
  computeHealthScore(sessionResults: TestResult[], ageGroup: AgeGroup): HealthScore {
    const breakdown: ScoreBreakdown[] = [];
    let normalCount = 0;
    let borderlineCount = 0;
    let criticalCount = 0;
    let uncategorizedCount = 0;

    // Categorize all results
    for (const result of sessionResults) {
      const category = this.categorizeResult(result, ageGroup);
      breakdown.push({
        testType: result.testType,
        measuredValue: result.measuredValue,
        riskCategory: category,
        penalty: 0, // will be computed below
      });

      switch (category) {
        case RiskCategory.Normal:
          normalCount++;
          break;
        case RiskCategory.Borderline:
          borderlineCount++;
          break;
        case RiskCategory.Critical:
          criticalCount++;
          break;
        case RiskCategory.Uncategorized:
          uncategorizedCount++;
          break;
      }
    }

    // Compute score: total test count excludes uncategorized for penalty calculation
    // but the spec says "totalTestCount" includes all results for the divisor
    const totalTestCount = sessionResults.length;

    if (totalTestCount === 0) {
      return {
        score: 100,
        breakdown,
        normalCount,
        borderlineCount,
        criticalCount,
        uncategorizedCount,
      };
    }

    let score = 100;

    // Compute penalties
    for (const entry of breakdown) {
      let penalty = 0;

      if (entry.riskCategory === RiskCategory.Borderline) {
        penalty = (100 / totalTestCount) * 0.3;
      } else if (entry.riskCategory === RiskCategory.Critical) {
        penalty = (100 / totalTestCount) * 0.7;
      }
      // Normal and Uncategorized have no penalty

      entry.penalty = penalty;
      score -= penalty;
    }

    // Floor at 0, ceiling at 100, round to nearest integer
    score = Math.round(Math.max(0, Math.min(100, score)));

    return {
      score,
      breakdown,
      normalCount,
      borderlineCount,
      criticalCount,
      uncategorizedCount,
    };
  }

  /**
   * Detect deterioration by comparing current results with previous results.
   * Flags parameters deteriorated >20% relative to age-adjusted normal range.
   * Only flags actual deterioration (value moving away from normal), not improvement.
   *
   * Requirement 6.4: Compare current with most recent prior checkup
   */
  detectDeterioration(
    currentResults: TestResult[],
    previousResults: TestResult[],
    ageGroup: AgeGroup
  ): DeteriorationFlag[] {
    const flags: DeteriorationFlag[] = [];

    if (currentResults.length === 0 || previousResults.length === 0) {
      return flags;
    }

    // Build a map of previous results by test type, keeping only the most recent
    const previousByType = new Map<string, TestResult>();
    for (const prev of previousResults) {
      const existing = previousByType.get(prev.testType);
      if (!existing || new Date(prev.collectionTimestamp).getTime() > new Date(existing.collectionTimestamp).getTime()) {
        previousByType.set(prev.testType, prev);
      }
    }

    for (const current of currentResults) {
      const previous = previousByType.get(current.testType);
      if (!previous) continue;

      const range = this.referenceRangeProvider.getRange(current.testType, ageGroup);
      if (!range) continue;

      // Calculate normal range span for percentage reference
      const normalSpan = range.max - range.min;
      if (normalSpan === 0) continue;

      // Determine if the change represents deterioration (moving away from normal)
      // The midpoint of the normal range serves as the "ideal" reference point
      const normalMidpoint = (range.min + range.max) / 2;
      const currentDistance = Math.abs(current.measuredValue - normalMidpoint);
      const previousDistance = Math.abs(previous.measuredValue - normalMidpoint);

      // Only flag if the current value is further from normal than the previous value
      // (i.e., the patient's condition has worsened, not improved)
      if (currentDistance <= previousDistance) continue;

      // Calculate absolute change relative to the normal range span
      const absoluteChange = Math.abs(current.measuredValue - previous.measuredValue);
      const percentageChange = (absoluteChange / normalSpan) * 100;

      // Flag if deteriorated >20% relative to age-adjusted normal range
      if (percentageChange > 20) {
        const category = this.categorizeResult(current, ageGroup);
        flags.push({
          testType: current.testType,
          currentValue: current.measuredValue,
          previousValue: previous.measuredValue,
          percentageChange: Math.round(percentageChange * 100) / 100,
          riskCategory: category,
        });
      }
    }

    return flags;
  }

  /**
   * Get the age-adjusted reference range for a given test type and age group.
   * Returns null if no range is defined.
   */
  getAgeAdjustedRange(testType: string, ageGroup: AgeGroup): ReferenceRange | null {
    return this.referenceRangeProvider.getRange(testType, ageGroup);
  }

  /**
   * Publish a CriticalAlertRaised event when a result is categorized as Critical.
   * Must be generated within 30 seconds of categorization.
   *
   * Requirement 6.2: Alert to Physician within 30 seconds of categorization
   */
  async publishCriticalAlert(
    testResult: TestResult,
    ageGroup: AgeGroup,
    physicianId: string
  ): Promise<void> {
    if (!this.eventBus) return;

    const range = this.referenceRangeProvider.getRange(testResult.testType, ageGroup);
    const now = this.dateProvider();

    // Determine threshold direction and value
    let criticalThreshold: number;
    let thresholdDirection: 'above' | 'below';

    if (range) {
      if (testResult.measuredValue > range.criticalHigh) {
        criticalThreshold = range.criticalHigh;
        thresholdDirection = 'above';
      } else {
        criticalThreshold = range.criticalLow;
        thresholdDirection = 'below';
      }
    } else {
      // Fallback: if no range, still publish with the measured value as threshold
      criticalThreshold = testResult.measuredValue;
      thresholdDirection = 'above';
    }

    const event: CriticalAlertRaisedEvent = {
      id: this.idGenerator(),
      type: 'CriticalAlertRaised',
      occurredAt: now.toISOString(),
      sourceId: testResult.id,
      payload: {
        alertId: this.idGenerator(),
        testResultId: testResult.id,
        seniorId: testResult.seniorId,
        physicianId,
        testName: testResult.testType,
        measuredValue: testResult.measuredValue,
        unit: testResult.unit,
        criticalThreshold,
        thresholdDirection,
      },
    };

    await this.eventBus.publish(event);
  }
}
