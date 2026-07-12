/**
 * Pure TLS 1.3 + certificate-pinning decision logic (Task 16.4).
 *
 * Requirement 25.3:
 *   "IF a network connection cannot be established using TLS 1.3 OR
 *    certificate-pinning validation fails, THEN reject the connection,
 *    transmit no health data, and record the failed connection attempt."
 *
 * The decision is a pure function of two negotiated facts — the negotiated TLS
 * version and the certificate fingerprint the peer presented — plus the set of
 * pinned fingerprints the gateway trusts. Keeping it side-effect free makes the
 * accept/reject rule exhaustively unit-testable without any sockets, and lets
 * the {@link TransportGuard} adapter own the recording + short-circuit
 * behaviour separately.
 *
 * Fail-closed posture: anything that is not provably TLS 1.3 with a pinned
 * certificate is rejected. Missing metadata, an empty pin set, or an unknown
 * fingerprint all reject — the gateway never "assumes" a secure channel.
 *
 * Requirements: 25.3
 */

/** The exact TLS version health-data transport requires (design: TLS 1.3). */
export const REQUIRED_TLS_VERSION = '1.3';

/** Why a transport-security check rejected a connection. */
export type TransportRejectionReason =
  /** No TLS version was negotiated / surfaced to the gateway. */
  | 'tls-version-missing'
  /** A TLS version was negotiated but it is not 1.3. */
  | 'tls-version-unsupported'
  /** The gateway has no pinned fingerprints configured (cannot validate). */
  | 'pinning-unconfigured'
  /** The peer presented no certificate fingerprint. */
  | 'cert-fingerprint-missing'
  /** The presented fingerprint does not match any pinned fingerprint. */
  | 'cert-pinning-mismatch';

/** Inputs to the pure transport-security decision. */
export interface TransportSecurityInput {
  /** The negotiated TLS protocol version, e.g. `"TLSv1.3"`, `"1.2"`. */
  readonly negotiatedTlsVersion?: string | null;
  /** The certificate fingerprint the peer presented (any common encoding). */
  readonly presentedCertFingerprint?: string | null;
  /** Fingerprints the gateway pins/trusts. Empty means pinning is unconfigured. */
  readonly pinnedCertFingerprints: readonly string[];
}

/** The result of the pure transport-security decision. */
export type TransportSecurityDecision =
  | { readonly accepted: true }
  | {
      readonly accepted: false;
      readonly reason: TransportRejectionReason;
      readonly detail: string;
    };

/**
 * Normalize a TLS version label to its bare `major.minor` form so cosmetic
 * differences (`"TLSv1.3"`, `"TLS 1.3"`, `"tlsv1_3"`, `"1.3"`) compare equal.
 */
export function normalizeTlsVersion(version: string): string {
  return version
    .trim()
    .toLowerCase()
    .replace(/^tls\s*v?/, '') // strip a leading "tls" / "tlsv" prefix
    .replace(/^v/, '') // strip a bare leading "v"
    .replace(/_/g, '.') // "1_3" -> "1.3"
    .trim();
}

/**
 * Whether a negotiated TLS version string denotes TLS 1.3.
 */
export function isTls13(version: string | null | undefined): boolean {
  if (version == null) {
    return false;
  }
  return normalizeTlsVersion(version) === REQUIRED_TLS_VERSION;
}

/**
 * Normalize a certificate fingerprint for comparison: lowercase and strip the
 * separators (`:`, whitespace) and any `sha256:`-style algorithm prefix that
 * differ between encoders but not between identical certificates.
 */
export function normalizeFingerprint(fingerprint: string): string {
  return fingerprint
    .trim()
    .toLowerCase()
    .replace(/^sha(?:1|256|384|512):/, '')
    .replace(/[\s:]/g, '');
}

/**
 * Whether a presented fingerprint matches any pinned fingerprint. A blank
 * presented fingerprint or an empty pin set never matches (fail-closed).
 */
export function matchesPinnedCert(
  presented: string | null | undefined,
  pinned: readonly string[],
): boolean {
  if (presented == null || presented.trim() === '') {
    return false;
  }
  const target = normalizeFingerprint(presented);
  if (target === '') {
    return false;
  }
  return pinned.some((pin) => normalizeFingerprint(pin) === target);
}

/**
 * The pure accept/reject decision for a single connection.
 *
 * The connection is accepted only when TLS 1.3 was negotiated AND the peer's
 * certificate fingerprint matches a configured pin. Every other case rejects
 * with a specific {@link TransportRejectionReason}. TLS-version failures are
 * reported ahead of pinning failures, but either one alone rejects.
 */
export function evaluateTransportSecurity(
  input: TransportSecurityInput,
): TransportSecurityDecision {
  const { negotiatedTlsVersion, presentedCertFingerprint, pinnedCertFingerprints } =
    input;

  // --- 1. TLS 1.3 establishment ---
  if (negotiatedTlsVersion == null || negotiatedTlsVersion.trim() === '') {
    return {
      accepted: false,
      reason: 'tls-version-missing',
      detail: 'No TLS version was negotiated for the connection.',
    };
  }
  if (!isTls13(negotiatedTlsVersion)) {
    return {
      accepted: false,
      reason: 'tls-version-unsupported',
      detail: `Negotiated TLS version "${negotiatedTlsVersion}" is not TLS 1.3.`,
    };
  }

  // --- 2. Certificate pinning ---
  if (pinnedCertFingerprints.length === 0) {
    return {
      accepted: false,
      reason: 'pinning-unconfigured',
      detail: 'No pinned certificate fingerprints are configured.',
    };
  }
  if (presentedCertFingerprint == null || presentedCertFingerprint.trim() === '') {
    return {
      accepted: false,
      reason: 'cert-fingerprint-missing',
      detail: 'The peer presented no certificate fingerprint.',
    };
  }
  if (!matchesPinnedCert(presentedCertFingerprint, pinnedCertFingerprints)) {
    return {
      accepted: false,
      reason: 'cert-pinning-mismatch',
      detail: 'The presented certificate fingerprint does not match any pin.',
    };
  }

  return { accepted: true };
}
