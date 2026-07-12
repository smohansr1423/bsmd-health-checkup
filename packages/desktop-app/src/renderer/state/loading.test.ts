/**
 * Loading-lifecycle slice — Unit Tests
 *
 * Example-based tests for the per-operation request-status reducer
 * (Req 16.1, 16.2). These verify concrete dispatch → completion transitions
 * and the key edge cases (concurrent operations, re-dispatch after completion,
 * and that unrelated actions leave `requests` untouched). The universal
 * "loading always clears on completion" property is covered separately by the
 * property test in task 10.4.
 *
 * Feature: api-copilot-desktop
 */

import { loadingReducer, loadingSlice } from './loading';
import { rootReducer } from './reducer';
import { initialAppState } from './types';
import type { AppAction, AppState } from './types';

describe('loadingReducer — Req 16.1, 16.2', () => {
  it('sets an operation to loading on dispatch (Req 16.1)', () => {
    const next = loadingReducer(initialAppState, {
      type: 'REQUEST_DISPATCHED',
      operationId: 'qa',
    });

    expect(next.requests.qa).toBe('loading');
  });

  it('sets an operation to success on successful completion, clearing loading (Req 16.2)', () => {
    const loading = loadingReducer(initialAppState, {
      type: 'REQUEST_DISPATCHED',
      operationId: 'search',
    });

    const done = loadingReducer(loading, {
      type: 'REQUEST_SUCCEEDED',
      operationId: 'search',
    });

    expect(done.requests.search).toBe('success');
  });

  it('sets an operation to error on failed completion, clearing loading (Req 16.2)', () => {
    const loading = loadingReducer(initialAppState, {
      type: 'REQUEST_DISPATCHED',
      operationId: 'code-gen',
    });

    const done = loadingReducer(loading, {
      type: 'REQUEST_FAILED',
      operationId: 'code-gen',
    });

    expect(done.requests['code-gen']).toBe('error');
  });

  it('tracks concurrent operations independently', () => {
    let state: AppState = initialAppState;
    state = loadingReducer(state, { type: 'REQUEST_DISPATCHED', operationId: 'qa' });
    state = loadingReducer(state, { type: 'REQUEST_DISPATCHED', operationId: 'search' });

    // Completing one leaves the other still loading.
    state = loadingReducer(state, { type: 'REQUEST_SUCCEEDED', operationId: 'qa' });

    expect(state.requests.qa).toBe('success');
    expect(state.requests.search).toBe('loading');
  });

  it('re-dispatching a completed operation returns it to loading', () => {
    let state: AppState = initialAppState;
    state = loadingReducer(state, { type: 'REQUEST_DISPATCHED', operationId: 'qa' });
    state = loadingReducer(state, { type: 'REQUEST_FAILED', operationId: 'qa' });
    expect(state.requests.qa).toBe('error');

    // A retry dispatches the same operation again.
    state = loadingReducer(state, { type: 'REQUEST_DISPATCHED', operationId: 'qa' });
    expect(state.requests.qa).toBe('loading');
  });

  it('does not mutate the input state (returns a new object and map)', () => {
    const next = loadingReducer(initialAppState, {
      type: 'REQUEST_DISPATCHED',
      operationId: 'qa',
    });

    expect(next).not.toBe(initialAppState);
    expect(next.requests).not.toBe(initialAppState.requests);
    expect(initialAppState.requests).toEqual({});
  });

  it('leaves requests untouched for actions it does not handle', () => {
    const unrelated = { type: 'SIGN_IN_SUCCEEDED' } as AppAction;
    const next = loadingReducer(initialAppState, unrelated);

    expect(next).toBe(initialAppState);
  });
});

describe('loadingSlice wired into the root reducer', () => {
  it('applies loading transitions through rootReducer with no effects', () => {
    const { state, effects } = rootReducer(initialAppState, {
      type: 'REQUEST_DISPATCHED',
      operationId: 'dashboard',
    });

    expect(state.requests.dashboard).toBe('loading');
    expect(effects).toEqual([]);
  });

  it('exposes a reduce function and no effects on the slice', () => {
    expect(typeof loadingSlice.reduce).toBe('function');
    expect(loadingSlice.effects).toBeUndefined();
  });
});
