/**
 * @calorie-cortisol/shared
 *
 * Shared, language-neutral domain types and API contracts for the Calorie &
 * Cortisol Tool. TypeScript is the source of truth; the Python (`cc_contracts`)
 * and Go (`contracts`) mirrors under `shared/python` and `shared/go` track
 * these definitions.
 *
 * Implemented in task 1.2 ("Define shared domain types and API contracts").
 * The structured error/degraded-outcome result contract is task 1.3.
 */
export const PACKAGE_NAME = '@calorie-cortisol/shared';

// Structured error / degraded-outcome result contract (Task 1.3). Also
// importable via the `@calorie-cortisol/shared/result` subpath.
export * from './result';

// Field-level constraints (single source of truth).
export * from './constants';

// Core domain types (food, cortisol, insights, account/compliance).
export * from './domain';

// Lightweight validation / guard helpers.
export * from './guards';

// GraphQL schema (SDL) for the client-facing API.
export * from './graphql/schema';

// REST webhook contracts (lab-results, FHIR).
export * from './contracts/webhooks';

// Cross-cutting AES-256 per-user encryption + separated key store (Task 3.1).
export * from './crypto';

// Structured error / degraded-outcome result contract (Task 1.3). Also
// importable directly via the `@calorie-cortisol/shared/result` subpath.
export * from './result';
