/**
 * Integration test for the update-available notification flow (Req 19.4).
 *
 * Task 15.2: mock `electron-updater` (and `electron`) so that
 * {@link createDefaultUpdater} — the production wiring — resolves them via its
 * lazy `require`, then have the mocked auto-updater emit `update-available` and
 * assert the renderer-notify callback (the `onUpdateAvailable` bridge in
 * production) is invoked with the sanitized notification.
 *
 * Both `electron` and `electron-updater` are declared as *virtual* mocks
 * because neither package is installed in this workspace; `updater.ts` only
 * ever `require`s them lazily, so the virtual mocks fully satisfy the wiring.
 */

import { EventEmitter } from 'events';
import type { AutoUpdaterLike, RawUpdateInfo, UpdateAvailableNotification } from './updater';

/**
 * A controllable stand-in for `electron-updater`'s `autoUpdater`. It is a real
 * EventEmitter (so `on`/`emit` behave exactly like the library) augmented with
 * the `autoDownload` flag and a spy `checkForUpdates`. The `mock` name prefix
 * lets the jest.mock factory reference it despite hoisting.
 */
const mockAutoUpdater = new EventEmitter() as EventEmitter &
  AutoUpdaterLike & { autoDownload: boolean; checkForUpdates: jest.Mock };
mockAutoUpdater.autoDownload = true;
mockAutoUpdater.checkForUpdates = jest.fn().mockResolvedValue(undefined);

jest.mock('electron-updater', () => ({ autoUpdater: mockAutoUpdater }), {
  virtual: true,
});
jest.mock('electron', () => ({ app: { getVersion: () => '1.2.3' } }), {
  virtual: true,
});

// Imported after the mocks are registered so the lazy requires resolve to them.
import { createDefaultUpdater } from './updater';

describe('updater integration — update-available notifies the renderer (Req 19.4)', () => {
  beforeEach(() => {
    mockAutoUpdater.removeAllListeners();
    mockAutoUpdater.autoDownload = true;
    mockAutoUpdater.checkForUpdates.mockClear();
  });

  it('forwards a sanitized notification to the renderer when electron-updater emits update-available', () => {
    const notifications: UpdateAvailableNotification[] = [];
    const updater = createDefaultUpdater((info) => notifications.push(info));

    // Version surface is wired through electron's app.getVersion() (Req 19.3).
    expect(updater.getVersion()).toBe('1.2.3');

    updater.start();

    // Notify-only: an available update must not be auto-downloaded (Req 19.4).
    expect(mockAutoUpdater.autoDownload).toBe(false);
    expect(mockAutoUpdater.checkForUpdates).toHaveBeenCalledTimes(1);

    // No notification until electron-updater actually reports an update.
    expect(notifications).toHaveLength(0);

    const raw: RawUpdateInfo = {
      version: '1.4.0',
      releaseName: 'Spring Release',
      releaseNotes: 'Bug fixes and improvements.',
    };
    mockAutoUpdater.emit('update-available', raw);

    // The renderer bridge is notified exactly once with the sanitized payload.
    expect(notifications).toEqual([
      {
        version: '1.4.0',
        releaseName: 'Spring Release',
        releaseNotes: 'Bug fixes and improvements.',
      },
    ]);
  });

  it('normalizes array-form release notes and omits missing optional fields', () => {
    const notifications: UpdateAvailableNotification[] = [];
    const updater = createDefaultUpdater((info) => notifications.push(info));
    updater.start();

    mockAutoUpdater.emit('update-available', {
      version: '2.0.0',
      releaseNotes: [{ note: 'First change' }, { note: 'Second change' }],
    } satisfies RawUpdateInfo);

    expect(notifications).toEqual([
      { version: '2.0.0', releaseNotes: 'First change\nSecond change' },
    ]);
  });

  it('registers the listener only once even if start is called repeatedly', () => {
    const notifications: UpdateAvailableNotification[] = [];
    const updater = createDefaultUpdater((info) => notifications.push(info));

    updater.start();
    updater.start();

    expect(mockAutoUpdater.checkForUpdates).toHaveBeenCalledTimes(1);

    mockAutoUpdater.emit('update-available', { version: '3.1.0' } satisfies RawUpdateInfo);

    // A single emission yields a single notification — no duplicate listeners.
    expect(notifications).toEqual([{ version: '3.1.0' }]);
  });
});
