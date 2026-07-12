import {
  AvailabilityStatus,
  applyHealthCheck,
  applyHealthChecks,
  downtimeIntervals,
  initialMonitorState,
  isUnavailable,
  StateTransition,
  type HealthCheckResult,
  type MonitorState,
} from './state-machine';

/**
 * Focused unit tests for the health-check downtime state machine (Req 24.3,
 * 24.4, 24.5). The optional property test (Property 56) is task 16.10.
 */

// 60-second cadence starting at a fixed instant.
const BASE = Date.UTC(2025, 0, 1, 0, 0, 0); // 2025-01-01T00:00:00Z

function check(index: number, success: boolean): HealthCheckResult {
  return {
    success,
    timestamp: new Date(BASE + index * 60_000).toISOString(),
  };
}

/** Build a chronological sequence from a pattern of booleans. */
function sequence(pattern: readonly boolean[]): HealthCheckResult[] {
  return pattern.map((success, i) => check(i, success));
}

describe('initialMonitorState', () => {
  it('starts available with no checks and no intervals', () => {
    const s = initialMonitorState();
    expect(s.status).toBe(AvailabilityStatus.AVAILABLE);
    expect(s.consecutiveFailures).toBe(0);
    expect(s.consecutiveSuccesses).toBe(0);
    expect(s.intervals).toEqual([]);
    expect(isUnavailable(s)).toBe(false);
  });
});

describe('going unavailable (Req 24.3)', () => {
  it('does not flip before the 3rd consecutive failure', () => {
    const s = applyHealthChecks(initialMonitorState(), sequence([false, false]));
    expect(s.status).toBe(AvailabilityStatus.AVAILABLE);
    expect(s.consecutiveFailures).toBe(2);
    expect(s.intervals).toEqual([]);
  });

  it('records unavailable exactly on the 3rd consecutive failure', () => {
    let state = initialMonitorState();
    const transitions: StateTransition[] = [];
    for (const c of sequence([false, false, false])) {
      const applied = applyHealthCheck(state, c);
      state = applied.state;
      transitions.push(applied.transition);
    }
    expect(transitions).toEqual([
      StateTransition.NONE,
      StateTransition.NONE,
      StateTransition.WENT_UNAVAILABLE,
    ]);
    expect(state.status).toBe(AvailabilityStatus.UNAVAILABLE);
    expect(state.intervals).toHaveLength(1);
    // Start timestamp is the FIRST failed check of the streak.
    expect(state.intervals[0].start).toBe(check(0, false).timestamp);
    expect(state.intervals[0].end).toBeUndefined();
  });

  it('resets the failing streak when a success interrupts it', () => {
    // fail, fail, success, fail, fail -> never 3 consecutive fails.
    const s = applyHealthChecks(
      initialMonitorState(),
      sequence([false, false, true, false, false]),
    );
    expect(s.status).toBe(AvailabilityStatus.AVAILABLE);
    expect(s.intervals).toEqual([]);
  });
});

describe('recovering (Req 24.4)', () => {
  function downState(): MonitorState {
    return applyHealthChecks(initialMonitorState(), sequence([false, false, false]));
  }

  it('does not recover before the 3rd consecutive success', () => {
    let state = downState();
    // two successes only
    state = applyHealthCheck(state, check(3, true)).state;
    state = applyHealthCheck(state, check(4, true)).state;
    expect(state.status).toBe(AvailabilityStatus.UNAVAILABLE);
    expect(state.intervals[0].end).toBeUndefined();
  });

  it('records available exactly on the 3rd consecutive success and closes the interval', () => {
    let state = downState();
    const transitions: StateTransition[] = [];
    for (const c of [check(3, true), check(4, true), check(5, true)]) {
      const applied = applyHealthCheck(state, c);
      state = applied.state;
      transitions.push(applied.transition);
    }
    expect(transitions).toEqual([
      StateTransition.NONE,
      StateTransition.NONE,
      StateTransition.RECOVERED,
    ]);
    expect(state.status).toBe(AvailabilityStatus.AVAILABLE);
    expect(state.intervals).toHaveLength(1);
    // End timestamp is the FIRST successful check of the recovery streak.
    expect(state.intervals[0].end).toBe(check(3, true).timestamp);
    expect(state.intervals[0].start).toBe(check(0, false).timestamp);
  });

  it('resets the recovery streak when a failure interrupts it', () => {
    let state = downState();
    // success, success, failure, success, success -> not yet 3 consecutive.
    state = applyHealthChecks(
      state,
      [check(3, true), check(4, true), check(5, false), check(6, true), check(7, true)],
    );
    expect(state.status).toBe(AvailabilityStatus.UNAVAILABLE);
    expect(state.intervals[0].end).toBeUndefined();
  });
});

describe('multiple downtime intervals are retained (Req 24.5)', () => {
  it('records and retains a second interval after recovery', () => {
    // down, up, down again
    const pattern = [
      false, false, false, // interval 1 starts @0
      true, true, true, // interval 1 ends @3
      true, // extra healthy
      false, false, false, // interval 2 starts @7
    ];
    const state = applyHealthChecks(initialMonitorState(), sequence(pattern));
    const intervals = downtimeIntervals(state);
    expect(intervals).toHaveLength(2);
    expect(intervals[0].start).toBe(check(0, false).timestamp);
    expect(intervals[0].end).toBe(check(3, true).timestamp);
    expect(intervals[1].start).toBe(check(7, false).timestamp);
    expect(intervals[1].end).toBeUndefined();
    expect(state.status).toBe(AvailabilityStatus.UNAVAILABLE);
  });
});

describe('purity', () => {
  it('does not mutate the input state', () => {
    const s = initialMonitorState();
    const snapshot = JSON.stringify(s);
    applyHealthCheck(s, check(0, false));
    expect(JSON.stringify(s)).toBe(snapshot);
  });

  it('accepts Date timestamps as well as ISO strings', () => {
    const state = applyHealthCheck(initialMonitorState(), {
      success: false,
      timestamp: new Date(BASE),
    }).state;
    expect(state.pendingDowntimeStart).toBe(new Date(BASE).toISOString());
  });
});
