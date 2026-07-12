/**
 * Session-expiry handling — Property-Based Tests
 *
 * Uses fast-check to validate the design's Correctness Property 9 across a
 * broad, generated space of application states. The session reducer must react
 * to a `session_expired` outcome (the `SESSION_EXPIRED` action) identically no
 * matter what the rest of the state looked like beforehand.
 *
 * Feature: api-copilot-desktop
 *
 * Property 9: Session-expiry outcome clears the token and routes to sign-in
 * Validates: Requirements 4.4
 */

import * as fc from 'fast-check';

import type { apiCopilotShared } from '@health-checkup/services';

import { rootReducer } from './reducer';
import type {
  AppState,
  ConnectivityState,
  RequestStatus,
  ViewId,
} from './types';

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

const CONNECTIVITY: readonly ConnectivityState[] = ['reachable', 'unreachable'];
const REQUEST_STATUS: readonly RequestStatus[] = [
  'idle',
  'loading',
  'success',
  'error',
];

/** An arbitrary Active_API_Version selection (Req 7.2). */
const apiSelectionArb: fc.Arbitrary<apiCopilotShared.ApiSelection> = fc.record({
  workspaceId: fc.string(),
  apiId: fc.string(),
  version: fc.integer({ min: 0, max: 1000 }),
}) as fc.Arbitrary<apiCopilotShared.ApiSelection>;

/**
 * A generator spanning the full {@link AppState} space: any session status
 * (including already-signed-out with or without an expiry notice), either
 * connectivity, any current route, any selection, an arbitrary per-operation
 * request map, and arbitrary retained inputs. This lets the property assert the
 * expiry transition is independent of everything else in state.
 */
const appStateArb: fc.Arbitrary<AppState> = fc.record({
  session: fc.record({
    status: fc.constantFrom<'signed_out' | 'signed_in'>(
      'signed_out',
      'signed_in',
    ),
    expiredNotice: fc.boolean(),
  }),
  connectivity: fc.constantFrom(...CONNECTIVITY),
  activeWorkspaceId: fc.option(fc.string(), { nil: null }),
  activeApiVersion: fc.option(apiSelectionArb, { nil: null }),
  selectionError: fc.constant(null),
  route: fc.constantFrom(...ALL_VIEWS),
  requests: fc.dictionary(fc.string(), fc.constantFrom(...REQUEST_STATUS)),
  retainedInputs: fc.constant<AppState['retainedInputs']>({}),
});

describe('session-expiry — Property 9: clears the token and routes to sign-in', () => {
  it('sets signed-out with the expiry notice and routes to sign-in for any prior state (Req 4.4)', () => {
    fc.assert(
      fc.property(appStateArb, (state) => {
        const { state: next } = rootReducer(state, { type: 'SESSION_EXPIRED' });

        expect(next.session).toEqual({
          status: 'signed_out',
          expiredNotice: true,
        });
        expect(next.route).toBe('sign-in');
      })
    );
  });

  it('always requests a clear-token effect so the stored Session_Token is deleted (Req 4.4)', () => {
    fc.assert(
      fc.property(appStateArb, (state) => {
        const { effects } = rootReducer(state, { type: 'SESSION_EXPIRED' });

        expect(effects).toContainEqual({ type: 'clear-token' });
      })
    );
  });

  it('is idempotent: a second expiry from the resulting state yields the same session/route/effect', () => {
    fc.assert(
      fc.property(appStateArb, (state) => {
        const first = rootReducer(state, { type: 'SESSION_EXPIRED' });
        const second = rootReducer(first.state, { type: 'SESSION_EXPIRED' });

        expect(second.state.session).toEqual(first.state.session);
        expect(second.state.route).toBe(first.state.route);
        expect(second.effects).toContainEqual({ type: 'clear-token' });
      })
    );
  });

  it('leaves connectivity and selection untouched (expiry only affects the session, Req 4.4)', () => {
    fc.assert(
      fc.property(appStateArb, (state) => {
        const { state: next } = rootReducer(state, { type: 'SESSION_EXPIRED' });

        expect(next.connectivity).toBe(state.connectivity);
        expect(next.activeWorkspaceId).toBe(state.activeWorkspaceId);
        expect(next.activeApiVersion).toBe(state.activeApiVersion);
      })
    );
  });
});
