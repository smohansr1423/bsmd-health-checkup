/**
 * Transport guard: enforces TLS 1.3 + certificate pinning at the gateway edge
 * (Task 16.4).
 *
 * Requirement 25.3: reject the connection, transmit no health data, and record
 * the failed attempt whenever TLS 1.3 cannot be established or certificate
 * pinning fails.
 *
 * This module wires the pure {@link evaluateTransportSecurity} decision to the
 * two mandated side effects:
 *   1. Recording — every rejection is written to the injected
 *      {@link FailedAttemptRecorder} *before* the caller is told, so a failed
 *      attempt is never silently dropped.
 *   2. Zero egress — the guard runs at the very front of the chain and
 *      short-circuits on rejection. It never calls `next`, so no request body
 *      (potential health data) is forwarded downstream.
 *
 * The guard implements the {@link TlsTerminator} extension point declared by
 * Task 16.1, so it drops straight into the gateway middleware chain seat.
 *
 * Requirements: 25.3
 */

import { type ErrorContract, type Result, err, ok } from '@calorie-cortisol/shared/result';
import { GATEWAY_ERROR, STATUS, respondError } from '../responses';
import type {
  GatewayRequest,
  GatewayResponse,
  Middleware,
  NextFn,
  RequestContext,
  TlsDecision,
  TlsTerminator,
} from '../types';
import type { FailedAttemptRecorder } from './recorder';
import {
  type TransportRejectionReason,
  type TransportSecurityDecision,
  evaluateTransportSecurity,
} from './security';

/** Header carrying the peer's presented certificate fingerprint by default. */
export const DEFAULT_CERT_FINGERPRINT_HEADER = 'x-tls-cert-fingerprint';
/** Header carrying the negotiated TLS version when not on connection metadata. */
export const DEFAULT_TLS_VERSION_HEADER = 'x-tls-version';

/** The negotiated transport facts for one connection attempt. */
export interface TransportConnection {
  /** The negotiated TLS protocol version, e.g. `"TLSv1.3"`. */
  readonly negotiatedTlsVersion?: string | null;
  /** The certificate fingerprint the peer presented. */
  readonly presentedCertFingerprint?: string | null;
  /** Correlating request id (for the audit record). */
  readonly requestId?: string;
  /** Remote peer IP (for the audit record). */
  readonly remoteIp?: string;
  /** Attempted request path (for the audit record). */
  readonly path?: string;
}

/** Configuration for a {@link TransportGuard}. */
export interface TransportGuardOptions {
  /** Fingerprints the gateway pins/trusts. */
  readonly pinnedCertFingerprints: readonly string[];
  /** Sink that records rejected connection attempts (Req 25.3). */
  readonly recorder: FailedAttemptRecorder;
  /** Clock for timestamps; defaults to `() => new Date()`. */
  readonly clock?: () => Date;
  /** Header to read the presented cert fingerprint from (chain adapter). */
  readonly certFingerprintHeader?: string;
  /** Header to read the TLS version from when absent on connection metadata. */
  readonly tlsVersionHeader?: string;
}

/** Maps a rejection reason to the retryability of the resulting error. */
function isRetryable(reason: TransportRejectionReason): boolean {
  // Transient handshake problems (no version negotiated) may succeed on retry;
  // a mismatched/misconfigured pin will not until the client/config is fixed.
  switch (reason) {
    case 'tls-version-missing':
      return true;
    default:
      return false;
  }
}

/**
 * Enforces the TLS 1.3 + certificate-pinning rule for a single connection,
 * recording any rejection. This is the framework-agnostic core; the
 * {@link TransportGuard.middleware} and {@link TransportGuard.terminate}
 * adapters build on it.
 */
export class TransportGuard implements TlsTerminator {
  private readonly pinnedCertFingerprints: readonly string[];
  private readonly recorder: FailedAttemptRecorder;
  private readonly clock: () => Date;
  private readonly certFingerprintHeader: string;
  private readonly tlsVersionHeader: string;

  constructor(options: TransportGuardOptions) {
    this.pinnedCertFingerprints = options.pinnedCertFingerprints;
    this.recorder = options.recorder;
    this.clock = options.clock ?? (() => new Date());
    this.certFingerprintHeader = (
      options.certFingerprintHeader ?? DEFAULT_CERT_FINGERPRINT_HEADER
    ).toLowerCase();
    this.tlsVersionHeader = (
      options.tlsVersionHeader ?? DEFAULT_TLS_VERSION_HEADER
    ).toLowerCase();
  }

  /**
   * Evaluate one connection. On rejection the failed attempt is recorded
   * (awaited) and a structured {@link ErrorContract} is returned; on success
   * the connection facts are returned unchanged. No health data is ever part
   * of this decision, so a rejection transmits zero payload bytes.
   */
  async check(connection: TransportConnection): Promise<Result<TransportConnection>> {
    const decision: TransportSecurityDecision = evaluateTransportSecurity({
      negotiatedTlsVersion: connection.negotiatedTlsVersion,
      presentedCertFingerprint: connection.presentedCertFingerprint,
      pinnedCertFingerprints: this.pinnedCertFingerprints,
    });

    if (decision.accepted) {
      return ok(connection);
    }

    await this.recorder.record({
      requestId: connection.requestId,
      remoteIp: connection.remoteIp,
      path: connection.path,
      reason: decision.reason,
      negotiatedTlsVersion: connection.negotiatedTlsVersion ?? null,
      presentedCertFingerprint: connection.presentedCertFingerprint ?? null,
      timestamp: this.clock().toISOString(),
    });

    return err(this.buildError(decision.reason, decision.detail));
  }

  /**
   * Build the structured transport-rejection error contract. Always
   * `retainedState: true` — the guard mutates nothing and forwards nothing.
   */
  private buildError(reason: TransportRejectionReason, detail: string): ErrorContract {
    return {
      code: GATEWAY_ERROR.TLS_REQUIRED,
      message: `Secure transport required (TLS 1.3 + certificate pinning): ${detail}`,
      retryable: isRetryable(reason),
      retainedState: true,
    };
  }

  /** Extract the connection facts the guard needs from a gateway request. */
  private extractConnection(request: GatewayRequest): TransportConnection {
    const headers = request.headers ?? {};
    const tlsVersion =
      request.connection?.tlsVersion ?? headers[this.tlsVersionHeader] ?? null;
    const fingerprint = headers[this.certFingerprintHeader] ?? null;
    return {
      negotiatedTlsVersion: tlsVersion,
      presentedCertFingerprint: fingerprint,
      requestId: request.id,
      remoteIp: request.connection?.remoteIp,
      path: request.path,
    };
  }

  /**
   * {@link TlsTerminator} implementation for the middleware chain seat. Returns
   * an accept/reject decision with a structured error on rejection.
   */
  async terminate(request: GatewayRequest): Promise<TlsDecision> {
    const result = await this.check(this.extractConnection(request));
    if (result.ok) {
      return { accepted: true };
    }
    return { accepted: false, error: result.error };
  }

  /**
   * A front-of-chain {@link Middleware}. On rejection it records the attempt
   * and returns the rejection response **without calling `next`**, so no
   * request body is ever forwarded to a downstream service (zero health-data
   * egress). On success it delegates to the rest of the chain.
   */
  middleware(): Middleware {
    return {
      name: 'transport-guard',
      handle: async (ctx: RequestContext, next: NextFn): Promise<GatewayResponse> => {
        const decision = await this.terminate(ctx.request);
        if (!decision.accepted) {
          return respondError(
            STATUS.FORBIDDEN,
            decision.error ?? this.buildError('tls-version-missing', 'rejected'),
          );
        }
        return next(ctx);
      },
    };
  }
}
