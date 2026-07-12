/**
 * Renderer store context (Task 13.1).
 *
 * A thin React binding over the pure {@link rootReducer}. Views read the current
 * {@link AppState} and dispatch {@link AppAction}s through this context instead
 * of holding their own copies of state, which is what "wired to the store"
 * means for the view layer.
 *
 * Reducers are pure and only *declare* the side effects an action implies (e.g.
 * `clear-token` on sign-out). This provider executes those effects through an
 * injectable {@link EffectHandler}, so the deterministic transition stays in the
 * reducer while the impure work (calling the preload bridge) is supplied from
 * the outside — by tests as a spy, and by the app entry (Task 16) as the real
 * `window.copilot` binding.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react';
import { rootReducer } from './reducer';
import { initialAppState } from './types';
import type { AppAction, AppEffect, AppState } from './types';

/** Performs a side effect a reducer requested (e.g. clearing the token). */
export type EffectHandler = (effect: AppEffect) => void;

/** The value exposed to consumers of the store context. */
export interface AppStore {
  /** The current application state. */
  state: AppState;
  /** Dispatch an action; runs the reducer and executes any resulting effects. */
  dispatch: (action: AppAction) => void;
}

const StoreContext = createContext<AppStore | null>(null);

/** Props for {@link AppStoreProvider}. */
export interface AppStoreProviderProps {
  children: React.ReactNode;
  /** Starting state; defaults to {@link initialAppState}. Handy for tests. */
  initialState?: AppState;
  /** Executes effects the reducer requests; defaults to a no-op. */
  onEffect?: EffectHandler;
}

/**
 * Provide the app store to a React subtree.
 *
 * `dispatch` computes the next state and effects from the *latest* state via a
 * ref (so rapid successive dispatches compose correctly) and runs the effects
 * outside the state updater, keeping the render phase pure.
 */
export function AppStoreProvider({
  children,
  initialState = initialAppState,
  onEffect,
}: AppStoreProviderProps): React.ReactElement {
  const [state, setState] = useState<AppState>(initialState);

  // Track the latest state and effect handler without re-creating `dispatch`.
  const stateRef = useRef<AppState>(state);
  stateRef.current = state;
  const onEffectRef = useRef<EffectHandler | undefined>(onEffect);
  onEffectRef.current = onEffect;

  const dispatch = useCallback((action: AppAction) => {
    const { state: next, effects } = rootReducer(stateRef.current, action);
    stateRef.current = next;
    setState(next);
    for (const effect of effects) {
      onEffectRef.current?.(effect);
    }
  }, []);

  const value = useMemo<AppStore>(() => ({ state, dispatch }), [state, dispatch]);

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

/**
 * Read the app store. Throws when used outside an {@link AppStoreProvider} so a
 * missing provider is caught immediately rather than producing silent nulls.
 */
export function useAppStore(): AppStore {
  const store = useContext(StoreContext);
  if (store === null) {
    throw new Error('useAppStore must be used within an AppStoreProvider');
  }
  return store;
}
