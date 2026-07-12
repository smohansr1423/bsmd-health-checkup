/**
 * Updater & Version surface (main process) — Req 19.3, 19.4.
 *
 * Two responsibilities, both confined to the Electron MAIN process:
 *
 *  1. Version surface (Req 19.3): expose the installed build's version
 *     identifier — `app.getVersion()` in production — so a renderer
 *     "About"/status surface can display which build is running.
 *
 *  2. Update notification (Req 19.4): wire `electron-updater` so that when its
 *     `update-available` event fires, the renderer is *notified* (via the
 *     preload bridge's `onUpdateAvailable`) to show a non-blocking banner. The
 *     MVP only notifies — it never forces a download or install.
 *
 * Testability: like {@link ../main/secure-store}, every Electron/native
 * dependency is expressed as a small interface and injected through
 * {@link createUpdater}. Tests supply in-memory fakes (a version provider and
 * a fake auto-updater that emits `update-available`); production wiring uses
 * {@link createDefaultUpdater}, which lazily `require`s `electron` and
 * `electron-updater` so this module carries no static dependency on either and
 * can be imported and unit-tested without them installed.
 */

import type { UpdateAvailableNotification } from '../shared-ipc/contract';

/**
 * The sanitized update notification handed to the renderer. Sourced from the
 * shared IPC contract so the main process, preload bridge, and renderer all
 * agree on the `update-available` payload (Req 19.4). It carries only
 * non-sensitive, display-oriented fields — never a token or credential.
 *
 * Re-exported here for convenience so main-process consumers (and tests) can
 * import it alongside the updater's own types.
 */
export type { UpdateAvailableNotification } from '../shared-ipc/contract';

/**
 * Callback invoked when an update becomes available. In production this is the
 * bridge method that forwards the notification to the renderer
 * (`onUpdateAvailable`) so it can render a non-blocking banner (Req 19.4).
 */
export type NotifyUpdateAvailable = (info: UpdateAvailableNotification) => void;

/**
 * Minimal shape of Electron's `app` used here. Declared locally so this module
 * does not statically depend on the `electron` types.
 */
export interface AppVersionProvider {
  /** Return the installed build's version identifier (Req 19.3). */
  getVersion(): string;
}

/**
 * The raw payload `electron-updater` passes to an `update-available` listener.
 * Only the fields this module reads are declared; all are optional because the
 * shape varies by updater version and provider.
 */
export interface RawUpdateInfo {
  version?: string;
  releaseName?: string | null;
  releaseNotes?: string | Array<{ note?: string | null }> | null;
}

/**
 * Minimal shape of `electron-updater`'s `autoUpdater`. Declared locally so this
 * module does not statically depend on `electron-updater`. Only the members
 * used for notify-only behavior are included.
 */
export interface AutoUpdaterLike {
  /** Register an event listener; we listen for `'update-available'`. */
  on(event: 'update-available', listener: (info: RawUpdateInfo) => void): unknown;
  /**
   * Begin checking for updates. Returns a promise in `electron-updater`; we
   * ignore the result because the MVP only notifies via the event.
   */
  checkForUpdates?(): Promise<unknown> | unknown;
  /**
   * When false, an available update is not downloaded automatically. Set to
   * false so the MVP only notifies and never forces an install (Req 19.4).
   */
  autoDownload?: boolean;
}

/** Dependencies injected into {@link createUpdater}. */
export interface UpdaterDeps {
  /** Provides the installed build version (Electron's `app` in production). */
  app: AppVersionProvider;
  /** The auto-updater whose `update-available` event drives notifications. */
  autoUpdater: AutoUpdaterLike;
  /** Invoked (once per available update) to notify the renderer. */
  notify: NotifyUpdateAvailable;
}

/** The public surface of the updater service used by main-process wiring. */
export interface Updater {
  /** The installed build's version identifier (Req 19.3). */
  getVersion(): string;
  /**
   * Register the `update-available` listener and begin checking for updates.
   * Idempotent: calling it more than once registers the listener only once.
   */
  start(): void;
}

/**
 * Normalize `electron-updater`'s raw update payload into the sanitized
 * {@link UpdateAvailableNotification} sent to the renderer.
 *
 * `releaseNotes` may be a string or an array of `{ note }` objects depending on
 * the provider; both are reduced to a single string. Missing fields are
 * dropped rather than surfaced as `undefined` values.
 */
export function toUpdateNotification(info: RawUpdateInfo): UpdateAvailableNotification {
  const notification: UpdateAvailableNotification = {
    version: typeof info.version === 'string' ? info.version : '',
  };

  if (typeof info.releaseName === 'string' && info.releaseName.length > 0) {
    notification.releaseName = info.releaseName;
  }

  const notes = normalizeReleaseNotes(info.releaseNotes);
  if (notes !== undefined) {
    notification.releaseNotes = notes;
  }

  return notification;
}

/** Reduce the polymorphic `releaseNotes` field to a single string, if present. */
function normalizeReleaseNotes(
  releaseNotes: RawUpdateInfo['releaseNotes'],
): string | undefined {
  if (typeof releaseNotes === 'string') {
    return releaseNotes.length > 0 ? releaseNotes : undefined;
  }
  if (Array.isArray(releaseNotes)) {
    const joined = releaseNotes
      .map((entry) => (typeof entry?.note === 'string' ? entry.note : ''))
      .filter((note) => note.length > 0)
      .join('\n');
    return joined.length > 0 ? joined : undefined;
  }
  return undefined;
}

/**
 * Wire an auto-updater's `update-available` event to a renderer-notify
 * callback (Req 19.4). This is the pure, injectable core: given any
 * {@link AutoUpdaterLike} and a {@link NotifyUpdateAvailable}, it registers a
 * listener that normalizes the payload and forwards it. Exposed separately so
 * tests can drive it with a fake updater that simply emits the event.
 *
 * The MVP is notify-only: this disables `autoDownload` and never triggers an
 * install.
 */
export function wireUpdateAvailable(
  autoUpdater: AutoUpdaterLike,
  notify: NotifyUpdateAvailable,
): void {
  // Notify only — do not auto-download or force an install (Req 19.4).
  if ('autoDownload' in autoUpdater) {
    autoUpdater.autoDownload = false;
  }
  autoUpdater.on('update-available', (info: RawUpdateInfo) => {
    notify(toUpdateNotification(info));
  });
}

/**
 * Create an {@link Updater} from injected backends.
 *
 * `getVersion` reads straight through to the injected app provider (Req 19.3).
 * `start` wires the `update-available` event once and kicks off a check;
 * subsequent calls are no-ops so the listener is never registered twice.
 */
export function createUpdater(deps: UpdaterDeps): Updater {
  let started = false;

  return {
    getVersion(): string {
      return deps.app.getVersion();
    },

    start(): void {
      if (started) {
        return;
      }
      started = true;

      wireUpdateAvailable(deps.autoUpdater, deps.notify);

      // Kick off a check; the MVP reacts only to the `update-available`
      // event, so the promise result is intentionally ignored. Any rejection
      // (e.g. no network) must not crash the main process.
      if (typeof deps.autoUpdater.checkForUpdates === 'function') {
        try {
          const result = deps.autoUpdater.checkForUpdates();
          if (result && typeof (result as Promise<unknown>).catch === 'function') {
            (result as Promise<unknown>).catch(() => {
              // Ignored: update checks are best-effort and notify-only.
            });
          }
        } catch {
          // Ignored: a failed check must never break startup.
        }
      }
    },
  };
}

/**
 * Production wiring: build an {@link Updater} backed by Electron's `app` (for
 * the version) and `electron-updater`'s `autoUpdater` (for the
 * `update-available` event), forwarding notifications through the supplied
 * bridge callback.
 *
 * `electron` and `electron-updater` are loaded lazily via `require` so this
 * module can be imported and unit-tested without either package installed.
 * Call this only from the Electron main process.
 */
export function createDefaultUpdater(notify: NotifyUpdateAvailable): Updater {
  const electron = require('electron') as { app: AppVersionProvider };
  const { autoUpdater } = require('electron-updater') as {
    autoUpdater: AutoUpdaterLike;
  };

  return createUpdater({
    app: electron.app,
    autoUpdater,
    notify,
  });
}
