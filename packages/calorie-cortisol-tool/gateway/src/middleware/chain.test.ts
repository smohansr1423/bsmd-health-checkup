import { composeChain, chainStageNames } from './chain';
import type { GatewayResponse, Middleware, RequestContext } from '../types';

function ctx(): RequestContext {
  return {
    request: { id: '1', kind: 'rest', method: 'GET', path: '/x', headers: {} },
    auth: null,
    route: null,
    startedAt: 0,
    attributes: {},
  };
}

function recorder(name: string, log: string[]): Middleware {
  return {
    name,
    async handle(c, next) {
      log.push(`>${name}`);
      const res = await next(c);
      log.push(`<${name}`);
      return res;
    },
  };
}

const okTerminal = (): Promise<GatewayResponse> =>
  Promise.resolve({ status: 200, ok: true, body: 'done' });

describe('composeChain', () => {
  it('runs middlewares in order and reaches the terminal', async () => {
    const log: string[] = [];
    const run = composeChain([recorder('a', log), recorder('b', log)], () => {
      log.push('terminal');
      return okTerminal();
    });
    const res = await run(ctx());
    expect(res.body).toBe('done');
    expect(log).toEqual(['>a', '>b', 'terminal', '<b', '<a']);
  });

  it('short-circuits when a middleware returns without calling next', async () => {
    const log: string[] = [];
    const blocker: Middleware = {
      name: 'blocker',
      async handle() {
        log.push('blocked');
        return { status: 403, ok: false };
      },
    };
    const run = composeChain([recorder('a', log), blocker, recorder('c', log)], () => {
      log.push('terminal');
      return okTerminal();
    });
    const res = await run(ctx());
    expect(res.status).toBe(403);
    expect(log).toEqual(['>a', 'blocked', '<a']);
  });

  it('throws if a middleware calls next() more than once', async () => {
    const doubled: Middleware = {
      name: 'doubled',
      async handle(c, next) {
        await next(c);
        return next(c);
      },
    };
    const run = composeChain([doubled], okTerminal);
    await expect(run(ctx())).rejects.toThrow(/more than once/);
  });

  it('chainStageNames lists names in order', () => {
    const log: string[] = [];
    expect(chainStageNames([recorder('a', log), recorder('b', log)])).toEqual(['a', 'b']);
  });
});
