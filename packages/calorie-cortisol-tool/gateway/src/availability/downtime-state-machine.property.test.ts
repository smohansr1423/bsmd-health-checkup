import fc from 'fast-check';

import {
  CONSECUTIVE_THRESHOLD,
  MONTHLY_DOWNTIME_BUDGET_MINUTES,
  ServiceClass,
} from './constants';
import {
  AvailabilityStatus,
  applyHealthCheck,
  applyHealthChecks,
  downtimeIntervals,
  initialMonitorState,
  isUnavailable,
  StateTransition,
  type DowntimeInterval,
  type HealthCheckResult,
} from './state-machine';
import {
  accumulatedDowntimeMs,
  evaluateMonthlyBudget,
  monthOf,
} from './accounting';

/**
 * Property-based test for the health-check downtime state machine and its
 * availability accounting (Task 16.10), targeting the gateway monitoring
 * subsystem implemented in Task 16.9.
 *
 * Feature: calorie-cortisol-tool, Property 56
 * Property 56: Health-check downtime state machine.
 *   For any sequence of health-check results, a service is recorded unavailable
 *   after exactly 3 consecutive failed checks (recording the downtime start as
 *   the first failed check of that streak) and available again after exactly 3
 *   consecutive successful checks (recording the downtime end as the first
 *   successful check of that recovery streak), and every recorded downtime
 *   interval is retained. Accumulated per-month downtime is charged against the
 *   service class's budget, breaching iff the total exceeds it.
 *
 * Validates: Requirements 24.3, 24.4, 24.5
 */

// A 60-second health-check cadence anchored inside a single calendar month so
// accounting needs no cross-month clipping.
const BASE = Date.UTC(2025, 0, 1, 0, 0, 0); // 2025-01-01T00:00:00Z
const CADENCE_MS = 60_000;

/** Timestamp (ISO) of the check at the given zero-based index. */
function tsAt(index: number): string {
  return new Date(BASE + index * CADENCE_MS).toISOString();
}

/** Build a chronological sequence of results from a boolean pattern. */
function sequence(pattern: readonly boolean[]): HealthCheckResult[] {
  return pattern.map((success, i) => ({ success, timestamp: tsAt(i) }));
}

// ---------------------------------------------------------------------------
// Independent oracle
// ---------------------------------------------------------------------------

interface OracleInterval {
  readonly startIdx: number;
  readonly endIdx?: number;
}

interface OracleResult {
  readonly status: AvailabilityStatus;
  readonly intervals: readonly OracleInterval[];
}

/**
 * Recompute the expected recorded status and downtime intervals directly from
 * the Req 24.3/24.4 rules, tracking only the length of the current same-result
 * run and the index of its first check. This is a deliberately different
 * representation from the reducer (run scanning by index rather than a threaded
 * counter state), so the property constrains behaviour rather than mirroring
 * the implementation.
 *
 *   - available + THRESHOLD consecutive failures  → unavailable; open a new
 *     interval whose start is the first failure of the streak.
 *   - unavailable + THRESHOLD consecutive successes → available; close the open
 *     interval with an end at the first success of the recovery streak.
 *
 * After each flip the run counter resets, so a further flip requires a fresh
 * streak; while a service is already in a state, additional same-result checks
 * neither open nor close intervals.
 */
function oracle(pattern: readonly boolean[]): OracleResult {
  let status: AvailabilityStatus = AvailabilityStatus.AVAILABLE;
  let runValue: boolean | null = null;
  let run = 0;
  let firstIdxOfRun = -1;
  const intervals: OracleInterval[] = [];

  for (let i = 0; i < pattern.length; i += 1) {
    const success = pattern[i];
    if (success === runValue) {
      run += 1;
    } else {
      runValue = success;
      run = 1;
      firstIdxOfRun = i;
    }

    if (!success) {
      if (
        status === AvailabilityStatus.AVAILABLE &&
        run >= CONSECUTIVE_THRESHOLD
      ) {
        status = AvailabilityStatus.UNAVAILABLE;
        intervals.push({ startIdx: firstIdxOfRun });
        run = 0; // fresh streak required for any subsequent flip
      }
    } else if (
      status === AvailabilityStatus.UNAVAILABLE &&
      run >= CONSECUTIVE_THRESHOLD
    ) {
      status = AvailabilityStatus.AVAILABLE;
      const openIdx = intervals.length - 1;
      intervals[openIdx] = { ...intervals[openIdx], endIdx: firstIdxOfRun };
      run = 0;
    }
  }

  return { status, intervals };
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/**
 * Run-based generator: a series of same-result runs whose lengths cluster on
 * the THRESHOLD boundary (1, 2, 3, 4…) so the "exactly 3" behaviour is exercised
 * from both sides. Flattened into a boolean pattern.
 */
const runBasedPattern: fc.Arbitrary<boolean[]> = fc
  .array(
    fc.record({
      value: fc.boolean(),
      len: fc.integer({ min: 1, max: 6 }),
    }),
    { maxLength: 18 },
  )
  .map((runs) => {
    const out: boolean[] = [];
    for (const { value, len } of runs) {
      for (let i = 0; i < len; i += 1) out.push(value);
    }
    return out;
  });

/** Purely random result patterns for additional coverage. */
const randomPattern: fc.Arbitrary<boolean[]> = fc.array(fc.boolean(), {
  maxLength: 60,
});

const patternArb: fc.Arbitrary<boolean[]> = fc.oneof(
  { weight: 3, arbitrary: runBasedPattern },
  { weight: 1, arbitrary: randomPattern },
);

// ---------------------------------------------------------------------------
// Structural invariants (independent of the oracle)
// ---------------------------------------------------------------------------

function assertStructuralInvariants(
  intervals: readonly DowntimeInterval[],
  status: AvailabilityStatus,
): void {
  let openCount = 0;
  let previousStartMs = -Infinity;
  for (let i = 0; i < intervals.length; i += 1) {
    const { start, end } = intervals[i];
    const startMs = Date.parse(start);
    expect(Number.isNaN(startMs)).toBe(false);

    // Intervals are retained in chronological, non-overlapping order.
    expect(startMs).toBeGreaterThanOrEqual(previousStartMs);
    previousStartMs = startMs;

    if (end === undefined) {
      openCount += 1;
      // Only the final interval may be ongoing.
      expect(i).toBe(intervals.length - 1);
    } else {
      const endMs = Date.parse(end);
      expect(Number.isNaN(endMs)).toBe(false);
      // A closed interval ends no earlier than it started.
      expect(endMs).toBeGreaterThanOrEqual(startMs);
    }
  }

  // An interval is open iff the service is currently recorded unavailable.
  if (status === AvailabilityStatus.UNAVAILABLE) {
    expect(openCount).toBe(1);
  } else {
    expect(openCount).toBe(0);
  }
}

// ---------------------------------------------------------------------------
// Property
// ---------------------------------------------------------------------------

describe('Property 56: Health-check downtime state machine [Feature: calorie-cortisol-tool, Property 56]', () => {
  it('flips on exactly 3 consecutive checks, records/retains intervals with correct start/end, and accounts monthly downtime (Req 24.3, 24.4, 24.5)', () => {
    fc.assert(
      fc.property(patternArb, (pattern) => {
        const finalState = applyHealthChecks(initialMonitorState(), sequence(pattern));
        const expected = oracle(pattern);

        // 1. Recorded availability status matches the independent oracle.
        expect(finalState.status).toBe(expected.status);
        expect(isUnavailable(finalState)).toBe(
          expected.status === AvailabilityStatus.UNAVAILABLE,
        );

        // 2. Exactly the expected intervals are recorded and retained, in order,
        //    each with the correct first-failure start and first-success end.
        const intervals = downtimeIntervals(finalState);
        expect(intervals).toHaveLength(expected.intervals.length);
        expected.intervals.forEach((oracleInterval, idx) => {
          expect(intervals[idx].start).toBe(tsAt(oracleInterval.startIdx));
          if (oracleInterval.endIdx === undefined) {
            expect(intervals[idx].end).toBeUndefined();
          } else {
            expect(intervals[idx].end).toBe(tsAt(oracleInterval.endIdx));
          }
        });

        // 3. Reducer-only structural invariants hold regardless of the oracle.
        assertStructuralInvariants(intervals, finalState.status);

        // 4. Folding equals step-by-step application, and every WENT_UNAVAILABLE
        //    transition corresponds to exactly one recorded interval.
        let stepState = initialMonitorState();
        let downtimeStarts = 0;
        let recoveries = 0;
        for (const result of sequence(pattern)) {
          const applied = applyHealthCheck(stepState, result);
          stepState = applied.state;
          if (applied.transition === StateTransition.WENT_UNAVAILABLE) {
            downtimeStarts += 1;
          } else if (applied.transition === StateTransition.RECOVERED) {
            recoveries += 1;
          }
        }
        expect(stepState).toEqual(finalState);
        expect(downtimeStarts).toBe(intervals.length);
        const closedIntervals = intervals.filter((i) => i.end !== undefined).length;
        expect(recoveries).toBe(closedIntervals);

        // 5. Availability accounting (Req 24.5): accumulated monthly downtime
        //    equals the independent sum of interval durations (open intervals
        //    charged up to `now`), and a budget breach occurs iff the total
        //    exceeds the service class's budget.
        const nowMs = BASE + (pattern.length + 1) * CADENCE_MS;
        const now = new Date(nowMs);
        const month = monthOf(now);

        let expectedMs = 0;
        for (const interval of intervals) {
          const from = Date.parse(interval.start);
          const to = interval.end === undefined ? nowMs : Date.parse(interval.end);
          expectedMs += Math.max(0, to - from);
        }
        const actualMs = accumulatedDowntimeMs(intervals, month, now);
        expect(actualMs).toBe(expectedMs);

        const generalEval = evaluateMonthlyBudget({
          serviceId: 'svc-general',
          serviceClass: ServiceClass.GENERAL,
          intervals,
          month,
          now,
        });
        const expectedMinutes = expectedMs / 60_000;
        expect(generalEval.totalDowntimeMinutes).toBeCloseTo(expectedMinutes, 9);
        expect(generalEval.breached).toBe(
          expectedMinutes > MONTHLY_DOWNTIME_BUDGET_MINUTES[ServiceClass.GENERAL],
        );
        expect(generalEval.breached ? generalEval.alert !== undefined : generalEval.alert === undefined).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it('never flips before the threshold and raises a breach alert once accumulated downtime exceeds the budget (Req 24.3, 24.5)', () => {
    // Construct outages that exceed the general 43-minute monthly budget: N
    // outage blocks, each a fail-run of >= THRESHOLD then a recovery-run of
    // >= THRESHOLD, so exactly N intervals are recorded and retained.
    const scenarioArb = fc
      .array(
        fc.record({
          failLen: fc.integer({ min: CONSECUTIVE_THRESHOLD, max: 90 }),
          recoverLen: fc.integer({ min: CONSECUTIVE_THRESHOLD, max: 5 }),
        }),
        { minLength: 1, maxLength: 6 },
      )
      .map((blocks) => {
        const pattern: boolean[] = [];
        const blockStartIdx: number[] = [];
        for (const { failLen, recoverLen } of blocks) {
          blockStartIdx.push(pattern.length);
          for (let i = 0; i < failLen; i += 1) pattern.push(false);
          for (let i = 0; i < recoverLen; i += 1) pattern.push(true);
        }
        return { pattern, blockStartIdx, blocks };
      });

    fc.assert(
      fc.property(scenarioArb, ({ pattern, blockStartIdx, blocks }) => {
        const state = applyHealthChecks(initialMonitorState(), sequence(pattern));
        const intervals = downtimeIntervals(state);

        // One retained interval per outage block, each starting at the first
        // failure of its block (the flip happened at exactly the 3rd failure,
        // but the recorded start is the streak's first failure).
        expect(intervals).toHaveLength(blocks.length);
        blocks.forEach((_, idx) => {
          expect(intervals[idx].start).toBe(tsAt(blockStartIdx[idx]));
          expect(intervals[idx].end).toBe(tsAt(blockStartIdx[idx] + blocks[idx].failLen));
        });
        // All outages recovered, so the service ends available with no open interval.
        expect(state.status).toBe(AvailabilityStatus.AVAILABLE);

        const now = new Date(BASE + (pattern.length + 1) * CADENCE_MS);
        const evaluation = evaluateMonthlyBudget({
          serviceId: 'svc-general',
          serviceClass: ServiceClass.GENERAL,
          intervals,
          month: monthOf(now),
          now,
        });

        // Each block's downtime is (failLen) minutes: start=first failure,
        // end=first success = start + failLen checks at 1-minute cadence.
        const expectedMinutes = blocks.reduce((sum, b) => sum + b.failLen, 0);
        expect(evaluation.totalDowntimeMinutes).toBeCloseTo(expectedMinutes, 9);

        const budget = MONTHLY_DOWNTIME_BUDGET_MINUTES[ServiceClass.GENERAL];
        if (expectedMinutes > budget) {
          expect(evaluation.breached).toBe(true);
          expect(evaluation.alert).toBeDefined();
          expect(evaluation.alert?.serviceId).toBe('svc-general');
          expect(evaluation.alert?.totalDowntimeMinutes).toBeCloseTo(expectedMinutes, 9);
        } else {
          expect(evaluation.breached).toBe(false);
          expect(evaluation.alert).toBeUndefined();
        }
      }),
      { numRuns: 100 },
    );
  });
});
