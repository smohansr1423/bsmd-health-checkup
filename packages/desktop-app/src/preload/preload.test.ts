/**
 * Unit tests for the pure preload bridge factory (Req 4.1, 4.2).
 *
 * These exercise the bridge's channel routing, argument forwarding, response
 * pass-through, event subscription/unsubscription, and the security invariants
 * (frozen object, no raw ipcRenderer / Node globals exposed) using an in-memory
 * fake `ipcRenderer` — no Electron required.
 */

import { IPC_CHANNELS } from '../shared-ipc/contract';
import type {
  RequestDescriptor,
  SanitizedResponse,
  UpdateAvailableNotification,
  WindowBounds,
} from '../shared-ipc/contract';
import { createCopilotBridge, type IpcRendererLike } from './preload';

interface Listener {
  channel: string;
  fn: (event: unknown, ...args: unknown[]) => void;
}

/** In-memory ipcRenderer that records invocations and event listeners. */
function fakeIpcRenderer(invokeResult: unknown = undefined): {
  ipc: IpcRendererLike;
  invocations: Array<{ channel: string; args: unknown[] }>;
  listeners: Listener[];
} {
  const invocations: Array<{ channel: string; args: unknown[] }> = [];
  const listeners: Listener[] = [];
  const ipc: IpcRendererLike = {
    invoke: (channel, ...args) => {
      invocations.push({ channel, args });
      return Promise.resolve(invokeResult);
    },
    on: (channel, fn) => {
      listeners.push({ channel, fn });
      return undefined;
    },
    removeListener: (channel, fn) => {
      const index = listeners.findIndex(
        (l) => l.channel === channel && l.fn === fn,
      );
      if (index !== -1) {
        listeners.splice(index, 1);
      }
      return undefined;
    },
  };
  return { ipc, invocations, listeners };
}

describe('createCopilotBridge', () => {
  it('exposes exactly the CopilotBridge surface and nothing else', () => {
    const { ipc } = fakeIpcRenderer();
    const bridge = createCopilotBridge(ipc);

    expect(Object.keys(bridge).sort()).toEqual(
      [
        'getBaseUrl',
        'onUpdateAvailable',
        'persistWindowState',
        'secureRequest',
        'setBaseUrl',
        'signOut',
      ].sort(),
    );
    // No raw ipcRenderer / Node globals leak onto the exposed object.
    const asRecord = bridge as unknown as Record<string, unknown>;
    expect(asRecord.ipcRenderer).toBeUndefined();
    expect(asRecord.require).toBeUndefined();
  });

  it('freezes the exposed object so methods cannot be replaced', () => {
    const { ipc } = fakeIpcRenderer();
    const bridge = createCopilotBridge(ipc);

    expect(Object.isFrozen(bridge)).toBe(true);
    expect(() => {
      (bridge as { secureRequest: unknown }).secureRequest = () => undefined;
    }).toThrow();
  });

  it('routes getBaseUrl to the getBaseUrl channel', async () => {
    const { ipc, invocations } = fakeIpcRenderer('https://api.example.com');
    const result = await createCopilotBridge(ipc).getBaseUrl();

    expect(result).toBe('https://api.example.com');
    expect(invocations).toEqual([{ channel: IPC_CHANNELS.getBaseUrl, args: [] }]);
  });

  it('routes setBaseUrl with the candidate argument', async () => {
    const accepted = { accepted: true, baseUrl: 'https://api.example.com' };
    const { ipc, invocations } = fakeIpcRenderer(accepted);
    const result = await createCopilotBridge(ipc).setBaseUrl(
      'https://api.example.com',
    );

    expect(result).toEqual(accepted);
    expect(invocations).toEqual([
      { channel: IPC_CHANNELS.setBaseUrl, args: ['https://api.example.com'] },
    ]);
  });

  it('routes secureRequest with the descriptor and returns the sanitized response', async () => {
    const response: SanitizedResponse = {
      status: 200,
      ok: true,
      transport: 'ok',
      data: { hello: 'world' },
    };
    const { ipc, invocations } = fakeIpcRenderer(response);
    const descriptor: RequestDescriptor = {
      method: 'GET',
      path: '/api/copilot/query-engine/questions',
      timeoutMs: 30000,
      requiresAuth: true,
    };
    const result = await createCopilotBridge(ipc).secureRequest(descriptor);

    expect(result).toEqual(response);
    expect(invocations).toEqual([
      { channel: IPC_CHANNELS.secureRequest, args: [descriptor] },
    ]);
  });

  it('routes signOut to the signOut channel', async () => {
    const { ipc, invocations } = fakeIpcRenderer();
    await createCopilotBridge(ipc).signOut();

    expect(invocations).toEqual([{ channel: IPC_CHANNELS.signOut, args: [] }]);
  });

  it('routes persistWindowState with the bounds argument', async () => {
    const { ipc, invocations } = fakeIpcRenderer();
    const bounds: WindowBounds = {
      x: 1,
      y: 2,
      width: 800,
      height: 600,
      maximized: false,
    };
    await createCopilotBridge(ipc).persistWindowState(bounds);

    expect(invocations).toEqual([
      { channel: IPC_CHANNELS.persistWindowState, args: [bounds] },
    ]);
  });

  describe('onUpdateAvailable', () => {
    it('delivers only the notification payload, not the raw event', () => {
      const { ipc, listeners } = fakeIpcRenderer();
      const received: UpdateAvailableNotification[] = [];
      createCopilotBridge(ipc).onUpdateAvailable((n) => received.push(n));

      expect(listeners).toHaveLength(1);
      expect(listeners[0].channel).toBe(IPC_CHANNELS.updateAvailable);

      const notification: UpdateAvailableNotification = { version: '1.4.0' };
      // Simulate main → renderer send: (event, payload).
      listeners[0].fn({ senderId: 1 }, notification);

      expect(received).toEqual([notification]);
    });

    it('returns an unsubscribe function that detaches the listener', () => {
      const { ipc, listeners } = fakeIpcRenderer();
      const unsubscribe = createCopilotBridge(ipc).onUpdateAvailable(() => {
        /* no-op */
      });

      expect(listeners).toHaveLength(1);
      unsubscribe();
      expect(listeners).toHaveLength(0);
    });
  });
});
