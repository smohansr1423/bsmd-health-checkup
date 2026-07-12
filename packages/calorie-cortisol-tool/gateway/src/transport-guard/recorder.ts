/**
 * Failed-connection-attempt recording (Task 16.4).
 *
 * Requirement 25.3 mandates that a rejected TLS/cert-pinning connection is
 * *recorded*. The recorder is an injected sink so the {@link TransportGuard}
 * stays testable and the durable implementation (audit log / SIEM) can be
 * wired independently. The recorded attempt deliberately carries only
 * transport metadata — never any health-data payload — so recording a failure
 * cannot itself leak bytes.
 *
 * Requirements: 25.3
 */

import type { TransportRejectionReason } from './security';

/** A single rejected connection attempt, captured for the audit trail. */
export interface FailedConnectionAttempt {
  /** Correlating request id, when available. */
  readonly requestId?: string;
  /** Remote peer IP, when available. */
  readonly remoteIp?: string;
  /** Request path the peer attempted to reach, when available. */
  readonly path?: string;
  /** Why the connection was rejected. */
  readonly reason: TransportRejectionReason;
  /** The negotiated TLS version (if any) at the time of rejection. */
  readonly negotiatedTlsVersion?: string | null;
  /** The certificate fingerprint the peer presented (if any). */
  readonly presentedCertFingerprint?: string | null;
  /** ISO-8601 timestamp of the rejection. */
  readonly timestamp: string;
}

/**
 * Append-only sink for rejected connection attempts. Injected into the
 * {@link TransportGuard}; production wires this to the durable audit log.
 */
export interface FailedAttemptRecorder {
  record(attempt: FailedConnectionAttempt): void | Promise<void>;
}

/**
 * In-memory {@link FailedAttemptRecorder} for tests and local development.
 * Retains every recorded attempt in insertion order.
 */
export class InMemoryFailedAttemptRecorder implements FailedAttemptRecorder {
  private readonly attempts: FailedConnectionAttempt[] = [];

  record(attempt: FailedConnectionAttempt): void {
    this.attempts.push(attempt);
  }

  /** All recorded attempts, in the order they were recorded. */
  get recorded(): readonly FailedConnectionAttempt[] {
    return this.attempts;
  }

  /** Number of recorded attempts. */
  get count(): number {
    return this.attempts.length;
  }

  /** The most recently recorded attempt, or undefined if none. */
  get last(): FailedConnectionAttempt | undefined {
    return this.attempts[this.attempts.length - 1];
  }

  /** Discard all recorded attempts. */
  clear(): void {
    this.attempts.length = 0;
  }
}
