import { TokenBucketStore, rateLimitKey } from './rate-limiter';
import type { RequestContext } from '../types';

describe('TokenBucketStore', () => {
  it('allows requests up to capacity, then denies', () => {
    const store = new TokenBucketStore({ capacity: 3, refillPerSecond: 0, clock: () => 0 });
    expect(store.consume('k').allowed).toBe(true);
    expect(store.consume('k').allowed).toBe(true);
    const third = store.consume('k');
    expect(third.allowed).toBe(true);
    expect(third.remaining).toBe(0);
    expect(store.consume('k').allowed).toBe(false);
  });

  it('refills tokens over time based on the injected clock', () => {
    let now = 0;
    const store = new TokenBucketStore({
      capacity: 2,
      refillPerSecond: 1,
      clock: () => now,
    });
    expect(store.consume('k').allowed).toBe(true);
    expect(store.consume('k').allowed).toBe(true);
    expect(store.consume('k').allowed).toBe(false); // empty

    now = 1000; // +1s -> +1 token
    expect(store.consume('k').allowed).toBe(true);
    expect(store.consume('k').allowed).toBe(false);
  });

  it('never refills beyond capacity', () => {
    let now = 0;
    const store = new TokenBucketStore({
      capacity: 2,
      refillPerSecond: 10,
      clock: () => now,
    });
    store.consume('k'); // 1 left
    now = 10_000; // huge elapse, but capped at capacity
    const d = store.consume('k');
    expect(d.allowed).toBe(true);
    expect(d.remaining).toBe(1); // capped at 2, consumed 1
  });

  it('reports retryAfterSeconds when denied', () => {
    const store = new TokenBucketStore({ capacity: 1, refillPerSecond: 0.5, clock: () => 0 });
    store.consume('k'); // empties bucket
    const denied = store.consume('k');
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterSeconds).toBe(2); // 1 token / 0.5 per s
  });

  it('isolates buckets per key', () => {
    const store = new TokenBucketStore({ capacity: 1, refillPerSecond: 0, clock: () => 0 });
    expect(store.consume('a').allowed).toBe(true);
    expect(store.consume('b').allowed).toBe(true);
    expect(store.consume('a').allowed).toBe(false);
  });

  it('rejects invalid configuration', () => {
    expect(() => new TokenBucketStore({ capacity: 0, refillPerSecond: 1 })).toThrow();
    expect(() => new TokenBucketStore({ capacity: 1, refillPerSecond: -1 })).toThrow();
  });
});

describe('rateLimitKey', () => {
  const base = {
    request: { id: '1', kind: 'rest', method: 'GET', path: '/x', headers: {} },
    route: null,
    startedAt: 0,
    attributes: {},
  };

  it('prefers the authenticated user id', () => {
    const ctx = {
      ...base,
      auth: { principal: { userId: 'u9', roles: [] }, token: 't' },
    } as unknown as RequestContext;
    expect(rateLimitKey(ctx)).toBe('user:u9');
  });

  it('falls back to remote IP then path', () => {
    const ipCtx = {
      ...base,
      auth: null,
      request: { ...base.request, connection: { remoteIp: '1.2.3.4' } },
    } as unknown as RequestContext;
    expect(rateLimitKey(ipCtx)).toBe('ip:1.2.3.4');

    const anonCtx = { ...base, auth: null } as unknown as RequestContext;
    expect(rateLimitKey(anonCtx)).toBe('anon:/x');
  });
});
