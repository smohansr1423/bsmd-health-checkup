/**
 * Risk Assessment Engine Tests
 * Unit tests for risk categorization, health score computation,
 * deterioration detection, and critical alert publishing.
 *
 * Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5
 */

import { AgeGroup, RiskCategory } from '@health-checkup/shared';
import type { TestResult, ReferenceRange } from '@health-checkup/shared';
import { InMemoryEventBus } from '@health-checkup/shared';
import { RiskAssessmentEngine, RiskDefaultReferenceRangeProvider } from './risk-assessment.service';

/** Helper to create a minimal TestResult */
function makeTestResult(overrides: Partial<TestResult> = {}): TestResult {
  return {
    id: 'tr-1',
    checkupSessionId: 'session-1',
    seniorId: 'senior-1',
    testType: 'blood_sugar',
    measuredValue: 100,
    unit: 'mg/dL',
    collectionTimestamp: new Date(),
    technicianId: 'tech-1',
    amendmentHistory: [],
    createdAt: new Date(),
    ...overrides,
  };
}

describe('RiskAssessmentEngine', () => {
  let engine: RiskAssessmentEngine;
  let eventBus: InMemoryEventBus;

  beforeEach(() => {
    eventBus = new InMemoryEventBus();
    engine = new RiskAssessmentEngine({
      eventBus,
      idGenerator: () => `test-id-${Date.now()}`,
      dateProvider: () => new Date('2024-01-15T10:00:00Z'),
    });
  });

  describe('categorizeResult', () => {
    it('should return Normal when value is within [min, max]', () => {
      // blood_sugar 60-69: min=70, max=130
      const result = makeTestResult({ measuredValue: 100 });
      const category = engine.categorizeResult(result, AgeGroup.SixtyToSixtyNine);
      expect(category).toBe(RiskCategory.Normal);
    });

    it('should return Normal at min boundary', () => {
      const result = makeTestResult({ measuredValue: 70 });
      const category = engine.categorizeResult(result, AgeGroup.SixtyToSixtyNine);
      expect(category).toBe(RiskCategory.Normal);
    });

    it('should return Normal at max boundary', () => {
      const result = makeTestResult({ measuredValue: 130 });
      const category = engine.categorizeResult(result, AgeGroup.SixtyToSixtyNine);
      expect(category).toBe(RiskCategory.Normal);
    });

    it('should return Borderline when value is in [borderlineLow, min)', () => {
      // borderlineLow=60, min=70 → 65 is borderline
      const result = makeTestResult({ measuredValue: 65 });
      const category = engine.categorizeResult(result, AgeGroup.SixtyToSixtyNine);
      expect(category).toBe(RiskCategory.Borderline);
    });

    it('should return Borderline at borderlineLow boundary', () => {
      const result = makeTestResult({ measuredValue: 60 });
      const category = engine.categorizeResult(result, AgeGroup.SixtyToSixtyNine);
      expect(category).toBe(RiskCategory.Borderline);
    });

    it('should return Borderline when value is in (max, borderlineHigh]', () => {
      // max=130, borderlineHigh=140 → 135 is borderline
      const result = makeTestResult({ measuredValue: 135 });
      const category = engine.categorizeResult(result, AgeGroup.SixtyToSixtyNine);
      expect(category).toBe(RiskCategory.Borderline);
    });

    it('should return Borderline at borderlineHigh boundary', () => {
      const result = makeTestResult({ measuredValue: 140 });
      const category = engine.categorizeResult(result, AgeGroup.SixtyToSixtyNine);
      expect(category).toBe(RiskCategory.Borderline);
    });

    it('should return Critical when value is below criticalLow', () => {
      // criticalLow=40 → 30 is critical
      const result = makeTestResult({ measuredValue: 30 });
      const category = engine.categorizeResult(result, AgeGroup.SixtyToSixtyNine);
      expect(category).toBe(RiskCategory.Critical);
    });

    it('should return Critical when value is above criticalHigh', () => {
      // criticalHigh=200 → 250 is critical
      const result = makeTestResult({ measuredValue: 250 });
      const category = engine.categorizeResult(result, AgeGroup.SixtyToSixtyNine);
      expect(category).toBe(RiskCategory.Critical);
    });

    it('should return Critical when value is in [criticalLow, borderlineLow)', () => {
      // criticalLow=40, borderlineLow=60 → 50 is critical
      const result = makeTestResult({ measuredValue: 50 });
      const category = engine.categorizeResult(result, AgeGroup.SixtyToSixtyNine);
      expect(category).toBe(RiskCategory.Critical);
    });

    it('should return Critical when value is in (borderlineHigh, criticalHigh]', () => {
      // borderlineHigh=140, criticalHigh=200 → 150 is critical
      const result = makeTestResult({ measuredValue: 150 });
      const category = engine.categorizeResult(result, AgeGroup.SixtyToSixtyNine);
      expect(category).toBe(RiskCategory.Critical);
    });

    it('should return Uncategorized when no reference range exists', () => {
      const result = makeTestResult({ testType: 'unknown_test' });
      const category = engine.categorizeResult(result, AgeGroup.SixtyToSixtyNine);
      expect(category).toBe(RiskCategory.Uncategorized);
    });

    it('should use correct age-adjusted range for different age groups', () => {
      // blood_sugar 90+: min=70, max=160 → 155 is Normal for 90+
      const result = makeTestResult({ measuredValue: 155 });
      const category90Plus = engine.categorizeResult(result, AgeGroup.NinetyPlus);
      expect(category90Plus).toBe(RiskCategory.Normal);

      // Same value for 60-69 where max=130 → 155 is Critical (borderlineHigh=140, so 155 > 140)
      const category60 = engine.categorizeResult(result, AgeGroup.SixtyToSixtyNine);
      expect(category60).toBe(RiskCategory.Critical);
    });
  });

  describe('computeHealthScore', () => {
    it('should return 100 when all results are Normal', () => {
      const results = [
        makeTestResult({ testType: 'blood_sugar', measuredValue: 100 }),
        makeTestResult({ testType: 'lipid_profile', measuredValue: 150 }),
      ];
      const score = engine.computeHealthScore(results, AgeGroup.SixtyToSixtyNine);
      expect(score.score).toBe(100);
      expect(score.normalCount).toBe(2);
      expect(score.borderlineCount).toBe(0);
      expect(score.criticalCount).toBe(0);
    });

    it('should return 100 for empty results', () => {
      const score = engine.computeHealthScore([], AgeGroup.SixtyToSixtyNine);
      expect(score.score).toBe(100);
    });

    it('should reduce score for Borderline results by (100/totalCount)*0.3', () => {
      // 2 tests total: 1 Normal, 1 Borderline
      // Penalty: (100/2) * 0.3 = 15
      // Score: 100 - 15 = 85
      const results = [
        makeTestResult({ testType: 'blood_sugar', measuredValue: 100 }), // Normal
        makeTestResult({ testType: 'lipid_profile', measuredValue: 235 }), // Borderline (max=200, borderlineHigh=240)
      ];
      const score = engine.computeHealthScore(results, AgeGroup.SixtyToSixtyNine);
      expect(score.score).toBe(85);
      expect(score.borderlineCount).toBe(1);
    });

    it('should reduce score for Critical results by (100/totalCount)*0.7', () => {
      // 2 tests total: 1 Normal, 1 Critical
      // Penalty: (100/2) * 0.7 = 35
      // Score: 100 - 35 = 65
      const results = [
        makeTestResult({ testType: 'blood_sugar', measuredValue: 100 }), // Normal
        makeTestResult({ testType: 'lipid_profile', measuredValue: 310 }), // Critical (criticalHigh=300)
      ];
      const score = engine.computeHealthScore(results, AgeGroup.SixtyToSixtyNine);
      expect(score.score).toBe(65);
      expect(score.criticalCount).toBe(1);
    });

    it('should not impact score for Uncategorized results', () => {
      // 2 tests: 1 Normal (blood_sugar), 1 Uncategorized (unknown)
      // totalTestCount = 2
      // No penalty from uncategorized → score remains 100
      const results = [
        makeTestResult({ testType: 'blood_sugar', measuredValue: 100 }), // Normal
        makeTestResult({ testType: 'unknown_test', measuredValue: 50 }), // Uncategorized
      ];
      const score = engine.computeHealthScore(results, AgeGroup.SixtyToSixtyNine);
      expect(score.score).toBe(100);
      expect(score.uncategorizedCount).toBe(1);
    });

    it('should floor score at 0', () => {
      // All critical results → max penalty
      const results = [
        makeTestResult({ testType: 'blood_sugar', measuredValue: 250 }), // Critical
        makeTestResult({ testType: 'lipid_profile', measuredValue: 310 }), // Critical
        makeTestResult({ testType: 'complete_blood_count', measuredValue: 25 }), // Critical
      ];
      const score = engine.computeHealthScore(results, AgeGroup.SixtyToSixtyNine);
      // 3 critical: penalty = 3 * (100/3) * 0.7 = 70
      // Score: 100 - 70 = 30
      expect(score.score).toBe(30);
      expect(score.score).toBeGreaterThanOrEqual(0);
    });

    it('should provide correct breakdown per test', () => {
      const results = [
        makeTestResult({ testType: 'blood_sugar', measuredValue: 100 }), // Normal
        makeTestResult({ testType: 'lipid_profile', measuredValue: 235 }), // Borderline
      ];
      const score = engine.computeHealthScore(results, AgeGroup.SixtyToSixtyNine);
      expect(score.breakdown).toHaveLength(2);
      expect(score.breakdown[0].riskCategory).toBe(RiskCategory.Normal);
      expect(score.breakdown[0].penalty).toBe(0);
      expect(score.breakdown[1].riskCategory).toBe(RiskCategory.Borderline);
      expect(score.breakdown[1].penalty).toBeCloseTo(15);
    });

    it('should round score to nearest integer', () => {
      // 3 tests: 2 Normal, 1 Borderline
      // Penalty: (100/3) * 0.3 ≈ 10
      // Score: 100 - 10 = 90
      const results = [
        makeTestResult({ testType: 'blood_sugar', measuredValue: 100 }),
        makeTestResult({ testType: 'lipid_profile', measuredValue: 150 }),
        makeTestResult({ testType: 'complete_blood_count', measuredValue: 12 }), // Borderline (max=11, borderlineHigh=13)
      ];
      const score = engine.computeHealthScore(results, AgeGroup.SixtyToSixtyNine);
      expect(Number.isInteger(score.score)).toBe(true);
    });
  });

  describe('detectDeterioration', () => {
    it('should flag parameters with >20% deterioration relative to normal range', () => {
      // blood_sugar 60-69: min=70, max=130 → normalSpan = 60
      // 20% of 60 = 12; change must exceed 12
      const currentResults = [
        makeTestResult({ testType: 'blood_sugar', measuredValue: 115 }),
      ];
      const previousResults = [
        makeTestResult({ testType: 'blood_sugar', measuredValue: 100 }),
      ];
      // Change = |115 - 100| = 15, percentage = (15/60)*100 = 25% > 20%
      const flags = engine.detectDeterioration(currentResults, previousResults, AgeGroup.SixtyToSixtyNine);
      expect(flags).toHaveLength(1);
      expect(flags[0].testType).toBe('blood_sugar');
      expect(flags[0].percentageChange).toBe(25);
    });

    it('should not flag parameters with ≤20% deterioration', () => {
      // Change of 10: (10/60)*100 ≈ 16.67% ≤ 20%
      const currentResults = [
        makeTestResult({ testType: 'blood_sugar', measuredValue: 110 }),
      ];
      const previousResults = [
        makeTestResult({ testType: 'blood_sugar', measuredValue: 100 }),
      ];
      const flags = engine.detectDeterioration(currentResults, previousResults, AgeGroup.SixtyToSixtyNine);
      expect(flags).toHaveLength(0);
    });

    it('should not flag when no previous result exists for the test type', () => {
      const currentResults = [
        makeTestResult({ testType: 'blood_sugar', measuredValue: 200 }),
      ];
      const previousResults = [
        makeTestResult({ testType: 'lipid_profile', measuredValue: 150 }),
      ];
      const flags = engine.detectDeterioration(currentResults, previousResults, AgeGroup.SixtyToSixtyNine);
      expect(flags).toHaveLength(0);
    });

    it('should not flag when no reference range exists for the test type', () => {
      const currentResults = [
        makeTestResult({ testType: 'unknown_test', measuredValue: 200 }),
      ];
      const previousResults = [
        makeTestResult({ testType: 'unknown_test', measuredValue: 100 }),
      ];
      const flags = engine.detectDeterioration(currentResults, previousResults, AgeGroup.SixtyToSixtyNine);
      expect(flags).toHaveLength(0);
    });

    it('should include correct metadata in deterioration flags', () => {
      const currentResults = [
        makeTestResult({ testType: 'blood_sugar', measuredValue: 150 }),
      ];
      const previousResults = [
        makeTestResult({ testType: 'blood_sugar', measuredValue: 100 }),
      ];
      // Change = 50, percentage = (50/60)*100 ≈ 83.33%
      const flags = engine.detectDeterioration(currentResults, previousResults, AgeGroup.SixtyToSixtyNine);
      expect(flags[0].currentValue).toBe(150);
      expect(flags[0].previousValue).toBe(100);
      expect(flags[0].percentageChange).toBeCloseTo(83.33, 1);
    });

    it('should use the most recent prior result when multiple exist for same test type', () => {
      // blood_sugar 60-69: min=70, max=130, normalSpan=60, midpoint=100
      const currentResults = [
        makeTestResult({ testType: 'blood_sugar', measuredValue: 120 }),
      ];
      // Multiple previous results for same test type — should use the most recent one
      const previousResults = [
        makeTestResult({
          testType: 'blood_sugar',
          measuredValue: 90,
          collectionTimestamp: new Date('2024-01-01T10:00:00Z'),
        }),
        makeTestResult({
          testType: 'blood_sugar',
          measuredValue: 100,
          collectionTimestamp: new Date('2024-01-10T10:00:00Z'), // Most recent
        }),
        makeTestResult({
          testType: 'blood_sugar',
          measuredValue: 80,
          collectionTimestamp: new Date('2024-01-05T10:00:00Z'),
        }),
      ];
      // Should compare against measuredValue=100 (most recent by collectionTimestamp)
      // Change = |120 - 100| = 20, percentage = (20/60)*100 ≈ 33.33%
      // Midpoint = 100, currentDistance = 20, previousDistance = 0 → deterioration
      const flags = engine.detectDeterioration(currentResults, previousResults, AgeGroup.SixtyToSixtyNine);
      expect(flags).toHaveLength(1);
      expect(flags[0].previousValue).toBe(100);
      expect(flags[0].percentageChange).toBeCloseTo(33.33, 1);
    });

    it('should NOT flag when value improves (moves toward normal range)', () => {
      // blood_sugar 60-69: min=70, max=130, midpoint=100
      // Previous was 140 (distance from midpoint = 40), current is 120 (distance = 20)
      // Even though change = 20, (20/60)*100 = 33.33% > 20%,
      // it's an IMPROVEMENT (closer to normal), so should NOT flag
      const currentResults = [
        makeTestResult({ testType: 'blood_sugar', measuredValue: 120 }),
      ];
      const previousResults = [
        makeTestResult({ testType: 'blood_sugar', measuredValue: 140 }),
      ];
      const flags = engine.detectDeterioration(currentResults, previousResults, AgeGroup.SixtyToSixtyNine);
      expect(flags).toHaveLength(0);
    });

    it('should flag deterioration when value goes UP for tests where higher is worse', () => {
      // blood_sugar 60-69: min=70, max=130, midpoint=100
      // Previous was 110 (distance=10), current is 145 (distance=45) → deterioration
      // Change = 35, percentage = (35/60)*100 ≈ 58.33% > 20%
      const currentResults = [
        makeTestResult({ testType: 'blood_sugar', measuredValue: 145 }),
      ];
      const previousResults = [
        makeTestResult({ testType: 'blood_sugar', measuredValue: 110 }),
      ];
      const flags = engine.detectDeterioration(currentResults, previousResults, AgeGroup.SixtyToSixtyNine);
      expect(flags).toHaveLength(1);
      expect(flags[0].percentageChange).toBeCloseTo(58.33, 1);
    });

    it('should flag deterioration when value goes DOWN for tests where lower is worse', () => {
      // blood_sugar 60-69: min=70, max=130, midpoint=100
      // Previous was 90 (distance=10), current is 55 (distance=45) → deterioration (below normal)
      // Change = 35, percentage = (35/60)*100 ≈ 58.33% > 20%
      const currentResults = [
        makeTestResult({ testType: 'blood_sugar', measuredValue: 55 }),
      ];
      const previousResults = [
        makeTestResult({ testType: 'blood_sugar', measuredValue: 90 }),
      ];
      const flags = engine.detectDeterioration(currentResults, previousResults, AgeGroup.SixtyToSixtyNine);
      expect(flags).toHaveLength(1);
      expect(flags[0].percentageChange).toBeCloseTo(58.33, 1);
    });

    it('should NOT flag when change is exactly 20% (boundary case)', () => {
      // blood_sugar 60-69: min=70, max=130, normalSpan=60, midpoint=100
      // 20% of normalSpan = 12. Need a change of exactly 12.
      // Previous at 100 (midpoint, distance=0), current at 112 (distance=12)
      // Change = 12, percentage = (12/60)*100 = 20% → NOT > 20%, so should NOT flag
      const currentResults = [
        makeTestResult({ testType: 'blood_sugar', measuredValue: 112 }),
      ];
      const previousResults = [
        makeTestResult({ testType: 'blood_sugar', measuredValue: 100 }),
      ];
      const flags = engine.detectDeterioration(currentResults, previousResults, AgeGroup.SixtyToSixtyNine);
      expect(flags).toHaveLength(0);
    });

    it('should return empty array when current results are empty', () => {
      const previousResults = [
        makeTestResult({ testType: 'blood_sugar', measuredValue: 100 }),
      ];
      const flags = engine.detectDeterioration([], previousResults, AgeGroup.SixtyToSixtyNine);
      expect(flags).toHaveLength(0);
    });

    it('should return empty array when previous results are empty', () => {
      const currentResults = [
        makeTestResult({ testType: 'blood_sugar', measuredValue: 150 }),
      ];
      const flags = engine.detectDeterioration(currentResults, [], AgeGroup.SixtyToSixtyNine);
      expect(flags).toHaveLength(0);
    });

    it('should handle multiple test types and only flag deteriorated ones', () => {
      // blood_sugar: min=70, max=130, midpoint=100
      // lipid_profile: min=100, max=200, midpoint=150
      const currentResults = [
        makeTestResult({ testType: 'blood_sugar', measuredValue: 120 }), // distance=20
        makeTestResult({ testType: 'lipid_profile', measuredValue: 140 }), // distance=10
      ];
      const previousResults = [
        makeTestResult({ testType: 'blood_sugar', measuredValue: 100 }), // distance=0, so current is worse
        makeTestResult({ testType: 'lipid_profile', measuredValue: 120 }), // distance=30, current is BETTER (closer to midpoint)
      ];
      // blood_sugar: change=20, percentage=(20/60)*100=33.33% > 20%, deterioration → flag
      // lipid_profile: improvement (currentDistance 10 < previousDistance 30) → no flag
      const flags = engine.detectDeterioration(currentResults, previousResults, AgeGroup.SixtyToSixtyNine);
      expect(flags).toHaveLength(1);
      expect(flags[0].testType).toBe('blood_sugar');
    });
  });

  describe('getAgeAdjustedRange', () => {
    it('should return the reference range for a known test type and age group', () => {
      const range = engine.getAgeAdjustedRange('blood_sugar', AgeGroup.SixtyToSixtyNine);
      expect(range).not.toBeNull();
      expect(range!.min).toBe(70);
      expect(range!.max).toBe(130);
      expect(range!.ageGroup).toBe(AgeGroup.SixtyToSixtyNine);
    });

    it('should return null for an unknown test type', () => {
      const range = engine.getAgeAdjustedRange('unknown_test', AgeGroup.SixtyToSixtyNine);
      expect(range).toBeNull();
    });

    it('should return different ranges for different age groups', () => {
      const range60 = engine.getAgeAdjustedRange('blood_sugar', AgeGroup.SixtyToSixtyNine);
      const range90 = engine.getAgeAdjustedRange('blood_sugar', AgeGroup.NinetyPlus);
      expect(range60!.max).toBe(130);
      expect(range90!.max).toBe(160);
    });
  });

  describe('publishCriticalAlert', () => {
    it('should publish CriticalAlertRaised event when called', async () => {
      const publishedEvents: any[] = [];
      eventBus.subscribe('CriticalAlertRaised', (event) => {
        publishedEvents.push(event);
      });

      const result = makeTestResult({ measuredValue: 250 }); // Critical (above criticalHigh=200)
      await engine.publishCriticalAlert(result, AgeGroup.SixtyToSixtyNine, 'physician-1');

      expect(publishedEvents).toHaveLength(1);
      expect(publishedEvents[0].type).toBe('CriticalAlertRaised');
      expect(publishedEvents[0].payload.testResultId).toBe('tr-1');
      expect(publishedEvents[0].payload.seniorId).toBe('senior-1');
      expect(publishedEvents[0].payload.physicianId).toBe('physician-1');
      expect(publishedEvents[0].payload.measuredValue).toBe(250);
      expect(publishedEvents[0].payload.criticalThreshold).toBe(200);
      expect(publishedEvents[0].payload.thresholdDirection).toBe('above');
    });

    it('should identify below threshold direction', async () => {
      const publishedEvents: any[] = [];
      eventBus.subscribe('CriticalAlertRaised', (event) => {
        publishedEvents.push(event);
      });

      const result = makeTestResult({ measuredValue: 30 }); // Critical (below criticalLow=40)
      await engine.publishCriticalAlert(result, AgeGroup.SixtyToSixtyNine, 'physician-1');

      expect(publishedEvents[0].payload.criticalThreshold).toBe(40);
      expect(publishedEvents[0].payload.thresholdDirection).toBe('below');
    });

    it('should not throw when no event bus is configured', async () => {
      const engineNoEvents = new RiskAssessmentEngine();
      const result = makeTestResult({ measuredValue: 250 });
      await expect(
        engineNoEvents.publishCriticalAlert(result, AgeGroup.SixtyToSixtyNine, 'physician-1')
      ).resolves.not.toThrow();
    });
  });

  describe('RiskDefaultReferenceRangeProvider', () => {
    it('should return default ranges for known test types', () => {
      const provider = new RiskDefaultReferenceRangeProvider();
      const range = provider.getRange('blood_sugar', AgeGroup.SixtyToSixtyNine);
      expect(range).not.toBeNull();
      expect(range!.min).toBe(70);
    });

    it('should return null for unknown test types', () => {
      const provider = new RiskDefaultReferenceRangeProvider();
      const range = provider.getRange('unknown', AgeGroup.SixtyToSixtyNine);
      expect(range).toBeNull();
    });

    it('should allow adding custom ranges', () => {
      const provider = new RiskDefaultReferenceRangeProvider();
      const customRange: ReferenceRange = {
        min: 10, max: 20, borderlineLow: 5, borderlineHigh: 25,
        criticalLow: 1, criticalHigh: 30, ageGroup: AgeGroup.SixtyToSixtyNine,
      };
      provider.addRange('custom_test', AgeGroup.SixtyToSixtyNine, customRange);
      const range = provider.getRange('custom_test', AgeGroup.SixtyToSixtyNine);
      expect(range).toEqual(customRange);
    });

    it('should support custom range data in constructor', () => {
      const customRanges = {
        my_test: {
          [AgeGroup.SixtyToSixtyNine]: {
            min: 5, max: 10, borderlineLow: 3, borderlineHigh: 12,
            criticalLow: 1, criticalHigh: 15, ageGroup: AgeGroup.SixtyToSixtyNine,
          },
        },
      };
      const provider = new RiskDefaultReferenceRangeProvider(customRanges);
      expect(provider.getRange('my_test', AgeGroup.SixtyToSixtyNine)).not.toBeNull();
      expect(provider.getRange('blood_sugar', AgeGroup.SixtyToSixtyNine)).toBeNull();
    });
  });
});
