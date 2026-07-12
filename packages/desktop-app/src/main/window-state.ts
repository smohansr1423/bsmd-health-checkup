/**
 * Window State & Lifecycle (main process) — Req 18.2, 18.4.
 *
 * This module lives in the Electron MAIN process but is deliberately
 * Electron-free at the type level so its logic can be unit- and
 * property-tested in isolation (see Property 21: window-bounds round-trip).
 * The Electron wiring lives in {@link file://./main.ts} and calls into the
 * pure helpers exported here.
 *
 * Two concerns are handled:
 *  1. **Bounds persistence (Req 18.2)** — window size/position/maximized state
 *     is persisted on move/resize and restored on the next launch. Persistence
 *     is expressed as the injectable {@link WindowBoundsPersistence} interface
 *     so tests can substitute an in-memory fake; production wiring backs it
 *     with the existing {@link AppConfigStore} (see
 *     {@link createConfigBackedBoundsPersistence}).
 *  2. **Close confirmation (Req 18.4)** — an {@link InFlightRequestTracker}
 *     records outstanding backend requests so the lifecycle code can decide,
 *     on a close attempt, whether to `preventDefault` and ask the renderer to
 *     confirm before quitting.
 */

import {
  AppConfigStore,
  DEFAULT_WINDOW_BOUNDS,
  WindowBounds,
} from './app-config';

// Re-export the shared bounds type so consumers of window state can import it
// from a single place without also reaching into the config module.
export { WindowBounds, DEFAULT_WINDOW_BOUNDS };

/**
 * Injectable persistence for window bounds. The store loads the last known
 * bounds on launch and saves updated bounds on move/resize. Tests provide an
 * in-memory fake; production uses {@link createConfigBackedBoundsPersistence}.
 */
export interface WindowBoundsPersistence {
  /** Return the last persisted bounds (already sanitized by the store). */
  loadBounds(): WindowBounds;
  /** Persist the supplied bounds. */
  saveBounds(bounds: WindowBounds): void;
}

/**
 * Back {@link WindowBoundsPersistence} with the existing non-secret
 * {@link AppConfigStore}, reusing its file-persistence and the `window` field
 * of the persisted {@link AppConfig}. This keeps a single config file on disk
 * rather than introducing a second bounds file.
 */
export function createConfigBackedBoundsPersistence(
  configStore: AppConfigStore,
): WindowBoundsPersistence {
  return {
    loadBounds(): WindowBounds {
      return configStore.getConfig().window;
    },
    saveBounds(bounds: WindowBounds): void {
      configStore.setWindowBounds(bounds);
    },
  };
}

/** True iff the value is a finite number (rejects NaN and ±Infinity). */
function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Coerce an arbitrary candidate into valid {@link WindowBounds}, filling any
 * missing/invalid field from {@link DEFAULT_WINDOW_BOUNDS}. Width and height
 * are floored to a small minimum so a persisted zero/negative size can never
 * produce an unusable window on restore.
 */
export function sanitizeBounds(
  candidate: Partial<WindowBounds> | null | undefined,
): WindowBounds {
  const raw = candidate ?? {};
  const MIN_SIZE = 1;
  return {
    x: isFiniteNumber(raw.x) ? Math.round(raw.x) : DEFAULT_WINDOW_BOUNDS.x,
    y: isFiniteNumber(raw.y) ? Math.round(raw.y) : DEFAULT_WINDOW_BOUNDS.y,
    width: isFiniteNumber(raw.width)
      ? Math.max(MIN_SIZE, Math.round(raw.width))
      : DEFAULT_WINDOW_BOUNDS.width,
    height: isFiniteNumber(raw.height)
      ? Math.max(MIN_SIZE, Math.round(raw.height))
      : DEFAULT_WINDOW_BOUNDS.height,
    maximized:
      typeof raw.maximized === 'boolean'
        ? raw.maximized
        : DEFAULT_WINDOW_BOUNDS.maximized,
  };
}

/**
 * Minimal shape of Electron's `BrowserWindow` used to read geometry. Declared
 * locally so this module carries no static dependency on `electron`.
 */
export interface BrowserWindowLike {
  getBounds(): { x: number; y: number; width: number; height: number };
  isMaximized(): boolean;
}

/**
 * Derive the bounds to persist from a live window (Req 18.2).
 *
 * When the window is maximized, its reported geometry is the maximized frame,
 * which is a poor value to restore to un-maximized. So while maximized we keep
 * the previous normal (restore) geometry and only flip `maximized` to true.
 * When not maximized, we capture the current geometry and record
 * `maximized: false`.
 */
export function boundsFromWindow(
  win: BrowserWindowLike,
  previous: WindowBounds,
): WindowBounds {
  if (win.isMaximized()) {
    return { ...previous, maximized: true };
  }
  const current = win.getBounds();
  return sanitizeBounds({ ...current, maximized: false });
}

/**
 * Loads bounds on launch and persists them on move/resize/maximize changes.
 *
 * The manager holds the last known *normal* geometry so that, while the window
 * is maximized, move/resize events do not clobber the restore size. All
 * persistence goes through the injected {@link WindowBoundsPersistence}.
 */
export class WindowStateManager {
  private current: WindowBounds;

  constructor(private readonly persistence: WindowBoundsPersistence) {
    this.current = sanitizeBounds(persistence.loadBounds());
  }

  /** The bounds a freshly created window should be given (Req 18.2 restore). */
  getBounds(): WindowBounds {
    return { ...this.current };
  }

  /** True iff the restored window should start maximized. */
  shouldStartMaximized(): boolean {
    return this.current.maximized;
  }

  /**
   * Capture the live window's geometry and persist it. Call this from the
   * debounced `move`/`resize` handlers and from `maximize`/`unmaximize`.
   */
  capture(win: BrowserWindowLike): void {
    this.current = boundsFromWindow(win, this.current);
    this.persistence.saveBounds(this.current);
  }
}

/**
 * Tracks the number of outstanding backend requests so the lifecycle code can
 * decide whether a close attempt needs confirmation (Req 18.4).
 *
 * The request broker calls {@link begin} before issuing a request and
 * {@link end} when it settles (success or failure). {@link hasInFlight}
 * reports whether any request is still outstanding.
 */
export class InFlightRequestTracker {
  private count = 0;

  /** Record the start of a request; returns the new in-flight count. */
  begin(): number {
    this.count += 1;
    return this.count;
  }

  /**
   * Record the completion of a request; returns the new in-flight count.
   * Never drops below zero, so an unmatched `end` is harmless.
   */
  end(): number {
    this.count = Math.max(0, this.count - 1);
    return this.count;
  }

  /** Current number of outstanding requests. */
  get inFlight(): number {
    return this.count;
  }

  /** True iff at least one request is still outstanding (Req 18.4 trigger). */
  hasInFlight(): boolean {
    return this.count > 0;
  }
}

/**
 * Decide how a close attempt should proceed (Req 18.4).
 *
 * If any request is in flight, the caller must `preventDefault` the close and
 * ask the renderer to confirm; otherwise the app may quit immediately. The
 * `confirmedQuit` flag lets a second close attempt (after the user confirmed)
 * bypass the prompt.
 */
export function decideClose(
  hasInFlight: boolean,
  confirmedQuit: boolean,
): { action: 'quit' } | { action: 'confirm' } {
  if (confirmedQuit || !hasInFlight) {
    return { action: 'quit' };
  }
  return { action: 'confirm' };
}
