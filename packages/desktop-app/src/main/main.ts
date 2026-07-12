/**
 * Electron MAIN process entry point — app lifecycle, single-instance lock, and
 * window creation/restoration (Req 18.2, 18.4).
 *
 * Electron is loaded lazily via `require('electron')` (typed against the local
 * shims below) so this module — and the rest of `src/main` — can be compiled
 * and unit-tested without the `electron` package installed. The testable logic
 * (bounds sanitization, restore geometry, in-flight tracking, close decision)
 * lives in {@link file://./window-state.ts}; this file is the thin wiring that
 * connects that logic to real Electron events.
 *
 * NOTE: secure IPC (the preload bridge, request broker, secure store, and
 * updater wiring) is completed in a later task; this file establishes the
 * window lifecycle and the hooks those pieces plug into (the exported
 * {@link inFlightRequests} tracker and the close-confirmation channel).
 */

import * as path from 'path';

import {
  AppConfigStore,
  configFilePath,
  createFileConfigPersistence,
} from './app-config';
import {
  InFlightRequestTracker,
  WindowStateManager,
  createConfigBackedBoundsPersistence,
  decideClose,
} from './window-state';

// ---------------------------------------------------------------------------
// Local Electron type shims
//
// The `electron` package is not a static dependency of this module, so we
// declare only the minimal surface we use. `require('electron')` is cast to
// this shape at runtime inside the Electron process.
// ---------------------------------------------------------------------------

interface WebContentsLike {
  send(channel: string, ...args: unknown[]): void;
}

interface BrowserWindowLike {
  readonly webContents: WebContentsLike;
  getBounds(): { x: number; y: number; width: number; height: number };
  isMaximized(): boolean;
  maximize(): void;
  show(): void;
  focus(): void;
  restore(): void;
  isMinimized(): boolean;
  close(): void;
  destroy(): void;
  loadFile(filePath: string): Promise<void>;
  on(event: string, listener: (...args: unknown[]) => void): void;
}

interface BrowserWindowConstructorOptions {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  show?: boolean;
  webPreferences?: {
    preload?: string;
    contextIsolation?: boolean;
    nodeIntegration?: boolean;
    sandbox?: boolean;
    webSecurity?: boolean;
  };
}

interface BrowserWindowStatic {
  new (options?: BrowserWindowConstructorOptions): BrowserWindowLike;
}

interface IpcMainLike {
  on(
    channel: string,
    listener: (event: unknown, ...args: unknown[]) => void,
  ): void;
}

interface AppLike {
  getPath(name: 'userData'): string;
  getVersion(): string;
  whenReady(): Promise<void>;
  requestSingleInstanceLock(): boolean;
  quit(): void;
  on(event: string, listener: (...args: unknown[]) => void): void;
}

interface ElectronModule {
  app: AppLike;
  BrowserWindow: BrowserWindowStatic;
  ipcMain: IpcMainLike;
}

// ---------------------------------------------------------------------------
// IPC channels for the close-confirmation flow (Req 18.4)
// ---------------------------------------------------------------------------

/** Main → renderer: a close was attempted while requests are in flight. */
export const CLOSE_CONFIRM_REQUEST = 'window:close-confirm-request';
/** Renderer → main: the user's confirm/cancel decision. */
export const CLOSE_CONFIRM_RESPONSE = 'window:close-confirm-response';

/**
 * Tracks outstanding backend requests. The request broker (wired in a later
 * task) calls `begin()`/`end()` around each `secureRequest`; the close handler
 * consults `hasInFlight()` to decide whether to prompt (Req 18.4).
 */
export const inFlightRequests = new InFlightRequestTracker();

/** Debounce helper so a burst of move/resize events persists at most once. */
function debounce(fn: () => void, delayMs: number): () => void {
  let handle: ReturnType<typeof setTimeout> | null = null;
  return () => {
    if (handle !== null) {
      clearTimeout(handle);
    }
    handle = setTimeout(() => {
      handle = null;
      fn();
    }, delayMs);
  };
}

/** Module-level references, set once the app is ready. */
let mainWindow: BrowserWindowLike | null = null;
let windowState: WindowStateManager | null = null;
/** Set true once the user confirms closing, so the retry close bypasses the prompt. */
let confirmedQuit = false;

/**
 * Create the main window, restoring persisted bounds (Req 18.2) and wiring the
 * geometry-persistence and close-confirmation handlers (Req 18.4).
 */
function createMainWindow(electron: ElectronModule): BrowserWindowLike {
  const { app, BrowserWindow } = electron;

  const configStore = new AppConfigStore(
    createFileConfigPersistence(configFilePath(app.getPath('userData'))),
  );
  windowState = new WindowStateManager(
    createConfigBackedBoundsPersistence(configStore),
  );

  const bounds = windowState.getBounds();
  const win = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  if (windowState.shouldStartMaximized()) {
    win.maximize();
  }

  // Persist geometry on move/resize (debounced) and on maximize/unmaximize.
  const persistBounds = debounce(() => {
    if (windowState !== null) {
      windowState.capture(win);
    }
  }, 250);
  win.on('move', persistBounds);
  win.on('resize', persistBounds);
  win.on('maximize', () => windowState?.capture(win));
  win.on('unmaximize', () => windowState?.capture(win));

  // Close confirmation while requests are in flight (Req 18.4).
  win.on('close', (...args: unknown[]) => {
    const event = args[0] as { preventDefault(): void } | undefined;
    const decision = decideClose(inFlightRequests.hasInFlight(), confirmedQuit);
    if (decision.action === 'confirm') {
      event?.preventDefault();
      win.webContents.send(CLOSE_CONFIRM_REQUEST);
    }
  });

  win.on('ready-to-show', () => win.show());

  // Load the renderer entry (produced by the renderer build in a later task).
  void win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  return win;
}

/**
 * Register the renderer's confirm/cancel response for the close flow. When the
 * user confirms, mark the quit as confirmed and re-issue the close so it passes
 * the guard; otherwise the window stays open (Req 18.4).
 */
function wireCloseConfirmation(electron: ElectronModule): void {
  electron.ipcMain.on(
    CLOSE_CONFIRM_RESPONSE,
    (_event: unknown, ...args: unknown[]) => {
      const confirmed = args[0] === true;
      if (confirmed && mainWindow !== null) {
        confirmedQuit = true;
        mainWindow.close();
      }
    },
  );
}

/**
 * Bootstrap the application. Enforces a single-instance lock so window state is
 * owned by exactly one process; a second launch focuses the existing window
 * instead of opening another (Req 18.2).
 */
export function bootstrap(): void {
  // Loaded lazily so importing this module never requires `electron` to exist.
  const electron = require('electron') as ElectronModule;
  const { app } = electron;

  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    app.quit();
    return;
  }

  app.on('second-instance', () => {
    if (mainWindow === null) {
      return;
    }
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.focus();
  });

  wireCloseConfirmation(electron);

  void app.whenReady().then(() => {
    mainWindow = createMainWindow(electron);

    app.on('activate', () => {
      // macOS: re-create the window when the dock icon is clicked and none exist.
      if (mainWindow === null) {
        mainWindow = createMainWindow(electron);
      }
    });
  });

  app.on('window-all-closed', () => {
    // Standard cross-platform behavior: quit on non-macOS platforms.
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
}

// Only bootstrap when actually running inside Electron. Guard on the presence
// of `process.versions.electron` so importing this module in tests/tooling
// (plain Node) does not attempt to `require('electron')`.
if (process.versions && (process.versions as { electron?: string }).electron) {
  bootstrap();
}
