/**
 * Unit tests for the TLS 1.3 / certificate-pinning egress guard (Task 16.4).
 *
 * Validates Requirement 25.3: connections that cannot establish TLS 1.3 or
 * pass certificate pinning are rejected, no health data is transmitted, and the
 * failed attempt is recorded.
 */

import { GATEWAY_ERROR, STATUS } from '../responses';
import type { GatewayRequest, GatewayResponse, NextFn, RequestContext } from '../types';
import {
  DEFAULT_CERT_FINGERPRINT_HEADER,
  DEFAULT_TLS_VERSION_HEADER,
  InMemoryFailedAttemptRecorder,
  TransportGuard,
  evaluateTransportSecurity,
  isTls13,
  matchesPinnedCert,
  normalizeFingerprint,
  normalizeTlsVersion,
} from './index';

const PIN_A = 'AB:CD:EF:01:23:45:67:89';
const PIN_B = 'sha256:99887766554433221100';

describe('normalizeTlsVersion / isTls13', () => {
  it('normalizes common TLS 1.3 spellings to "1.3"', () => {
    for (const v of ['TLSv1.3', 'TLS 1.3', 'tlsv1.3', '1.3', 'TLSv1_3', 'v1.3']) {
      expect(normalizeTlsVersion(v)).toBe('1.3');
      expect(isTls13(v)).toBe(true);
    }
  });

  it('rejects non-1.3 versions and nullish input', () => {
    for (const v of ['TLSv1.2', '1.2', 'TLSv1.1', 'SSLv3', '']) {
      expect(isTls13(v)).toBe(false);
    }
    expect(isTls13(null)).toBe(false);
    expect(isTls13(undefined)).toBe(false);
  });
});

describe('normalizeFingerprint / matchesPinnedCert', () => {
  it('ignores case, separators, and algorithm prefixes', () => {
    expect(normalizeFingerprint('AB:CD:ef')).toBe('abcdef');
    expect(normalizeFingerprint('sha256:AB CD ef')).toBe('abcdef');
  });

  it('matches a presented fingerprint against pins regardless of encoding', () => {
    expect(matchesPinnedCert('abcdef0123456789', [PIN_A])).toBe(true);
    expect(matchesPinnedCert('9988-7766-5544-3322-1100', [PIN_B])).toBe(false);
    expect(matchesPinnedCert('99887766554433221100', [PIN_B])).toBe(true);
  });

  it('never matches a blank fingerprint or an empty pin set', () => {
    expect(matchesPinnedCert('', [PIN_A])).toBe(false);
    expect(matchesPinnedCert(null, [PIN_A])).toBe(false);
    expect(matchesPinnedCert('abcdef0123456789', [])).toBe(false);
  });
});

describe('evaluateTransportSecurity (pure decision)', () => {
  it('accepts TLS 1.3 with a pinned certificate', () => {
    const d = evaluateTransportSecurity({
      negotiatedTlsVersion: 'TLSv1.3',
      presentedCertFingerprint: PIN_A,
      pinnedCertFingerprints: [PIN_A],
    });
    expect(d.accepted).toBe(true);
  });

  it('rejects when no TLS version was negotiated', () => {
    const d = evaluateTransportSecurity({
      negotiatedTlsVersion: null,
      presentedCertFingerprint: PIN_A,
      pinnedCertFingerprints: [PIN_A],
    });
    expect(d).toMatchObject({ accepted: false, reason: 'tls-version-missing' });
  });

  it('rejects when the negotiated version is not 1.3', () => {
    const d = evaluateTransportSecurity({
      negotiatedTlsVersion: 'TLSv1.2',
      presentedCertFingerprint: PIN_A,
      pinnedCertFingerprints: [PIN_A],
    });
    expect(d).toMatchObject({ accepted: false, reason: 'tls-version-unsupported' });
  });

  it('rejects when no pins are configured (fail-closed)', () => {
    const d = evaluateTransportSecurity({
      negotiatedTlsVersion: 'TLSv1.3',
      presentedCertFingerprint: PIN_A,
      pinnedCertFingerprints: [],
    });
    expect(d).toMatchObject({ accepted: false, reason: 'pinning-unconfigured' });
  });

  it('rejects when the peer presents no certificate', () => {
    const d = evaluateTransportSecurity({
      negotiatedTlsVersion: 'TLSv1.3',
      presentedCertFingerprint: '',
      pinnedCertFingerprints: [PIN_A],
    });
    expect(d).toMatchObject({ accepted: false, reason: 'cert-fingerprint-missing' });
  });

  it('rejects when the presented certificate matches no pin', () => {
    const d = evaluateTransportSecurity({
      negotiatedTlsVersion: 'TLSv1.3',
      presentedCertFingerprint: 'deadbeefdeadbeef',
      pinnedCertFingerprints: [PIN_A],
    });
    expect(d).toMatchObject({ accepted: false, reason: 'cert-pinning-mismatch' });
  });

  it('reports the TLS-version failure ahead of a pinning failure', () => {
    const d = evaluateTransportSecurity({
      negotiatedTlsVersion: 'TLSv1.2',
      presentedCertFingerprint: 'nope',
      pinnedCertFingerprints: [PIN_A],
    });
    expect(d).toMatchObject({ accepted: false, reason: 'tls-version-unsupported' });
  });
});

describe('TransportGuard.check', () => {
  const clock = () => new Date('2024-01-01T00:00:00.000Z');

  it('accepts a valid connection and records nothing', async () => {
    const recorder = new InMemoryFailedAttemptRecorder();
    const guard = new TransportGuard({ pinnedCertFingerprints: [PIN_A], recorder, clock });

    const result = await guard.check({
      negotiatedTlsVersion: 'TLSv1.3',
      presentedCertFingerprint: PIN_A,
    });

    expect(result.ok).toBe(true);
    expect(recorder.count).toBe(0);
  });

  it('rejects an invalid connection, records it, and returns a structured error', async () => {
    const recorder = new InMemoryFailedAttemptRecorder();
    const guard = new TransportGuard({ pinnedCertFingerprints: [PIN_A], recorder, clock });

    const result = await guard.check({
      negotiatedTlsVersion: 'TLSv1.2',
      presentedCertFingerprint: PIN_A,
      requestId: 'req-1',
      remoteIp: '203.0.113.7',
      path: '/graphql',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(GATEWAY_ERROR.TLS_REQUIRED);
      expect(result.error.retainedState).toBe(true);
    }
    expect(recorder.count).toBe(1);
    expect(recorder.last).toMatchObject({
      requestId: 'req-1',
      remoteIp: '203.0.113.7',
      path: '/graphql',
      reason: 'tls-version-unsupported',
      negotiatedTlsVersion: 'TLSv1.2',
      timestamp: '2024-01-01T00:00:00.000Z',
    });
  });

  it('marks a missing-version failure retryable and a pin mismatch non-retryable', async () => {
    const recorder = new InMemoryFailedAttemptRecorder();
    const guard = new TransportGuard({ pinnedCertFingerprints: [PIN_A], recorder, clock });

    const missing = await guard.check({ negotiatedTlsVersion: null });
    const mismatch = await guard.check({
      negotiatedTlsVersion: 'TLSv1.3',
      presentedCertFingerprint: 'deadbeef',
    });

    expect(missing.ok).toBe(false);
    expect(mismatch.ok).toBe(false);
    if (!missing.ok) expect(missing.error.retryable).toBe(true);
    if (!mismatch.ok) expect(mismatch.error.retryable).toBe(false);
  });
});

function makeRequest(overrides: Partial<GatewayRequest> = {}): GatewayRequest {
  return {
    id: 'req-x',
    kind: 'graphql',
    method: 'POST',
    path: '/graphql',
    headers: {},
    body: { sensitive: 'health-data-payload' },
    ...overrides,
  };
}

function makeContext(request: GatewayRequest): RequestContext {
  return {
    request,
    auth: null,
    route: null,
    startedAt: 0,
    attributes: {},
  };
}

describe('TransportGuard.terminate (chain seat adapter)', () => {
  it('reads TLS version from connection metadata and fingerprint from headers', async () => {
    const recorder = new InMemoryFailedAttemptRecorder();
    const guard = new TransportGuard({ pinnedCertFingerprints: [PIN_A], recorder });

    const accepted = await guard.terminate(
      makeRequest({
        connection: { tlsVersion: 'TLSv1.3' },
        headers: { [DEFAULT_CERT_FINGERPRINT_HEADER]: PIN_A },
      }),
    );
    expect(accepted.accepted).toBe(true);

    const rejected = await guard.terminate(
      makeRequest({
        connection: { tlsVersion: 'TLSv1.2' },
        headers: { [DEFAULT_CERT_FINGERPRINT_HEADER]: PIN_A },
      }),
    );
    expect(rejected.accepted).toBe(false);
    expect(rejected.error?.code).toBe(GATEWAY_ERROR.TLS_REQUIRED);
    expect(recorder.count).toBe(1);
  });

  it('falls back to a TLS-version header when connection metadata is absent', async () => {
    const recorder = new InMemoryFailedAttemptRecorder();
    const guard = new TransportGuard({ pinnedCertFingerprints: [PIN_A], recorder });

    const decision = await guard.terminate(
      makeRequest({
        headers: {
          [DEFAULT_TLS_VERSION_HEADER]: 'TLSv1.3',
          [DEFAULT_CERT_FINGERPRINT_HEADER]: PIN_A,
        },
      }),
    );
    expect(decision.accepted).toBe(true);
  });
});

describe('TransportGuard.middleware (zero health-data egress)', () => {
  it('does NOT call next on rejection, so no request body is forwarded', async () => {
    const recorder = new InMemoryFailedAttemptRecorder();
    const guard = new TransportGuard({ pinnedCertFingerprints: [PIN_A], recorder });
    const mw = guard.middleware();

    let forwarded = false;
    const next: NextFn = async (): Promise<GatewayResponse> => {
      forwarded = true;
      return { status: STATUS.OK, ok: true, body: 'downstream' };
    };

    const req = makeRequest({
      connection: { tlsVersion: 'TLSv1.2' },
      headers: { [DEFAULT_CERT_FINGERPRINT_HEADER]: PIN_A },
    });
    const res = await mw.handle(makeContext(req), next);

    expect(forwarded).toBe(false); // zero bytes forwarded downstream
    expect(res.ok).toBe(false);
    expect(res.status).toBe(STATUS.FORBIDDEN);
    expect(res.error?.code).toBe(GATEWAY_ERROR.TLS_REQUIRED);
    expect(res.body).toBeUndefined();
    expect(recorder.count).toBe(1);
  });

  it('delegates to next on an accepted connection', async () => {
    const recorder = new InMemoryFailedAttemptRecorder();
    const guard = new TransportGuard({ pinnedCertFingerprints: [PIN_A], recorder });
    const mw = guard.middleware();

    let forwarded = false;
    const next: NextFn = async (): Promise<GatewayResponse> => {
      forwarded = true;
      return { status: STATUS.OK, ok: true, body: 'downstream' };
    };

    const req = makeRequest({
      connection: { tlsVersion: 'TLSv1.3' },
      headers: { [DEFAULT_CERT_FINGERPRINT_HEADER]: PIN_A },
    });
    const res = await mw.handle(makeContext(req), next);

    expect(forwarded).toBe(true);
    expect(res.ok).toBe(true);
    expect(res.body).toBe('downstream');
    expect(recorder.count).toBe(0);
  });

  it('names the middleware "transport-guard" for chain introspection', () => {
    const recorder = new InMemoryFailedAttemptRecorder();
    const guard = new TransportGuard({ pinnedCertFingerprints: [PIN_A], recorder });
    expect(guard.middleware().name).toBe('transport-guard');
  });
});
