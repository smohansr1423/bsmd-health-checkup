/**
 * Root reducer — composes the app's reducer slices.
 *
 * The store keeps a single {@link AppState}. Each concern is implemented as an
 * independent {@link ReducerSlice} that owns its portion of the state and
 * ignores actions it does not handle. The root reducer pipes the state through
 * every registered slice in turn and gathers the {@link AppEffect}s each slice
 * requests for the dispatched action.
 *
 * This is the single extension point for new slices: a later task adds its
 * slice to {@link SLICES} and its state/actions to `./types`, with no changes
 * to existing slice files.
 */

import { connectivitySlice } from './connectivity';
import { loadingSlice } from './loading';
import { selectionSlice } from './selection';
import { sessionSlice } from './session';
import type { AppAction, AppEffect, AppState, ReducerSlice } from './types';

/**
 * The ordered list of reducer slices. Order does not affect correctness because
 * slices own disjoint parts of {@link AppState}; it only fixes a deterministic
 * traversal. New slices (loading-lifecycle, selection, connectivity, …) are
 * appended here.
 */
export const SLICES: readonly ReducerSlice[] = [
  sessionSlice,
  loadingSlice,
  connectivitySlice,
  selectionSlice,
];

/** The result of reducing an action: the next state and any effects to run. */
export interface ReducerResult {
  /** The next application state. */
  state: AppState;
  /** Side effects the store must perform (e.g. clearing the token). */
  effects: AppEffect[];
}

/**
 * Apply an action to the state through every slice, collecting effects.
 *
 * Pure: for a given `(state, action)` it always returns an equal result and
 * performs no I/O. The store is responsible for executing the returned effects.
 */
export function rootReducer(state: AppState, action: AppAction): ReducerResult {
  let nextState = state;
  const effects: AppEffect[] = [];

  for (const slice of SLICES) {
    nextState = slice.reduce(nextState, action);
    if (slice.effects) {
      effects.push(...slice.effects(action));
    }
  }

  return { state: nextState, effects };
}
