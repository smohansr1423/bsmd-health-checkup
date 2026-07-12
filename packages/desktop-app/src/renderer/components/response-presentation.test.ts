/**
 * Unit tests for the exact-payload presentation helpers (Task 13.2).
 *
 * These verify the two fidelity guarantees the presentation layer must uphold:
 *  - execution/testing-console/replay results are surfaced with status, headers,
 *    body, and elapsed time unchanged (Req 11.4, 11.6, 12.2), and
 *  - backend-provided lists are surfaced in the exact backend order
 *    (Req 9.2, 12.3, 14.1).
 *
 * The helpers are pure, so they run in the default node test environment
 * without a DOM. The React components in this folder are thin shells over these
 * helpers, so covering the helpers covers the fidelity logic.
 */

import type { apiCopilotShared, queryEngine } from '@health-checkup/services';
import {
  toHeaderEntries,
  toResponseView,
  toRequestView,
  toOrderedItems,
  toSearchResultItems,
  toConsoleHistoryItems,
  toConversationItems,
} from './response-presentation';

describe('toHeaderEntries', () => {
  it('preserves each header value unchanged and in map order', () => {
    const headers = {
      'Content-Type': 'application/json',
      'X-Request-Id': 'abc-123',
      'Retry-After': '30',
    };

    const entries = toHeaderEntries(headers);

    expect(entries).toEqual([
      { name: 'Content-Type', value: 'application/json' },
      { name: 'X-Request-Id', value: 'abc-123' },
      { name: 'Retry-After', value: '30' },
    ]);
    // Every entry value equals the original map value (no alteration).
    for (const entry of entries) {
      expect(entry.value).toBe(headers[entry.name as keyof typeof headers]);
    }
  });

  it('returns an empty array for an empty header map', () => {
    expect(toHeaderEntries({})).toEqual([]);
  });
});

describe('toResponseView', () => {
  it('maps status, body, elapsed time, and outcome verbatim', () => {
    const result: apiCopilotShared.ExecutionResult = {
      statusCode: 503,
      headers: { 'Content-Type': 'text/plain', 'X-Trace': 'zzz' },
      body: '{\n  "error": "unavailable",\n  "retry": true\n}',
      elapsedMs: 1234,
      outcome: 'error',
    };

    const view = toResponseView(result);

    expect(view.status).toBe(503);
    expect(view.body).toBe(result.body);
    expect(view.elapsedMs).toBe(1234);
    expect(view.outcome).toBe('error');
    expect(view.headers).toEqual([
      { name: 'Content-Type', value: 'text/plain' },
      { name: 'X-Trace', value: 'zzz' },
    ]);
  });

  it('does not reformat or trim the body', () => {
    const body = '   leading and trailing whitespace \n\t preserved   ';
    const result: apiCopilotShared.ExecutionResult = {
      statusCode: 200,
      headers: {},
      body,
      elapsedMs: 0,
      outcome: 'success',
    };

    expect(toResponseView(result).body).toBe(body);
  });
});

describe('toRequestView', () => {
  it('maps method, url, headers, and body verbatim', () => {
    const request: apiCopilotShared.OutboundRequestSnapshot = {
      method: 'POST',
      url: 'https://api.example.com/v1/orders?limit=10',
      headers: { Authorization: 'Bearer <redacted-by-broker>', Accept: 'application/json' },
      body: '{"item":"widget"}',
    };

    const view = toRequestView(request);

    expect(view.method).toBe('POST');
    expect(view.url).toBe(request.url);
    expect(view.body).toBe(request.body);
    expect(view.headers).toEqual([
      { name: 'Authorization', value: 'Bearer <redacted-by-broker>' },
      { name: 'Accept', value: 'application/json' },
    ]);
  });

  it('preserves an absent body as undefined', () => {
    const request: apiCopilotShared.OutboundRequestSnapshot = {
      method: 'GET',
      url: 'https://api.example.com/v1/health',
      headers: {},
    };

    expect(toRequestView(request).body).toBeUndefined();
  });
});

describe('toOrderedItems', () => {
  it('preserves input order and assigns ascending indices', () => {
    const xs = ['c', 'a', 'b'];

    const ordered = toOrderedItems(xs);

    expect(ordered.map((o) => o.item)).toEqual(xs);
    expect(ordered.map((o) => o.index)).toEqual([0, 1, 2]);
  });

  it('never sorts or reverses the items', () => {
    const xs = [3, 1, 2, 5, 4];
    expect(toOrderedItems(xs).map((o) => o.item)).toEqual([3, 1, 2, 5, 4]);
  });

  it('returns an empty array for an empty list', () => {
    expect(toOrderedItems([])).toEqual([]);
  });
});

describe('backend-order list presenters', () => {
  it('keeps search hits in backend (ranked) order', () => {
    const hits: queryEngine.SearchHit[] = [
      { sourceRef: 'GET /orders', text: 'list orders', score: 0.95 },
      { sourceRef: 'POST /orders', text: 'create order', score: 0.9 },
      { sourceRef: 'GET /orders/{id}', text: 'get order', score: 0.8 },
    ];

    expect(toSearchResultItems(hits).map((o) => o.item)).toEqual(hits);
  });

  it('keeps console history entries in backend order', () => {
    const entry = (id: string): apiCopilotShared.HistoryEntry => ({
      historyId: id,
      workspaceId: 'ws-1',
      request: { method: 'GET', url: `https://api.example.com/${id}`, headers: {} },
      result: { statusCode: 200, headers: {}, body: '', elapsedMs: 1, outcome: 'success' },
      createdAt: new Date('2024-01-01T00:00:00.000Z'),
    });
    const entries = [entry('h3'), entry('h1'), entry('h2')];

    expect(toConsoleHistoryItems(entries).map((o) => o.item.historyId)).toEqual([
      'h3',
      'h1',
      'h2',
    ]);
  });

  it('keeps conversation entries in backend order', () => {
    const entry = (id: string): apiCopilotShared.ConversationEntry => ({
      entryId: id,
      workspaceId: 'ws-1',
      userId: 'user-1',
      question: `q-${id}`,
      answer: { text: `a-${id}`, grounded: true, citations: [] },
      answeredAt: new Date('2024-01-01T00:00:00.000Z'),
    });
    const entries = [entry('e2'), entry('e5'), entry('e1')];

    expect(toConversationItems(entries).map((o) => o.item.entryId)).toEqual([
      'e2',
      'e5',
      'e1',
    ]);
  });
});
