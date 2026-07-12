/**
 * Connectivity & input-retention slice — example-based unit tests.
 *
 * These cover the concrete transitions of the connectivity reducer (Req 8.7,
 * 11.5, 17). The broad-input property coverage lives in the Property 19 / 20
 * tests (tasks 10.9, 10.10); here we pin the specific behaviours the design
 * calls out so regressions are caught with readable examples.
 *
 * Feature: api-copilot-desktop
 */

import {
  backendActionsEnabled,
  connectivityReducer,
  connectivitySlice,
} from './connectivity';
import { rootReducer } from './reducer';
import { initialAppState } from './types';
import type { AppState } from './types';

/** A signed-in, reachable baseline so we can observe the session staying put. */
const signedInReachable: AppState = {
  ...initialAppState,
  session: { status: 'signed_in', expiredNotice: false },
  connectivity: 'reachable',
  route: 'qa',
};

describe('connectivityReducer — OPERATION_UNREACHABLE (Req 17.1, 17.3, 17.5)', () => {
  it('sets connectivity to unreachable and retains the operation input', () => {
    const next = connectivityReducer(signedInReachable, {
      type: 'OPERATION_UNREACHABLE',
      view: 'qa',
      input: { question: 'what does /users do?' },
    });

    expect(next.connectivity).toBe('unreachable');
    expect(next.retainedInputs.qa).toEqual({ question: 'what does /users do?' });
  });

  it('keeps the User signed in and never emits a clear-token effect (Req 17.2)', () => {
    const { state, effects } = rootReducer(signedInReachable, {
      type: 'OPERATION_UNREACHABLE',
      view: 'testing-console',
      input: { values: { id: '1' } },
    });

    expect(state.session).toEqual(signedInReachable.session);
    expect(effects).toEqual([]);
  });

  it('disables backend-requiring actions while unreachable (Req 17.3)', () => {
    const next = connectivityReducer(signedInReachable, {
      type: 'OPERATION_UNREACHABLE',
      view: 'qa',
      input: 'hi',
    });

    expect(backendActionsEnabled(next)).toBe(false);
  });

  it('does not disturb inputs retained for other views', () => {
    const withOther: AppState = {
      ...signedInReachable,
      retainedInputs: { search: { query: 'auth' } },
    };

    const next = connectivityReducer(withOther, {
      type: 'OPERATION_UNREACHABLE',
      view: 'qa',
      input: 'q',
    });

    expect(next.retainedInputs.search).toEqual({ query: 'auth' });
    expect(next.retainedInputs.qa).toBe('q');
  });
});

describe('connectivityReducer — OPERATION_TIMED_OUT (Req 8.7, 11.5, 17.5)', () => {
  it('retains the input for retry without changing connectivity', () => {
    const next = connectivityReducer(signedInReachable, {
      type: 'OPERATION_TIMED_OUT',
      view: 'qa',
      input: { question: 'slow question' },
    });

    expect(next.retainedInputs.qa).toEqual({ question: 'slow question' });
    expect(next.connectivity).toBe('reachable');
  });

  it('leaves an already-unreachable connectivity unchanged', () => {
    const unreachable: AppState = { ...signedInReachable, connectivity: 'unreachable' };

    const next = connectivityReducer(unreachable, {
      type: 'OPERATION_TIMED_OUT',
      view: 'testing-console',
      input: { values: {} },
    });

    expect(next.connectivity).toBe('unreachable');
  });
});

describe('connectivityReducer — OPERATION_SUCCEEDED (Req 17.4)', () => {
  it('marks connectivity reachable and clears the view input', () => {
    const degraded: AppState = {
      ...signedInReachable,
      connectivity: 'unreachable',
      retainedInputs: { qa: { question: 'retry me' } },
    };

    const next = connectivityReducer(degraded, {
      type: 'OPERATION_SUCCEEDED',
      view: 'qa',
    });

    expect(next.connectivity).toBe('reachable');
    expect('qa' in next.retainedInputs).toBe(false);
    expect(backendActionsEnabled(next)).toBe(true);
  });

  it('only clears the succeeding view input, retaining others', () => {
    const degraded: AppState = {
      ...signedInReachable,
      connectivity: 'unreachable',
      retainedInputs: { qa: 'a', search: 'b' },
    };

    const next = connectivityReducer(degraded, {
      type: 'OPERATION_SUCCEEDED',
      view: 'qa',
    });

    expect('qa' in next.retainedInputs).toBe(false);
    expect(next.retainedInputs.search).toBe('b');
  });

  it('is a no-op reference-wise for retainedInputs when nothing was retained', () => {
    const next = connectivityReducer(signedInReachable, {
      type: 'OPERATION_SUCCEEDED',
      view: 'qa',
    });

    expect(next.connectivity).toBe('reachable');
    expect(next.retainedInputs).toBe(signedInReachable.retainedInputs);
  });
});

describe('connectivityReducer — unrelated actions', () => {
  it('returns the input state unchanged for actions it does not handle', () => {
    const next = connectivitySlice.reduce(signedInReachable, {
      type: 'SIGN_IN_SUCCEEDED',
    });

    expect(next).toBe(signedInReachable);
  });

  it('declares no effects', () => {
    expect(connectivitySlice.effects).toBeUndefined();
  });
});
