/**
 * Renderer-facing types for the typed HTTP API client layer.
 *
 * The client layer is pure: it builds {@link RequestDescriptor}s per endpoint
 * and maps {@link SanitizedResponse} into a {@link UiOutcome}. Payload shapes
 * mirror the backend by importing `apiCopilotShared` types so the request /
 * response contract is compile-checked against the gateway.
 */

// Type-only import: the client talks to the backend over HTTP, never in-process.
import type { apiCopilotShared } from '@health-checkup/services';

// Re-export the transport contract so client code has a single import surface.
export type {
  HttpMethod,
  RequestDescriptor,
  SanitizedResponse,
  BackendErrorBody,
  TransportResult,
  WindowBounds,
} from '../../shared-ipc/contract';

import type { WindowBounds } from '../../shared-ipc/contract';

/**
 * The renderer-facing outcome every client method ultimately returns.
 * Each variant maps to a distinct UI presentation.
 */
export type UiOutcome<T> =
  | { kind: 'success'; value: T }
  // Client-side, produced before any request is sent (Req 2.3, 3.3, 5.3, 6.3, 8.2, 9.4).
  | { kind: 'validation_error'; field?: string; message: string }
  // Backend returned a 4xx/5xx with an error envelope (Req 16.3).
  | { kind: 'backend_error'; code: string; message: string; details?: unknown }
  // Backend returned 429 (Req 16.4).
  | { kind: 'rate_limited'; retryAfterMs?: number }
  // Backend reported the Session_Token expired/invalid (Req 4.4).
  | { kind: 'session_expired' }
  // Backend_Gateway could not be reached (Req 17.1).
  | { kind: 'unreachable' }
  // A secure HTTPS connection could not be established (Req 4.6).
  | { kind: 'tls_error' };

// ---- Client-side form inputs (validated before send) ----

export interface SignUpInput {
  email: string;
  password: string;
  [field: string]: string;
}

export interface SignInInput {
  email: string;
  password: string;
}

export interface UploadFile {
  name: string;
  contentType: 'yaml' | 'json';
  sizeBytes: number;
  bytes: Uint8Array;
}

export interface CredentialInput {
  scheme: string;
  values: Record<string, string>;
  targetApiRef: string;
}

export type ParamValues = Record<string, string>;

export interface ConsoleRunInput {
  selection: apiCopilotShared.ApiSelection;
  endpointId: string;
  values: ParamValues;
}

// ---- Persisted app config (non-secret) ----

/**
 * The persisted, non-secret application configuration (Req 1.2, 1.3, 18.2).
 * It holds the HTTPS base URL and the window geometry; it never holds the
 * Session_Token, which lives only in the main-process Secure_Store.
 */
export interface AppConfig {
  /** HTTPS-only Backend_Gateway base URL; null until configured (Req 1.2, 1.3). */
  backendBaseUrl: string | null;
  /** Persisted window bounds restored on launch (Req 18.2). */
  window: WindowBounds;
}
