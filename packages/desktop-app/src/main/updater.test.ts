/**
 * Integration test for the update-available notification flow (Req 19.4),
 * exercising the *injectable core* of the updater rather than the production
 * `require`-based wiring.
 *
 * Task 12.2: instead of mocking the `electron`/`electron-updater` modules, this
 * drives {@link createUpdater} with in-memory fakes:
 *
 *  - a fake {@link AppVersionProvider} for the version surface (Req 19.3),
 *  - a fake {@link AutoUpdaterLike} (a real EventEmitter) that can `emit`
 *    `update-available` with a raw `electron-updater` payload, and
 *  - a spy `notify` callback standing in for the `onUpdateAvailable` bridge.
 *
 * It asserts that `start()` registers the listener, disables `autoDownload`
 * (notify-only — no forced install, Req 19.4), and that emitting
 * `update-available` forwards a normalized {@link UpdateAvailableNotification}
 * to the renderer. It also covers {@link toUpdateNotification} normalization
 * directly (string vs array release notes, missing optional fields).
 */

import { EventEmitter } from 'events';
import {
  createUpdater,
  wireUpdateAvailable,
  toUpdateNotification,
  type AppVersionProvider,
  type AutoUpdaterLike,
  type RawUpdateInfo,
  type UpdateAvailableNotification,
} from './updater';

/**
 * A controllable stand-in for `electron-updater`'s `autoUpdater`, built on a
 * real EventEmitter so `on`/`emit` behave exactly like the library, plus the
 * `autoDownload` flag and a spy `checkForUpdates`.
 */
type FakeAutoUpdater = EventEmitter &
  AutoUpdaterLike & { autoDownload: boolean; checkForUpdates: jest.Mock };

function makeFakeAutoUpdater(): FakeAutoUpdater {
  const emitter = new EventEmitter() as FakeAutoUpdater;
  emitter.autoDownload = true;
  emitter.checkForUpdates = jest.fn().mockResolvedValue(undefined);
  return emitter;
}

/** A fake version provider standing in for Electron's `app` (Req 19.3). */
function makeAppVersionProvider(version: string): AppVersionProvider {
  return { getVersion: () => version };
}

describe('createUpdater — update-available notifies the renderer (Req 19.4)', () => {
  it('exposes the injected build version (Req 19.3)', () => {
    const updater = createUpdater({
      app: makeAppVersionProvider('1.2.3'),
      autoUpdater: makeFakeAutoUpdater(),
      notify: jest.fn(),
    });

    expect(updater.getVersion()).toBe('1.2.3');
  });

  it('registers the update-available listener and disables autoDownload on start()', () => {
    const autoUpdater = makeFakeAutoUpdater();
    const notify = jest.fn();
    const updater = createUpdater({
      app: makeAppVersionProvider('1.0.0'),
      autoUpdater,
      notify,
    });

    // Nothing wired until start() is called.
    expect(autoUpdater.listenerCount('update-available')).toBe(0);
    expect(autoUpdater.autoDownload).toBe(true);

    updater.start();

    // A single listener is registered and a check is kicked off.
    expect(autoUpdater.listenerCount('update-available')).toBe(1);
    expect(autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1);

    // Notify-only: an available update must not be auto-downloaded (Req 19.4).
    expect(autoUpdater.autoDownload).toBe(false);

    // No notification until the updater actually reports one.
    expect(notify).not.toHaveBeenCalled();
  });

  it('forwards a normalized notification to the spy callback when update-available fires', () => {
    const autoUpdater = makeFakeAutoUpdater();
    const notify = jest.fn<void, [UpdateAvailableNotification]>();
    const updater = createUpdater({
      app: makeAppVersionProvider('1.0.0'),
      autoUpdater,
      notify,
    });

    updater.start();

    const raw: RawUpdateInfo = {
      version: '1.4.0',
      releaseName: 'Spring Release',
      releaseNotes: 'Bug fixes and improvements.',
    };
    autoUpdater.emit('update-available', raw);

    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith({
      version: '1.4.0',
      releaseName: 'Spring Release',
      releaseNotes: 'Bug fixes and improvements.',
    });
  });

  it('registers the listener only once even if start() is called repeatedly', () => {
    const autoUpdater = makeFakeAutoUpdater();
    const notify = jest.fn<void, [UpdateAvailableNotification]>();
    const updater = createUpdater({
      app: makeAppVersionProvider('1.0.0'),
      autoUpdater,
      notify,
    });

    updater.start();
    updater.start();

    expect(autoUpdater.listenerCount('update-available')).toBe(1);
    expect(autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1);

    autoUpdater.emit('update-available', { version: '3.1.0' } satisfies RawUpdateInfo);

    // A single emission yields a single notification — no duplicate listeners.
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith({ version: '3.1.0' });
  });

  it('does not crash when checkForUpdates rejects (best-effort, notify-only)', async () => {
    const autoUpdater = makeFakeAutoUpdater();
    autoUpdater.checkForUpdates.mockRejectedValueOnce(new Error('offline'));
    const updater = createUpdater({
      app: makeAppVersionProvider('1.0.0'),
      autoUpdater,
      notify: jest.fn(),
    });

    expect(() => updater.start()).not.toThrow();
    // Let the ignored rejection settle without an unhandled rejection.
    await Promise.resolve();
  });
});

describe('wireUpdateAvailable — notify-only wiring (Req 19.4)', () => {
  it('disables autoDownload and forwards normalized notifications', () => {
    const autoUpdater = makeFakeAutoUpdater();
    const notify = jest.fn<void, [UpdateAvailableNotification]>();

    wireUpdateAvailable(autoUpdater, notify);

    expect(autoUpdater.autoDownload).toBe(false);

    autoUpdater.emit('update-available', {
      version: '2.5.0',
      releaseName: 'Autumn',
    } satisfies RawUpdateInfo);

    expect(notify).toHaveBeenCalledWith({ version: '2.5.0', releaseName: 'Autumn' });
  });
});

describe('toUpdateNotification — release-notes normalization (Req 19.4)', () => {
  it('passes through string release notes and a release name', () => {
    expect(
      toUpdateNotification({
        version: '1.4.0',
        releaseName: 'Spring Release',
        releaseNotes: 'Bug fixes and improvements.',
      }),
    ).toEqual({
      version: '1.4.0',
      releaseName: 'Spring Release',
      releaseNotes: 'Bug fixes and improvements.',
    });
  });

  it('joins array-form release notes into a single string', () => {
    expect(
      toUpdateNotification({
        version: '2.0.0',
        releaseNotes: [{ note: 'First change' }, { note: 'Second change' }],
      }),
    ).toEqual({ version: '2.0.0', releaseNotes: 'First change\nSecond change' });
  });

  it('omits missing optional fields rather than emitting undefined values', () => {
    const result = toUpdateNotification({ version: '3.1.0' });

    expect(result).toEqual({ version: '3.1.0' });
    expect('releaseName' in result).toBe(false);
    expect('releaseNotes' in result).toBe(false);
  });

  it('drops empty and non-string array entries and empty release names', () => {
    expect(
      toUpdateNotification({
        version: '4.0.0',
        releaseName: '',
        releaseNotes: [{ note: 'Kept' }, { note: '' }, { note: null }, {}],
      }),
    ).toEqual({ version: '4.0.0', releaseNotes: 'Kept' });
  });

  it('defaults a missing version to an empty string', () => {
    expect(toUpdateNotification({})).toEqual({ version: '' });
  });
});
