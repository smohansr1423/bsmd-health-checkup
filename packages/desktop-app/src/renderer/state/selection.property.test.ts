/**
 * Selection slice — Property-Based Tests
 *
 * Uses fast-check to validate the design's Correctness Property 10 across a
 * broad, generated input space. These property tests complement the
 * example-based unit tests in `selection.test.ts` by exercising the reducer
 * over arbitrary sequences of navigation and selection actions.
 *
 * Feature: api-copilot-desktop
 *
 * Property 10: Active workspace and API version persist across navigation
 * Validates: Requirements 5.4, 7.2, 18.1
 */

import * as fc from 'fast-check';

import { selectionReducer } from './selection';
import { initialAppState } from './types';
import type { AppAction, AppState, ViewId } from './types';
import type { apiCopilotShared } from '@health-checkup/services';

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

/** Generator for a view id spanning the full route vocabulary. */
const viewArb: fc.Arbitrary<ViewId> = fc.constantFrom(...ALL_VIEWS);

/** Generator for a workspace id. */
const workspaceIdArb: fc.Arbitrary<string> = fc
  .string({ minLength: 1, maxLength: 8 })
  .map((s) => `ws-${s}`);

/** Generator for an Active_API_Version selection. */
const apiSelectionArb: fc.Arbitrary<apiCopilotShared.ApiSelection> = fc.record({
  workspaceId: workspaceIdArb,
  apiId: fc.string({ minLength: 1, maxLength: 8 }).map((s) => `api-${s}`),
  version: fc.integer({ min: 1, max: 20 }),
});

/** A `NAVIGATED` action to an arbitrary view. */
const navigateActionArb: fc.Arbitrary<AppAction> = viewArb.map((view) => ({
  type: 'NAVIGATED' as const,
  view,
}));

/**
 * A "non-selection" action: navigation plus other slices' actions that the
 * selection reducer must pass through without touching the active selection.
 * None of these are explicit workspace/version selection actions.
 */
const nonSelectionActionArb: fc.Arbitrary<AppAction> = fc.oneof(
  navigateActionArb,
  fc.constant<AppAction>({ type: 'SIGN_IN_SUCCEEDED' }),
  fc.constant<AppAction>({ type: 'SIGNED_OUT' }),
  fc.constant<AppAction>({ type: 'SESSION_EXPIRED' }),
  viewArb.map<AppAction>((view) => ({ type: 'OPERATION_SUCCEEDED', view })),
  fc
    .record({ view: viewArb })
    .map<AppAction>(({ view }) => ({ type: 'OPERATION_UNREACHABLE', view, input: null })),
  fc
    .string()
    .map<AppAction>((operationId) => ({ type: 'REQUEST_DISPATCHED', operationId })),
);

/** Explicit selection actions that ARE allowed to change the active selection. */
const selectionActionArb: fc.Arbitrary<AppAction> = fc.oneof(
  workspaceIdArb.map<AppAction>((workspaceId) => ({
    type: 'WORKSPACE_SELECTED',
    workspaceId,
  })),
  apiSelectionArb.map<AppAction>((selection) => ({
    type: 'API_VERSION_SELECTED',
    selection,
  })),
);

/** Any action from the union: a mix of selection and non-selection actions. */
const anyActionArb: fc.Arbitrary<AppAction> = fc.oneof(
  { weight: 3, arbitrary: nonSelectionActionArb },
  { weight: 1, arbitrary: selectionActionArb },
);

/** Generator for an arbitrary starting selection state. */
const startStateArb: fc.Arbitrary<AppState> = fc
  .record({
    activeWorkspaceId: fc.option(workspaceIdArb, { nil: null }),
    activeApiVersion: fc.option(apiSelectionArb, { nil: null }),
    route: viewArb,
  })
  .map((partial) => ({
    ...initialAppState,
    ...partial,
  }));

/** Fold a sequence of actions through the selection reducer. */
function run(state: AppState, actions: readonly AppAction[]): AppState {
  return actions.reduce(selectionReducer, state);
}

describe('selectionReducer — Property 10: selection persists across navigation', () => {
  it('leaves the active selection unchanged for any sequence of navigation actions (Req 18.1)', () => {
    fc.assert(
      fc.property(
        startStateArb,
        fc.array(navigateActionArb, { maxLength: 30 }),
        (start, navigations) => {
          const end = run(start, navigations);
          expect(end.activeWorkspaceId).toBe(start.activeWorkspaceId);
          expect(end.activeApiVersion).toEqual(start.activeApiVersion);
        },
      )
    );
  });

  it('leaves the active selection unchanged for any sequence of non-selection actions (Req 5.4, 7.2, 18.1)', () => {
    fc.assert(
      fc.property(
        startStateArb,
        fc.array(nonSelectionActionArb, { maxLength: 30 }),
        (start, actions) => {
          const end = run(start, actions);
          expect(end.activeWorkspaceId).toBe(start.activeWorkspaceId);
          expect(end.activeApiVersion).toEqual(start.activeApiVersion);
        },
      )
    );
  });

  it('the active selection always equals the most recent explicit selection action (Req 5.4, 7.2)', () => {
    fc.assert(
      fc.property(startStateArb, fc.array(anyActionArb, { maxLength: 40 }), (start, actions) => {
        const end = run(start, actions);

        // Independently compute the expected active selection: fold only the
        // explicit selection actions, starting from the initial selection.
        let expectedWorkspaceId = start.activeWorkspaceId;
        let expectedVersion = start.activeApiVersion;
        for (const action of actions) {
          if (action.type === 'WORKSPACE_SELECTED') {
            expectedWorkspaceId = action.workspaceId;
          } else if (action.type === 'API_VERSION_SELECTED') {
            expectedVersion = action.selection;
          }
        }

        expect(end.activeWorkspaceId).toBe(expectedWorkspaceId);
        expect(end.activeApiVersion).toEqual(expectedVersion);
      })
    );
  });

  it('navigation between explicit selections never alters the selection set by the last selection action (Req 18.1)', () => {
    fc.assert(
      fc.property(
        startStateArb,
        selectionActionArb,
        fc.array(navigateActionArb, { maxLength: 20 }),
        (start, selection, navigations) => {
          // Apply an explicit selection, then a run of navigations.
          const afterSelection = selectionReducer(start, selection);
          const afterNavigation = run(afterSelection, navigations);

          expect(afterNavigation.activeWorkspaceId).toBe(afterSelection.activeWorkspaceId);
          expect(afterNavigation.activeApiVersion).toEqual(afterSelection.activeApiVersion);
        },
      )
    );
  });
});
