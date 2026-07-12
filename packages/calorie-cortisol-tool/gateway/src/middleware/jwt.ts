/**
 * HMAC-SHA256 (HS256) JWT verification (Task 16.1).
 *
 * The gateway's auth stage verifies the bearer JWT before any health-data
 * routing (design: "AuthN — JWT 15-min + refresh"). Verification is pure and
 * deterministic given (a) the shared signing secret and (b) an injected clock,
 * so it is fully unit-testable without wall-clock flakiness.
 *
 * This intentionally supports only HS256 — the token shape used between the
 * gateway and the identity service — and rejects `alg: none` and any other
 * algorithm to avoid algorithm-confusion attacks.
 *
 * Requirements: 18.1, 25.2
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import type {
  AuthPrincipal,
  AuthVerification,
  AuthVerifier,
} from '../types';

/** A monotonic-ish clock returning epoch milliseconds (injectable for tests). */
export type Clock = () => number;

/** Standard system clock. */
export const systemClock: Clock = () => Date.now();

/** Decoded JWT claims the gateway understands. */
export interface JwtClaims {
  /** Subject — the user id. */
  readonly sub: string;
  /** Expiry (epoch seconds). */
  readonly exp?: number;
  /** Not-before (epoch seconds). */
  readonly nbf?: number;
  /** Issued-at (epoch seconds). */
  readonly iat?: number;
  readonly familyAccountId?: string;
  readonly roles?: readonly string[];
  readonly region?: string;
  readonly consentedCategories?: readonly string[];
  readonly [claim: string]: unknown;
}

/** Configuration for {@link HmacJwtVerifier}. */
export interface JwtVerifierConfig {
  /** Shared HS256 signing secret. */
  readonly secret: string;
  /** Clock injected for exp/nbf checks. Defaults to {@link systemClock}. */
  readonly clock?: Clock;
  /** Clock skew tolerance in seconds. Defaults to 0. */
  readonly clockSkewSeconds?: number;
}

/** base64url-decode to a Buffer. */
function base64UrlDecode(input: string): Buffer {
  const pad = input.length % 4 === 0 ? '' : '='.repeat(4 - (input.length % 4));
  const b64 = input.replace(/-/g, '+').replace(/_/g, '/') + pad;
  return Buffer.from(b64, 'base64');
}

/** base64url-encode a Buffer. */
function base64UrlEncode(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Sign the `header.payload` segment with HS256. Exposed so tests (and the
 * identity service, conceptually) can mint valid tokens.
 */
export function signHs256(signingInput: string, secret: string): string {
  return base64UrlEncode(createHmac('sha256', secret).update(signingInput).digest());
}

/** Mint an HS256 JWT for the given claims (test / dev helper). */
export function mintHs256(claims: JwtClaims, secret: string): string {
  const header = base64UrlEncode(Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const payload = base64UrlEncode(Buffer.from(JSON.stringify(claims)));
  const signingInput = `${header}.${payload}`;
  return `${signingInput}.${signHs256(signingInput, secret)}`;
}

/**
 * Constant-time signature comparison. Returns false on length mismatch (which
 * `timingSafeEqual` would otherwise throw on).
 */
function safeSignatureEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

function claimsToPrincipal(claims: JwtClaims): AuthPrincipal {
  return {
    userId: claims.sub,
    ...(claims.familyAccountId ? { familyAccountId: claims.familyAccountId } : {}),
    roles: claims.roles ?? [],
    ...(claims.region ? { region: claims.region } : {}),
    ...(claims.consentedCategories
      ? { consentedCategories: claims.consentedCategories }
      : {}),
  };
}

/** An {@link AuthVerifier} that verifies HS256 JWTs. */
export class HmacJwtVerifier implements AuthVerifier {
  private readonly secret: string;
  private readonly clock: Clock;
  private readonly skewSeconds: number;

  constructor(config: JwtVerifierConfig) {
    this.secret = config.secret;
    this.clock = config.clock ?? systemClock;
    this.skewSeconds = config.clockSkewSeconds ?? 0;
  }

  verify(token: string): AuthVerification {
    if (typeof token !== 'string' || token.length === 0) {
      return { valid: false, reason: 'missing token' };
    }
    const parts = token.split('.');
    if (parts.length !== 3) {
      return { valid: false, reason: 'malformed token' };
    }
    const [headerB64, payloadB64, signatureB64] = parts;

    // Header: enforce HS256, reject `none` and algorithm confusion.
    let header: { alg?: string };
    try {
      header = JSON.parse(base64UrlDecode(headerB64).toString('utf8'));
    } catch {
      return { valid: false, reason: 'malformed header' };
    }
    if (header.alg !== 'HS256') {
      return { valid: false, reason: `unsupported alg: ${String(header.alg)}` };
    }

    // Signature verification (constant time).
    const expected = signHs256(`${headerB64}.${payloadB64}`, this.secret);
    if (!safeSignatureEqual(expected, signatureB64)) {
      return { valid: false, reason: 'signature mismatch' };
    }

    // Claims + temporal validity.
    let claims: JwtClaims;
    try {
      claims = JSON.parse(base64UrlDecode(payloadB64).toString('utf8'));
    } catch {
      return { valid: false, reason: 'malformed claims' };
    }
    if (typeof claims.sub !== 'string' || claims.sub.length === 0) {
      return { valid: false, reason: 'missing subject' };
    }

    const nowSeconds = Math.floor(this.clock() / 1000);
    if (typeof claims.exp === 'number' && nowSeconds > claims.exp + this.skewSeconds) {
      return { valid: false, reason: 'token expired' };
    }
    if (typeof claims.nbf === 'number' && nowSeconds + this.skewSeconds < claims.nbf) {
      return { valid: false, reason: 'token not yet valid' };
    }

    return { valid: true, principal: claimsToPrincipal(claims) };
  }
}
