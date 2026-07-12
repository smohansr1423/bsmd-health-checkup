import { buildGateway, buildStages, type GatewayDependencies } from './gateway';
import { HmacJwtVerifier, mintHs256 } from './middleware/jwt';
import { TokenBucketStore } from './middleware/rate-limiter';
import { ConcurrencyCapacityController } from './middleware/capacity';
import type { ServiceHandlers } from './router/service-router';
import type {
  ConsentResidencyGuard,
  GatewayResponse,
  Middleware,
  ServiceName,
  TlsTerminator,
} from './types';

const SECRET = 'gw-secret';

function echoHandlers(seen: ServiceName[]): ServiceHandlers {
  const make =
    (name: ServiceName) =>
    (): GatewayResponse => {
      seen.push(name);
      return { status: 200, ok: true, body: { routedTo: name } };
    };
  return {
    'food-vision': make('food-vision'),
    'nutrition-lookup': make('nutrition-lookup'),
    'cortisol-data': make('cortisol-data'),
    'insights-ml': make('insights-ml'),
    'user-profile': make('user-profile'),
    notification: make('notification'),
  };
}

function baseDeps(overrides: Partial<GatewayDependencies> = {}): GatewayDependencies {
  return {
    authVerifier: new HmacJwtVerifier({ secret: SECRET, clock: () => 0 }),
    rateLimitStore: new TokenBucketStore({ capacity: 100, refillPerSecond: 0, clock: () => 0 }),
    capacityController: new ConcurrencyCapacityController({ maxConcurrent: 100 }),
    serviceHandlers: echoHandlers([]),
    ...overrides,
  };
}

function authHeader(): Record<string, string> {
  return { Authorization: `Bearer ${mintHs256({ sub: 'u1', roles: ['member'] }, SECRET)}` };
}

describe('buildStages ordering', () => {
  it('assembles the canonical chain order', () => {
    const stages = buildStages(baseDeps());
    expect(stages.map((s) => s.name)).toEqual([
      'tls-termination',
      'auth',
      'rate-limiter',
      'capacity',
      'consent-residency',
      'request-validation',
    ]);
  });

  it('prepends outer middleware (audit seat) outermost', () => {
    const audit: Middleware = { name: 'audit', handle: (c, next) => next(c) };
    const gw = buildGateway(baseDeps({ outerMiddleware: [audit] }));
    expect(gw.stageNames[0]).toBe('audit');
  });
});

describe('gateway end-to-end', () => {
  it('routes an authenticated GraphQL query to the owning service', async () => {
    const seen: ServiceName[] = [];
    const gw = buildGateway(baseDeps({ serviceHandlers: echoHandlers(seen) }));
    const res = await gw.handle({
      id: '1',
      kind: 'graphql',
      method: 'POST',
      path: '/graphql',
      headers: authHeader(),
      graphql: { operationType: 'query', fieldName: 'insights' },
    });
    expect(res.ok).toBe(true);
    expect(seen).toEqual(['insights-ml']);
  });

  it('routes an authenticated REST call to the owning service', async () => {
    const seen: ServiceName[] = [];
    const gw = buildGateway(baseDeps({ serviceHandlers: echoHandlers(seen) }));
    const res = await gw.handle({
      id: '2',
      kind: 'rest',
      method: 'POST',
      path: '/recognize',
      headers: authHeader(),
    });
    expect(res.ok).toBe(true);
    expect(seen).toEqual(['food-vision']);
  });

  it('routes an unauthenticated webhook to the owning service', async () => {
    const seen: ServiceName[] = [];
    const gw = buildGateway(baseDeps({ serviceHandlers: echoHandlers(seen) }));
    const res = await gw.handle({
      id: '3',
      kind: 'webhook',
      method: 'POST',
      path: '/webhooks/lab-results',
      headers: {},
    });
    expect(res.ok).toBe(true);
    expect(seen).toEqual(['cortisol-data']);
  });

  it('rejects an unauthenticated client request before routing', async () => {
    const seen: ServiceName[] = [];
    const gw = buildGateway(baseDeps({ serviceHandlers: echoHandlers(seen) }));
    const res = await gw.handle({
      id: '4',
      kind: 'rest',
      method: 'GET',
      path: '/trend',
      headers: {},
    });
    expect(res.status).toBe(401);
    expect(seen).toEqual([]);
  });

  it('sheds with a rate-limit 429 when the bucket is exhausted', async () => {
    const seen: ServiceName[] = [];
    const gw = buildGateway(
      baseDeps({
        serviceHandlers: echoHandlers(seen),
        rateLimitStore: new TokenBucketStore({ capacity: 1, refillPerSecond: 0, clock: () => 0 }),
      }),
    );
    const call = () =>
      gw.handle({
        id: 'r',
        kind: 'rest',
        method: 'POST',
        path: '/recognize',
        headers: authHeader(),
      });
    expect((await call()).ok).toBe(true);
    const limited = await call();
    expect(limited.status).toBe(429);
    expect(limited.error?.code).toBe('GATEWAY_RATE_LIMITED');
    expect(seen).toEqual(['food-vision']); // second call never reached the service
  });

  it('sheds with a capacity 503 beyond the concurrency ceiling (Req 23.3)', async () => {
    // A handler that blocks until we release it, so we can hold a slot in-flight.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const seen: ServiceName[] = [];
    const handlers = echoHandlers(seen);
    const blocking: ServiceHandlers = {
      ...handlers,
      'food-vision': async () => {
        await gate;
        return { status: 200, ok: true, body: 'slow' };
      },
    };
    const gw = buildGateway(
      baseDeps({
        serviceHandlers: blocking,
        capacityController: new ConcurrencyCapacityController({ maxConcurrent: 1 }),
      }),
    );
    const inFlight = gw.handle({
      id: 'a',
      kind: 'rest',
      method: 'POST',
      path: '/recognize',
      headers: authHeader(),
    });
    const shed = await gw.handle({
      id: 'b',
      kind: 'rest',
      method: 'POST',
      path: '/recognize',
      headers: authHeader(),
    });
    expect(shed.status).toBe(503);
    expect(shed.error?.code).toBe('GATEWAY_CAPACITY_EXCEEDED');
    // The already-admitted request completes normally once released.
    release();
    expect((await inFlight).ok).toBe(true);
  });

  it('returns 404 NO_ROUTE for an authenticated but unmapped path', async () => {
    const gw = buildGateway(baseDeps());
    const res = await gw.handle({
      id: '5',
      kind: 'rest',
      method: 'GET',
      path: '/does-not-exist',
      headers: authHeader(),
    });
    expect(res.status).toBe(404);
    expect(res.error?.code).toBe('GATEWAY_NO_ROUTE');
  });

  it('applies an injected TLS terminator that rejects the connection', async () => {
    const rejectingTls: TlsTerminator = {
      terminate: () => ({ accepted: false }),
    };
    const gw = buildGateway(baseDeps({ tlsTerminator: rejectingTls }));
    const res = await gw.handle({
      id: '6',
      kind: 'rest',
      method: 'POST',
      path: '/recognize',
      headers: authHeader(),
    });
    expect(res.status).toBe(403);
    expect(res.error?.code).toBe('GATEWAY_TLS_REQUIRED');
  });

  it('applies an injected consent/residency guard that blocks the request', async () => {
    const blockingGuard: ConsentResidencyGuard = {
      evaluate: () => ({ allowed: false }),
    };
    const gw = buildGateway(baseDeps({ consentResidencyGuard: blockingGuard }));
    const res = await gw.handle({
      id: '7',
      kind: 'rest',
      method: 'POST',
      path: '/recognize',
      headers: authHeader(),
    });
    expect(res.status).toBe(403);
    expect(res.error?.code).toBe('GATEWAY_CONSENT_REQUIRED');
  });

  it('rejects a malformed GraphQL request at the validation stage', async () => {
    const gw = buildGateway(baseDeps());
    const res = await gw.handle({
      id: '8',
      kind: 'graphql',
      method: 'POST',
      path: '/graphql',
      headers: authHeader(),
      // no graphql operation provided
    });
    expect(res.status).toBe(400);
    expect(res.error?.code).toBe('GATEWAY_INVALID_REQUEST');
  });
});
