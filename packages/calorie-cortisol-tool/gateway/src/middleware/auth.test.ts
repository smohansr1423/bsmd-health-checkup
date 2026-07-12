import { authMiddleware, extractBearerToken } from './auth';
import type {
  AuthVerifier,
  GatewayRequest,
  GatewayResponse,
  RequestContext,
  WebhookAuthenticator,
} from '../types';

const passTerminal = (): Promise<GatewayResponse> =>
  Promise.resolve({ status: 200, ok: true, body: 'routed' });

function ctxFor(request: GatewayRequest): RequestContext {
  return { request, auth: null, route: null, startedAt: 0, attributes: {} };
}

const acceptingVerifier: AuthVerifier = {
  verify: () => ({ valid: true, principal: { userId: 'u1', roles: ['member'] } }),
};

describe('extractBearerToken', () => {
  it('extracts a bearer token case-insensitively', () => {
    expect(extractBearerToken({ Authorization: 'Bearer abc.def.ghi' })).toBe('abc.def.ghi');
    expect(extractBearerToken({ authorization: 'bearer xyz' })).toBe('xyz');
  });

  it('returns null when absent or malformed', () => {
    expect(extractBearerToken({})).toBeNull();
    expect(extractBearerToken({ Authorization: 'Basic zzz' })).toBeNull();
  });
});

describe('authMiddleware', () => {
  it('attaches an auth context when the token verifies', async () => {
    const mw = authMiddleware({ verifier: acceptingVerifier });
    const ctx = ctxFor({
      id: '1',
      kind: 'rest',
      method: 'GET',
      path: '/trend',
      headers: { Authorization: 'Bearer good' },
    });
    const res = await mw.handle(ctx, passTerminal);
    expect(res.body).toBe('routed');
    expect(ctx.auth?.principal.userId).toBe('u1');
  });

  it('rejects a request with no bearer token (401)', async () => {
    const mw = authMiddleware({ verifier: acceptingVerifier });
    const res = await mw.handle(
      ctxFor({ id: '2', kind: 'rest', method: 'GET', path: '/trend', headers: {} }),
      passTerminal,
    );
    expect(res.status).toBe(401);
    expect(res.error?.code).toBe('GATEWAY_UNAUTHENTICATED');
  });

  it('rejects an invalid token (401)', async () => {
    const rejecting: AuthVerifier = { verify: () => ({ valid: false, reason: 'bad' }) };
    const mw = authMiddleware({ verifier: rejecting });
    const res = await mw.handle(
      ctxFor({
        id: '3',
        kind: 'rest',
        method: 'GET',
        path: '/trend',
        headers: { Authorization: 'Bearer bad' },
      }),
      passTerminal,
    );
    expect(res.status).toBe(401);
  });

  it('passes webhooks through without JWT when no webhook authenticator is set', async () => {
    const mw = authMiddleware({ verifier: acceptingVerifier });
    const ctx = ctxFor({
      id: '4',
      kind: 'webhook',
      method: 'POST',
      path: '/webhooks/lab-results',
      headers: {},
    });
    const res = await mw.handle(ctx, passTerminal);
    expect(res.body).toBe('routed');
    expect(ctx.auth).toBeNull();
  });

  it('defers to an injected webhook authenticator when present', async () => {
    const denying: WebhookAuthenticator = {
      authenticate: () => ({ valid: false, reason: 'bad signature' }),
    };
    const mw = authMiddleware({ verifier: acceptingVerifier, webhookAuthenticator: denying });
    const res = await mw.handle(
      ctxFor({
        id: '5',
        kind: 'webhook',
        method: 'POST',
        path: '/webhooks/fhir',
        headers: {},
      }),
      passTerminal,
    );
    expect(res.status).toBe(401);
  });
});
