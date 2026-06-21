/**
 * Risk Assessment Engine Types
 * Interfaces and types for risk categorization, health scoring,
 * deterioration detection, and critical alert generation.
 * Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5
 */

import type { TestResult, ReferenceRange } from '@health-checkup/shared';
import type { AgeGroup, RiskCategory } from '@health-checkup/shared';
import type { EventBus } from '@health-checkup/shared';

/**
 * Health score computed from a set of test results.
 * Score 0–100 where 100 = all normal.
 */
export interface HealthScore {
  /** Overall health score (0–100, rounded to nearest integer) */
  score: number;
  /** Per-test breakdown of scoring */
  breakdown: ScoreBreakdown[];
  /** Count of results categorized as Normal */
  normalCount: number;
  /** Count of results categorized as Borderline */
  borderlineCount: number;
  /** Count of results categorized as Critical */
  criticalCount: number;
  /** Count of results categorized as Uncategorized (excluded from scoring) */
  uncategorizedCount: number;
}

/**
 * Per-test breakdown within a health score computation.
 */
export interface ScoreBreakdown {
  testType: string;
  measuredValue: number;
  riskCategory: RiskCategory;
  penalty: number;
}

/**
 * Flag indicating a parameter has deteriorated compared to a previous checkup.
 */
export interface DeteriorationFlag {
  testType: string;
  currentValue: number;
  previousValue: number;
  percentageChange: number;
  riskCategory: RiskCategory;
}

/**
 * Provider for age-adjusted reference ranges used by the risk assessment engine.
 */
export interface RiskReferenceRangeProvider {
  getRange(testType: string, ageGroup: AgeGroup): ReferenceRange | null;
}

/**
 * Dependencies injected into the RiskAssessmentEngine for testability.
 */
export interface RiskAssessmentDependencies {
  referenceRangeProvider: RiskReferenceRangeProvider;
  eventBus?: EventBus;
  idGenerator?: () => string;
  dateProvider?: () => Date;
}

/**
 * Interface for the Risk Assessment Engine.
 */
export interface IRiskAssessmentEngine {
  /**
   * Categorize a single test result based on age-adjusted thresholds.
   * Returns 'Uncategorized' when no reference range is defined for the test type + age group.
   */
  categorizeResult(testResult: TestResult, ageGroup: AgeGroup): RiskCategory;

  /**
   * Compute a health score (0–100) from a set of session test results.
   * Uncategorized results are excluded from scoring.
   */
  computeHealthScore(sessionResults: TestResult[], ageGroup: AgeGroup): HealthScore;

  /**
   * Detect deterioration by comparing current results with previous results.
   * Flags parameters that have deteriorated >20% relative to age-adjusted normal range.
   */
  detectDeterioration(
    currentResults: TestResult[],
    previousResults: TestResult[],
    ageGroup: AgeGroup
  ): DeteriorationFlag[];

  /**
   * Get the age-adjusted reference range for a given test type and age group.
   * Returns null if no range is defined.
   */
  getAgeAdjustedRange(testType: string, ageGroup: AgeGroup): ReferenceRange | null;
}
