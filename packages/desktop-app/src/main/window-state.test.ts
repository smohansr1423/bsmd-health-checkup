/**
 * Unit tests for the pure window-state logic (Req 18.2, 18.4): bounds
 * sanitization, restore geometry, persistence round-trip via an in-memory
 * fake, in-flight request tracking, and the close decision.
 */

import { DEFAULT_WINDOW_BOUNDS, WindowBounds } from './app-config';
import {
  BrowserWindowLike,
  InFlightRequestTracker,
  WindowBoundsPersistence,
  WindowStateManager,
  boundsFromWindow,
  decideClose,
  sanitizeBounds,
} from './window-state';

/** In-memory persistence so tests never touch the filesystem. */
function inMemoryPersistence(
  initial: WindowBounds = DEFAULT_WINDOW_BOUNDS,
): WindowBoundsPersistence & { peek(): WindowBounds } {
  let store: WindowBounds = { ...initial };
  return {
    loadBounds: () => ({ ...store }),
    saveBounds: (bounds) => {
      store = { ...bounds };
    },
    peek: () => ({ ...store }),
  };
}

/** Minimal fake window returning fixed geometry / maximized state. */
function fakeWindow(
  bounds: { x: number; y: number; width: number; height: number },
  maximized: boolean,
): BrowserWindowLike {
  return {
    getBounds: () => ({ ...bounds }),
    isMaximized: () => maximized,
  };
}

describe('sanitizeBounds', () => {
  it('fills missing fields from defaults', () => {
    expect(sanitizeBounds({})).toEqual(DEFAULT_WINDOW_BOUNDS);
    expect(sanitizeBounds(null)).toEqual(DEFAULT_WINDOW_BOUNDS);
    expect(sanitizeBounds(undefined)).toEqual(DEFAULT_WINDOW_BOUNDS);
  });

  it('rejects non-finite numbers and floors size to a minimum', () => {
    expect(sanitizeBounds({ width: NaN, height: 0 })).toMatchObject({
      width: DEFAULT_WINDOW_BOUNDS.width,
      height: 1,
    });
    expect(sanitizeBounds({ width: -50 })).toMatchObject({ width: 1 });
  });

  it('rounds fractional coordinates and preserves the maximized flag', () => {
    expect(sanitizeBounds({ x: 10.7, y: -3.2, maximized: true })).toMatchObject({
      x: 11,
      y: -3,
      maximized: true,
    });
  });
});

describe('boundsFromWindow', () => {
  it('captures live geometry when not maximized', () => {
    const win = fakeWindow({ x: 100, y: 200, width: 800, height: 600 }, false);
    expect(boundsFromWindow(win, DEFAULT_WINDOW_BOUNDS)).toEqual({
      x: 100,
      y: 200,
      width: 800,
      height: 600,
      maximized: false,
    });
  });

  it('keeps the previous restore geometry while maximized', () => {
    const previous: WindowBounds = {
      x: 50,
      y: 60,
      width: 1024,
      height: 768,
      maximized: false,
    };
    const win = fakeWindow({ x: 0, y: 0, width: 3840, height: 2160 }, true);
    expect(boundsFromWindow(win, previous)).toEqual({ ...previous, maximized: true });
  });
});

describe('WindowStateManager', () => {
  it('restores persisted bounds on construction', () => {
    const stored: WindowBounds = {
      x: 12,
      y: 34,
      width: 900,
      height: 700,
      maximized: true,
    };
    const manager = new WindowStateManager(inMemoryPersistence(stored));
    expect(manager.getBounds()).toEqual(stored);
    expect(manager.shouldStartMaximized()).toBe(true);
  });

  it('captures and persists live geometry (round-trip)', () => {
    const persistence = inMemoryPersistence();
    const manager = new WindowStateManager(persistence);
    const win = fakeWindow({ x: 5, y: 6, width: 1200, height: 900 }, false);

    manager.capture(win);

    const expected: WindowBounds = {
      x: 5,
      y: 6,
      width: 1200,
      height: 900,
      maximized: false,
    };
    expect(persistence.peek()).toEqual(expected);
    // A new manager loading from the same store restores identical bounds.
    expect(new WindowStateManager(persistence).getBounds()).toEqual(expected);
  });
});

describe('InFlightRequestTracker', () => {
  it('tracks outstanding requests and never drops below zero', () => {
    const tracker = new InFlightRequestTracker();
    expect(tracker.hasInFlight()).toBe(false);

    tracker.begin();
    tracker.begin();
    expect(tracker.inFlight).toBe(2);
    expect(tracker.hasInFlight()).toBe(true);

    tracker.end();
    expect(tracker.hasInFlight()).toBe(true);
    tracker.end();
    tracker.end(); // unmatched end is harmless
    expect(tracker.inFlight).toBe(0);
    expect(tracker.hasInFlight()).toBe(false);
  });
});

describe('decideClose', () => {
  it('quits immediately when nothing is in flight', () => {
    expect(decideClose(false, false)).toEqual({ action: 'quit' });
  });

  it('prompts for confirmation when a request is in flight', () => {
    expect(decideClose(true, false)).toEqual({ action: 'confirm' });
  });

  it('quits without prompting once the user has confirmed', () => {
    expect(decideClose(true, true)).toEqual({ action: 'quit' });
  });
});
