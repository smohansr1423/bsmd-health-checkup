import fc from 'fast-check';

import { GATEWAY_ERROR, STATUS } from '../responses';
import type { GatewayRequest, GatewayResponse, NextFn, RequestContext } from '../types';
import {
  DEFAULT_CERT_FINGERPRINT_HEADER,
  DEFAULT_TLS_VERSION_HEADER,
  InMemoryFailedAttemptRecorder,
  TransportGuard,
  isTls13,
  matchesPinnedCert,
} from './index';

/**
 * Property-based test for the TLS 1.3 / certificate-pinning egress guard
 * (Task 16.4 implementation; Task 16.5 property).
 *
 * Feature: calorie-cortisol-tool, Property 55
 * Property 55: TLS/cert-pinning failure blocks all health-data egress.
 *   For any transmission attempt where TLS 1.3 cannot be established or
 *   certificate-pinning validation fails, the connection is rejected, zero
 *   health-data bytes are transmitted, and the failed attempt is recorded.
 *
 * Validates: Requirements 25.3
 *
 * The global fast-check default is 10 runs; this suite pins numRuns >= 100
 * inline so the property is exercised across a broad input space of TLS
 * versions, certificate fingerprints, and pin configurations.
 */

const NUM_RUNS = 100;

/** Two fingerprints the gateway pins/trusts, in two common encodings. */
const PIN_A = 'AB:CD:EF:01:23:45:67:89';
const PIN_B = 'sha256:99887766554433221100';
const PINS: readonly string[] = [PIN_A, PIN_B];

/** The raw (normalized-equal) values a peer might present for the pinned certs. */
const MATCHING_FINGERPRINTS = [
  PIN_A,
  'abcdef0123456789', // PIN_A, lowercase, no separators
  'ab:cd:ef:01:23:45:67:89',
  PIN_B,
  '99887766554433221100', // PIN_B without the sha256: prefix
] as const;

const NON_MATCHING_FINGERPRINTS = [
  'deadbeefdeadbeef',
  '00112233445566778899',
  'sha256:1122334455',
  'not-a-real-fingerprint',
] as const;

/** TLS version spellings that denote TLS 1.3. */
const TLS13_VERSIONS = ['TLSv1.3', 'TLS 1.3', 'tlsv1.3', '1.3', 'TLSv1_3', 'v1.3'] as const;

/** TLS versions (and nullish inputs) that are NOT TLS 1.3. */
const NON_TLS13_VERSIONS = ['TLSv1.2', '1.2', 'TLSv1.1', 'SSLv3', '', null, undefined] as const;

/** A negotiated TLS version: any 1.3 spelling, any non-1.3 value, or nullish. */
const tlsVersionArb: fc.Arbitrary<string | null | undefined> = fc.constantFrom(
  ...TLS13_VERSIONS,
  ...NON_TLS13_VERSIONS,
);

/** A presented cert fingerprint: matching, non-matching, blank, or absent. */
const fingerprintArb: fc.Arbitrary<string | null | undefined> = fc.constantFrom(
  ...MATCHING_FINGERPRINTS,
  ...NON_MATCHING_FINGERPRINTS,
  '',
  null,
  undefined,
);

/** Pin configuration: the trusted set, or empty (pinning unconfigured). */
const pinsArb: fc.Arbitrary<readonly string[]> = fc.constantFrom(PINS, [] as string[]);

/** A request body standing in for the health-data payload that must not leak. */
const HEALTH_DATA_BODY = { patient: 'p-1', cortisol: [12.3, 9.8], meals: ['oats'] } as const;

function makeContext(
  tlsVersion: string | null | undefined,
  fingerprint: string | null | undefined,
): RequestContext {
  const headers: Record<string, string> = {};
  if (tlsVersion != null) {
    headers[DEFAULT_TLS_VERSION_HEADER] = tlsVersion;
  }
  if (fingerprint != null) {
    headers[DEFAULT_CERT_FINGERPRINT_HEADER] = fingerprint;
  }
  const request: GatewayRequest = {
    id: 'req-egress',
    kind: 'graphql',
    method: 'POST',
    path: '/graphql',
    headers,
    body: HEALTH_DATA_BODY,
  };
  return { request, auth: null, route: null, startedAt: 0, attributes: {} };
}

describe('Property 55: TLS/cert-pinning failure blocks all health-data egress', () => {
  it('rejects, transmits zero health-data bytes, and records the attempt whenever TLS 1.3 or pinning fails', async () => {
    await fc.assert(
      fc.asyncProperty(
        tlsVersionArb,
        fingerprintArb,
        pinsArb,
        async (tlsVersion, fingerprint, pins) => {
          const recorder = new InMemoryFailedAttemptRecorder();
          const guard = new TransportGuard({ pinnedCertFingerprints: pins, recorder });
          const mw = guard.middleware();

          // Ground truth: egress is allowed ONLY with TLS 1.3 AND a pinned cert.
          const secure =
            pins.length > 0 && isTls13(tlsVersion) && matchesPinnedCert(fingerprint, pins);

          let forwardedBody: unknown;
          let forwarded = false;
          const next: NextFn = async (ctx): Promise<GatewayResponse> => {
            forwarded = true;
            forwardedBody = ctx.request.body;
            return { status: STATUS.OK, ok: true, body: 'downstream' };
          };

          const res = await mw.handle(makeContext(tlsVersion, fingerprint), next);

          if (secure) {
            // Complement: a fully valid transport is allowed through untouched.
            expect(forwarded).toBe(true);
            expect(forwardedBody).toBe(HEALTH_DATA_BODY);
            expect(res.ok).toBe(true);
            expect(recorder.count).toBe(0);
            return;
          }

          // --- Rejected: next is never invoked (zero health-data egress). ---
          expect(forwarded).toBe(false);
          expect(forwardedBody).toBeUndefined();

          // --- Rejected: forbidden response carrying the TLS-required error. ---
          expect(res.ok).toBe(false);
          expect(res.status).toBe(STATUS.FORBIDDEN);
          expect(res.error?.code).toBe(GATEWAY_ERROR.TLS_REQUIRED);
          // No response body means no downstream/health payload echoed back.
          expect(res.body).toBeUndefined();

          // --- Rejected: the failed attempt is recorded exactly once, and the
          //     record carries only transport metadata, never the payload. ---
          expect(recorder.count).toBe(1);
          const attempt = recorder.last;
          expect(attempt).toBeDefined();
          expect(attempt?.reason).toBeDefined();
          expect(JSON.stringify(attempt)).not.toContain('cortisol');
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
