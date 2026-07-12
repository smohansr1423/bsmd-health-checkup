/**
 * Request Broker (main process) — Req 4.2, 4.6, 16.5, 17.1.
 *
 * The single choke point for every outbound call to the Backend_Gateway. The
 * renderer never talks to the network directly; it builds a token-less
 * {@link RequestDescriptor} and calls `window.copilot.secureRequest`, which is
 * routed here. This module:
 *
 *  - Enforces HTTPS. A path that resolves to a non-HTTPS URL (or that cannot be
 *    resolved because no base URL is configured), and any TLS handshake
 *    failure, cause the broker to send nothing and return
 *    `transport: 'tls_failed'` (Req 4.6).
 *  - Attaches `Authorization: Bearer <token>` iff the descriptor
 *    `requiresAuth` and a Session_Token is stored (Req 4.2). The token is read
 *    from the Secure_Store here, never in the renderer.
 *  - Classifies transport failures as `unreachable`, `timeout`, or
 *    `tls_failed` (Req 17.1, 8.7, 4.6).
 *  - Sanitizes the response so no `Authorization` header, Session_Token, or
 *    credential string is ever echoed back to the renderer (Req 4.1, 16.5).
 *
 * Testability: the two side-effecting dependencies — the HTTP transport and the
 * Secure_Store token source — are expressed as small interfaces and injected
 * through {@link createRequestBroker}. Tests supply in-memory fakes, so the
 * broker's HTTPS enforcement, token attachment, failure classification, and
 * sanitization can be exercised without a real network or Electron. Production
 * wiring uses {@link createDefaultHttpTransport} / {@link registerSecureRequestHandler},
 * which lazily `require` Node's `https` module and `electron` so this file
 * carries no static dependency on either.
 */

import type {
  BackendErrorBody,
  HttpMethod,
  RequestDescriptor,
  SanitizedResponse,
  TransportResult,
} from '../shared-ipc/contract';
import type { SecureStore } from './secure-store';

// ---------------------------------------------------------------------------
// Injectable HTTP transport
// ---------------------------------------------------------------------------

/** A fully-resolved outbound request, ready for the transport to send. */
export interface TransportRequest {
  /** Absolute URL. Guaranteed HTTPS by the broker before it reaches here. */
  url: string;
  method: HttpMethod;
  /** Complete header set, including `Authorization` when the broker attached it. */
  headers: Record<string, string>;
  /** Serialized JSON body, or undefined for bodyless requests. */
  body?: string;
  /** Deadline in milliseconds; the transport must classify overruns as timeouts. */
  timeoutMs: number;
}

/**
 * The transport's result for a single attempt: either a completed HTTP
 * response, or a transport-level failure classification.
 */
export type TransportOutcome =
  | {
      kind: 'response';
      status: number;
      headers: Record<string, string>;
      /** Raw response body text; parsed into the `{ data }`/`{ error }` envelope by the broker. */
      bodyText: string;
    }
  | {
      kind: 'failure';
      /** Never `'ok'` — a failure is one of the three error classifications. */
      transport: Exclude<TransportResult, 'ok'>;
    };

/**
 * Performs the actual network I/O. Injected so the broker is testable without a
 * real socket; production uses {@link createDefaultHttpTransport}.
 */
export interface HttpTransport {
  send(request: TransportRequest): Promise<TransportOutcome>;
}

/** The minimal Secure_Store surface the broker needs: reading the token. */
export type TokenSource = Pick<SecureStore, 'loadToken'>;

/** Dependencies injected into {@link createRequestBroker}. */
export interface RequestBrokerDeps {
  /** Performs the HTTPS request once the broker has assembled it. */
  transport: HttpTransport;
  /** Supplies the stored Session_Token for protected requests (Req 4.2). */
  tokenSource: TokenSource;
  /**
   * Resolve a relative `/api/copilot/*` path to an absolute URL against the
   * stored base URL, or return null when no base URL is configured. In
   * production this is {@link AppConfigStore.resolve} bound to the config store.
   */
  resolveUrl(path: string): string | null;
}

/** The public surface: a single method mirroring the preload bridge. */
export interface RequestBroker {
  secureRequest(descriptor: RequestDescriptor): Promise<SanitizedResponse>;
}

/** The Authorization header name, kept in one place so it is never re-typed. */
const AUTHORIZATION_HEADER = 'Authorization';

/** IPC channel the preload bridge invokes for a brokered request. */
export const SECURE_REQUEST_CHANNEL = 'copilot:secure-request';

/** A tls_failed response that transmitted nothing (Req 4.6). */
function tlsFailedResponse(): SanitizedResponse {
  return { status: 0, ok: false, transport: 'tls_failed' };
}

/** A transport-failure response (unreachable/timeout/tls_failed) that carries no payload. */
function transportFailureResponse(
  transport: Exclude<TransportResult, 'ok'>,
): SanitizedResponse {
  return { status: 0, ok: false, transport };
}

/**
 * Create a {@link RequestBroker} from injected backends.
 *
 * The returned `secureRequest` never throws for expected failure modes; it maps
 * them to a {@link SanitizedResponse} the renderer's mapper can interpret.
 */
export function createRequestBroker(deps: RequestBrokerDeps): RequestBroker {
  return {
    async secureRequest(
      descriptor: RequestDescriptor,
    ): Promise<SanitizedResponse> {
      // --- HTTPS enforcement (Req 4.6) -----------------------------------
      // Resolve the target URL and refuse anything that is not HTTPS. On
      // rejection we transmit nothing and report a TLS failure.
      const url = deps.resolveUrl(descriptor.path);
      if (url === null || !isHttpsUrl(url)) {
        return tlsFailedResponse();
      }

      // --- Header assembly + token attachment (Req 4.2) ------------------
      // Start from the descriptor's headers but drop any Authorization the
      // renderer may have set: the token is attached here and nowhere else.
      const headers = stripAuthorization(descriptor.headers);

      let token: string | null = null;
      if (descriptor.requiresAuth) {
        token = await deps.tokenSource.loadToken();
        if (token !== null && token.length > 0) {
          headers[AUTHORIZATION_HEADER] = `Bearer ${token}`;
        }
      }

      // Serialize the JSON body (if any) and set the content type.
      let body: string | undefined;
      if (descriptor.body !== undefined) {
        body = JSON.stringify(descriptor.body);
        if (headers['Content-Type'] === undefined) {
          headers['Content-Type'] = 'application/json';
        }
      }

      // --- Send + failure classification (Req 17.1, 8.7, 4.6) ------------
      let outcome: TransportOutcome;
      try {
        outcome = await deps.transport.send({
          url,
          method: descriptor.method,
          headers,
          body,
          timeoutMs: descriptor.timeoutMs,
        });
      } catch {
        // An unexpected transport throw is treated as unreachable rather than
        // surfacing an error object that might embed request details.
        return transportFailureResponse('unreachable');
      }

      if (outcome.kind === 'failure') {
        return transportFailureResponse(outcome.transport);
      }

      // --- Parse + sanitize the response (Req 4.1, 16.5) -----------------
      const parsed = parseHttpResponse(outcome);
      // Redact the token from any part of the response the backend may have
      // echoed, guaranteeing the returned object contains no secret string.
      return sanitizeResponse(parsed, token);
    },
  };
}

/** True iff the URL uses the HTTPS scheme. Malformed URLs are treated as non-HTTPS. */
export function isHttpsUrl(url: string): boolean {
  try {
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Return a shallow copy of the given headers with any `Authorization` entry
 * removed, regardless of its casing. The broker is the only place that sets the
 * Authorization header, so the renderer can never smuggle one through.
 */
export function stripAuthorization(
  headers: Record<string, string> | undefined,
): Record<string, string> {
  const result: Record<string, string> = {};
  if (headers === undefined) {
    return result;
  }
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === AUTHORIZATION_HEADER.toLowerCase()) {
      continue;
    }
    result[key] = value;
  }
  return result;
}

/**
 * Parse a completed HTTP response into a {@link SanitizedResponse} shape
 * (before secret redaction). Maps the backend's `{ data }` / `{ error }`
 * envelope, derives `ok` from the status code, and reads `Retry-After` for 429s.
 */
export function parseHttpResponse(outcome: {
  status: number;
  headers: Record<string, string>;
  bodyText: string;
}): SanitizedResponse {
  const ok = outcome.status >= 200 && outcome.status < 300;
  const parsedBody = safeParseJson(outcome.bodyText);

  const response: SanitizedResponse = {
    status: outcome.status,
    ok,
    transport: 'ok',
  };

  if (ok) {
    // Success envelope is `{ data }`; fall back to the whole body if the
    // gateway ever returns a bare payload.
    if (isRecord(parsedBody) && 'data' in parsedBody) {
      response.data = parsedBody.data;
    } else if (parsedBody !== undefined) {
      response.data = parsedBody;
    }
  } else {
    const errorBody = extractErrorBody(parsedBody);
    if (errorBody !== undefined) {
      response.error = errorBody;
    }
  }

  const retryAfterMs = parseRetryAfter(findHeader(outcome.headers, 'Retry-After'));
  if (retryAfterMs !== undefined) {
    response.retryAfterMs = retryAfterMs;
  }

  return response;
}

/** Pull a well-formed `{ error: { code, message, details? } }` body if present. */
function extractErrorBody(parsedBody: unknown): BackendErrorBody | undefined {
  if (!isRecord(parsedBody)) {
    return undefined;
  }
  const errorValue = 'error' in parsedBody ? parsedBody.error : parsedBody;
  if (!isRecord(errorValue)) {
    return undefined;
  }
  const code = typeof errorValue.code === 'string' ? errorValue.code : 'unknown';
  const message =
    typeof errorValue.message === 'string' ? errorValue.message : '';
  const body: BackendErrorBody = { code, message };
  if ('details' in errorValue && errorValue.details !== undefined) {
    body.details = errorValue.details;
  }
  return body;
}

/**
 * Interpret a `Retry-After` header value (Req 16.4). Supports both the
 * delta-seconds form (`"120"`) and the HTTP-date form; returns the delay in
 * milliseconds, clamped to be non-negative, or undefined when absent/unparseable.
 */
export function parseRetryAfter(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return undefined;
  }

  // delta-seconds form.
  if (/^\d+$/.test(trimmed)) {
    return Number(trimmed) * 1000;
  }

  // HTTP-date form.
  const dateMs = Date.parse(trimmed);
  if (!Number.isNaN(dateMs)) {
    return Math.max(0, dateMs - Date.now());
  }

  return undefined;
}

/**
 * Redact every occurrence of the Session_Token from a parsed response so no
 * secret can be echoed back to the renderer (Req 4.1, 16.5). The response's
 * transport-level fields are copied as-is; only the `data` and `error` payloads
 * — the parts derived from the backend body — are scrubbed.
 */
export function sanitizeResponse(
  response: SanitizedResponse,
  token: string | null,
): SanitizedResponse {
  if (token === null || token.length === 0) {
    return response;
  }
  const sanitized: SanitizedResponse = {
    status: response.status,
    ok: response.ok,
    transport: response.transport,
  };
  if (response.retryAfterMs !== undefined) {
    sanitized.retryAfterMs = response.retryAfterMs;
  }
  if (response.data !== undefined) {
    sanitized.data = redactSecret(response.data, token);
  }
  if (response.error !== undefined) {
    sanitized.error = redactSecret(response.error, token) as BackendErrorBody;
  }
  return sanitized;
}

/** The placeholder substituted for any redacted secret value. */
export const REDACTION_PLACEHOLDER = '[REDACTED]';

/**
 * Recursively replace any occurrence of `secret` within a JSON-like value.
 * Strings that contain the secret as a substring have it replaced with
 * {@link REDACTION_PLACEHOLDER}; arrays and objects are walked; other primitives
 * are returned unchanged. Object keys are preserved (secrets live in values).
 */
export function redactSecret(value: unknown, secret: string): unknown {
  if (typeof value === 'string') {
    return value.includes(secret)
      ? value.split(secret).join(REDACTION_PLACEHOLDER)
      : value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => redactSecret(entry, secret));
  }
  if (isRecord(value)) {
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      result[key] = redactSecret(entry, secret);
    }
    return result;
  }
  return value;
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** Type guard for a plain object (non-null, non-array). */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Parse JSON, returning undefined for empty or invalid bodies rather than throwing. */
function safeParseJson(text: string): unknown {
  if (text.trim().length === 0) {
    return undefined;
  }
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Case-insensitive header lookup. */
function findHeader(
  headers: Record<string, string>,
  name: string,
): string | undefined {
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === target) {
      return value;
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Production wiring (lazy `require`, so the module compiles without electron/https)
// ---------------------------------------------------------------------------

/**
 * Node's `https`/`http` request surface used by the default transport. Declared
 * locally so this module has no static dependency on the modules; loaded via
 * `require` inside {@link createDefaultHttpTransport}.
 */
interface NodeHttpModule {
  request(
    url: string,
    options: {
      method: string;
      headers: Record<string, string>;
      timeout: number;
    },
    callback: (res: NodeHttpResponse) => void,
  ): NodeHttpRequest;
}

interface NodeHttpResponse {
  statusCode?: number;
  headers: Record<string, string | string[] | undefined>;
  setEncoding(encoding: string): void;
  on(event: 'data', listener: (chunk: string) => void): void;
  on(event: 'end', listener: () => void): void;
}

interface NodeHttpRequest {
  on(event: 'error', listener: (err: NodeJS.ErrnoException) => void): void;
  on(event: 'timeout', listener: () => void): void;
  write(chunk: string): void;
  destroy(error?: Error): void;
  end(): void;
}

/**
 * Production {@link HttpTransport} backed by Node's `https` module. Loaded
 * lazily so this file can be imported/unit-tested without invoking it. It
 * classifies TLS handshake failures as `tls_failed`, connection/DNS failures as
 * `unreachable`, and deadline overruns as `timeout` (Req 17.1, 8.7, 4.6).
 */
export function createDefaultHttpTransport(): HttpTransport {
  const https = require('https') as NodeHttpModule;

  return {
    send(request: TransportRequest): Promise<TransportOutcome> {
      return new Promise<TransportOutcome>((resolve) => {
        let settled = false;
        const finish = (outcome: TransportOutcome): void => {
          if (!settled) {
            settled = true;
            resolve(outcome);
          }
        };

        const req = https.request(
          request.url,
          {
            method: request.method,
            headers: request.headers,
            timeout: request.timeoutMs,
          },
          (res) => {
            res.setEncoding('utf8');
            let bodyText = '';
            res.on('data', (chunk) => {
              bodyText += chunk;
            });
            res.on('end', () => {
              finish({
                kind: 'response',
                status: res.statusCode ?? 0,
                headers: flattenHeaders(res.headers),
                bodyText,
              });
            });
          },
        );

        req.on('timeout', () => {
          req.destroy();
          finish({ kind: 'failure', transport: 'timeout' });
        });

        req.on('error', (err) => {
          finish({ kind: 'failure', transport: classifyNodeError(err) });
        });

        if (request.body !== undefined) {
          req.write(request.body);
        }
        req.end();
      });
    },
  };
}

/** Collapse Node's possibly-array header values into single strings. */
function flattenHeaders(
  headers: Record<string, string | string[] | undefined>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) {
      continue;
    }
    result[key] = Array.isArray(value) ? value.join(', ') : value;
  }
  return result;
}

/**
 * Classify a Node socket/TLS error into a {@link TransportResult}. TLS handshake
 * and certificate errors map to `tls_failed`; everything else (DNS, refused,
 * reset, offline) maps to `unreachable` (Req 17.1, 4.6).
 */
export function classifyNodeError(
  err: NodeJS.ErrnoException,
): Exclude<TransportResult, 'ok' | 'timeout'> {
  const code = err.code ?? '';
  // TLS/certificate failures — the secure connection could not be established.
  if (
    code.startsWith('ERR_TLS') ||
    code.startsWith('CERT_') ||
    code.startsWith('UNABLE_TO_') ||
    code.startsWith('DEPTH_ZERO_') ||
    code.startsWith('SELF_SIGNED') ||
    code.startsWith('ERR_SSL') ||
    code === 'EPROTO'
  ) {
    return 'tls_failed';
  }
  // Everything else is treated as the gateway being unreachable.
  return 'unreachable';
}

/**
 * Register the `secure-request` IPC handler on Electron's `ipcMain`, routing
 * each brokered call through the given {@link RequestBroker}. Electron is loaded
 * lazily so this file compiles without it; call only from the main process.
 */
export function registerSecureRequestHandler(broker: RequestBroker): void {
  const { ipcMain } = require('electron') as {
    ipcMain: {
      handle(
        channel: string,
        listener: (
          event: unknown,
          descriptor: RequestDescriptor,
        ) => Promise<SanitizedResponse>,
      ): void;
    };
  };

  ipcMain.handle(
    SECURE_REQUEST_CHANNEL,
    (_event: unknown, descriptor: RequestDescriptor) =>
      broker.secureRequest(descriptor),
  );
}
