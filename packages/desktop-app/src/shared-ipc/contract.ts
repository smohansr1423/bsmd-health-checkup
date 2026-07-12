/**
 * Typed IPC contract shared between the Electron main process, the preload
 * bridge, and the renderer. These are the core transport types that flow
 * across the process boundary via `window.copilot.secureRequest`.
 *
 * IMPORTANT (Req 4): none of these renderer-visible types ever carry the
 * Session_Token. The token is held only inside the main-process Secure_Store
 * and is attached to outbound requests by the request broker.
 */

/** HTTP methods the client issues against the Backend_Gateway. */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/**
 * A token-less, transport-agnostic description of a backend call.
 * The main process attaches auth and performs the actual HTTPS request.
 */
export interface RequestDescriptor {
  /** HTTP method for this call. */
  method: HttpMethod;
  /** Relative path, e.g. '/api/copilot/query-engine/questions'. Joined with the stored HTTPS base URL by the broker. */
  path: string;
  /** JSON-serializable body; never contains the Session_Token. */
  body?: unknown;
  /** Extra headers; never contains Authorization — the broker adds it (Req 4.2). */
  headers?: Record<string, string>;
  /** Deadline for the call, e.g. 30_000 for Q&A (Req 8.7). */
  timeoutMs: number;
  /** The broker attaches the token iff this is true and a token exists (Req 4.2). */
  requiresAuth: boolean;
}

/** Classification of the transport-level result of an attempted request. */
export type TransportResult = 'ok' | 'timeout' | 'unreachable' | 'tls_failed';

/** The parsed `{ error }` envelope returned by the Backend_Gateway on failure. */
export interface BackendErrorBody {
  code: string;
  message: string;
  details?: unknown;
}

/**
 * The sanitized result the main-process broker returns to the renderer.
 * Guaranteed to contain no token or credential string (Req 4.1, 16.5).
 */
export interface SanitizedResponse {
  /** HTTP status, or 0 for a transport-level failure. */
  status: number;
  ok: boolean;
  /** Parsed `{ data }` payload on success. */
  data?: unknown;
  /** Parsed `{ error }` payload on failure. */
  error?: BackendErrorBody;
  /** Parsed from the `Retry-After` header on 429 (Req 16.4). */
  retryAfterMs?: number;
  /** Transport-level classification of the attempt. */
  transport: TransportResult;
}

// ---------------------------------------------------------------------------
// IPC channel names
// ---------------------------------------------------------------------------

/**
 * The canonical IPC channel names bridged by the preload `window.copilot`
 * object. Centralized here so the main process, preload, and renderer all
 * refer to the exact same string, and adding a channel is a single edit.
 *
 * `secureRequest`, `getBaseUrl`, `setBaseUrl`, `signOut`, and
 * `persistWindowState` are renderer → main `invoke`/`handle` request-response
 * channels. `updateAvailable` is a main → renderer `send` event channel that
 * backs the `onUpdateAvailable` bridge (Req 19.4).
 */
export const IPC_CHANNELS = {
  /** Renderer → main: broker an outbound HTTPS call (Req 4.2). */
  secureRequest: 'copilot:secure-request',
  /** Renderer → main: read the stored Backend_Gateway base URL (Req 1.2). */
  getBaseUrl: 'copilot:get-base-url',
  /** Renderer → main: validate and store an HTTPS base URL (Req 1.2, 1.3). */
  setBaseUrl: 'copilot:set-base-url',
  /** Renderer → main: clear the Session_Token from the Secure_Store (Req 4.3). */
  signOut: 'copilot:sign-out',
  /** Renderer → main: persist the current window bounds (Req 18.2). */
  persistWindowState: 'copilot:persist-window-state',
  /** Main → renderer: an application update is available (Req 19.4). */
  updateAvailable: 'copilot:update-available',
} as const;

/** Union of every IPC channel name in {@link IPC_CHANNELS}. */
export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];

// ---------------------------------------------------------------------------
// Channel payloads
// ---------------------------------------------------------------------------

/**
 * Persisted, non-secret window geometry (Req 18.2). Sent over the
 * `persistWindowState` channel and stored in {@link AppConfig}.
 */
export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  maximized: boolean;
}

/**
 * Result of a `setBaseUrl` request. The main process accepts and stores the
 * candidate only when it is a non-empty HTTPS URL; otherwise it is rejected and
 * the previously stored value (if any) is retained (Req 1.2, 1.3).
 */
export interface SetBaseUrlResult {
  /** True when the candidate was accepted and stored. */
  accepted: boolean;
  /** The base URL now in effect after the request (unchanged when rejected). */
  baseUrl: string | null;
}

/**
 * Notification payload for the `updateAvailable` event. Carries only
 * non-sensitive, display-oriented fields used to render a non-blocking banner
 * (Req 19.4); it never carries a token or credential, and the renderer never
 * triggers a forced install in MVP.
 *
 * `version` is always present. `releaseName`/`releaseNotes` are optional and
 * included only when `electron-updater` provides them.
 */
export interface UpdateAvailableNotification {
  /** The version string of the available update (e.g. "1.4.0"). */
  version: string;
  /** Optional human-readable release name, when the updater provides one. */
  releaseName?: string;
  /** Optional release notes/changelog text, when the updater provides one. */
  releaseNotes?: string;
}

/**
 * The typed request/response contract for every renderer → main IPC channel.
 * Keying by the channel name lets the preload bridge and its consumers stay
 * compile-checked against a single source of truth.
 */
export interface IpcRequestResponse {
  [IPC_CHANNELS.secureRequest]: {
    request: RequestDescriptor;
    response: SanitizedResponse;
  };
  [IPC_CHANNELS.getBaseUrl]: {
    request: void;
    response: string | null;
  };
  [IPC_CHANNELS.setBaseUrl]: {
    request: string;
    response: SetBaseUrlResult;
  };
  [IPC_CHANNELS.signOut]: {
    request: void;
    response: void;
  };
  [IPC_CHANNELS.persistWindowState]: {
    request: WindowBounds;
    response: void;
  };
}

/** Payloads for main → renderer event channels. */
export interface IpcEventPayload {
  [IPC_CHANNELS.updateAvailable]: UpdateAvailableNotification;
}

/**
 * The typed surface exposed to the renderer as `window.copilot` by the preload
 * bridge (implemented in a later task). Declared here so the renderer and
 * preload share one definition. No method ever exposes the Session_Token.
 */
export interface CopilotBridge {
  /** Read the stored HTTPS base URL, or null when none is configured. */
  getBaseUrl(): Promise<string | null>;
  /** Validate and store an HTTPS base URL (Req 1.2, 1.3). */
  setBaseUrl(candidate: string): Promise<SetBaseUrlResult>;
  /** Broker a token-less request through the main process (Req 4.2). */
  secureRequest(descriptor: RequestDescriptor): Promise<SanitizedResponse>;
  /** Clear the Session_Token and end the Session (Req 4.3). */
  signOut(): Promise<void>;
  /** Persist the current window bounds (Req 18.2). */
  persistWindowState(bounds: WindowBounds): Promise<void>;
  /**
   * Subscribe to update-available notifications (Req 19.4). Returns an
   * unsubscribe function.
   */
  onUpdateAvailable(
    listener: (notification: UpdateAvailableNotification) => void,
  ): () => void;
}
