/**
 * Health-check downtime state machine (Task 16.9, Req 24.3, 24.4).
 *
 * A pure, deterministic reducer over a sequence of health-check results. It
 * tracks, per monitored service, whether the service is currently recorded as
 * available or unavailable and accumulates the downtime intervals it has
 * observed:
 *
 *   - A service becomes UNAVAILABLE after exactly {@link CONSECUTIVE_THRESHOLD}
 *     consecutive failed checks; the start timestamp of the downtime interval
 *     is recorded as the timestamp of the *first* failed check of that failing
 *     streak — the moment the service actually stopped responding (Req 24.3).
 *
 *   - A previously-unavailable service becomes AVAILABLE again after exactly
 *     {@link CONSECUTIVE_THRESHOLD} consecutive successful checks; the end
 *     timestamp of the downtime interval is recorded as the timestamp of the
 *     *first* successful check of that recovery streak — the moment the service
 *     started responding again (Req 24.4).
 *
 *   - Every recorded downtime interval is retained (Req 24.5). An interval that
 *     has begun but not yet recovered is retained with an undefined `end` (it
 *     is "ongoing").
 *
 * The reducer takes no clock and performs no I/O: results (with their
 * timestamps) are supplied as data, making the machine fully deterministic and
 * trivially testable.
 *
 * Requirements: 24.3, 24.4, 24.5
 */

import { CONSECUTIVE_THRESHOLD } from './constants';

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/** A single health-check observation fed to the state machine. */
export interface HealthCheckResult {
  /**
   * Whether the check returned a successful health-check response. A check that
   * timed out, errored, or returned a non-success status is `false`.
   */
  readonly success: boolean;
  /** ISO-8601 timestamp (or Date) at which the check was performed. */
  readonly timestamp: string | Date;
}

// ---------------------------------------------------------------------------
// Domain shapes
// ---------------------------------------------------------------------------

/**
 * A recorded downtime interval (Req 24.3, 24.4, 24.5). `start` is the first
 * failed check of the failing streak; `end` is the first successful check of
 * the recovery streak. An `end` of `undefined` denotes an interval that is
 * still ongoing (the service has not yet recovered).
 */
export interface DowntimeInterval {
  /** ISO-8601 start timestamp of the downtime interval (Req 24.3). */
  readonly start: string;
  /** ISO-8601 end timestamp, or undefined while the outage is ongoing (Req 24.4). */
  readonly end?: string;
}

/** The recorded availability status of a monitored service. */
export const AvailabilityStatus = {
  AVAILABLE: 'available',
  UNAVAILABLE: 'unavailable',
} as const;

export type AvailabilityStatus =
  (typeof AvailabilityStatus)[keyof typeof AvailabilityStatus];

/**
 * The immutable state of the downtime state machine for a single service.
 * Callers thread this through {@link applyHealthCheck} / {@link applyHealthChecks}.
 */
export interface MonitorState {
  /** Currently recorded availability status (Req 24.3, 24.4). */
  readonly status: AvailabilityStatus;
  /** Length of the current run of consecutive failed checks. */
  readonly consecutiveFailures: number;
  /** Length of the current run of consecutive successful checks. */
  readonly consecutiveSuccesses: number;
  /**
   * Timestamp of the first failure in the current failing streak — the
   * candidate downtime start, promoted to an interval start on the 3rd failure.
   */
  readonly pendingDowntimeStart?: string;
  /**
   * Timestamp of the first success in the current recovery streak — the
   * candidate downtime end, applied to the open interval on the 3rd success.
   */
  readonly pendingRecoveryStart?: string;
  /**
   * All recorded downtime intervals, in the order they began (Req 24.5). The
   * last entry may be ongoing (its `end` undefined) while `status` is
   * unavailable.
   */
  readonly intervals: readonly DowntimeInterval[];
}

/** The state transition, if any, produced by a single health check. */
export const StateTransition = {
  /** No change to the recorded availability status. */
  NONE: 'none',
  /** The service crossed into the unavailable state (downtime started). */
  WENT_UNAVAILABLE: 'went_unavailable',
  /** The service recovered into the available state (downtime ended). */
  RECOVERED: 'recovered',
} as const;

export type StateTransition =
  (typeof StateTransition)[keyof typeof StateTransition];

/** The result of applying a single health check to a {@link MonitorState}. */
export interface ApplyResult {
  readonly state: MonitorState;
  readonly transition: StateTransition;
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

/**
 * The initial state of a freshly-monitored service: recorded available, with no
 * observed checks and no downtime intervals.
 */
export function initialMonitorState(): MonitorState {
  return {
    status: AvailabilityStatus.AVAILABLE,
    consecutiveFailures: 0,
    consecutiveSuccesses: 0,
    intervals: [],
  };
}

function toIso(timestamp: string | Date): string {
  return timestamp instanceof Date ? timestamp.toISOString() : timestamp;
}

// ---------------------------------------------------------------------------
// Reducer (Req 24.3, 24.4)
// ---------------------------------------------------------------------------

/**
 * Apply a single health-check result to the state machine, returning the next
 * state and the transition (if any) it produced (Req 24.3, 24.4). Pure: the
 * input state is never mutated.
 */
export function applyHealthCheck(
  state: MonitorState,
  result: HealthCheckResult,
): ApplyResult {
  const at = toIso(result.timestamp);

  return result.success
    ? applySuccess(state, at)
    : applyFailure(state, at);
}

function applyFailure(state: MonitorState, at: string): ApplyResult {
  const consecutiveFailures = state.consecutiveFailures + 1;
  // The failing streak's first failure is the candidate downtime start.
  const pendingDowntimeStart =
    state.pendingDowntimeStart ?? at;

  // A failure breaks any in-progress recovery streak.
  const base: MonitorState = {
    ...state,
    consecutiveFailures,
    consecutiveSuccesses: 0,
    pendingRecoveryStart: undefined,
    pendingDowntimeStart,
  };

  // Only an available service can transition to unavailable, and only once the
  // failure threshold is reached (Req 24.3).
  if (
    state.status === AvailabilityStatus.AVAILABLE &&
    consecutiveFailures >= CONSECUTIVE_THRESHOLD
  ) {
    return {
      state: {
        ...base,
        status: AvailabilityStatus.UNAVAILABLE,
        // Reset the streak counter now that the transition is recorded; further
        // failures simply keep the (now open) interval ongoing.
        consecutiveFailures: 0,
        pendingDowntimeStart: undefined,
        intervals: [...state.intervals, { start: pendingDowntimeStart }],
      },
      transition: StateTransition.WENT_UNAVAILABLE,
    };
  }

  return { state: base, transition: StateTransition.NONE };
}

function applySuccess(state: MonitorState, at: string): ApplyResult {
  const consecutiveSuccesses = state.consecutiveSuccesses + 1;
  // The recovery streak's first success is the candidate downtime end.
  const pendingRecoveryStart = state.pendingRecoveryStart ?? at;

  // A success breaks any in-progress failing streak.
  const base: MonitorState = {
    ...state,
    consecutiveSuccesses,
    consecutiveFailures: 0,
    pendingDowntimeStart: undefined,
    pendingRecoveryStart,
  };

  // Only an unavailable service can recover, and only once the success
  // threshold is reached (Req 24.4).
  if (
    state.status === AvailabilityStatus.UNAVAILABLE &&
    consecutiveSuccesses >= CONSECUTIVE_THRESHOLD
  ) {
    return {
      state: {
        ...base,
        status: AvailabilityStatus.AVAILABLE,
        consecutiveSuccesses: 0,
        pendingRecoveryStart: undefined,
        intervals: closeOngoingInterval(state.intervals, pendingRecoveryStart),
      },
      transition: StateTransition.RECOVERED,
    };
  }

  return { state: base, transition: StateTransition.NONE };
}

/**
 * Close the currently-open (ongoing) downtime interval by stamping its `end`.
 * The open interval is the last one with no `end`; if none exists (defensive),
 * the intervals are returned unchanged.
 */
function closeOngoingInterval(
  intervals: readonly DowntimeInterval[],
  end: string,
): DowntimeInterval[] {
  const lastIndex = intervals.length - 1;
  if (lastIndex < 0 || intervals[lastIndex].end !== undefined) {
    return [...intervals];
  }
  const next = [...intervals];
  next[lastIndex] = { ...next[lastIndex], end };
  return next;
}

// ---------------------------------------------------------------------------
// Folding a sequence (Req 24.3, 24.4)
// ---------------------------------------------------------------------------

/**
 * Fold a chronological sequence of health-check results into a single
 * {@link MonitorState}, applying the state machine to each in turn (Req 24.3,
 * 24.4). Results are assumed to be ordered by their timestamp.
 */
export function applyHealthChecks(
  state: MonitorState,
  results: readonly HealthCheckResult[],
): MonitorState {
  return results.reduce<MonitorState>(
    (acc, result) => applyHealthCheck(acc, result).state,
    state,
  );
}

// ---------------------------------------------------------------------------
// Convenience accessors
// ---------------------------------------------------------------------------

/** Whether the service is currently recorded as unavailable (Req 24.3). */
export function isUnavailable(state: MonitorState): boolean {
  return state.status === AvailabilityStatus.UNAVAILABLE;
}

/**
 * The retained downtime intervals for the service (Req 24.5), including any
 * ongoing interval (with undefined `end`).
 */
export function downtimeIntervals(
  state: MonitorState,
): readonly DowntimeInterval[] {
  return state.intervals;
}
