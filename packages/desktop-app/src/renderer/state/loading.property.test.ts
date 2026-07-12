/**
 * Loading-lifecycle slice — Property-Based Tests
 *
 * Uses fast-check to validate the design's Correctness Property 13 across a
 * broad, generated input space. These property tests complement the
 * example-based unit tests in `loading.test.ts` by exercising the reducer over
 * arbitrary starting states and arbitrary sequences of lifecycle actions.
 *
 * Feature: api-copilot-desktop
 *
 * Property 13: The loading indicator is set on dispatch and always cleared on
 * completion. For any backend request, dispatching it sets that operation's
 * status to `loading`, and its completion — whether success or failure — sets
 * the status to `success` or `error`, so no completed operation remains in the
 * `loading` state.
 *
 * Validates: Requirements 16.1, 16.2
 */

import * as fc from 'fast-check';

import { loadingReducer } from './loading';
import { initialAppState } from './types';
import type { AppAction, AppState, RequestStatus } from './types';

const ALL_STATUSES: readonly RequestStatus[] = ['idle', 'loading', 'success', 'error'];

/** Operation-id generator: a small pool so sequences revisit the same ops. */
const operationIdArb: fc.Arbitrary<string> = fc.constantFrom(
  'qa',
  'search',
  'code-gen',
  'dashboard',
  'testing-console',
  'sign-in',
);

/** The three lifecycle actions this slice owns, over an arbitrary operationId. */
const lifecycleActionArb: fc.Arbitrary<
  Extract<
    AppAction,
    { type: 'REQUEST_DISPATCHED' | 'REQUEST_SUCCEEDED' | 'REQUEST_FAILED' }
  >
> = operationIdArb.chain((operationId) =>
  fc.constantFrom(
    { type: 'REQUEST_DISPATCHED' as const, operationId },
    { type: 'REQUEST_SUCCEEDED' as const, operationId },
    { type: 'REQUEST_FAILED' as const, operationId },
  ),
);

/**
 * Arbitrary starting request map, so properties hold from any prior state
 * (operations already loading, already completed, or untracked).
 */
const requestsArb: fc.Arbitrary<Record<string, RequestStatus>> = fc.dictionary(
  operationIdArb,
  fc.constantFrom(...ALL_STATUSES),
);

const appStateArb: fc.Arbitrary<AppState> = requestsArb.map((requests) => ({
  ...initialAppState,
  requests,
}));

describe('loadingReducer — Property 13: loading is set on dispatch, always cleared on completion', () => {
  it('dispatching a request sets that operation to loading (Req 16.1)', () => {
    fc.assert(
      fc.property(appStateArb, operationIdArb, (state, operationId) => {
        const next = loadingReducer(state, {
          type: 'REQUEST_DISPATCHED',
          operationId,
        });
        expect(next.requests[operationId]).toBe('loading');
      })
    );
  });

  it('a successful completion always clears loading, setting the operation to success (Req 16.2)', () => {
    fc.assert(
      fc.property(appStateArb, operationIdArb, (state, operationId) => {
        const next = loadingReducer(state, {
          type: 'REQUEST_SUCCEEDED',
          operationId,
        });
        expect(next.requests[operationId]).toBe('success');
        expect(next.requests[operationId]).not.toBe('loading');
      })
    );
  });

  it('a failed completion always clears loading, setting the operation to error (Req 16.2)', () => {
    fc.assert(
      fc.property(appStateArb, operationIdArb, (state, operationId) => {
        const next = loadingReducer(state, {
          type: 'REQUEST_FAILED',
          operationId,
        });
        expect(next.requests[operationId]).toBe('error');
        expect(next.requests[operationId]).not.toBe('loading');
      })
    );
  });

  it('over any sequence of lifecycle actions, no operation whose last action was a completion remains loading (Req 16.1, 16.2)', () => {
    fc.assert(
      fc.property(
        appStateArb,
        fc.array(lifecycleActionArb, { minLength: 0, maxLength: 40 }),
        (initial, actions) => {
          // Fold the actions through the reducer, tracking, per operation, the
          // last lifecycle action applied — an independent oracle.
          const lastAction = new Map<string, AppAction['type']>();
          let state = initial;
          for (const action of actions) {
            state = loadingReducer(state, action);
            lastAction.set(action.operationId, action.type);
          }

          for (const [operationId, type] of lastAction) {
            const status = state.requests[operationId];
            if (type === 'REQUEST_DISPATCHED') {
              // A dispatched-and-not-yet-completed operation is loading (Req 16.1).
              expect(status).toBe('loading');
            } else {
              // Any completed operation has been moved out of loading (Req 16.2).
              expect(status).not.toBe('loading');
              expect(status).toBe(type === 'REQUEST_SUCCEEDED' ? 'success' : 'error');
            }
          }
        },
      )
    );
  });

  it('only the targeted operation changes; sibling operations keep their prior status', () => {
    fc.assert(
      fc.property(appStateArb, lifecycleActionArb, (state, action) => {
        const next = loadingReducer(state, action);
        for (const key of Object.keys(state.requests)) {
          if (key !== action.operationId) {
            expect(next.requests[key]).toBe(state.requests[key]);
          }
        }
      })
    );
  });
});
