/**
 * TLS 1.3 / certificate-pinning egress guard (Task 16.4).
 *
 * Public surface for the transport guard that enforces Requirement 25.3:
 * rejecting connections that cannot establish TLS 1.3 or pass certificate
 * pinning, transmitting zero health-data bytes, and recording the failed
 * attempt.
 *
 * Requirements: 25.3
 */

export * from './security';
export * from './recorder';
export * from './guard';
