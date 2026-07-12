/**
 * Unit tests for the navigation model (Task 13.1 — Req 18.3).
 */

import { SIGNED_IN_NAV_ITEMS, isViewReachable } from './navigation';
import type { SessionState, ViewId } from '../state/types';

const signedIn: SessionState = { status: 'signed_in', expiredNotice: false };
const signedOut: SessionState = { status: 'signed_out', expiredNotice: false };

describe('SIGNED_IN_NAV_ITEMS', () => {
  it('includes every authenticated view and excludes the auth entry points', () => {
    const views = SIGNED_IN_NAV_ITEMS.map((i) => i.view);
    expect(views).toEqual([
      'workspaces',
      'api-browser',
      'qa',
      'search',
      'testing-console',
      'code-gen',
      'history',
      'dashboard',
    ]);
    expect(views).not.toContain('sign-in');
    expect(views).not.toContain('sign-up');
  });
});

describe('isViewReachable', () => {
  it('allows every authenticated view while signed in (Req 18.3)', () => {
    for (const item of SIGNED_IN_NAV_ITEMS) {
      expect(isViewReachable(signedIn, item.view)).toBe(true);
    }
  });

  it('allows only the public views while signed out', () => {
    expect(isViewReachable(signedOut, 'sign-in')).toBe(true);
    expect(isViewReachable(signedOut, 'sign-up')).toBe(true);
    const gated: ViewId[] = ['workspaces', 'qa', 'dashboard'];
    for (const view of gated) {
      expect(isViewReachable(signedOut, view)).toBe(false);
    }
  });
});
