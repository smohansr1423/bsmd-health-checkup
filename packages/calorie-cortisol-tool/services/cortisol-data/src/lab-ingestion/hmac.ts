/**
 * HMAC verification for the lab-results webhook (design: API Gateway —
 * "`/webhooks/lab-results` (HMAC-verified)"; Req 8.4/8.8).
 *
 * The lab partner signs the exact raw request body with a shared secret using
 * HMAC-SHA256 and sends the hex digest in a signature header. We recompute the
 * digest over the received raw body and compare in constant time.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

/** Signature scheme prefix some partners prepend (e.g. `sha256=<hex>`). */
const SCHEME_PREFIX = /^sha256=/i;

/** Compute the hex HMAC-SHA256 of `rawBody` under `secret`. */
export function computeSignature(rawBody: string, secret: string): string {
  return createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
}

/**
 * Verify a provided signature against the raw body using a constant-time
 * comparison. Accepts an optional `sha256=` scheme prefix. Returns false for a
 * missing/empty signature or secret, or any length/format mismatch — never
 * throws.
 */
export function verifyHmacSignature(
  rawBody: string,
  providedSignature: string | undefined | null,
  secret: string,
): boolean {
  if (!providedSignature || !secret) return false;

  const provided = providedSignature.replace(SCHEME_PREFIX, '').trim().toLowerCase();
  const expected = computeSignature(rawBody, secret);

  // Constant-time compare requires equal-length buffers.
  if (provided.length !== expected.length) return false;

  try {
    return timingSafeEqual(
      Buffer.from(provided, 'hex'),
      Buffer.from(expected, 'hex'),
    );
  } catch {
    // Non-hex provided signature → Buffer length mismatch → not verified.
    return false;
  }
}
