import { ServiceClass } from './constants';
import {
  HealthCheckMonitor,
  InMemoryAvailabilityAlertSink,
} from './monitor';
import { AvailabilityStatus, type HealthCheckResult } from './state-machine';

/**
 * Focused unit tests for the stateful health-check monitor wrapper (Req 24.3,
 * 24.4, 24.5).
 */

const BASE = Date.UTC(2025, 0, 5, 0, 0, 0);

function check(index: number, success: boolean): HealthCheckResult {
  return { success, timestamp: new Date(BASE + index * 60_000).toISOString() };
}

describe('HealthCheckMonitor state transitions (Req 24.3, 24.4)', () => {
  it('flips to unavailable on the 3rd failure and reports the transition', () => {
    const monitor = new HealthCheckMonitor({
      serviceId: 'gateway',
      serviceClass: ServiceClass.GENERAL,
    });
    monitor.record(check(0, false));
    monitor.record(check(1, false));
    const applied = monitor.record(check(2, false));

    expect(HealthCheckMonitor.isDowntimeStart(applied)).toBe(true);
    expect(monitor.unavailable).toBe(true);
    expect(monitor.state.status).toBe(AvailabilityStatus.UNAVAILABLE);
    expect(monitor.intervals).toHaveLength(1);
  });

  it('recovers on the 3rd success and reports the transition', () => {
    const monitor = new HealthCheckMonitor({
      serviceId: 'gateway',
      serviceClass: ServiceClass.GENERAL,
    });
    [check(0, false), check(1, false), check(2, false)].forEach((c) =>
      monitor.record(c),
    );
    monitor.record(check(3, true));
    monitor.record(check(4, true));
    const applied = monitor.record(check(5, true));

    expect(HealthCheckMonitor.isRecovery(applied)).toBe(true);
    expect(monitor.unavailable).toBe(false);
    expect(monitor.intervals[0].end).toBe(check(3, true).timestamp);
  });
});

describe('HealthCheckMonitor budget alerting (Req 24.5)', () => {
  it('raises an availability-breach alert to the sink when budget exceeded', () => {
    const sink = new InMemoryAvailabilityAlertSink();
    // Evaluate at a fixed instant so the ongoing interval accrues > 43 min.
    const now = new Date(BASE + 50 * 60_000); // 50 minutes after the outage began
    const monitor = new HealthCheckMonitor({
      serviceId: 'gateway',
      serviceClass: ServiceClass.GENERAL,
      clock: () => now,
      alertSink: sink,
    });
    // Go unavailable: downtime interval starts at check(0).
    [check(0, false), check(1, false), check(2, false)].forEach((c) =>
      monitor.record(c),
    );

    const evaluation = monitor.evaluateBudget();

    expect(evaluation.breached).toBe(true);
    expect(evaluation.totalDowntimeMinutes).toBeCloseTo(50, 5);
    expect(sink.count).toBe(1);
    expect(sink.last?.serviceId).toBe('gateway');
    expect(sink.last?.serviceClass).toBe(ServiceClass.GENERAL);
    expect(sink.last?.intervals).toHaveLength(1);
  });

  it('does not raise an alert while within budget', () => {
    const sink = new InMemoryAvailabilityAlertSink();
    const now = new Date(BASE + 10 * 60_000); // only 10 minutes of downtime
    const monitor = new HealthCheckMonitor({
      serviceId: 'gateway',
      serviceClass: ServiceClass.GENERAL,
      clock: () => now,
      alertSink: sink,
    });
    [check(0, false), check(1, false), check(2, false)].forEach((c) =>
      monitor.record(c),
    );

    const evaluation = monitor.evaluateBudget();

    expect(evaluation.breached).toBe(false);
    expect(sink.count).toBe(0);
  });
});
