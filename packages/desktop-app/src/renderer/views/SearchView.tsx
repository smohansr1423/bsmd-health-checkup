/**
 * Semantic search view (Task 13.1 — Req 9.1, 9.3, 9.4, 16.1).
 *
 * Submits a semantic search query, validating the 1..1000-character length
 * before sending (Req 9.4) and gating on an Active_API_Version (Req 7.5). It
 * renders the "no relevant content found" empty state for zero results
 * (Req 9.3). The exact ordered rendering of populated results is owned by Task
 * 13.2; this view provides the scaffolding and empty state.
 */

import React, { useState } from 'react';
import { queryEngine, isSelectionRequired } from '../app-client/builders';
import { validateSearchQuery } from '../app-client/validation';
import { EmptyState } from '../components/EmptyState';
import { LoadingIndicator } from '../components/LoadingIndicator';
import {
  EMPTY_STATE_MESSAGES,
  resolveSearchDisplay,
} from '../components/empty-states';
import { useAppStore } from '../state/store';
import { useViewActions } from './actions';

/** Stable operation id for the search request. */
export const SEARCH_OP = 'query-engine:search';

/** A single search result (mirrors the backend by name). */
export interface SearchResult {
  id: string;
  title: string;
  snippet: string;
}

export interface SearchViewProps {
  /** The results in backend order, or undefined before a search has run. */
  results?: readonly SearchResult[];
}

export function SearchView({ results }: SearchViewProps): React.ReactElement {
  const { state } = useAppStore();
  const actions = useViewActions();
  const [query, setQuery] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const loading = state.requests[SEARCH_OP] === 'loading';
  const display = resolveSearchDisplay(results);

  const handleSubmit = (event: React.FormEvent): void => {
    event.preventDefault();
    const validation = validateSearchQuery(query);
    if (validation) {
      setMessage(validation.message);
      return;
    }
    const gated = queryEngine.search(state.activeApiVersion, query);
    if (isSelectionRequired(gated)) {
      setMessage(gated.message);
      return;
    }
    setMessage(null);
    void actions.runRequest?.({
      operationId: SEARCH_OP,
      view: 'search',
      descriptor: gated,
      retainInput: { query },
    });
  };

  return (
    <section className="view view--search" aria-labelledby="search-title">
      <h1 id="search-title">Search documentation</h1>

      <form onSubmit={handleSubmit}>
        <label>
          Search query
          <input
            type="text"
            name="query"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        {message !== null ? (
          <p className="error" role="alert">
            {message}
          </p>
        ) : null}
        <button type="submit" disabled={loading}>
          Search
        </button>
      </form>

      {loading ? <LoadingIndicator label="Searching…" /> : null}

      {display === 'no-results' ? (
        <EmptyState message={EMPTY_STATE_MESSAGES.noResults} />
      ) : null}

      {display === 'results' && results ? (
        <ol className="search-results">
          {results.map((r) => (
            <li key={r.id}>
              <span className="search-results__title">{r.title}</span>
              <span className="search-results__snippet">{r.snippet}</span>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}
