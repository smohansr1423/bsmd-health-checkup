/**
 * Audit-logging ports and record shape (Task 16.2).
 *
 * The audit middleware records a complete audit entry on every read / create /
 * modify / delete of health data — **including** denied unauthenticated or
 * unauthorized attempts — and each entry is retained for at least 6 years
 * (Req 25.6, 25.7).
 *
 * All collaborators are injected as small ports so the entry-construction and
 * retention logic stay pure and unit-testable:
 *   - {@link Clock}       — the time source (system clock in production, a
 *                           fixed clock in tests).
 *   - {@link AuditStore}  — the append-only durable sink.
 *   - {@link AuditClassifier} / {@link RecordIdResolver} — optional overrides
 *     that let the routing layer refine health-data detection / record-id
 *     extraction without changing the middleware.
 *
 * Requirements: 25.6, 25.7
 */

import type { AuditEntry } from '@calorie-cortisol/shared';
import type { GatewayRequest } from '../types';

/** Actor identity recorded when a request carries no authenticated principal. */
export const ANONYMOUS_ACTOR = 'anonymous';

/** Minimum retention window for every audit entry (Req 25.6). */
export const AUDIT_RETENTION_YEARS = 6;

/** How a health-data access attempt resolved. */
export type AuditOutcome = 'allowed' | 'denied' | 'error';

/**
 * A durable audit record. It **is** the shared {@link AuditEntry} (the four
 * fields mandated by Req 25.6: actor, action, record id, timestamp) extended
 * with the metadata needed to satisfy Req 25.7 (recording denied attempts) and
 * to enforce the 6-year retention floor.
 */
export interface AuditRecord extends AuditEntry {
  /** Correlates the entry with the originating gateway request. */
  readonly requestId: string;
  /** Whether the access was allowed, denied, or failed. */
  readonly outcome: AuditOutcome;
  /** Optional human/machine-readable reason (e.g. the denial error code). */
  readonly reason?: string;
  /**
   * Earliest instant at which the entry may be purged: `timestamp` + 6 years.
   * The store must never delete an entry before this instant (Req 25.6).
   */
  readonly expiresAt: string;
}

/** Injectable time source. */
export interface Clock {
  now(): Date;
}

/**
 * Append-only durable audit sink (design: "Append-only audit log, 6-year
 * retention"). Implementations MUST NOT mutate or drop previously appended
 * records except through a retention-aware purge that honours
 * {@link AuditRecord.expiresAt}.
 */
export interface AuditStore {
  append(record: AuditRecord): void | Promise<void>;
}

/**
 * Predicate deciding whether a request touches health data and therefore must
 * be audited. Injected so the routing layer can refine detection; a
 * compliance-safe default is provided by the module.
 */
export type AuditClassifier = (request: GatewayRequest) => boolean;

/** Extracts the affected data-record identifier from a request (Req 25.6). */
export type RecordIdResolver = (request: GatewayRequest) => string;

/** Configuration for {@link createAuditMiddleware}. */
export interface AuditMiddlewareConfig {
  /** The durable append-only sink. Required. */
  readonly store: AuditStore;
  /** Time source; defaults to the system clock. */
  readonly clock?: Clock;
  /** Health-data predicate; defaults to the module classifier. */
  readonly classifyHealthData?: AuditClassifier;
  /** Record-id extractor; defaults to the module resolver. */
  readonly resolveRecordId?: RecordIdResolver;
}
