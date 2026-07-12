/**
 * No-Secret-Leak Invariant — Property-Based Tests (Task 8.4).
 *
 * Property 7: No secret ever appears in descriptors, logs, UI, or errors.
 *   For any Session_Token or credential secret value, that value does not
 *   appear as a substring of: any renderer-visible `RequestDescriptor`, any
 *   serialized application log or config artifact, any mapped error message or
 *   details — regardless of the backend error body received.
 *
 * This test drives a secret through the real client pipeline exactly as the
 * running app does:
 *
 *     builder  →  (broker) parse + sanitize  →  mapResponse  →  serialize
 *
 *  - **builder** (`builders.ts`, Task 6.1): produces the token-less
 *    `RequestDescriptor` the renderer hands to the broker. The Session_Token is
 *    never passed to a builder, so it can never appear in a descriptor and no
 *    descriptor ever carries an `Authorization` header (the broker adds it).
 *  - **sanitizer** (`ipc-handlers.ts` `parseHttpResponse` + `sanitizeResponse`,
 *    Task 8.1): even when a hostile/buggy backend echoes the token or a
 *    credential secret back inside its `{ data }` / `{ error }` body, the broker
 *    redacts every occurrence before the response crosses the process boundary.
 *  - **mapper** (`map-response.ts`, Task 7.1): only ever copies fields from the
 *    already-sanitized response, so it cannot re-introduce a secret into the UI
 *    outcome (`backend_error` message/details, `success` value, etc.).
 *  - **serialize**: `JSON.stringify` stands in for any log line or config
 *    artifact the app might persist; the secret must be absent from it.
 *
 * The generated secret is a long random alphanumeric string, so any occurrence
 * of it in a serialized artifact is an unambiguous leak (it can never collide
 * with a structural JSON key or with unrelated generated noise).
 *
 * Validates: Requirements 4.1, 10.3, 10.4, 16.5
 */

import * as fc from 'fast-check';

import {
  account,
  workspaces,
  queryEngine,
  usageAnalytics,
  conversations,
  isSelectionRequired,
} from './builders';
import { mapResponse } from './mapper';
import { parseHttpResponse, sanitizeResponse } from '../../main/ipc-handlers';
import type { apiCopilotShared } from '@health-checkup/services';

const RUNS = {} as const;

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/**
 * A secret value (a Session_Token or a credential secret). Alphanumeric and at
 * least 20 characters, so it never collides with a JSON key (`data`, `error`,
 * `code`, ...) and never appears by chance in unrelated generated noise. This
 * makes "the secret is a substring of the serialized artifact" a reliable leak
 * detector.
 */
const secretArb: fc.Arbitrary<string> = fc
  .array(
    fc.constantFrom(
      ...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'.split(
        '',
      ),
    ),
    { minLength: 20, maxLength: 64 },
  )
  .map((chars) => `secret_${chars.join('')}`);

/** A realistic API selection for version-scoped builders. */
const selectionArb: fc.Arbitrary<apiCopilotShared.ApiSelection> = fc.record({
  workspaceId: fc.string({ minLength: 1, maxLength: 12 }),
  apiId: fc.string({ minLength: 1, maxLength: 12 }),
  version: fc.integer({ min: 1, max: 99 }),
}) as fc.Arbitrary<apiCopilotShared.ApiSelection>;

/**
 * A JSON-serializable value that *deliberately embeds* the secret in several
 * shapes (bare, prefixed, nested, in an array) alongside arbitrary noise — the
 * body a hostile or buggy backend might echo back.
 */
function bodyEmbeddingSecret(secret: string): fc.Arbitrary<unknown> {
  return fc.record({
    echoedAuthorization: fc.constant(`Bearer ${secret}`),
    token: fc.constant(secret),
    nested: fc.constant({ deep: { value: `leaked:${secret}` } }),
    list: fc.constant([secret, `x${secret}y`]),
    noise: fc.jsonValue(),
  });
}

/** A backend `{ error }` envelope whose code/message/details all embed the secret. */
function errorBodyEmbeddingSecret(
  secret: string,
): fc.Arbitrary<Record<string, unknown>> {
  return fc.record({
    error: fc.record({
      code: fc.constantFrom(
        'BACKEND_ERROR',
        'AUTH_ERROR',
        'VALIDATION_ERROR',
        'SESSION_EXPIRED',
        'INTERNAL_ERROR',
      ),
      message: fc.constant(`operation failed for token ${secret}`),
      details: fc.constant({ echoed: `Bearer ${secret}`, values: [secret] }),
    }),
  });
}

/** Statuses spanning success, session-expiry, rate-limit, and generic errors. */
const statusArb = fc.constantFrom(200, 201, 204, 400, 401, 403, 429, 500, 503);

// ---------------------------------------------------------------------------
// Builder step: descriptors never carry the Session_Token
// ---------------------------------------------------------------------------

describe('Property 7: builders emit no Session_Token and no Authorization header', () => {
  it('no public or protected descriptor contains the token or an Authorization header', () => {
    fc.assert(
      fc.property(
        secretArb,
        selectionArb,
        fc.string({ minLength: 1, maxLength: 50 }),
        fc.string({ minLength: 1, maxLength: 20 }),
        (secret, selection, question, wsId) => {
          const ask = queryEngine.ask(selection, question);
          const descriptors = [
            account.signIn({ email: 'user@example.com', password: 'pw' }),
            workspaces.create(wsId),
            usageAnalytics.dashboard(wsId),
            conversations.list(wsId),
            ...(isSelectionRequired(ask) ? [] : [ask]),
          ];

          for (const descriptor of descriptors) {
            // The token is never handed to a builder, so it can never appear.
            expect(JSON.stringify(descriptor).includes(secret)).toBe(false);
            // The broker — not the renderer — attaches auth, so descriptors
            // must never carry an Authorization header (any casing).
            const headerKeys = Object.keys(descriptor.headers ?? {}).map((k) =>
              k.toLowerCase(),
            );
            expect(headerKeys).not.toContain('authorization');
          }
        },
      ),
      RUNS,
    );
  });
});

// ---------------------------------------------------------------------------
// Sanitizer step: an echoed secret is redacted from data and error payloads
// ---------------------------------------------------------------------------

describe('Property 7: the broker sanitizer strips any echoed secret', () => {
  it('a secret echoed inside a success `{ data }` body is redacted', () => {
    fc.assert(
      fc.property(
        secretArb.chain((secret) =>
          fc.record({
            secret: fc.constant(secret),
            adversarial: bodyEmbeddingSecret(secret),
          }),
        ),
        ({ secret, adversarial }) => {
          const bodyText = JSON.stringify({ data: adversarial });
          // Sanity: the raw backend body really does contain the secret.
          expect(bodyText.includes(secret)).toBe(true);

          const parsed = parseHttpResponse({ status: 200, headers: {}, bodyText });
          const sanitized = sanitizeResponse(parsed, secret);

          expect(JSON.stringify(sanitized).includes(secret)).toBe(false);
        },
      ),
      RUNS,
    );
  });

  it('a secret echoed inside an `{ error }` body is redacted', () => {
    fc.assert(
      fc.property(
        secretArb.chain((secret) =>
          fc.record({
            secret: fc.constant(secret),
            errBody: errorBodyEmbeddingSecret(secret),
          }),
        ),
        ({ secret, errBody }) => {
          const bodyText = JSON.stringify(errBody);
          expect(bodyText.includes(secret)).toBe(true);

          const parsed = parseHttpResponse({ status: 500, headers: {}, bodyText });
          const sanitized = sanitizeResponse(parsed, secret);

          expect(JSON.stringify(sanitized).includes(secret)).toBe(false);
        },
      ),
      RUNS,
    );
  });
});

// ---------------------------------------------------------------------------
// Full pipeline: parse → sanitize → map → serialize, for arbitrary bodies
// ---------------------------------------------------------------------------

describe('Property 7: no secret survives the full parse → sanitize → map → serialize pipeline', () => {
  it('regardless of status or backend body, the mapped outcome and any log artifact are secret-free', () => {
    fc.assert(
      fc.property(
        secretArb.chain((secret) =>
          fc.record({
            secret: fc.constant(secret),
            status: statusArb,
            body: fc.oneof(
              bodyEmbeddingSecret(secret).map((v) => ({ data: v })),
              errorBodyEmbeddingSecret(secret),
            ),
            retryAfter: fc.option(fc.constantFrom('120', '0', '3600'), {
              nil: undefined,
            }),
          }),
        ),
        ({ secret, status, body, retryAfter }) => {
          const bodyText = JSON.stringify(body);
          // Sanity: the untrusted backend body carries the secret.
          expect(bodyText.includes(secret)).toBe(true);

          const headers: Record<string, string> =
            retryAfter === undefined ? {} : { 'Retry-After': retryAfter };

          // Broker: parse the raw HTTP response, then sanitize with the
          // Session_Token the broker holds.
          const parsed = parseHttpResponse({ status, headers, bodyText });
          const sanitized = sanitizeResponse(parsed, secret);

          // Mapper: turn the sanitized response into the UI outcome.
          const outcome = mapResponse(sanitized);

          // Serializer: the sanitized response, the UI outcome, and a combined
          // "log/config artifact" must all be free of the secret.
          expect(JSON.stringify(sanitized).includes(secret)).toBe(false);
          expect(JSON.stringify(outcome).includes(secret)).toBe(false);
          expect(JSON.stringify({ sanitized, outcome }).includes(secret)).toBe(
            false,
          );
        },
      ),
      RUNS,
    );
  });
});
