import { composeChain } from '../middleware/chain';
import type {
  GatewayRequest,
  GatewayResponse,
  Middleware,
  NextFn,
  RequestContext,
} from '../types';
import { AUDIT_MIDDLEWARE_NAME, createAuditMiddleware } from './middleware';
import { InMemoryAuditStore } from './store';
import { ANONYMOUS_ACTOR, type Clock } from './types';

const FIXED = new Date('2024-06-15T12:00:00.000Z');
const fixedClock: Clock = { now: () => FIXED };

function requestFor(overrides: Partial<GatewayRequest> = {}): GatewayRequest {
  return {
    id: 'req-1',
    kind: 'rest',
    method: 'GET',
    path: '/meals',
    headers: {},
    ...overrides,
  };
}

function contextFor(request: GatewayRequest, userId?: string): RequestContext {
  return {
    request,
    auth: userId ? { principal: { userId, roles: [] }, token: 'tkn' } : null,
    route: null,
    startedAt: 0,
    attributes: {},
  };
}

function okNext(body: unknown = {}): NextFn {
  return async () => ({ status: 200, ok: true, body });
}

describe('createAuditMiddleware', () => {
  it('conforms to the Middleware shape with a stable name', () => {
    const mw: Middleware = createAuditMiddleware({ store: new InMemoryAuditStore() });
    expect(mw.name).toBe(AUDIT_MIDDLEWARE_NAME);
    expect(typeof mw.handle).toBe('function');
  });

  it('records an allowed entry for a successful health-data access', async () => {
    const store = new InMemoryAuditStore();
    const mw = createAuditMiddleware({ store, clock: fixedClock });
    const ctx = contextFor(
      requestFor({ method: 'POST', path: '/meals', body: { id: 'meal-1' } }),
      'user-1',
    );

    const response = await mw.handle(ctx, okNext());

    expect(response.ok).toBe(true);
    expect(store.size).toBe(1);
    expect(store.list()[0]).toMatchObject({
      actorId: 'user-1',
      action: 'create',
      recordId: 'meal-1',
      outcome: 'allowed',
      timestamp: FIXED.toISOString(),
    });
  });

  it('records a denied entry for an unauthenticated attempt (401)', async () => {
    const store = new InMemoryAuditStore();
    const mw = createAuditMiddleware({ store, clock: fixedClock });
    const ctx = contextFor(requestFor());
    const deny: NextFn = async () => ({
      status: 401,
      ok: false,
      error: { code: 'GATEWAY_UNAUTHENTICATED', message: 'no token', retryable: false, retainedState: true },
    });

    await mw.handle(ctx, deny);

    expect(store.size).toBe(1);
    expect(store.list()[0]).toMatchObject({
      actorId: ANONYMOUS_ACTOR,
      action: 'read',
      outcome: 'denied',
      reason: 'GATEWAY_UNAUTHENTICATED',
    });
  });

  it('records a denied entry for an unauthorized attempt (403)', async () => {
    const store = new InMemoryAuditStore();
    const mw = createAuditMiddleware({ store, clock: fixedClock });
    const ctx = contextFor(requestFor({ method: 'DELETE', path: '/meals', body: { id: 'meal-9' } }), 'user-2');
    const deny: NextFn = async () => ({
      status: 403,
      ok: false,
      error: { code: 'GATEWAY_UNAUTHORIZED', message: 'forbidden', retryable: false, retainedState: true },
    });

    await mw.handle(ctx, deny);

    expect(store.list()[0]).toMatchObject({
      actorId: 'user-2',
      action: 'delete',
      recordId: 'meal-9',
      outcome: 'denied',
      reason: 'GATEWAY_UNAUTHORIZED',
    });
  });

  it('records an error entry and re-throws when the chain throws', async () => {
    const store = new InMemoryAuditStore();
    const mw = createAuditMiddleware({ store, clock: fixedClock });
    const ctx = contextFor(requestFor(), 'user-3');
    const boom: NextFn = async () => {
      throw new Error('downstream exploded');
    };

    await expect(mw.handle(ctx, boom)).rejects.toThrow('downstream exploded');
    expect(store.list()[0]).toMatchObject({
      outcome: 'error',
      reason: 'downstream exploded',
    });
  });

  it('does not audit excluded operational endpoints', async () => {
    const store = new InMemoryAuditStore();
    const mw = createAuditMiddleware({ store, clock: fixedClock });
    const ctx = contextFor(requestFor({ path: '/healthz' }));

    await mw.handle(ctx, okNext());

    expect(store.size).toBe(0);
  });

  it('honours an injected health-data classifier', async () => {
    const store = new InMemoryAuditStore();
    const mw = createAuditMiddleware({
      store,
      clock: fixedClock,
      classifyHealthData: () => false,
    });

    await mw.handle(contextFor(requestFor()), okNext());

    expect(store.size).toBe(0);
  });

  it('captures denied attempts short-circuited before routing when composed ahead of auth', async () => {
    const store = new InMemoryAuditStore();
    const audit = createAuditMiddleware({ store, clock: fixedClock });

    // A stand-in auth stage that denies unauthenticated requests and never
    // calls next() — mirroring the real chain short-circuit.
    const authStage: Middleware = {
      name: 'auth',
      handle: async (): Promise<GatewayResponse> => ({
        status: 401,
        ok: false,
        error: { code: 'GATEWAY_UNAUTHENTICATED', message: 'no token', retryable: false, retainedState: true },
      }),
    };

    // Terminal router should never be reached for a denied request.
    const router: NextFn = async () => ({ status: 200, ok: true, body: 'routed' });
    const chain = composeChain([audit, authStage], router);

    const response = await chain(contextFor(requestFor()));

    expect(response.status).toBe(401);
    expect(store.size).toBe(1);
    expect(store.list()[0]).toMatchObject({ outcome: 'denied', actorId: ANONYMOUS_ACTOR });
  });
});
