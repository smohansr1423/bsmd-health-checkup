/**
 * Barrel for the gateway middleware modules (Task 16.1).
 *
 * Each stage is a standalone, individually testable module. Sibling tasks
 * (16.2 audit, 16.4 TLS guard, 16.6 consent/residency guard) implement their
 * logic in their own modules and plug into the interfaces re-exported here.
 */
export * from './chain';
export * from './jwt';
export * from './auth';
export * from './rate-limiter';
export * from './capacity';
export * from './guards';
export * from './validation';
