/**
 * Selection slice — unit tests (Req 5.4, 7.2, 7.4, 18.1).
 *
 * Example-based coverage of the selection/version-select reducer: workspace
 * selection, successful version selection, navigation preserving the selection,
 * and the unavailable-version outcome retaining the prior version while
 * surfacing an error. Property-based coverage lives in the `*.property.test.ts`
 * sub-tasks (Properties 10 and 11).
 */

import { selectionReducer } from './selection';
import { initialAppState } from './types';
import type { AppState } from './types';
import type { apiCopilotShared } from '@health-checkup/services';

const V1: apiCopilotShared.ApiSelection = {
  workspaceId: 'ws-1',
  apiId: 'api-1',
  version: 1,
};
const V2: apiCopilotShared.ApiSelection = {
  workspaceId: 'ws-1',
  apiId: 'api-1',
  version: 2,
};

/** A signed-in state with an active workspace and version already selected. */
function selectedState(): AppState {
  return {
    ...initialAppState,
    session: { status: 'signed_in', expiredNotice: false },
    route: 'api-browser',
    activeWorkspaceId: 'ws-1',
    activeApiVersion: V1,
  };
}

describe('selectionReducer', () => {
  describe('WORKSPACE_SELECTED (Req 5.4)', () => {
    it('sets the Active_Workspace to the chosen id', () => {
      const next = selectionReducer(initialAppState, {
        type: 'WORKSPACE_SELECTED',
        workspaceId: 'ws-42',
      });
      expect(next.activeWorkspaceId).toBe('ws-42');
    });

    it('clears any prior selection error', () => {
      const start: AppState = {
        ...selectedState(),
        selectionError: { kind: 'version-unavailable', attempted: V2 },
      };
      const next = selectionReducer(start, {
        type: 'WORKSPACE_SELECTED',
        workspaceId: 'ws-2',
      });
      expect(next.selectionError).toBeNull();
    });

    it('leaves the Active_API_Version untouched (persists until explicitly changed)', () => {
      const next = selectionReducer(selectedState(), {
        type: 'WORKSPACE_SELECTED',
        workspaceId: 'ws-2',
      });
      expect(next.activeApiVersion).toEqual(V1);
    });
  });

  describe('API_VERSION_SELECTED (Req 7.2)', () => {
    it('adopts the returned selection as the Active_API_Version', () => {
      const next = selectionReducer(selectedState(), {
        type: 'API_VERSION_SELECTED',
        selection: V2,
      });
      expect(next.activeApiVersion).toEqual(V2);
    });

    it('clears a prior version-unavailable error', () => {
      const start: AppState = {
        ...selectedState(),
        selectionError: { kind: 'version-unavailable', attempted: V2 },
      };
      const next = selectionReducer(start, {
        type: 'API_VERSION_SELECTED',
        selection: V2,
      });
      expect(next.selectionError).toBeNull();
    });
  });

  describe('API_VERSION_UNAVAILABLE (Req 7.4)', () => {
    it('retains the previously Active_API_Version', () => {
      const next = selectionReducer(selectedState(), {
        type: 'API_VERSION_UNAVAILABLE',
        attempted: V2,
      });
      expect(next.activeApiVersion).toEqual(V1);
    });

    it('surfaces a version-unavailable error naming the attempted selection', () => {
      const next = selectionReducer(selectedState(), {
        type: 'API_VERSION_UNAVAILABLE',
        attempted: V2,
      });
      expect(next.selectionError).toEqual({
        kind: 'version-unavailable',
        attempted: V2,
      });
    });

    it('retains a null Active_API_Version when none was set', () => {
      const start: AppState = { ...selectedState(), activeApiVersion: null };
      const next = selectionReducer(start, {
        type: 'API_VERSION_UNAVAILABLE',
        attempted: V1,
      });
      expect(next.activeApiVersion).toBeNull();
    });
  });

  describe('NAVIGATED (Req 18.1)', () => {
    it('changes the route only', () => {
      const next = selectionReducer(selectedState(), {
        type: 'NAVIGATED',
        view: 'qa',
      });
      expect(next.route).toBe('qa');
    });

    it('preserves the Active_Workspace and Active_API_Version across navigation', () => {
      const next = selectionReducer(selectedState(), {
        type: 'NAVIGATED',
        view: 'search',
      });
      expect(next.activeWorkspaceId).toBe('ws-1');
      expect(next.activeApiVersion).toEqual(V1);
    });

    it('returns the same reference when navigating to the current view', () => {
      const start = selectedState();
      const next = selectionReducer(start, {
        type: 'NAVIGATED',
        view: 'api-browser',
      });
      expect(next).toBe(start);
    });
  });

  it('ignores unrelated actions, preserving the selection', () => {
    const start = selectedState();
    const next = selectionReducer(start, { type: 'SIGNED_OUT' });
    expect(next).toBe(start);
  });
});
