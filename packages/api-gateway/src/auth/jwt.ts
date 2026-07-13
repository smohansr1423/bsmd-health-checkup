/**
 * Minimal, dependency-free JWT (HS256) sign/verify utility.
 *
 * This is the single source of truth for the gateway's token format. Both the
 * login endpoint (which ISSUES tokens) and the auth middleware (which VALIDATES
 * them) go through here, so the two can never drift apart.
 *
 * Security properties:
 *  - HMAC-SHA256 signature over `base64url(header).base64url(payload)`.
 *  - Constant-time signature comparison (guards against timing attacks).
 *  - `exp` (expiry) and `iat` (issued-at) are always set and enforced on verify.
 *  - Rejects the `alg: none` downgrade and any non-HS256 algorithm.
 *
 * Validates: Requirements 18.1, 18.2, 18.5
 */

import crypto from 'crypto';

/** Registered + custom claims carried by a gateway token. */
export interface JwtClaims {
  /** Subject — the userId. */
  sub: string;
  /** Role claim used for RBAC. */
  role: string;
  /** Session id this token belongs to. */
  sid: string;
  /** Issued-at (seconds since epoch). */
  iat: number;
  /** Expiry (seconds since epoch). */
  exp: number;
}

const HEADER = { alg: 'HS256', typ: 'JWT' } as const;

function base64urlEncode(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

function hmacSha256(input: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(input).digest('base64url');
}

/** Timing-safe string comparison for signatures. */
function safeEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) {
    return false;
  }
  return crypto.timingSafeEqual(ab, bb);
}

/**
 * Sign a token. `sub`, `role`, and `sid` are supplied by the caller; `iat`/`exp`
 * are derived from `now` and `expiresInMs`.
 */
export function signToken(
  input: { sub: string; role: string; sid: string },
  secret: string,
  expiresInMs: number,
  now: Date = new Date()
): { token: string; issuedAt: Date; expiresAt: Date } {
  if (!secret) {
    throw new Error('signToken: secret must be a non-empty string');
  }
  const iatMs = now.getTime();
  const expMs = iatMs + expiresInMs;
  const claims: JwtClaims = {
    sub: input.sub,
    role: input.role,
    sid: input.sid,
    iat: Math.floor(iatMs / 1000),
    exp: Math.floor(expMs / 1000),
  };

  const encodedHeader = base64urlEncode(JSON.stringify(HEADER));
  const encodedPayload = base64urlEncode(JSON.stringify(claims));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = hmacSha256(signingInput, secret);

  return {
    token: `${signingInput}.${signature}`,
    issuedAt: new Date(iatMs),
    expiresAt: new Date(expMs),
  };
}

/**
 * Verify a token's structure, algorithm, signature, and expiry.
 * Returns the decoded claims on success, or `null` on any failure. Never throws.
 */
export function verifyToken(
  token: string,
  secret: string,
  now: Date = new Date()
): JwtClaims | null {
  if (!token || !secret) {
    return null;
  }

  const parts = token.split('.');
  if (parts.length !== 3) {
    return null;
  }
  const [encodedHeader, encodedPayload, providedSignature] = parts;

  // Verify signature first (before trusting any decoded content).
  const expectedSignature = hmacSha256(`${encodedHeader}.${encodedPayload}`, secret);
  if (!safeEquals(providedSignature, expectedSignature)) {
    return null;
  }

  // Header must declare HS256 — reject `none`/algorithm-confusion downgrades.
  let header: { alg?: unknown; typ?: unknown };
  try {
    header = JSON.parse(Buffer.from(encodedHeader, 'base64url').toString('utf-8'));
  } catch {
    return null;
  }
  if (header.alg !== 'HS256') {
    return null;
  }

  let claims: JwtClaims;
  try {
    claims = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf-8'));
  } catch {
    return null;
  }

  if (
    typeof claims.sub !== 'string' ||
    typeof claims.role !== 'string' ||
    typeof claims.sid !== 'string' ||
    typeof claims.iat !== 'number' ||
    typeof claims.exp !== 'number'
  ) {
    return null;
  }

  // Enforce expiry.
  if (now.getTime() >= claims.exp * 1000) {
    return null;
  }

  return claims;
}
