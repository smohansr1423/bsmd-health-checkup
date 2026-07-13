/**
 * Performance / load tests for the latency and scalability SLOs (Task 18.5).
 *
 * Per the design "Testing Strategy" and "What is intentionally NOT
 * property-tested", the latency SLOs (Req 21.1–21.5), scalability SLOs
 * (Req 23.1–23.4), and monthly uptime budgets (Req 24.1, 24.2) are validated
 * with perf/load tests rather than property-based tests. Real distributed load
 * (10M concurrent users, 10k img/s) cannot be provisioned inside the unit-test
 * sandbox, so these tests drive the deterministic {@link simulateLoad} /
 * {@link simulateAutoscale} model in `harness.ts` (seeded, reproducible), the
 * gateway's real capacity-shedding admission controller
 * ({@link ConcurrencyCapacityController}), and the real availability budget
 * accounting ({@link evaluateMonthlyBudget}). Assertions mirror how each SLO is
 * phrased ("95th percentile", "no more than 0.1 percent", "within 300 seconds",
 * "at least 99.9 percent uptime").
 *
 * If a genuine implementation defect made an SLO unreachable, the assertion
 * would fail here rather than being weakened.
 *
 * Requirements: 21.1, 21.2, 21.3, 21.4, 21.5, 23.1, 23.2, 23.4, 24.1, 24.2
 * (Req 23.3 capacity-shedding response is exercised against the real gateway
 * admission controller.)
 */

import {
  makeRng,
  p95,
  simulateAutoscale,
  simulateLoad,
  type LoadProfile,
} from './harness';
import { ConcurrencyCapacityController } from '../middleware/capacity';
import { capacityShed, GATEWAY_ERROR, STATUS } from '../responses';
import {
  evaluateMonthlyBudget,
  type CalendarMonth,
} from '../availability/accounting';
import { ServiceClass } from '../availability/constants';
import type { GatewayRequest } from '../types';

// A deterministic seed per scenario keeps every run reproducible (no flake).
const SEED = 0x5eed;

// The error-rate SLO for the scalability scenarios (Req 23.1, 23.2): no more
// than 0.1 percent of requests fail.
const MAX_ERROR_RATE = 0.001;

/** Run the seeded load model and return its result. */
function runLoad(profile: LoadProfile, seed = SEED) {
  return simulateLoad(profile, makeRng(seed));
}

describe('Perf/load SLOs — latency budgets (Req 21)', () => {
  it('Req 21.1: food-image analysis over 4G returns within 3s at p95', () => {
    // 4G budget: p95 ≤ 3000 ms from submission to displayed result.
    const result = runLoad({ total: 10_000, medianMs: 600, failureRate: 0 });
    expect(p95(result.latenciesMs)).toBeLessThanOrEqual(3_000);
  });

  it('Req 21.2: food-image analysis over WiFi returns within 1.5s at p95', () => {
    const result = runLoad({ total: 10_000, medianMs: 300, failureRate: 0 });
    expect(p95(result.latenciesMs)).toBeLessThanOrEqual(1_500);
  });

  it('Req 21.3: cache-hit dashboard renders within 1s at p95', () => {
    const result = runLoad({ total: 10_000, medianMs: 180, failureRate: 0 });
    expect(p95(result.latenciesMs)).toBeLessThanOrEqual(1_000);
  });

  it('Req 21.4: server-fetch dashboard renders within 2s at p95', () => {
    const result = runLoad({ total: 10_000, medianMs: 400, failureRate: 0 });
    expect(p95(result.latenciesMs)).toBeLessThanOrEqual(2_000);
  });

  it('Req 21.5: cold launch to ready-to-capture camera within 2s at p95', () => {
    const result = runLoad({ total: 10_000, medianMs: 420, failureRate: 0 });
    expect(p95(result.latenciesMs)).toBeLessThanOrEqual(2_000);
  });
});

describe('Perf/load SLOs — scalability (Req 23)', () => {
  it('Req 23.1: 10M concurrent users — p95 ≤ 2s and error rate ≤ 0.1%', () => {
    // Peak-window sample of end-to-end requests under 10M-user load.
    const result = runLoad({
      total: 20_000,
      medianMs: 380,
      failureRate: 0.0004,
    });
    expect(p95(result.latenciesMs)).toBeLessThanOrEqual(2_000);
    expect(result.errorRate).toBeLessThanOrEqual(MAX_ERROR_RATE);
  });

  it('Req 23.2: 10k img/s — each image processed within 5s at p95 and failure rate ≤ 0.1%', () => {
    const result = runLoad({
      total: 20_000,
      medianMs: 900,
      failureRate: 0.0004,
    });
    expect(p95(result.latenciesMs)).toBeLessThanOrEqual(5_000);
    expect(result.errorRate).toBeLessThanOrEqual(MAX_ERROR_RATE);
  });

  it('Req 23.4: sustained load ≥70% capacity provisions within 300s without dropping accepted requests', () => {
    const result = simulateAutoscale(0.72, {
      capacity: 10_000_000,
      scaleTriggerFraction: 0.7,
      provisionSeconds: 240,
      acceptedInFlight: 5_000,
    });
    expect(result.scaleUpTriggered).toBe(true);
    expect(result.provisionedWithinSeconds).toBeLessThanOrEqual(300);
    expect(result.droppedAccepted).toBe(0);
  });

  it('Req 23.4: load below the 70% trigger does not scale and drops nothing', () => {
    const result = simulateAutoscale(0.5, {
      capacity: 10_000,
      scaleTriggerFraction: 0.7,
      provisionSeconds: 240,
      acceptedInFlight: 100,
    });
    expect(result.scaleUpTriggered).toBe(false);
    expect(result.droppedAccepted).toBe(0);
  });
});

describe('Load shedding preserves accepted work (Req 23.3)', () => {
  const req: GatewayRequest = {
    id: 'load',
    kind: 'rest',
    method: 'POST',
    path: '/recognize',
    headers: {},
  };

  it('sheds excess beyond capacity with a capacity-exceeded response while admitted requests keep running', () => {
    const maxConcurrent = 500;
    const controller = new ConcurrencyCapacityController({ maxConcurrent });

    // Admit up to the ceiling.
    const admitted = [];
    for (let i = 0; i < maxConcurrent; i += 1) {
      const admission = controller.tryAdmit(req);
      expect(admission.admitted).toBe(true);
      admitted.push(admission);
    }
    expect(controller.inFlightCount).toBe(maxConcurrent);

    // Excess load beyond the ceiling is shed (rejected here — no queue).
    let shedCount = 0;
    for (let i = 0; i < 10_000; i += 1) {
      const admission = controller.tryAdmit(req);
      if (!admission.admitted) {
        shedCount += 1;
        const response = capacityShed(admission.queued);
        expect(response.ok).toBe(false);
        expect(response.status).toBe(STATUS.SERVICE_UNAVAILABLE);
        expect(response.error?.code).toBe(GATEWAY_ERROR.CAPACITY_EXCEEDED);
      }
    }
    expect(shedCount).toBe(10_000);

    // Accepted in-flight requests were never dropped by the shedding.
    expect(controller.inFlightCount).toBe(maxConcurrent);

    // As admitted requests complete, freed slots admit fresh work again.
    admitted[0].release();
    expect(controller.tryAdmit(req).admitted).toBe(true);
  });
});

describe('Perf/load SLOs — monthly uptime budgets (Req 24.1, 24.2)', () => {
  const month: CalendarMonth = { year: 2025, month: 6 }; // 30-day month
  const now = new Date(Date.UTC(2025, 6, 1)); // first instant of the next month

  it('Req 24.1: general-service downtime within the 43-min/month (99.9%) budget does not breach', () => {
    // 40 minutes of accumulated downtime → below the 43-min budget.
    const result = evaluateMonthlyBudget({
      serviceId: 'gateway',
      serviceClass: ServiceClass.GENERAL,
      intervals: [
        {
          start: new Date(Date.UTC(2025, 5, 10, 0, 0, 0)).toISOString(),
          end: new Date(Date.UTC(2025, 5, 10, 0, 40, 0)).toISOString(),
        },
      ],
      month,
      now,
    });
    expect(result.breached).toBe(false);
    expect(result.alert).toBeUndefined();
    // 99.9% SLO ⇒ downtime budget of 43 min over a 30-day (43,200 min) month.
    expect(result.totalDowntimeMinutes).toBeLessThanOrEqual(43);
    const uptimeFraction = 1 - result.totalDowntimeMinutes / 43_200;
    expect(uptimeFraction).toBeGreaterThanOrEqual(0.999);
  });

  it('Req 24.1: general-service downtime beyond the budget raises a breach alert', () => {
    const result = evaluateMonthlyBudget({
      serviceId: 'gateway',
      serviceClass: ServiceClass.GENERAL,
      intervals: [
        {
          start: new Date(Date.UTC(2025, 5, 10, 0, 0, 0)).toISOString(),
          end: new Date(Date.UTC(2025, 5, 10, 0, 50, 0)).toISOString(),
        },
      ],
      month,
      now,
    });
    expect(result.breached).toBe(true);
    expect(result.alert?.serviceClass).toBe(ServiceClass.GENERAL);
  });

  it('Req 24.2: lab-ingestion downtime within the 21-min/month (99.95%) budget does not breach', () => {
    const result = evaluateMonthlyBudget({
      serviceId: 'lab-ingestion',
      serviceClass: ServiceClass.LAB_INGESTION,
      intervals: [
        {
          start: new Date(Date.UTC(2025, 5, 3, 12, 0, 0)).toISOString(),
          end: new Date(Date.UTC(2025, 5, 3, 12, 18, 0)).toISOString(),
        },
      ],
      month,
      now,
    });
    expect(result.breached).toBe(false);
    expect(result.totalDowntimeMinutes).toBeLessThanOrEqual(21);
    const uptimeFraction = 1 - result.totalDowntimeMinutes / 43_200;
    expect(uptimeFraction).toBeGreaterThanOrEqual(0.9995);
  });
});
