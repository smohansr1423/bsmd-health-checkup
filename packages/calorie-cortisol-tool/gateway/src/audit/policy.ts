/**
 * Pure audit-entry construction and retention policy (Task 16.2).
 *
 * Everything in this module is a pure function of its inputs (the only impurity
 * — reading the wall clock — is injected as a {@link Clock}), so the mapping
 * from request/response to a complete {@link AuditRecord} and the 6-year
 * retention arithmetic can be exhaustively unit-tested.
 *
 * Requirements: 25.6, 25.7
 */

import type { AuditAction } from '@calorie-cortisol/shared';
import type { GatewayRequest, GatewayResponse, RequestContext } from '../types';
import {
  ANONYMOUS_ACTOR,
  AUDIT_RETENTION_YEARS,
  type AuditOutcome,
  type AuditRecord,
  type Clock,
  type RecordIdResolver,
} from './types';

/** The default, real-time clock. */
export const systemClock: Clock = { now: () => new Date() };

/** Safely read a string-valued property from an unknown record. */
function readString(source: unknown, key: string): string | undefined {
  if (typeof source !== 'object' || source === null) return undefined;
  const value = (source as Record<string, unknown>)[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * Map a request to the CRUD {@link AuditAction} it represents (Req 25.6).
 *
 * GraphQL queries are reads; GraphQL mutations are classified by their field
 * verb. REST/webhook requests are classified by HTTP method.
 */
export function resolveAuditAction(request: GatewayRequest): AuditAction {
  if (request.graphql) {
    if (request.graphql.operationType === 'query') return 'read';
    return classifyMutationVerb(request.graphql.fieldName);
  }
  return classifyHttpMethod(request.method);
}

/** Classify a GraphQL mutation field name by its leading verb. */
function classifyMutationVerb(fieldName: string): AuditAction {
  const name = fieldName.toLowerCase();
  if (/^(create|add|log|register|submit|record|start)/.test(name)) return 'create';
  if (/^(delete|remove|revoke|purge|erase|clear)/.test(name)) return 'delete';
  return 'modify';
}

/** Classify an HTTP method into a CRUD action. */
function classifyHttpMethod(method: string): AuditAction {
  switch (method.toUpperCase()) {
    case 'POST':
      return 'create';
    case 'PUT':
    case 'PATCH':
      return 'modify';
    case 'DELETE':
      return 'delete';
    // GET, HEAD, OPTIONS and anything else are treated as reads.
    default:
      return 'read';
  }
}

/**
 * Resolve the actor identity (Req 25.6). Authenticated requests use the
 * principal's user id; unauthenticated attempts (Req 25.7) fall back to the
 * anonymous sentinel so the denied attempt is still attributable.
 */
export function resolveActorId(ctx: RequestContext): string {
  return ctx.auth?.principal.userId ?? ANONYMOUS_ACTOR;
}

/**
 * Resolve the affected data-record identifier (Req 25.6). Prefers an explicit
 * id carried by the request (GraphQL variables or REST body), then a resolved
 * route operation, then the request path as a last resort so the field is
 * never empty.
 */
export function resolveRecordId(request: GatewayRequest): string {
  const fromGraphql =
    request.graphql &&
    (readString(request.graphql.variables, 'id') ??
      readString(request.graphql.variables, 'recordId'));
  if (fromGraphql) return fromGraphql;

  const fromBody = readString(request.body, 'id') ?? readString(request.body, 'recordId');
  if (fromBody) return fromBody;

  if (request.graphql) return request.graphql.fieldName;
  return request.path;
}

/**
 * Operational paths that never carry protected health data and are therefore
 * excluded from auditing by the default classifier.
 */
const NON_HEALTH_DATA_PATHS: readonly string[] = [
  '/health',
  '/healthz',
  '/livez',
  '/readyz',
  '/metrics',
  '/favicon.ico',
];

/**
 * Compliance-safe default health-data classifier: everything is treated as a
 * health-data access (and thus audited) except a small allowlist of
 * operational, non-PHI endpoints. Auditing more than strictly necessary is
 * safe; missing a health-data access is not (Req 25.6).
 */
export function defaultHealthDataClassifier(request: GatewayRequest): boolean {
  const path = request.path.toLowerCase();
  return !NON_HEALTH_DATA_PATHS.includes(path);
}

/**
 * Derive the audit outcome from the response. Authentication (401) and
 * authorization (403) failures are recorded as denied attempts (Req 25.7);
 * successful responses are allowed; everything else is an error.
 */
export function deriveOutcome(response: GatewayResponse): AuditOutcome {
  if (response.status === 401 || response.status === 403) return 'denied';
  if (response.ok) return 'allowed';
  return 'error';
}

/**
 * Compute the retention-expiry instant for an entry created at `from`:
 * `from` + {@link AUDIT_RETENTION_YEARS} years, as an ISO-8601 string
 * (Req 25.6, "retain each entry for at least 6 years").
 */
export function retentionExpiry(from: Date): string {
  const expires = new Date(from.getTime());
  expires.setUTCFullYear(expires.getUTCFullYear() + AUDIT_RETENTION_YEARS);
  return expires.toISOString();
}

/**
 * Whether an entry is still within its mandatory retention window at `now`
 * (i.e. must NOT be purged yet). True until `expiresAt` is reached.
 */
export function isWithinRetention(record: AuditRecord, now: Date): boolean {
  return now.getTime() < Date.parse(record.expiresAt);
}

/**
 * Whether an entry's retention obligation has fully elapsed at `now` and it is
 * therefore eligible for purge. This is the strict complement of
 * {@link isWithinRetention}.
 */
export function isRetentionExpired(record: AuditRecord, now: Date): boolean {
  return !isWithinRetention(record, now);
}

/**
 * Build a complete, retention-stamped {@link AuditRecord} from the request
 * context and its resolved outcome. Pure: the timestamp is derived solely from
 * the injected `now`.
 */
export function buildAuditRecord(params: {
  readonly ctx: RequestContext;
  readonly outcome: AuditOutcome;
  readonly now: Date;
  readonly reason?: string;
  readonly resolveRecordId?: RecordIdResolver;
}): AuditRecord {
  const { ctx, outcome, now, reason } = params;
  const resolveId = params.resolveRecordId ?? resolveRecordId;

  return {
    actorId: resolveActorId(ctx),
    action: resolveAuditAction(ctx.request),
    recordId: resolveId(ctx.request),
    timestamp: now.toISOString(),
    requestId: ctx.request.id,
    outcome,
    expiresAt: retentionExpiry(now),
    ...(reason !== undefined ? { reason } : {}),
  };
}
