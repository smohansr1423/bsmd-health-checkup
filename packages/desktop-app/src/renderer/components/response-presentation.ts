/**
 * Exact-payload presentation helpers (Task 13.2).
 *
 * These are **pure** view-model builders — no React, no I/O — so the
 * "present exactly as returned" and "render in backend order" guarantees can be
 * unit- and property-tested in isolation (see design Properties 15 & 16). The
 * React presentation components in this folder consume these helpers so the
 * fidelity rules live in one verifiable place rather than being scattered across
 * JSX.
 *
 * Fidelity rules encoded here:
 *  - Execution / testing-console / replay results are surfaced with their
 *    status code, headers, body, and elapsed time **byte-for-byte unchanged**
 *    (Req 11.4, 11.6, 12.2). No pretty-printing, trimming, casing, or numeric
 *    reformatting is applied — the backend already returns a
 *    structure-preserving body (`ExecutionResult.body`).
 *  - Backend-provided lists (search hits, testing-console history, conversation
 *    history) are surfaced in **exactly** the order the backend supplied, with
 *    no client-side sorting or reversing (Req 9.2, 12.3, 14.1).
 *
 * Header maps are turned into an ordered entry array purely so React can render
 * them with stable keys; each entry's value is the untouched original value and
 * the entry order follows the object's own key order.
 */

import type { apiCopilotShared, queryEngine } from '@health-checkup/services';

// ---- Header rendering (order- and value-preserving) -----------------------

/** A single response/request header, rendered verbatim. */
export interface HeaderEntry {
  /** The header name exactly as the backend returned it. */
  readonly name: string;
  /** The header value exactly as the backend returned it (never masked here). */
  readonly value: string;
}

/**
 * Turn a header map into an ordered array of {@link HeaderEntry} for rendering.
 *
 * The entry order is the map's own key order and every value is passed through
 * untouched, so `toHeaderEntries(h)[i].value === h[toHeaderEntries(h)[i].name]`
 * holds for every header (Req 11.4, 12.2).
 */
export function toHeaderEntries(
  headers: Readonly<Record<string, string>>
): HeaderEntry[] {
  return Object.keys(headers).map((name) => ({ name, value: headers[name] }));
}

// ---- Exact response presentation ------------------------------------------

/**
 * The exact-fidelity view model for an execution / testing-console / replay
 * response. Every field maps 1:1 to {@link apiCopilotShared.ExecutionResult}
 * with no alteration (Req 11.4, 11.6, 12.2).
 */
export interface ResponseView {
  /** HTTP status code, exactly as returned. */
  readonly status: number;
  /** Response headers, in backend order, values unchanged. */
  readonly headers: HeaderEntry[];
  /** Response body, byte-for-byte as returned (already structure-preserving). */
  readonly body: string;
  /** Elapsed time in milliseconds, exactly as returned. */
  readonly elapsedMs: number;
  /** The backend-reported outcome classification (success/error/timeout/…). */
  readonly outcome: apiCopilotShared.ExecutionOutcome;
}

/**
 * Build the exact-fidelity {@link ResponseView} for an execution result. Used
 * for endpoint execution (Req 11.4, 11.6), testing-console runs, and replays
 * (Req 12.2) — all three carry the same {@link apiCopilotShared.ExecutionResult}
 * shape, so a single presenter guarantees identical, unaltered rendering.
 */
export function toResponseView(
  result: apiCopilotShared.ExecutionResult
): ResponseView {
  return {
    status: result.statusCode,
    headers: toHeaderEntries(result.headers),
    body: result.body,
    elapsedMs: result.elapsedMs,
    outcome: result.outcome,
  };
}

/**
 * The exact-fidelity view model for the request that was sent, shown alongside
 * a testing-console run/replay result (Req 12.2: method, URL, headers, body).
 */
export interface RequestView {
  readonly method: apiCopilotShared.HttpMethod;
  readonly url: string;
  readonly headers: HeaderEntry[];
  readonly body?: string;
}

/** Build the exact-fidelity {@link RequestView} for a saved request snapshot. */
export function toRequestView(
  request: apiCopilotShared.OutboundRequestSnapshot
): RequestView {
  return {
    method: request.method,
    url: request.url,
    headers: toHeaderEntries(request.headers),
    body: request.body,
  };
}

// ---- Backend-order list presentation --------------------------------------

/**
 * An item paired with its backend-provided position. Rendering from an
 * {@link OrderedItem} array guarantees the display order equals the order the
 * backend supplied (Req 9.2, 12.3, 14.1) and gives React a stable, order-based
 * key without reordering the data.
 */
export interface OrderedItem<T> {
  /** Zero-based position in the backend-provided list. */
  readonly index: number;
  /** The list item, unchanged. */
  readonly item: T;
}

/**
 * Pair each item with its index **without reordering**. The result preserves
 * the input order exactly: `toOrderedItems(xs).map((o) => o.item)` deep-equals
 * `xs`, and the indices are `0..xs.length-1` ascending. Components MUST render
 * from this (or iterate the source array directly) and MUST NOT sort or reverse
 * (Req 9.2, 12.3, 14.1).
 */
export function toOrderedItems<T>(items: readonly T[]): OrderedItem<T>[] {
  return items.map((item, index) => ({ index, item }));
}

/** Ordered search hits, exactly as the backend ranked them (Req 9.2). */
export function toSearchResultItems(
  hits: readonly queryEngine.SearchHit[]
): OrderedItem<queryEngine.SearchHit>[] {
  return toOrderedItems(hits);
}

/**
 * Ordered testing-console history entries, in the backend-provided order
 * (most-recent-first as the backend returns it) (Req 12.3).
 */
export function toConsoleHistoryItems(
  entries: readonly apiCopilotShared.HistoryEntry[]
): OrderedItem<apiCopilotShared.HistoryEntry>[] {
  return toOrderedItems(entries);
}

/**
 * Ordered conversation-history entries, in the backend-provided order
 * (most-recent-first as the backend returns it) (Req 14.1).
 */
export function toConversationItems(
  entries: readonly apiCopilotShared.ConversationEntry[]
): OrderedItem<apiCopilotShared.ConversationEntry>[] {
  return toOrderedItems(entries);
}
