/**
 * Shared constants and identifiers for the health-check monitoring subsystem
 * (Task 16.9, Req 24.3, 24.4, 24.5).
 *
 * The availability accounting distinguishes two service classes, each with its
 * own monthly uptime SLO and the corresponding monthly downtime budget derived
 * from a 30-day calendar month in the design:
 *
 *   - general services      → 99.9%  uptime ≈ 43 minutes/month downtime budget
 *   - lab result ingestion  → 99.95% uptime ≈ 21 minutes/month downtime budget
 *
 * The alert indicator shape mirrors the compliance-indicator style already used
 * by the gateway's compliance guards (task 16.6) and the transport guard's
 * recorded attempts (task 16.4) so operator-facing records share a consistent
 * shape across the gateway.
 *
 * Requirements: 24.3, 24.4, 24.5
 */

// ---------------------------------------------------------------------------
// Service classes and downtime budgets (Req 24.5)
// ---------------------------------------------------------------------------

/**
 * The monitored service classes. Each carries a distinct monthly uptime SLO and
 * therefore a distinct monthly downtime budget (Req 24.5).
 */
export const ServiceClass = {
  /** General services: 99.9% monthly uptime SLO (Req 24.1). */
  GENERAL: 'general',
  /** Lab result ingestion: 99.95% monthly uptime SLO (Req 24.2). */
  LAB_INGESTION: 'lab_ingestion',
} as const;

export type ServiceClass = (typeof ServiceClass)[keyof typeof ServiceClass];

/**
 * Monthly downtime budgets in minutes, keyed by service class (Req 24.5).
 * Exceeding the budget for a class within a calendar month raises an
 * availability-breach alert.
 */
export const MONTHLY_DOWNTIME_BUDGET_MINUTES: Readonly<
  Record<ServiceClass, number>
> = {
  [ServiceClass.GENERAL]: 43,
  [ServiceClass.LAB_INGESTION]: 21,
} as const;

// ---------------------------------------------------------------------------
// Health-check state machine parameters (Req 24.3, 24.4)
// ---------------------------------------------------------------------------

/**
 * The number of consecutive same-result health checks that flips the recorded
 * availability state: 3 consecutive failures → unavailable (Req 24.3); 3
 * consecutive successes → available again (Req 24.4).
 */
export const CONSECUTIVE_THRESHOLD = 3;

/**
 * The nominal spacing between health checks, in seconds (Req 24.3, 24.4). The
 * state machine itself is interval-agnostic — results are fed as data with
 * their own timestamps — but this documents the monitoring cadence and is used
 * by callers that schedule checks.
 */
export const HEALTH_CHECK_INTERVAL_SECONDS = 60;

// ---------------------------------------------------------------------------
// Alert identifiers (Req 24.5)
// ---------------------------------------------------------------------------

/**
 * Stable, machine-readable identifier stamped on every availability-breach
 * alert this subsystem raises (Req 24.5).
 */
export const AVAILABILITY_BREACH_ALERT = 'availability_budget_breach' as const;
