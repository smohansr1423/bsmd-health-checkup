/**
 * Property-based test for exact response preservation (Task 13.3).
 *
 * **Property 15: Displayed responses preserve the backend payload exactly**
 *
 * *For any* execution, testing-console, or replay response, the status code,
 * headers, and body presented by the client equal those returned by the backend
 * with no alteration, and the elapsed-time value shown equals the one provided.
 *
 * **Validates: Requirements 11.4, 11.6, 12.2**
 *
 * All three surfaces (endpoint execution, testing-console runs, replays) carry
 * the same {@link apiCopilotShared.ExecutionResult} / request snapshot shapes
 * and are rendered through the pure presenters below, so exercising the
 * presenters across arbitrary payloads covers the fidelity guarantee for every
 * surface at once. The helpers are pure (no DOM), so they run in the default
 * node test environment.
 */

import * as fc from 'fast-check';
import type { apiCopilotShared } from '@health-checkup/services';
import {
  toHeaderEntries,
  toResponseView,
  toRequestView,
} from './response-presentation';

const HTTP_METHODS: apiCopilotShared.HttpMethod[] = [
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS',
];

const OUTCOMES: apiCopilotShared.ExecutionOutcome[] = [
  'success',
  'error',
  'timeout',
  'network_error',
];

/**
 * Arbitrary header map. Keys are unique (dictionary semantics) and both names
 * and values range over arbitrary strings — including empty strings and
 * whitespace — so the "values unchanged, order preserved" guarantee is checked
 * against payloads that a naive implementation might trim, case-fold, or
 * reorder.
 */
const headersArb: fc.Arbitrary<Record<string, string>> = fc.dictionary(
  fc.string(),
  fc.string(),
  { maxKeys: 8 }
);

const executionResultArb: fc.Arbitrary<apiCopilotShared.ExecutionResult> =
  fc.record({
    statusCode: fc.integer({ min: 100, max: 599 }),
    headers: headersArb,
    body: fc.string(),
    // noNaN so the strict-equality check is meaningful (NaN !== NaN); the
    // presenter itself passes the value through untouched regardless.
    elapsedMs: fc.double({ noNaN: true }),
    outcome: fc.constantFrom(...OUTCOMES),
  });

const requestSnapshotArb: fc.Arbitrary<apiCopilotShared.OutboundRequestSnapshot> =
  fc.record(
    {
      method: fc.constantFrom(...HTTP_METHODS),
      url: fc.string(),
      headers: headersArb,
      body: fc.option(fc.string(), { nil: undefined }),
    },
    { requiredKeys: ['method', 'url', 'headers'] }
  );

/**
 * Assert that an ordered {@link HeaderEntry} array reproduces a header map
 * exactly: same names in the same (insertion/key) order, and each value
 * strictly equal to the original map's value for that name.
 */
function expectHeadersPreserved(
  entries: ReturnType<typeof toHeaderEntries>,
  headers: Record<string, string>
): void {
  const names = Object.keys(headers);
  expect(entries.map((e) => e.name)).toEqual(names);
  for (const entry of entries) {
    expect(entry.value).toBe(headers[entry.name]);
  }
  // Reconstructing a map from the entries yields the original map.
  expect(Object.fromEntries(entries.map((e) => [e.name, e.value]))).toEqual(
    headers
  );
}

describe('Property 15: displayed responses preserve the backend payload exactly', () => {
  it('toResponseView surfaces status, headers, body, and elapsed time verbatim', () => {
    fc.assert(
      fc.property(executionResultArb, (result) => {
        const view = toResponseView(result);

        expect(view.status).toBe(result.statusCode);
        expect(view.body).toBe(result.body);
        expect(view.elapsedMs).toBe(result.elapsedMs);
        expect(view.outcome).toBe(result.outcome);
        expectHeadersPreserved(view.headers, result.headers);
      })
    );
  });

  it('toHeaderEntries preserves every header value and its map order', () => {
    fc.assert(
      fc.property(headersArb, (headers) => {
        expectHeadersPreserved(toHeaderEntries(headers), headers);
      })
    );
  });

  it('toRequestView surfaces method, url, body, and headers verbatim', () => {
    fc.assert(
      fc.property(requestSnapshotArb, (request) => {
        const view = toRequestView(request);

        expect(view.method).toBe(request.method);
        expect(view.url).toBe(request.url);
        expect(view.body).toBe(request.body);
        expectHeadersPreserved(view.headers, request.headers);
      })
    );
  });
});
