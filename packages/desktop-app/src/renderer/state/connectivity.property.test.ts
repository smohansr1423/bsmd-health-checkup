/**
 * Connectivity state machine — Property-Based Tests
 *
 * Uses fast-check to validate the design's Correctness Property 19 across a
 * broad, generated space of request-outcome sequences. These property tests
 * complement the example-based unit tests in `connectivity.test.ts` by
 * exercising the connectivity reducer over arbitrary interleavings of
 * unreachable / timeout / success outcomes across many views.
 *
 * Feature: api-copilot-desktop
 *
 * Property 19: Connectivity is a state machine that preserves session and gates actions
 * Validates: Requirements 17.1, 17.2, 17.3, 17.4
 */

import * as fc from 'fast-check';

import { backendActionsEnabled } from './connectivity';
import { rootReducer } from './reducer';
import { initialAppState } from './types';
import type { AppAction, AppState, ConnectivityState, ViewId } from './types';

/** Every view the app can route to (the input space for `view` payloads). */
const ALL_VIEWS: readonly ViewId[] = [
  'sign-in',
  'sign-up',
  'workspaces',
  'api-browser',
  'qa',
  'search',
  'testing-console',
  'code-gen',
  'history',
  'dashboard',
];

const viewArb: fc.Arbitrary<ViewId> = fc.constantFrom(...ALL_VIEWS);

/**
 * Arbitrary user input retained on failure. It spans primitives, objects, and
 * arrays because the reducer treats input as opaque (`unknown`).
 */
const inputArb: fc.Arbitrary<unknown> = fc.anything();

/**
 * A single request-outcome action: one of the three transitions the
 * connectivity state machine reacts to. Each carries a view (and, for the
 * failing outcomes, an input to retain).
 */
const outcomeActionArb: fc.Arbitrary<AppAction> = fc.oneof(
  fc.record({
    type: fc.constant<'OPERATION_UNREACHABLE'>('OPERATION_UNREACHABLE'),
    view: viewArb,
    input: inputArb,
  }),
  fc.record({
    type: fc.constant<'OPERATION_TIMED_OUT'>('OPERATION_TIMED_OUT'),
    view: viewArb,
    input: inputArb,
  }),
  fc.record({
    type: fc.constant<'OPERATION_SUCCEEDED'>('OPERATION_SUCCEEDED'),
    view: viewArb,
  }),
);

/** A non-empty sequence of outcomes to drive through the reducer. */
const outcomeSequenceArb: fc.Arbitrary<AppAction[]> = fc.array(outcomeActionArb, {
  minLength: 1,
  maxLength: 40,
});

/** A signed-in, reachable baseline so we can observe the session staying put. */
const signedInReachable: AppState = {
  ...initialAppState,
  session: { status: 'signed_in', expiredNotice: false },
  connectivity: 'reachable',
  route: 'qa',
};

/**
 * Independent oracle for the connectivity state machine: an `unreachable`
 * outcome moves to `unreachable`, a success moves to `reachable`, and a timeout
 * leaves the state unchanged. Written separately from the implementation so the
 * test does not merely restate it.
 */
function nextConnectivity(current: ConnectivityState, action: AppAction): ConnectivityState {
  switch (action.type) {
    case 'OPERATION_UNREACHABLE':
      return 'unreachable';
    case 'OPERATION_SUCCEEDED':
      return 'reachable';
    default:
      return current;
  }
}

describe('connectivity — Property 19: state machine preserves session and gates actions', () => {
  it('an unreachable outcome enters unreachable and disables backend actions (Req 17.1, 17.3)', () => {
    fc.assert(
      fc.property(outcomeSequenceArb, (actions) => {
        let state = signedInReachable;
        for (const action of actions) {
          state = rootReducer(state, action).state;
          if (action.type === 'OPERATION_UNREACHABLE') {
            expect(state.connectivity).toBe('unreachable');
            expect(backendActionsEnabled(state)).toBe(false);
          }
        }
      })
    );
  });

  it('a success after any state sets reachable and re-enables backend actions (Req 17.4)', () => {
    fc.assert(
      fc.property(outcomeSequenceArb, (actions) => {
        let state = signedInReachable;
        for (const action of actions) {
          state = rootReducer(state, action).state;
          if (action.type === 'OPERATION_SUCCEEDED') {
            expect(state.connectivity).toBe('reachable');
            expect(backendActionsEnabled(state)).toBe(true);
          }
        }
      })
    );
  });

  it('never signs the user out or clears the token across any outcome sequence (Req 17.2)', () => {
    fc.assert(
      fc.property(outcomeSequenceArb, (actions) => {
        let state = signedInReachable;
        for (const action of actions) {
          const result = rootReducer(state, action);
          state = result.state;
          // The connectivity slice must never emit a token-clearing effect...
          expect(result.effects).toEqual([]);
          // ...and the session must remain exactly as it started (signed in).
          expect(state.session).toEqual(signedInReachable.session);
        }
      })
    );
  });

  it('the gate is always derived from connectivity, matching an independent oracle', () => {
    fc.assert(
      fc.property(outcomeSequenceArb, (actions) => {
        let state = signedInReachable;
        let expected: ConnectivityState = signedInReachable.connectivity;
        for (const action of actions) {
          expected = nextConnectivity(expected, action);
          state = rootReducer(state, action).state;
          expect(state.connectivity).toBe(expected);
          expect(backendActionsEnabled(state)).toBe(expected === 'reachable');
        }
      })
    );
  });
});
