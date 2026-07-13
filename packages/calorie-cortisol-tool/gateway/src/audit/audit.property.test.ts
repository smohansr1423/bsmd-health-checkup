import fc from 'fast-check';

import { composeChain } from '../middleware/chain';
import type {
  GatewayRequest,
  GatewayResponse,
  NextFn,
  RequestContext,
} from '../types';
import { createAuditMiddleware } from './middleware';
import { isWithinRetention, retentionExpiry } from './policy';
import { InMemoryAuditStore } from './store';
import { ANONYMOUS_ACTOR, AUDIT_RETENTION_YEARS, type Clock } from './types';

/**
 * Property-based test for the gateway audit-logging middleware (Task 16.3,
 * covering Task 16.2's implementation).
 *
 * Feature: calorie-cortisol-tool, Property 54
 * Property 54: Audit entry on every health-data access.
 *   For any read, create, modify, or delete of health data — including denied
 *   unauthenticated/unauthorized attempts — a complete audit entry (actor
 *   identity, action type, record identifier, timestamp) is recorded and
 *   retained (append-only, ≥6-year retention).
 *
 * Validates: Requirements 25.6, 25.7
 *
 * The global fast-check default is 10 runs; this suite pins numRuns >= 100
 * inline so the property is exercised across a broad input space.
 */

const NUM_RUNS = 100;

// A fixed clock so the recorded timestamp / retention window are deterministic.
const FIXED = new Date('2024-06-15T12:00:00.000Z');
const fixedClock: Clock = { now: () => FIXED };

/** The four CRUD action types mandated by Req 25.6. */
const VALID_ACTIONS: readonly string[] = ['read', 'create', 'modify', 'delete'];

/**
 * Operational, non-PHI endpoints excluded from auditing by the default
 * classifier. Kept in sync with the policy allowlist.
 */
const OPERATIONAL_PATHS: readonly string[] = [
  '/health',
  '/healthz',
  '/livez',
  '/readyz',
  '/metrics',
  '/favicon.ico',
];

const arbId = fc.string({ minLength: 1, maxLength: 16 });
const arbMethod = fc.constantFrom('GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS');

/** Health-data paths: multi-segment routes that never collide with the allowlist. */
const arbHealthPath: fc.Arbitrary<string> = fc
  .array(
    fc.constantFrom('meals', 'cortisol', 'profile', 'insights', 'recognize', 'labs', 'users', 'records', 'v1'),
    { minLength: 1, maxLength: 3 },
  )
  .map((segs) => `/${segs.join('/')}`)
  .filter((p) => !OPERATIONAL_PATHS.includes(p.toLowerCase()));

const arbBody = fc.option(
  fc.record({ id: fc.string({ minLength: 1, maxLength: 12 }) }),
  { nil: undefined },
);

/** An arbitrary REST / webhook health-data request. */
const arbRestRequest: fc.Arbitrary<GatewayRequest> = fc
  .record({
    id: arbId,
    kind: fc.constantFrom('rest' as const, 'webhook' as const),
    method: arbMethod,
    path: arbHealthPath,
    body: arbBody,
  })
  .map((r) => ({ ...r, headers: {} }));

/** An arbitrary GraphQL health-data request (query = read, mutation = write). */
const arbGraphqlRequest: fc.Arbitrary<GatewayRequest> = fc
  .record({
    id: arbId,
    operationType: fc.constantFrom('query' as const, 'mutation' as const),
    fieldName: fc.constantFrom(
      'cortisolTrend',
      'mealHistory',
      'logMeal',
      'createMeal',
      'updateConsent',
      'deleteMeal',
      'removeDevice',
    ),
    variables: fc.option(fc.record({ id: fc.string({ minLength: 1, maxLength: 12 }) }), { nil: undefined }),
  })
  .map((r) => ({
    id: r.id,
    kind: 'graphql' as const,
    method: 'POST',
    path: '/graphql',
    headers: {},
    graphql: { operationType: r.operationType, fieldName: r.fieldName, variables: r.variables },
  }));

const arbHealthRequest = fc.oneof(arbRestRequest, arbGraphqlRequest);

/** An arbitrary operational (non-health-data) request from the allowlist. */
const arbOperationalRequest: fc.Arbitrary<GatewayRequest> = fc
  .record({ id: arbId, method: arbMethod, path: fc.constantFrom(...OPERATIONAL_PATHS) })
  .map((r) => ({ id: r.id, kind: 'rest' as const, method: r.method, path: r.path, headers: {} }));

/** Sometimes authenticated (with a non-empty user id), sometimes anonymous. */
const arbAuth = fc.option(fc.record({ userId: fc.string({ minLength: 1, maxLength: 16 }) }), {
  nil: undefined,
});

type Behavior =
  | { readonly type: 'ok' }
  | { readonly type: 'status'; readonly status: number; readonly code: string }
  | { readonly type: 'throw'; readonly message: string };

/**
 * How the rest of the chain resolves: success, a denied/error status (incl. the
 * 401/403 unauthenticated/unauthorized attempts of Req 25.7), or a thrown error.
 */
const arbBehavior: fc.Arbitrary<Behavior> = fc.oneof(
  fc.constant<Behavior>({ type: 'ok' }),
  fc
    .record({
      status: fc.constantFrom(401, 403, 500, 502),
      code: fc.constantFrom('GATEWAY_UNAUTHENTICATED', 'GATEWAY_UNAUTHORIZED', 'INTERNAL', 'BAD_GATEWAY'),
    })
    .map((r): Behavior => ({ type: 'status', status: r.status, code: r.code })),
  fc.string({ minLength: 1, maxLength: 24 }).map((m): Behavior => ({ type: 'throw', message: m })),
);

function terminalFor(behavior: Behavior): NextFn {
  return async (): Promise<GatewayResponse> => {
    if (behavior.type === 'throw') throw new Error(behavior.message);
    if (behavior.type === 'ok') return { status: 200, ok: true, body: {} };
    return {
      status: behavior.status,
      ok: false,
      error: { code: behavior.code, message: 'denied/error', retryable: false, retainedState: true },
    };
  };
}

function contextFor(request: GatewayRequest, auth?: { userId: string }): RequestContext {
  return {
    request,
    auth: auth ? { principal: { userId: auth.userId, roles: [] }, token: 'tkn' } : null,
    route: null,
    startedAt: 0,
    attributes: {},
  };
}

describe('Property 54: Audit entry on every health-data access [Feature: calorie-cortisol-tool, Property 54]', () => {
  it('records exactly one complete, retained audit entry for every health-data access — including denied/error attempts (Req 25.6, 25.7)', async () => {
    await fc.assert(
      fc.asyncProperty(arbHealthRequest, arbAuth, arbBehavior, async (request, auth, behavior) => {
        const store = new InMemoryAuditStore();
        const audit = createAuditMiddleware({ store, clock: fixedClock });
        const chain = composeChain([audit], terminalFor(behavior));
        const ctx = contextFor(request, auth);

        // Exercise. A thrown chain must re-throw after the entry is recorded.
        if (behavior.type === 'throw') {
          await expect(chain(ctx)).rejects.toThrow(behavior.message);
        } else {
          await chain(ctx);
        }

        // --- Recorded: exactly one entry for a health-data access. ---
        expect(store.size).toBe(1);
        const [entry] = store.list();

        // --- Complete #1: actor identity present and correctly attributed. ---
        const expectedActor = auth ? auth.userId : ANONYMOUS_ACTOR;
        expect(entry.actorId).toBe(expectedActor);
        expect(entry.actorId.length).toBeGreaterThan(0);

        // --- Complete #2: action type is one of the four CRUD actions. ---
        expect(VALID_ACTIONS).toContain(entry.action);

        // --- Complete #3: record identifier present (never empty). ---
        expect(typeof entry.recordId).toBe('string');
        expect(entry.recordId.length).toBeGreaterThan(0);

        // --- Complete #4: timestamp present, a valid instant, equal to the clock. ---
        expect(entry.timestamp).toBe(FIXED.toISOString());
        expect(Number.isNaN(Date.parse(entry.timestamp))).toBe(false);

        // --- Retained: expiry is timestamp + 6 years and still within window now. ---
        expect(entry.expiresAt).toBe(retentionExpiry(FIXED));
        expect(new Date(entry.expiresAt).getUTCFullYear() - FIXED.getUTCFullYear()).toBe(
          AUDIT_RETENTION_YEARS,
        );
        expect(isWithinRetention(entry, FIXED)).toBe(true);

        // --- Req 25.7: 401/403 attempts are recorded as denied. ---
        if (behavior.type === 'status' && (behavior.status === 401 || behavior.status === 403)) {
          expect(entry.outcome).toBe('denied');
        }

        // --- Append-only: a retention-honouring purge at `now` keeps the entry. ---
        store.purgeExpired(FIXED);
        expect(store.size).toBe(1);
        expect(store.list()[0]).toBe(entry);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('records no audit entry for non-health-data operational endpoints (the classifier boundary of Property 54)', async () => {
    await fc.assert(
      fc.asyncProperty(arbOperationalRequest, arbAuth, arbBehavior, async (request, auth, behavior) => {
        const store = new InMemoryAuditStore();
        const audit = createAuditMiddleware({ store, clock: fixedClock });
        const chain = composeChain([audit], terminalFor(behavior));
        const ctx = contextFor(request, auth);

        if (behavior.type === 'throw') {
          await expect(chain(ctx)).rejects.toThrow(behavior.message);
        } else {
          await chain(ctx);
        }

        expect(store.size).toBe(0);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
