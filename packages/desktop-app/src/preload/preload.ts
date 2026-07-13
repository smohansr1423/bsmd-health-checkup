/**
 * Preload bridge — Req 4.1, 4.2.
 *
 * This is the ONLY code that spans the Electron main ↔ renderer boundary. It
 * runs in the isolated preload context (with `contextIsolation: true`,
 * `nodeIntegration: false`, `sandbox: true`) and uses `contextBridge` to expose
 * a single, frozen `window.copilot` object of named, typed methods to the
 * renderer.
 *
 * Security invariants this file upholds:
 *
 *  - The renderer receives ONLY the {@link CopilotBridge} surface — never raw
 *    `ipcRenderer`, never Node globals, never a `require`. Each method forwards
 *    to a fixed, whitelisted IPC channel from {@link IPC_CHANNELS}; the renderer
 *    can neither pick an arbitrary channel nor reach the transport directly.
 *  - The Session_Token is never exposed. Token custody lives entirely in the
 *    main process (see `main/secure-store.ts` and `main/ipc-handlers.ts`); the
 *    renderer builds token-less {@link RequestDescriptor}s and gets back
 *    {@link SanitizedResponse}s, so no method here can read or return the token
 *    (Req 4.1, 4.2).
 *  - The exposed object is frozen so the renderer cannot monkey-patch a method
 *    to intercept traffic.
 *
 * Testability: the bridge is built by the pure {@link createCopilotBridge}
 * factory from a minimal {@link IpcRendererLike} seam, so its channel routing
 * and unsubscribe behavior can be unit-tested with an in-memory fake without
 * Electron. Production wiring ({@link installCopilotBridge}) lazily `require`s
 * `electron`, so this module carries no static dependency on it and can be
 * imported in plain Node.
 */

import {
  IPC_CHANNELS,
  type CopilotBridge,
  type RequestDescriptor,
  type SanitizedResponse,
  type SetBaseUrlResult,
  type UpdateAvailableNotification,
  type WindowBounds,
} from '../shared-ipc/contract';

// ---------------------------------------------------------------------------
// Minimal Electron seams (declared locally, no static `electron` dependency)
// ---------------------------------------------------------------------------

/**
 * The minimal slice of Electron's `ipcRenderer` the bridge depends on. Declared
 * structurally so tests can pass an in-memory fake and this module never needs
 * the `electron` types at compile time.
 */
export interface IpcRendererLike {
  /** Request/response call to a main-process `ipcMain.handle` channel. */
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
  /** Subscribe to a main → renderer `send` channel. */
  on(
    channel: string,
    listener: (event: unknown, ...args: unknown[]) => void,
  ): unknown;
  /** Remove a previously-registered listener (used to unsubscribe). */
  removeListener(
    channel: string,
    listener: (event: unknown, ...args: unknown[]) => void,
  ): unknown;
}

/** The minimal `contextBridge` surface used to publish `window.copilot`. */
export interface ContextBridgeLike {
  exposeInMainWorld(key: string, api: unknown): void;
}

/** The global key under which the bridge is exposed to the renderer. */
export const COPILOT_BRIDGE_KEY = 'copilot';

// ---------------------------------------------------------------------------
// Pure bridge factory (injectable, testable without Electron)
// ---------------------------------------------------------------------------

/**
 * Build the frozen {@link CopilotBridge} that becomes `window.copilot`.
 *
 * Every method forwards to a fixed channel from {@link IPC_CHANNELS}; there is
 * no pass-through that would let the renderer name an arbitrary channel or
 * touch `ipcRenderer` directly. The returned object is `Object.freeze`d so the
 * renderer cannot replace a method to intercept requests or responses.
 */
export function createCopilotBridge(ipcRenderer: IpcRendererLike): CopilotBridge {
  const bridge: CopilotBridge = {
    getBaseUrl(): Promise<string | null> {
      return ipcRenderer.invoke(IPC_CHANNELS.getBaseUrl) as Promise<
        string | null
      >;
    },

    setBaseUrl(candidate: string): Promise<SetBaseUrlResult> {
      return ipcRenderer.invoke(
        IPC_CHANNELS.setBaseUrl,
        candidate,
      ) as Promise<SetBaseUrlResult>;
    },

    secureRequest(descriptor: RequestDescriptor): Promise<SanitizedResponse> {
      return ipcRenderer.invoke(
        IPC_CHANNELS.secureRequest,
        descriptor,
      ) as Promise<SanitizedResponse>;
    },

    signOut(): Promise<void> {
      return ipcRenderer.invoke(IPC_CHANNELS.signOut) as Promise<void>;
    },

    persistWindowState(bounds: WindowBounds): Promise<void> {
      return ipcRenderer.invoke(
        IPC_CHANNELS.persistWindowState,
        bounds,
      ) as Promise<void>;
    },

    onUpdateAvailable(
      listener: (notification: UpdateAvailableNotification) => void,
    ): () => void {
      // Wrap the caller's listener so the raw IPC event object is never handed
      // to the renderer — it receives only the sanitized notification payload.
      const wrapped = (
        _event: unknown,
        ...args: unknown[]
      ): void => {
        listener(args[0] as UpdateAvailableNotification);
      };
      ipcRenderer.on(IPC_CHANNELS.updateAvailable, wrapped);
      // Return an unsubscribe handle so views can detach on unmount.
      return () => {
        ipcRenderer.removeListener(IPC_CHANNELS.updateAvailable, wrapped);
      };
    },
  };

  // Freeze so the renderer cannot monkey-patch a method to intercept traffic.
  return Object.freeze(bridge);
}

// ---------------------------------------------------------------------------
// Production wiring (lazy `require`, so the module compiles without electron)
// ---------------------------------------------------------------------------

/**
 * Publish the frozen `window.copilot` bridge into the renderer's main world via
 * `contextBridge`. Loads `electron` lazily so this module can be imported and
 * unit-tested in plain Node; call only from a preload script running inside
 * Electron.
 */
export function installCopilotBridge(): void {
  const { contextBridge, ipcRenderer } = require('electron') as {
    contextBridge: ContextBridgeLike;
    ipcRenderer: IpcRendererLike;
  };

  contextBridge.exposeInMainWorld(
    COPILOT_BRIDGE_KEY,
    createCopilotBridge(ipcRenderer),
  );
}

// Only wire the bridge when actually running inside an Electron renderer/preload
// context. Guard on `process.versions.electron` so importing this module in
// tests/tooling (plain Node) does not attempt to `require('electron')`.
if (
  typeof process !== 'undefined' &&
  process.versions &&
  (process.versions as { electron?: string }).electron
) {
  installCopilotBridge();
}
