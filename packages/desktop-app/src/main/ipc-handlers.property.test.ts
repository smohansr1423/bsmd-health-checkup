/**
 * Property test for the Request Broker (main process) — Req 4.2.
 *
 * Property 6: Protected requests carry the token only via the broker.
 *   For any protected RequestDescriptor and any stored token, the outbound
 *   request produced by the main-process broker includes an
 *   `Authorization: Bearer <token>` header, while the renderer-side descriptor
 *   contains no `Authorization` header and no token value.
 *
 * The broker's two side-effecting dependencies — the HTTP transport and the
 * Secure_Store token source — are backed by in-memory fakes. The fake
 * transport captures the fully-assembled outbound request so the test can
 * assert exactly which headers the broker attached, without any real network
 * or Electron.
 *
 * Validates: Requirements 4.2
 */
import * as fc from 'fast-check';
import {
  createRequestBroker,
  type HttpTransport,
  type TokenSource,
  type TransportOutcome,
  type TransportRequest,
} from './ipc-handlers';
import type { HttpMethod, RequestDescriptor } from '../shared-ipc/contract';

/**
 * In-memory {@link HttpTransport} that records every outbound request it is
 * asked to send and returns a fixed, benign 200 response. The recorded
 * requests let the test inspect the headers the broker assembled.
 */
function makeCapturingTransport(): {
  transport: HttpTransport;
  sent: TransportRequest[];
} {
  const sent: TransportRequest[] = [];
  const transport: HttpTransport = {
    async send(request: TransportRequest): Promise<TransportOutcome> {
      sent.push(request);
      return {
        kind: 'response',
        status: 200,
        headers: {},
        bodyText: JSON.stringify({ data: { ok: true } }),
      };
    },
  };
  return { transport, sent };
}

/** In-memory {@link TokenSource} that always returns the given token. */
function makeTokenSource(token: string | null): TokenSource {
  return {
    async loadToken(): Promise<string | null> {
      return token;
    },
  };
}

/** Case-insensitive lookup of a header value in a header record. */
function findHeaderValue(
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

const httpMethodArb: fc.Arbitrary<HttpMethod> = fc.constantFrom(
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
);

/**
 * Header records that never contain an Authorization key (in any casing) —
 * mirroring what the renderer is allowed to build.
 */
const nonAuthHeadersArb: fc.Arbitrary<Record<string, string>> = fc
  .dictionary(fc.string(), fc.string())
  .map((headers) => {
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(headers)) {
      if (key.toLowerCase() !== 'authorization') {
        result[key] = value;
      }
    }
    return result;
  });

/** A protected, token-less RequestDescriptor as the renderer would produce it. */
const protectedDescriptorArb: fc.Arbitrary<RequestDescriptor> = fc.record({
  method: httpMethodArb,
  path: fc
    .webPath()
    .map((p) => `/api/copilot${p.startsWith('/') ? p : `/${p}`}`),
  body: fc.option(fc.jsonValue(), { nil: undefined }),
  headers: fc.option(nonAuthHeadersArb, { nil: undefined }),
  timeoutMs: fc.integer({ min: 1, max: 60_000 }),
  requiresAuth: fc.constant(true),
});

/** Non-empty token strings — the broker attaches only when a token exists. */
const nonEmptyTokenArb: fc.Arbitrary<string> = fc
  .string()
  .filter((s) => s.length > 0);

describe('RequestBroker — Property 6: Protected requests carry the token only via the broker', () => {
  it('attaches Authorization: Bearer <token> to the outbound request while the descriptor stays token-less', async () => {
    await fc.assert(
      fc.asyncProperty(
        protectedDescriptorArb,
        nonEmptyTokenArb,
        async (descriptor, token) => {
          const { transport, sent } = makeCapturingTransport();
          const broker = createRequestBroker({
            transport,
            tokenSource: makeTokenSource(token),
            // Any HTTPS resolution is fine; token custody is independent of the host.
            resolveUrl: (path) => `https://gateway.example.com${path}`,
          });

          // Snapshot the renderer-side descriptor headers before sending.
          const descriptorHeadersBefore = JSON.stringify(descriptor.headers);

          await broker.secureRequest(descriptor);

          // Exactly one outbound request was assembled and sent.
          expect(sent).toHaveLength(1);
          const outbound = sent[0];

          // (1) The broker attached the token via the Authorization header.
          expect(findHeaderValue(outbound.headers, 'Authorization')).toBe(
            `Bearer ${token}`,
          );

          // (2) The renderer-side descriptor still carries no Authorization
          //     header and is not mutated by the broker.
          expect(findHeaderValue(descriptor.headers ?? {}, 'Authorization')).toBeUndefined();
          expect(JSON.stringify(descriptor.headers)).toBe(descriptorHeadersBefore);

          // (3) No `Bearer <token>` credential leaks into the descriptor's
          //     header values — the broker is the only place it is formed.
          const credential = `Bearer ${token}`;
          for (const value of Object.values(descriptor.headers ?? {})) {
            expect(value).not.toContain(credential);
          }
        },
      )
    );
  });

  it('never attaches Authorization for an unauthenticated descriptor, even when a token is stored', async () => {
    await fc.assert(
      fc.asyncProperty(
        protectedDescriptorArb,
        nonEmptyTokenArb,
        async (base, token) => {
          const descriptor: RequestDescriptor = { ...base, requiresAuth: false };
          const { transport, sent } = makeCapturingTransport();
          const broker = createRequestBroker({
            transport,
            tokenSource: makeTokenSource(token),
            resolveUrl: (path) => `https://gateway.example.com${path}`,
          });

          await broker.secureRequest(descriptor);

          expect(sent).toHaveLength(1);
          // No token is attached: the outbound request carries no Authorization
          // header and no `Bearer <token>` credential in any header value.
          expect(findHeaderValue(sent[0].headers, 'Authorization')).toBeUndefined();
          const credential = `Bearer ${token}`;
          for (const value of Object.values(sent[0].headers)) {
            expect(value).not.toContain(credential);
          }
        },
      )
    );
  });

  it('strips any Authorization the renderer smuggled in and replaces it with the broker-attached token', async () => {
    await fc.assert(
      fc.asyncProperty(
        protectedDescriptorArb,
        nonEmptyTokenArb,
        fc.string(),
        async (base, token, smuggled) => {
          // Simulate a renderer that (incorrectly) set its own Authorization.
          const descriptor: RequestDescriptor = {
            ...base,
            headers: { ...(base.headers ?? {}), Authorization: `Bearer ${smuggled}` },
          };
          const { transport, sent } = makeCapturingTransport();
          const broker = createRequestBroker({
            transport,
            tokenSource: makeTokenSource(token),
            resolveUrl: (path) => `https://gateway.example.com${path}`,
          });

          await broker.secureRequest(descriptor);

          expect(sent).toHaveLength(1);
          // The outbound Authorization is the broker's stored token, not the
          // renderer-supplied one.
          expect(findHeaderValue(sent[0].headers, 'Authorization')).toBe(
            `Bearer ${token}`,
          );
        },
      )
    );
  });
});
