/**
 * Report Generation - Trend Chart Data Logic
 * Provides trend data points for health reports by analyzing previous checkup sessions.
 *
 * Business Rules (Requirements 7.3, 7.4):
 * - Omit trend data if the senior has fewer than 2 previous checkup sessions
 * - Include up to 5 most recent sessions' data points per parameter if ≥2 exist
 *
 * Requirement 7.8:
 * - Support partial report generation with pending test indicators
 * - Regenerate when remaining results arrive
 *
 * Requirement 7.9:
 * - Send notification to senior citizen and caregiver when report is available
 */

import type { TrendDataPoint, TestResult } from '@health-checkup/shared';
import { RiskCategory } from '@health-checkup/shared';

/** Maximum number of previous sessions to include in trend data */
const MAX_TREND_SESSIONS = 5;

/** Minimum number of previous sessions required before including trend data */
const MIN_SESSIONS_FOR_TRENDS = 2;

/**
 * Groups test results by their checkup session ID.
 */
function groupResultsBySession(results: TestResult[]): Map<string, TestResult[]> {
  const grouped = new Map<string, TestResult[]>();
  for (const result of results) {
    const existing = grouped.get(result.checkupSessionId) ?? [];
    existing.push(result);
    grouped.set(result.checkupSessionId, existing);
  }
  return grouped;
}

/**
 * Sorts session groups by the most recent collection timestamp within each session (descending).
 * Returns session IDs in most-recent-first order.
 */
function sortSessionsByDate(sessionGroups: Map<string, TestResult[]>): string[] {
  const sessionDates: Array<{ sessionId: string; latestDate: Date }> = [];

  for (const [sessionId, results] of sessionGroups) {
    const latestDate = results.reduce(
      (max, r) => (new Date(r.collectionTimestamp) > max ? new Date(r.collectionTimestamp) : max),
      new Date(0)
    );
    sessionDates.push({ sessionId, latestDate });
  }

  sessionDates.sort((a, b) => b.latestDate.getTime() - a.latestDate.getTime());
  return sessionDates.map((s) => s.sessionId);
}

/**
 * Builds trend data points from a senior citizen's historical test results.
 *
 * @param allResults - All test results for the senior citizen across all sessions
 * @param currentSessionId - The current session ID to exclude from trend data
 * @returns Array of TrendDataPoint[] if ≥2 previous sessions exist, empty array otherwise
 */
export function buildTrendData(
  allResults: TestResult[],
  currentSessionId: string
): TrendDataPoint[] {
  // Filter out results from the current session
  const previousResults = allResults.filter((r) => r.checkupSessionId !== currentSessionId);

  if (previousResults.length === 0) {
    return [];
  }

  // Group by session
  const sessionGroups = groupResultsBySession(previousResults);

  // Requirement 7.3: Omit trends if fewer than 2 previous sessions
  if (sessionGroups.size < MIN_SESSIONS_FOR_TRENDS) {
    return [];
  }

  // Sort sessions by most recent date first
  const sortedSessionIds = sortSessionsByDate(sessionGroups);

  // Requirement 7.4: Include up to 5 most recent sessions
  const selectedSessionIds = sortedSessionIds.slice(0, MAX_TREND_SESSIONS);

  // Build trend data points from selected sessions
  const trendData: TrendDataPoint[] = [];

  for (const sessionId of selectedSessionIds) {
    const sessionResults = sessionGroups.get(sessionId)!;
    for (const result of sessionResults) {
      trendData.push({
        testType: result.testType,
        sessionDate: new Date(result.collectionTimestamp),
        value: result.measuredValue,
        category: result.riskCategory ?? RiskCategory.Uncategorized,
      });
    }
  }

  // Sort trend data by session date (oldest first) for chart rendering
  trendData.sort((a, b) => a.sessionDate.getTime() - b.sessionDate.getTime());

  return trendData;
}

/**
 * Determines pending tests for a session in 'pending_results' status.
 * Compares expected tests from the package with recorded results.
 *
 * @param expectedTestTypes - The test types expected based on the checkup package
 * @param recordedResults - The test results already recorded for this session
 * @returns Array of test type strings that are pending
 */
export function determinePendingTestTypes(
  expectedTestTypes: string[],
  recordedResults: TestResult[]
): string[] {
  const recordedTypes = new Set(recordedResults.map((r) => r.testType));
  return expectedTestTypes.filter((testType) => !recordedTypes.has(testType));
}

/**
 * Checks whether a report should be regenerated based on new results arriving.
 *
 * @param previousPendingTests - Tests that were pending in the last report generation
 * @param currentResults - Current test results for the session
 * @returns true if new results have arrived that resolve previously pending tests
 */
export function shouldRegenerateReport(
  previousPendingTests: string[],
  currentResults: TestResult[]
): boolean {
  if (previousPendingTests.length === 0) {
    return false;
  }

  const currentTestTypes = new Set(currentResults.map((r) => r.testType));

  // If any previously pending test now has a result, regeneration is needed
  return previousPendingTests.some((testType) => currentTestTypes.has(testType));
}
