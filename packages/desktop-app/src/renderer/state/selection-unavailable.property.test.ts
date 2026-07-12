/**
 * Selection slice — failed version selection (Property-Based Tests)
 *
 * Uses fast-check to validate the design's Correctness Property 11 across a
 * broad, generated input space. These property tests complement the
 * example-based unit tests in `selection.test.ts` by exercising the
 * `API_VERSION_UNAVAILABLE` transition over every combination of prior state:
 * a null or already-active API version, an arbitrary active workspace, any
 * pre-existing selection error, and any current route.
 *
 * Feature: api-copilot-desktop
 *
 * Property 11: A failed version selection retains the prior selection
 * Validates: Requirements 7.4
 */

import * as fc from 'fast-check';
import type { apiCopilotShared } from '@health-checkup/services';

import { selectionReducer } from './selection';
import { initialAppState } from './types';
import type { AppState, SelectionError, ViewId } from './types';

/** Generator for an {@link apiCopilotShared.ApiSelection}. */
const apiSelectionArb: fc.Arbitrary<apiCopilotShared.ApiSelection> = fc.record({
  workspaceId: fc.string({ minLength: 1, maxLength: 12 }),
  apiId: fc.string({ minLength: 1, maxLength: 12 }),
  version: fc.integer({ min: 1, max: 100 }),
});

/** The routes the store can occupy. */
const viewArb: fc.Arbitrary<ViewId> = fc.constantFrom<ViewId>(
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
);

/** A prior selection error: none, or an existing version-unavailable error. */
const priorSelectionErrorArb: fc.Arbitrary<SelectionError | null> = fc.oneof(
  fc.constant<SelectionError | null>(null),
  apiSelectionArb.map((attempted) => ({
    kind: 'version-unavailable' as const,
    attempted,
  })),
);

/**
 * Generator for a prior {@link AppState} spanning the full selection input
 * space: a null or already-active API version, any/no active workspace, any
 * pre-existing selection error, and any current route.
 */
const priorStateArb: fc.Arbitrary<AppState> = fc.record({
  activeApiVersion: fc.oneof(
    fc.constant<apiCopilotShared.ApiSelection | null>(null),
    apiSelectionArb,
  ),
  activeWorkspaceId: fc.oneof(
    fc.constant<string | null>(null),
    fc.string({ minLength: 1, maxLength: 12 }),
  ),
  selectionError: priorSelectionErrorArb,
  route: viewArb,
  session: fc.constantFrom(
    { status: 'signed_out' as const, expiredNotice: false },
    { status: 'signed_in' as const, expiredNotice: false },
  ),
}).map((partial) => ({
  ...initialAppState,
  ...partial,
}));

describe('selectionReducer — Property 11: a failed version selection retains the prior selection', () => {
  it('leaves activeApiVersion exactly equal to the prior selection (Req 7.4)', () => {
    fc.assert(
      fc.property(priorStateArb, apiSelectionArb, (prior, attempted) => {
        const next = selectionReducer(prior, {
          type: 'API_VERSION_UNAVAILABLE',
          attempted,
        });
        // The active version is retained unchanged — whether it was null or a
        // concrete selection — regardless of what was attempted.
        expect(next.activeApiVersion).toEqual(prior.activeApiVersion);
      })
    );
  });

  it('surfaces a version-unavailable error naming the attempted selection (Req 7.4)', () => {
    fc.assert(
      fc.property(priorStateArb, apiSelectionArb, (prior, attempted) => {
        const next = selectionReducer(prior, {
          type: 'API_VERSION_UNAVAILABLE',
          attempted,
        });
        expect(next.selectionError).toEqual({
          kind: 'version-unavailable',
          attempted,
        });
      })
    );
  });

  it('changes nothing else in the state — only activeApiVersion is retained and the error is set', () => {
    fc.assert(
      fc.property(priorStateArb, apiSelectionArb, (prior, attempted) => {
        const next = selectionReducer(prior, {
          type: 'API_VERSION_UNAVAILABLE',
          attempted,
        });
        // Every field other than selectionError is untouched.
        expect(next.activeWorkspaceId).toEqual(prior.activeWorkspaceId);
        expect(next.route).toEqual(prior.route);
        expect(next.session).toEqual(prior.session);
        expect(next.connectivity).toEqual(prior.connectivity);
        expect(next.requests).toEqual(prior.requests);
        expect(next.retainedInputs).toEqual(prior.retainedInputs);
      })
    );
  });
});
