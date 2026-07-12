/**
 * Property test for the main-process Request Broker — HTTPS enforcement (Req 4.6).
 *
 * Property 8: HTTPS failure transmits nothing and maps to a TLS error.
 *   For any request attempted when a secure HTTPS connection cannot be
 *   established, the broker sends no request body and the resulting UiOutcome
 *   is a TLS error (`transport: 'tls_failed'`).
 *
 * The broker's two side-effecting dependencies — the HTTP transport and the
 * Secure_Store token source — are backed by in-memory fakes injected through
 * `createRequestBroker`. A spy transport records every `send` call (and the
 * bytes it was handed) so the test can assert that, on an HTTPS failure, the
 * broker transmitted nothing at all.
 *
 * Two ways an HTTPS connection can fail to be established are covered:
 *   1. The resolved target is not an HTTPS URL (non-HTTPS scheme, malformed, or
 *      no base URL configured). The broker must short-circuit and never invoke
 *      the transport — literally zero bytes leave the process.
 *   2. The TLS handshake itself fails at the transport layer. The broker must
 *      surface `transport: 'tls_failed'` and carry no response payload.
 *
 * Validates: Requirements 4.6
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
 * A transport that must never be called. Every invocation is recorded so the
 * test can prove the broker transmitted nothing on an HTTPS failure.
 */
function makeSpyTransport(): { transport: HttpTransport; calls: TransportRequest[] } {
  const calls: TransportRequest[] = [];
  return {
    calls,
    transport: {
      async send(request: TransportRequest): Promise<TransportOutcome> {
        calls.push(request);
        // Should be unreachable for the non-HTTPS cases; return a benign
        // response so an accidental call is caught by the assertions, not a throw.
        return { kind: 'response', status: 200, headers: {}, bodyText: '' };
      },
    },
  };
}

/**
 * A transport whose handshake always fails with `tls_failed`. It still records
 * the attempt so we can confirm no request body was written past the boundary
 * (the transport never returns a response payload).
 */
function makeTlsFailingTransport(): {
  transport: HttpTransport;
  calls: TransportRequest[];
} {
  const calls: TransportRequest[] = [];
  return {
    calls,
    transport: {
      async send(request: TransportRequest): Promise<TransportOutcome> {
        calls.push(request);
        return { kind: 'failure', transport: 'tls_failed' };
      },
    },
  };
}

/** A token source that yields a fixed token, exercising the auth-attachment path too. */
function makeTokenSource(token: string | null): TokenSource {
  return {
    async loadToken(): Promise<string | null> {
      return token;
    },
  };
}

const httpMethodArb = fc.constantFrom<HttpMethod>(
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
);

const descriptorArb: fc.Arbitrary<RequestDescriptor> = fc.record({
  method: httpMethodArb,
  path: fc.string(),
  body: fc.option(fc.jsonValue(), { nil: undefined }),
  headers: fc.option(fc.dictionary(fc.string(), fc.string()), { nil: undefined }),
  timeoutMs: fc.integer({ min: 0, max: 60_000 }),
  requiresAuth: fc.boolean(),
});

/**
 * A target that cannot yield a secure HTTPS connection: either no base URL is
 * configured (null) or the resolved URL uses a non-HTTPS scheme / is malformed.
 */
const nonHttpsResolutionArb: fc.Arbitrary<string | null> = fc.oneof(
  fc.constant(null),
  fc.constantFrom(
    'http://api.example.com/api/copilot/x',
    'http://localhost:3000/path',
    'ftp://host/resource',
    'ws://host/socket',
    'wss://host/socket',
    'file:///etc/passwd',
    'not-a-url',
    '',
    '//no-scheme/path',
    'HTTP://caps.example.com/x',
  ),
);

describe('RequestBroker — Property 8: HTTPS failure transmits nothing and maps to a TLS error', () => {
  it('non-HTTPS / unresolvable target: transmits nothing and returns tls_failed', async () => {
    await fc.assert(
      fc.asyncProperty(
        descriptorArb,
        nonHttpsResolutionArb,
        fc.option(fc.string(), { nil: null }),
        async (descriptor, resolved, token) => {
          const spy = makeSpyTransport();
          const broker = createRequestBroker({
            transport: spy.transport,
            tokenSource: makeTokenSource(token),
            resolveUrl: () => resolved,
          });

          const response = await broker.secureRequest(descriptor);

          // Maps to a TLS error.
          expect(response.transport).toBe('tls_failed');
          expect(response.ok).toBe(false);
          expect(response.status).toBe(0);
          // Nothing about the attempt is echoed back.
          expect(response.data).toBeUndefined();
          expect(response.error).toBeUndefined();
          // No bytes were transmitted: the transport was never invoked.
          expect(spy.calls).toHaveLength(0);
        },
      )
    );
  });

  it('TLS handshake failure at the transport layer: no response payload, maps to tls_failed', async () => {
    await fc.assert(
      fc.asyncProperty(
        descriptorArb,
        fc.option(fc.string(), { nil: null }),
        async (descriptor, token) => {
          const failing = makeTlsFailingTransport();
          const broker = createRequestBroker({
            transport: failing.transport,
            tokenSource: makeTokenSource(token),
            // A well-formed HTTPS URL so the broker proceeds to the transport,
            // where the handshake then fails.
            resolveUrl: () => 'https://api.example.com/api/copilot/x',
          });

          const response = await broker.secureRequest(descriptor);

          expect(response.transport).toBe('tls_failed');
          expect(response.ok).toBe(false);
          expect(response.status).toBe(0);
          // A failed handshake yields no application payload.
          expect(response.data).toBeUndefined();
          expect(response.error).toBeUndefined();
        },
      )
    );
  });
});
