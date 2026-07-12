/**
 * Health-check monitor: an ergonomic, stateful wrapper around the pure downtime
 * state machine and availability accounting (Task 16.9, Req 24.3, 24.4, 24.5).
 *
 * The monitor advances the {@link MonitorState} as health-check results arrive
 * and, on demand, evaluates the current calendar month's accumulated downtime
 * against the service class's budget — emitting an availability-breach alert to
 * an injected sink when the budget is exceeded (Req 24.5). All time-dependent
 * behaviour is driven by an injected clock, keeping the monitor deterministic
 * and testable.
 *
 * The underlying reducer and accounting functions remain pure and independently
 * usable; this class merely retains the evolving state and forwards alerts.
 *
 * Requirements: 24.3, 24.4, 24.5
 */

import type { ServiceClass } from './constants';
import {
  type AvailabilityBreachAlert,
  type BudgetEvaluation,
  evaluateMonthlyBudget,
  monthOf,
} from './accounting';
import {
  type ApplyResult,
  type DowntimeInterval,
  type HealthCheckResult,
  type MonitorState,
  applyHealthCheck,
  initialMonitorState,
  isUnavailable,
  StateTransition,
} from './state-machine';

/** A clock the monitor consults for the current instant. Injectable for tests. */
export type MonitorClock = () => Date;

/**
 * Append-only sink for availability-breach alerts (Req 24.5). Injected into the
 * {@link HealthCheckMonitor}; production wires this to the operator alerting
 * pipeline (paging / SIEM). Mirrors the transport guard's recorder pattern.
 */
export interface AvailabilityAlertSink {
  raise(alert: AvailabilityBreachAlert): void | Promise<void>;
}

/**
 * In-memory {@link AvailabilityAlertSink} for tests and local development.
 * Retains every raised alert in insertion order.
 */
export class InMemoryAvailabilityAlertSink implements AvailabilityAlertSink {
  private readonly alerts: AvailabilityBreachAlert[] = [];

  raise(alert: AvailabilityBreachAlert): void {
    this.alerts.push(alert);
  }

  /** All raised alerts, in the order they were raised. */
  get raised(): readonly AvailabilityBreachAlert[] {
    return this.alerts;
  }

  /** Number of raised alerts. */
  get count(): number {
    return this.alerts.length;
  }

  /** The most recently raised alert, or undefined if none. */
  get last(): AvailabilityBreachAlert | undefined {
    return this.alerts[this.alerts.length - 1];
  }

  /** Discard all raised alerts. */
  clear(): void {
    this.alerts.length = 0;
  }
}

/** Configuration for a {@link HealthCheckMonitor}. */
export interface HealthCheckMonitorOptions {
  /** The concrete monitored service identifier. */
  readonly serviceId: string;
  /** The service class, selecting the applicable monthly budget (Req 24.5). */
  readonly serviceClass: ServiceClass;
  /** Clock supplying the current instant; defaults to the system clock. */
  readonly clock?: MonitorClock;
  /** Sink availability-breach alerts are raised to (Req 24.5). */
  readonly alertSink?: AvailabilityAlertSink;
}

/**
 * A stateful health-check monitor for a single service (Req 24.3, 24.4, 24.5).
 */
export class HealthCheckMonitor {
  readonly serviceId: string;
  readonly serviceClass: ServiceClass;
  private readonly clock: MonitorClock;
  private readonly alertSink?: AvailabilityAlertSink;
  private currentState: MonitorState;

  constructor(options: HealthCheckMonitorOptions) {
    this.serviceId = options.serviceId;
    this.serviceClass = options.serviceClass;
    this.clock = options.clock ?? (() => new Date());
    this.alertSink = options.alertSink;
    this.currentState = initialMonitorState();
  }

  /** The current state-machine state (Req 24.3, 24.4). */
  get state(): MonitorState {
    return this.currentState;
  }

  /** Whether the service is currently recorded as unavailable (Req 24.3). */
  get unavailable(): boolean {
    return isUnavailable(this.currentState);
  }

  /** The retained downtime intervals for the service (Req 24.5). */
  get intervals(): readonly DowntimeInterval[] {
    return this.currentState.intervals;
  }

  /**
   * Record a health-check result, advancing the state machine and returning the
   * transition it produced (Req 24.3, 24.4). If a check flips the service into
   * a recorded state change, the caller can inspect the returned transition.
   */
  record(result: HealthCheckResult): ApplyResult {
    const applied = applyHealthCheck(this.currentState, result);
    this.currentState = applied.state;
    return applied;
  }

  /** True when the last recorded check moved the service to unavailable. */
  static isDowntimeStart(applied: ApplyResult): boolean {
    return applied.transition === StateTransition.WENT_UNAVAILABLE;
  }

  /** True when the last recorded check moved the service back to available. */
  static isRecovery(applied: ApplyResult): boolean {
    return applied.transition === StateTransition.RECOVERED;
  }

  /**
   * Evaluate the calendar month containing the current instant against the
   * service's downtime budget, raising an availability-breach alert to the sink
   * when the budget is exceeded (Req 24.5). Returns the full evaluation. The
   * alert is raised at most once per call; callers control cadence.
   */
  evaluateBudget(): BudgetEvaluation {
    const now = this.clock();
    const evaluation = evaluateMonthlyBudget({
      serviceId: this.serviceId,
      serviceClass: this.serviceClass,
      intervals: this.currentState.intervals,
      month: monthOf(now),
      now,
    });
    if (evaluation.alert !== undefined && this.alertSink !== undefined) {
      void this.alertSink.raise(evaluation.alert);
    }
    return evaluation;
  }
}
