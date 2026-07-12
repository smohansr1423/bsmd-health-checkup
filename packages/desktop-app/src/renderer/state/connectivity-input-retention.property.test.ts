/**
 * Input retention on failed operations — Property-Based Tests
 *
 * Uses fast-check to validate the design's Correctness Property 20 across a
 * broad, generated space of request-outcome sequences. These property tests
 * complement the example-based unit tests in `connectivity.test.ts` by
 * exercising the connectivity reducer's input-retention behaviour over
 * arbitrary interleavings of unreachable / timeout / success outcomes across
 * many views and many opaque input payloads.
 *
 * Feature: api-copilot-desktop
 *
 * Property 20: Failed operations retain their input for retry
 * Validates: Requirements 8.7, 11.5, 17.5
 */

import * as fc from 'fast-check';

import { rootReducer } from './reducer';
import { initialAppState } from './types';
import type { AppAction, AppState, ViewId } from './types';

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
 * connectivity slice reacts to. The two failing outcomes carry an input to
 * retain; the success outcome clears the view's retained input.
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

/** The two outcomes that count as a failed operation (Req 8.7, 11.5, 17.5). */
type FailingOutcome = 'OPERATION_UNREACHABLE' | 'OPERATION_TIMED_OUT';
function isFailure(action: AppAction): action is Extract<AppAction, { type: FailingOutcome }> {
  return action.type === 'OPERATION_UNREACHABLE' || action.type === 'OPERATION_TIMED_OUT';
}

/** A signed-in, reachable baseline with no inputs retained yet. */
const baseline: AppState = {
  ...initialAppState,
  session: { status: 'signed_in', expiredNotice: false },
  connectivity: 'reachable',
  route: 'qa',
  retainedInputs: {},
};

describe('connectivity — Property 20: failed operations retain their input for retry', () => {
  it('a failing outcome retains the exact input under its view (Req 8.7, 11.5, 17.5)', () => {
    fc.assert(
      fc.property(inputArb, viewArb, (input, view) => {
        // Drive a single failing outcome from a clean baseline and check the
        // input is retained verbatim under the operation's view.
        for (const type of ['OPERATION_UNREACHABLE', 'OPERATION_TIMED_OUT'] as const) {
          const action = { type, view, input } as AppAction;
          const { state } = rootReducer(baseline, action);
          expect(view in state.retainedInputs).toBe(true);
          expect(state.retainedInputs[view]).toEqual(input);
        }
      })
    );
  });

  it('a success clears the retained input for that view, offering no stale retry (Req 17.5)', () => {
    fc.assert(
      fc.property(viewArb, inputArb, (view, input) => {
        // Retain an input via a failure, then complete successfully.
        const failed = rootReducer(baseline, {
          type: 'OPERATION_UNREACHABLE',
          view,
          input,
        }).state;
        expect(view in failed.retainedInputs).toBe(true);

        const succeeded = rootReducer(failed, { type: 'OPERATION_SUCCEEDED', view }).state;
        expect(view in succeeded.retainedInputs).toBe(false);
      })
    );
  });

  it('retained inputs track an independent per-view oracle over any sequence', () => {
    fc.assert(
      fc.property(outcomeSequenceArb, (actions) => {
        let state = baseline;
        // Oracle: last failing input per view, cleared on that view's success.
        const model = new Map<ViewId, unknown>();

        for (const action of actions) {
          state = rootReducer(state, action).state;

          if (isFailure(action)) {
            model.set(action.view, action.input);
          } else if (action.type === 'OPERATION_SUCCEEDED') {
            model.delete(action.view);
          }

          // Every view retained by the model is present with the same input...
          for (const [view, expectedInput] of model) {
            expect(view in state.retainedInputs).toBe(true);
            expect(state.retainedInputs[view]).toEqual(expectedInput);
          }
          // ...and no other view is retained by the state.
          const stateViews = Object.keys(state.retainedInputs) as ViewId[];
          expect(stateViews.length).toBe(model.size);
        }
      })
    );
  });

  it('a failed operation on one view never disturbs another view’s retained input', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(viewArb, { minLength: 2, maxLength: 2 }),
        inputArb,
        inputArb,
        ([viewA, viewB], inputA, inputB) => {
          let state = rootReducer(baseline, {
            type: 'OPERATION_TIMED_OUT',
            view: viewA,
            input: inputA,
          }).state;
          state = rootReducer(state, {
            type: 'OPERATION_UNREACHABLE',
            view: viewB,
            input: inputB,
          }).state;

          // Both inputs are retained independently under their own views.
          expect(state.retainedInputs[viewA]).toEqual(inputA);
          expect(state.retainedInputs[viewB]).toEqual(inputB);

          // Succeeding on B clears only B; A's retained input is untouched.
          const afterSuccessB = rootReducer(state, {
            type: 'OPERATION_SUCCEEDED',
            view: viewB,
          }).state;
          expect(viewB in afterSuccessB.retainedInputs).toBe(false);
          expect(afterSuccessB.retainedInputs[viewA]).toEqual(inputA);
        },
      )
    );
  });
});
