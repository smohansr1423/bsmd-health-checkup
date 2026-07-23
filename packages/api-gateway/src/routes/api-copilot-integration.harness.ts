/**
 * API Copilot AI — Integration Test Harness (shared)
 *
 * Shared helpers for the API Copilot AI gateway integration tests (tasks 17.3
 * and 18.2). Builds the real gateway app (with its composition-root service
 * registry of in-memory repositories and fake providers), starts it on an
 * ephemeral port, and issues real HTTP requests against it using Node's
 * built-in `http` client (supertest is not a dependency of this workspace).
 *
 * This is NOT a test file (no `*.test.ts` suffix), so Jest does not execute it
 * directly; the integration test files import from it.
 */

import http from 'http';
import type { AddressInfo } from 'net';

import { AuthService, type Role } from '@health-checkup/services';

import { createGatewayApp } from '../index';
import type { GatewayConfig } from '../index';
import type { ServiceRegistry } from '../service-registry';

/** A bearer token the test auth config accepts as a valid, authenticated user. */
export const TEST_TOKEN = 'integration-test-token';

/** The fixed user id the test token resolves to. */
export const TEST_USER_ID = 'test-user';

/**
 * Build a gateway app wired for tests: the test token resolves to an
 * authenticated user, TLS enforcement is disabled (so plain-HTTP localhost
 * requests are allowed), and the internal service registry uses in-memory
 * repositories and fake providers.
 */
export function buildTestGateway(): {
  app: ReturnType<typeof createGatewayApp>;
  services: ServiceRegistry;
} {
  const config: GatewayConfig = {
    auth: {
      validateToken: (token: string) => {
        if (!token) {
          return null;
        }
        return {
          token,
          userId: TEST_USER_ID,
          role: 'Administrator' as Role,
          sessionId: 'test-session',
          issuedAt: new Date(),
          expiresAt: new Date(Date.now() + 3_600_000),
        };
      },
      refreshSession: () => true,
    },
    // AuthService instance backing /api/auth (not exercised by these tests).
    authService: new AuthService(),
    // Disable TLS enforcement so localhost HTTP requests are not refused.
    tls: { enabled: false },
  };

  const app = createGatewayApp(config);
  const services = app.locals.services as ServiceRegistry;
  return { app, services };
}

/** A running test server bound to an ephemeral port. */
export interface RunningServer {
  server: http.Server;
  port: number;
  close: () => Promise<void>;
}

/** Start `app` listening on an ephemeral port and resolve with its address. */
export function startServer(
  app: ReturnType<typeof createGatewayApp>
): Promise<RunningServer> {
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        server,
        port,
        close: () =>
          new Promise<void>((res) => {
            server.close(() => res());
          }),
      });
    });
  });
}

/** Options for an HTTP request issued by {@link httpRequest}. */
export interface RequestOptions {
  /** Bearer token; omit to send no Authorization header (tests the 401 path). */
  token?: string;
  /** Value for the `x-account-id` header, driving workspace-scoped ownership. */
  accountId?: string;
  /** JSON request body. */
  body?: unknown;
  /** Extra headers. */
  headers?: Record<string, string>;
}

/** A parsed HTTP response. */
export interface ParsedResponse {
  status: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any;
  raw: string;
}

/**
 * Issue a real HTTP request against the running gateway and parse the JSON
 * response. Uses Node's built-in `http` client so no test-only HTTP dependency
 * is required.
 */
export function httpRequest(
  port: number,
  method: string,
  path: string,
  options: RequestOptions = {}
): Promise<ParsedResponse> {
  return new Promise((resolve, reject) => {
    const payload =
      options.body !== undefined ? JSON.stringify(options.body) : undefined;

    const headers: Record<string, string> = { ...options.headers };
    if (payload !== undefined) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(payload).toString();
    }
    if (options.token) {
      headers['Authorization'] = `Bearer ${options.token}`;
    }
    if (options.accountId) {
      headers['x-account-id'] = options.accountId;
    }

    const req = http.request(
      { host: '127.0.0.1', port, method, path, headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          let parsed: unknown = undefined;
          if (raw.length > 0) {
            try {
              parsed = JSON.parse(raw);
            } catch {
              parsed = raw;
            }
          }
          resolve({ status: res.statusCode ?? 0, body: parsed, raw });
        });
      }
    );

    req.on('error', reject);
    if (payload !== undefined) {
      req.write(payload);
    }
    req.end();
  });
}

/** A minimal, valid OpenAPI 3.0 specification with a single unauthenticated endpoint. */
export const WIDGET_OPENAPI_SPEC = `openapi: 3.0.0
info:
  title: Widget API
  version: 1.0.0
paths:
  /widgets:
    get:
      summary: List widgets
      responses:
        '200':
          description: A list of widgets
          content:
            application/json:
              schema:
                type: object
                properties:
                  widgets:
                    type: array
                    items:
                      type: string
`;
