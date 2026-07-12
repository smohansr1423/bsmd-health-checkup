import { TableServiceRouter, type ServiceHandlers } from './service-router';
import { matchPathPattern } from './routes';
import type {
  GatewayRequest,
  GatewayResponse,
  RequestContext,
  ServiceName,
} from '../types';

function handlersRecording(seen: ServiceName[]): ServiceHandlers {
  const make =
    (name: ServiceName) =>
    (ctx: RequestContext): GatewayResponse => {
      seen.push(name);
      return { status: 200, ok: true, body: { service: name, route: ctx.route } };
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

function ctxFor(request: GatewayRequest): RequestContext {
  return { request, auth: null, route: null, startedAt: 0, attributes: {} };
}

describe('matchPathPattern', () => {
  it('matches static and param segments', () => {
    expect(matchPathPattern('/barcode/:code', '/barcode/12345')).toEqual({ code: '12345' });
    expect(matchPathPattern('/recognize', '/recognize')).toEqual({});
    expect(matchPathPattern('/trend', '/trend?range=7')).toEqual({});
  });

  it('returns null on mismatch or arity difference', () => {
    expect(matchPathPattern('/recognize', '/portion')).toBeNull();
    expect(matchPathPattern('/barcode/:code', '/barcode')).toBeNull();
    expect(matchPathPattern('/kits/order', '/kits/order/extra')).toBeNull();
  });
});

describe('TableServiceRouter.resolve', () => {
  const router = new TableServiceRouter(handlersRecording([]));

  it('resolves GraphQL queries and mutations to the owning service', () => {
    expect(
      router.resolve({
        id: '1',
        kind: 'graphql',
        method: 'POST',
        path: '/graphql',
        headers: {},
        graphql: { operationType: 'query', fieldName: 'cortisolTrend' },
      })?.service,
    ).toBe('cortisol-data');

    expect(
      router.resolve({
        id: '2',
        kind: 'graphql',
        method: 'POST',
        path: '/graphql',
        headers: {},
        graphql: { operationType: 'mutation', fieldName: 'updateConsent' },
      })?.service,
    ).toBe('user-profile');
  });

  it('resolves REST paths (with method) to the owning service', () => {
    expect(
      router.resolve({ id: '3', kind: 'rest', method: 'POST', path: '/recognize', headers: {} })
        ?.service,
    ).toBe('food-vision');
    expect(
      router.resolve({ id: '4', kind: 'rest', method: 'GET', path: '/barcode/999', headers: {} })
        ?.service,
    ).toBe('nutrition-lookup');
  });

  it('tags webhook routes with kind webhook', () => {
    const res = router.resolve({
      id: '5',
      kind: 'webhook',
      method: 'POST',
      path: '/webhooks/lab-results',
      headers: {},
    });
    expect(res?.service).toBe('cortisol-data');
    expect(res?.kind).toBe('webhook');
  });

  it('returns null for unknown routes and wrong methods', () => {
    expect(
      router.resolve({ id: '6', kind: 'rest', method: 'DELETE', path: '/recognize', headers: {} }),
    ).toBeNull();
    expect(
      router.resolve({ id: '7', kind: 'rest', method: 'GET', path: '/nope', headers: {} }),
    ).toBeNull();
    expect(
      router.resolve({
        id: '8',
        kind: 'graphql',
        method: 'POST',
        path: '/graphql',
        headers: {},
        graphql: { operationType: 'query', fieldName: 'unknownField' },
      }),
    ).toBeNull();
  });
});

describe('TableServiceRouter.route', () => {
  it('dispatches to the resolved handler and attaches the resolution', async () => {
    const seen: ServiceName[] = [];
    const router = new TableServiceRouter(handlersRecording(seen));
    const ctx = ctxFor({
      id: '9',
      kind: 'rest',
      method: 'POST',
      path: '/questionnaire',
      headers: {},
    });
    const res = await router.route(ctx);
    expect(res.ok).toBe(true);
    expect(seen).toEqual(['cortisol-data']);
    expect(ctx.route?.service).toBe('cortisol-data');
  });

  it('returns a NO_ROUTE error for unresolved requests', async () => {
    const router = new TableServiceRouter(handlersRecording([]));
    const res = await router.route(
      ctxFor({ id: '10', kind: 'rest', method: 'GET', path: '/nope', headers: {} }),
    );
    expect(res.ok).toBe(false);
    expect(res.status).toBe(404);
    expect(res.error?.code).toBe('GATEWAY_NO_ROUTE');
  });
});
