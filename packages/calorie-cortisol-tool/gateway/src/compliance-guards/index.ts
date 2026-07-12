/**
 * Gateway compliance guards (Task 16.6).
 *
 *  - PHI-exchange BAA gate: block PHI exchange with a PHI-handling partner that
 *    lacks an executed Business Associate Agreement, recording a compliance
 *    indicator (Req 30.3).
 *  - EU data-residency invariant: block further processing when an EU resident's
 *    data is found outside an EU region, recording a residency-violation
 *    indicator (Req 30.6, 30.7).
 *
 * Both mirror the compliance-indicator style of the Cortisol Data service's
 * CLIA lab-partner gate (task 9.22) for cross-service consistency.
 */
export * from './errors';
export * from './baa-gate';
export * from './residency-invariant';
