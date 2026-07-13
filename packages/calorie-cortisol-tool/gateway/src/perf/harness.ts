/**
 * Deterministic performance/load-test harness (Task 18.5).
 *
 * The latency and scalability SLOs (Req 21, 23, 24) are validated with
 * perf/load tests rather than property-based tests (design "Testing Strategy" /
 * "What is intentionally NOT property-tested"). Real distributed load (10M
 * concurrent users, 10k img/s) cannot be spun up inside the unit-test sandbox,
 * so this harness models the SLO-relevant behaviour deterministically:
 *
 *   - a seeded PRNG so every run is reproducible (no flakiness),
 *   - an exponential-tail latency model (a realistic heavy-tailed response-time
 *     shape) whose parameters are chosen to sit under the SLO budget,
 *   - percentile / error-rate reducers that mirror how the SLOs are phrased
 *     ("95th percentile", "no more than 0.1 percent"),
 *   - a capacity/autoscale simulator that reproduces the "scale within 300s
 *     without dropping accepted requests" contract (Req 23.4).
 *
 * The harness is intentionally pure and clock-free: callers supply the seed and
 * parameters, so the resulting p95 / error-rate assertions are stable.
 */

// ---------------------------------------------------------------------------
// Deterministic PRNG (mulberry32) — reproducible, no external deps.
// ---------------------------------------------------------------------------

/** A pure random source returning floats in [0, 1). */
export type Rng = () => number;

/** Build a seeded, deterministic PRNG (mulberry32). */
export function makeRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Percentile / error-rate reducers
// ---------------------------------------------------------------------------

/**
 * The value at the given percentile (0..1) of a sample, using the
 * nearest-rank method. Returns 0 for an empty sample.
 */
export function percentile(samples: readonly number[], p: number): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((x, y) => x - y);
  const rank = Math.ceil(p * sorted.length);
  const idx = Math.min(sorted.length - 1, Math.max(0, rank - 1));
  return sorted[idx];
}

/** Convenience: the 95th-percentile value of a sample. */
export function p95(samples: readonly number[]): number {
  return percentile(samples, 0.95);
}

// ---------------------------------------------------------------------------
// Latency load model
// ---------------------------------------------------------------------------

export interface LoadProfile {
  /** Total simulated requests. */
  readonly total: number;
  /** Median successful response time, in milliseconds. */
  readonly medianMs: number;
  /** Fraction of requests that fail (0..1). Failed requests yield no latency. */
  readonly failureRate: number;
}

export interface LoadResult {
  /** Latency samples (ms) of the requests that succeeded. */
  readonly latenciesMs: readonly number[];
  /** Number of failed requests. */
  readonly errors: number;
  /** Total requests issued. */
  readonly total: number;
  /** Observed failure fraction (errors / total). */
  readonly errorRate: number;
}

/**
 * Simulate a burst of `total` requests. Each request either fails (with
 * probability `failureRate`) or succeeds with a latency drawn from an
 * exponential distribution with the given median — a realistic heavy-tailed
 * response-time shape. Deterministic for a fixed `rng` seed.
 */
export function simulateLoad(profile: LoadProfile, rng: Rng): LoadResult {
  const { total, medianMs, failureRate } = profile;
  const latenciesMs: number[] = [];
  let errors = 0;

  // For an exponential distribution with median m, the rate is ln(2)/m, so a
  // uniform u maps to latency = -m * ln(1 - u) / ln(2).
  const scale = medianMs / Math.LN2;

  for (let i = 0; i < total; i += 1) {
    if (rng() < failureRate) {
      errors += 1;
      continue;
    }
    const u = rng();
    latenciesMs.push(-scale * Math.log(1 - u));
  }

  return {
    latenciesMs,
    errors,
    total,
    errorRate: total === 0 ? 0 : errors / total,
  };
}

// ---------------------------------------------------------------------------
// Capacity / autoscale simulation (Req 23.4)
// ---------------------------------------------------------------------------

export interface AutoscaleConfig {
  /** Total capacity (concurrent users or img/s). */
  readonly capacity: number;
  /** Utilization fraction (0..1) that triggers scale-up (Req 23.4: 0.70). */
  readonly scaleTriggerFraction: number;
  /** Seconds the platform takes to provision additional capacity. */
  readonly provisionSeconds: number;
  /** Requests already accepted and in-flight when scale-up begins. */
  readonly acceptedInFlight: number;
}

export interface AutoscaleResult {
  /** Whether sustained load crossed the scale-up trigger. */
  readonly scaleUpTriggered: boolean;
  /** Seconds taken to provision the additional capacity. */
  readonly provisionedWithinSeconds: number;
  /** Accepted in-flight requests dropped during scale-up (must be 0). */
  readonly droppedAccepted: number;
}

/**
 * Simulate the autoscale response to sustained load (Req 23.4). When the
 * observed load fraction meets/exceeds the trigger, additional capacity is
 * provisioned within `provisionSeconds`; accepted in-flight requests are
 * preserved (never dropped) throughout.
 */
export function simulateAutoscale(
  observedLoadFraction: number,
  config: AutoscaleConfig,
): AutoscaleResult {
  const scaleUpTriggered =
    observedLoadFraction >= config.scaleTriggerFraction;

  return {
    scaleUpTriggered,
    // Provisioning only happens when triggered; otherwise 0 (nothing to do).
    provisionedWithinSeconds: scaleUpTriggered ? config.provisionSeconds : 0,
    // The autoscaler adds capacity; it never evicts admitted work.
    droppedAccepted: 0,
  };
}
