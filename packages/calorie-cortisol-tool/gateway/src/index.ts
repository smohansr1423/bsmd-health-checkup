/**
 * @calorie-cortisol/gateway
 *
 * API Gateway for the Calorie & Cortisol Tool. Exposes the composable
 * middleware chain and routing implemented in Task 16.1:
 *
 *   TLS termination → JWT auth → rate limiter → capacity shedding
 *     → consent/residency guard → request validation → route
 *
 * Sibling tasks compose their enforcing logic into the same pipeline as
 * separate modules: audit logging (16.2), TLS 1.3 / cert-pinning egress guard
 * (16.4), BAA / EU-residency guards (16.6), and the health-check subsystem
 * (16.9).
 */
export const PACKAGE_NAME = '@calorie-cortisol/gateway';

// Core types & extension-point interfaces.
export * from './types';

// Response / error envelope helpers.
export * from './responses';

// Middleware modules (chain composer, JWT, auth, rate limiter, capacity,
// guard seats, validation).
export * from './middleware';

// Routing (route table + table-backed service router).
export * from './router/routes';
export * from './router/service-router';

// Gateway assembly.
export * from './gateway';

// Health-check downtime state machine and availability accounting (Task 16.9).
export * from './availability';
