/**
 * Response-to-Outcome Mapper — Property-Based Tests
 *
 * Uses fast-check to validate the design's Correctness Property 14 across a
 * broad, generated `SanitizedResponse` input space. `mapResponse` is pure and
 * total, so every generated response must yield exactly one deterministic
 * {@link UiOutcome} following the documented mapping rules.
 *
 * Feature: api-copilot-desktop
 *
 * Property 14: Backend responses map deterministically to UI outcomes
 * Validates: Requirements 2.5, 8.6, 15.5, 16.3, 16.4
 */

import * as fc from 'fast-check';

import { mapResponse } from './mapper';
import type { BackendErrorBody, SanitizedResponse } from './types';

const RUNS = {} as const;

/**
 * HTTP 401 error codes that specifically denote an expired/invalid
 * Session_Token (mirrors the gateway auth middleware and the mapper's internal
 * set). A 401 carrying one of these maps to `session_expired`; any other 401
 * maps to an ordinary `backend_error`.
 */
const SESSION_EXPIRY_CODES = [
  'SESSION_EXPIRED',
  'INVALID_TOKEN',
  'AUTHENTICATION_REQUIRED',
  'INVALID_AUTH_FORMAT',
] as const;

// ---- Generators over the SanitizedResponse input space ----

const nonEmptyCodeArb: fc.Arbitrary<string> = fc
  .string({ minLength: 1, maxLength: 30 })
  .filter((s) => s.trim().length > 0)
  // Exclude the session-expiry codes so generic error bodies never accidentally
  // trigger the session_expired branch in the "other error" tests.
  .filter((s) => !(SESSION_EXPIRY_CODES as readonly string[]).includes(s));

/** Arbitrary JSON-ish success payload the broker may have parsed from `{ data }`. */
const dataArb: fc.Arbitrary<unknown> = fc.oneof(
  fc.string(),
  fc.integer(),
  fc.boolean(),
  fc.constant(null),
  fc.record({ id: fc.string(), items: fc.array(fc.string(), { maxLength: 5 }) }),
  fc.array(fc.integer(), { maxLength: 5 }),
);

/** Arbitrary backend error body with a non-expiry code. */
const backendErrorArb: fc.Arbitrary<BackendErrorBody> = fc.record({
  code: nonEmptyCodeArb,
  message: fc.string({ maxLength: 60 }),
  details: fc.option(fc.oneof(fc.string(), fc.record({ hint: fc.string() })), { nil: undefined }),
});

/** A 2xx status. */
const successStatusArb = fc.integer({ min: 200, max: 299 });

/** A 4xx/5xx status that is neither 401 nor 429 (the plain backend_error range). */
const otherErrorStatusArb = fc
  .integer({ min: 400, max: 599 })
  .filter((s) => s !== 401 && s !== 429);

/** Any HTTP status — used to prove transport failures win regardless of status. */
const anyStatusArb = fc.integer({ min: 0, max: 599 });

// ---------------------------------------------------------------------------
// Transport-level failures win over any HTTP status (Req 15.5, 16.3 boundary)
// ---------------------------------------------------------------------------

describe('mapResponse — transport failures take precedence (Property 14)', () => {
  it('unreachable transport → { kind: "unreachable" } regardless of status/body', () => {
    fc.assert(
      fc.property(anyStatusArb, fc.option(backendErrorArb, { nil: undefined }), (status, error) => {
        const res: SanitizedResponse = { status, ok: false, error, transport: 'unreachable' };
        expect(mapResponse(res)).toEqual({ kind: 'unreachable' });
      }),
      RUNS,
    );
  });

  it('tls_failed transport → { kind: "tls_error" } regardless of status/body', () => {
    fc.assert(
      fc.property(anyStatusArb, fc.option(backendErrorArb, { nil: undefined }), (status, error) => {
        const res: SanitizedResponse = { status, ok: false, error, transport: 'tls_failed' };
        expect(mapResponse(res)).toEqual({ kind: 'tls_error' });
      }),
      RUNS,
    );
  });

  it('timeout transport → backend_error with code TIMEOUT regardless of status', () => {
    fc.assert(
      fc.property(anyStatusArb, (status) => {
        const res: SanitizedResponse = { status, ok: false, transport: 'timeout' };
        const outcome = mapResponse(res);
        expect(outcome.kind).toBe('backend_error');
        if (outcome.kind === 'backend_error') {
          expect(outcome.code).toBe('TIMEOUT');
          expect(typeof outcome.message).toBe('string');
        }
      }),
      RUNS,
    );
  });
});

// ---------------------------------------------------------------------------
// Successful (2xx) responses (Req 2.5, 8.6, 15.5)
// ---------------------------------------------------------------------------

describe('mapResponse — 2xx maps to success carrying data (Property 14)', () => {
  it('any 2xx with transport ok → { kind: "success", value: data }', () => {
    fc.assert(
      fc.property(successStatusArb, dataArb, (status, data) => {
        const res: SanitizedResponse = { status, ok: true, data, transport: 'ok' };
        expect(mapResponse(res)).toEqual({ kind: 'success', value: data });
      }),
      RUNS,
    );
  });
});

// ---------------------------------------------------------------------------
// Session expiry: 401 with a token-expiry code (Req 16.3 → 4.4)
// ---------------------------------------------------------------------------

describe('mapResponse — 401 with expiry code maps to session_expired (Property 14)', () => {
  it('401 + session-expiry code → { kind: "session_expired" }', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...SESSION_EXPIRY_CODES),
        fc.string({ maxLength: 40 }),
        (code, message) => {
          const res: SanitizedResponse = {
            status: 401,
            ok: false,
            error: { code, message },
            transport: 'ok',
          };
          expect(mapResponse(res)).toEqual({ kind: 'session_expired' });
        },
      ),
      RUNS,
    );
  });
});

// ---------------------------------------------------------------------------
// Rate limiting: 429 (Req 16.4)
// ---------------------------------------------------------------------------

describe('mapResponse — 429 maps to rate_limited (Property 14)', () => {
  it('429 with a Retry-After value → rate_limited carrying retryAfterMs', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 600_000 }), (retryAfterMs) => {
        const res: SanitizedResponse = { status: 429, ok: false, retryAfterMs, transport: 'ok' };
        expect(mapResponse(res)).toEqual({ kind: 'rate_limited', retryAfterMs });
      }),
      RUNS,
    );
  });

  it('429 without a Retry-After value → rate_limited with undefined retryAfterMs', () => {
    fc.assert(
      fc.property(fc.option(backendErrorArb, { nil: undefined }), (error) => {
        const res: SanitizedResponse = { status: 429, ok: false, error, transport: 'ok' };
        expect(mapResponse(res)).toEqual({ kind: 'rate_limited', retryAfterMs: undefined });
      }),
      RUNS,
    );
  });
});

// ---------------------------------------------------------------------------
// Every other 4xx/5xx → backend_error carrying code + message (Req 2.5, 8.6, 15.5, 16.3)
// ---------------------------------------------------------------------------

describe('mapResponse — other 4xx/5xx map to backend_error (Property 14)', () => {
  it('non-401/429 error status with an error body → backend_error carrying code + message + details', () => {
    fc.assert(
      fc.property(otherErrorStatusArb, backendErrorArb, (status, error) => {
        const res: SanitizedResponse = { status, ok: false, error, transport: 'ok' };
        expect(mapResponse(res)).toEqual({
          kind: 'backend_error',
          code: error.code,
          message: error.message,
          details: error.details,
        });
      }),
      RUNS,
    );
  });

  it('401 whose code is NOT a session-expiry code → backend_error (not session_expired)', () => {
    fc.assert(
      fc.property(backendErrorArb, (error) => {
        const res: SanitizedResponse = { status: 401, ok: false, error, transport: 'ok' };
        const outcome = mapResponse(res);
        expect(outcome.kind).toBe('backend_error');
        if (outcome.kind === 'backend_error') {
          expect(outcome.code).toBe(error.code);
          expect(outcome.message).toBe(error.message);
        }
      }),
      RUNS,
    );
  });

  it('error status with no error body → backend_error with fallback code + message', () => {
    fc.assert(
      fc.property(otherErrorStatusArb, (status) => {
        const res: SanitizedResponse = { status, ok: false, transport: 'ok' };
        const outcome = mapResponse(res);
        expect(outcome.kind).toBe('backend_error');
        if (outcome.kind === 'backend_error') {
          // Falls back to the status string and a generic message.
          expect(outcome.code).toBe(String(status));
          expect(typeof outcome.message).toBe('string');
          expect(outcome.message.length).toBeGreaterThan(0);
        }
      }),
      RUNS,
    );
  });
});

// ---------------------------------------------------------------------------
// Determinism: the mapping is a pure total function (Property 14 "deterministically")
// ---------------------------------------------------------------------------

describe('mapResponse — determinism (Property 14)', () => {
  const transportArb = fc.constantFrom<SanitizedResponse['transport']>(
    'ok',
    'timeout',
    'unreachable',
    'tls_failed',
  );

  const anyResponseArb: fc.Arbitrary<SanitizedResponse> = fc.record({
    status: anyStatusArb,
    ok: fc.boolean(),
    data: fc.option(dataArb, { nil: undefined }),
    error: fc.option(
      fc.record({
        code: fc.oneof(nonEmptyCodeArb, fc.constantFrom(...SESSION_EXPIRY_CODES)),
        message: fc.string({ maxLength: 40 }),
      }),
      { nil: undefined },
    ),
    retryAfterMs: fc.option(fc.integer({ min: 0, max: 600_000 }), { nil: undefined }),
    transport: transportArb,
  });

  it('mapping the same response twice yields deep-equal outcomes', () => {
    fc.assert(
      fc.property(anyResponseArb, (res) => {
        expect(mapResponse(res)).toEqual(mapResponse(res));
      }),
      RUNS,
    );
  });
});
