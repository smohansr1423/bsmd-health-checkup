/**
 * Middleware chain composition (Task 16.1).
 *
 * `composeChain` folds an ordered list of {@link Middleware} into a single
 * handler, terminating in a supplied terminal handler (the service router).
 * Each middleware may either call `next(ctx)` to continue or return a response
 * to short-circuit the chain. Composition is dependency-free, so the assembled
 * chain is easy to unit test with in-memory fakes.
 *
 * Requirements: 18.1, 23.3, 25.2
 */

import type {
  GatewayResponse,
  Middleware,
  NextFn,
  RequestContext,
} from '../types';

/**
 * Compose an ordered list of middlewares into a single {@link NextFn}. The
 * `terminal` handler runs after every middleware has delegated via `next`.
 *
 * Guarantees:
 *  - Middlewares run in array order.
 *  - A middleware that returns without calling `next` short-circuits the rest
 *    of the chain (including the terminal handler).
 *  - Each middleware's `next` may be invoked at most once; a second invocation
 *    throws to surface accidental double-continuation in tests.
 */
export function composeChain(
  middlewares: readonly Middleware[],
  terminal: NextFn,
): NextFn {
  return function run(ctx: RequestContext): Promise<GatewayResponse> {
    let lastCalledIndex = -1;

    const dispatch = (index: number, context: RequestContext): Promise<GatewayResponse> => {
      if (index <= lastCalledIndex) {
        throw new Error(
          `Middleware "${middlewares[index - 1]?.name ?? 'terminal'}" called next() more than once.`,
        );
      }
      lastCalledIndex = index;

      if (index === middlewares.length) {
        return Promise.resolve(terminal(context));
      }

      const middleware = middlewares[index];
      const next: NextFn = (nextCtx) => dispatch(index + 1, nextCtx);
      return Promise.resolve(middleware.handle(context, next));
    };

    return dispatch(0, ctx);
  };
}

/** The ordered names of the stages in a chain (for introspection / tests). */
export function chainStageNames(middlewares: readonly Middleware[]): string[] {
  return middlewares.map((m) => m.name);
}
