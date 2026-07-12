/**
 * SearchResultsList (Task 13.2) — backend-ordered semantic search results.
 *
 * Renders the search hits in **exactly** the order the Backend_Gateway returned
 * them (Req 9.2). No client-side sorting or reversing is applied; ordering comes
 * straight from {@link toSearchResultItems}. The empty-state message is left to
 * the Q&A/search view (Task 13.1); this component only renders a non-empty,
 * order-preserving list.
 */

import type { queryEngine } from '@health-checkup/services';
import { toSearchResultItems } from './response-presentation';

export interface SearchResultsListProps {
  /** Search hits in backend-provided (ranked) order. */
  readonly hits: readonly queryEngine.SearchHit[];
}

/** Renders semantic-search hits in backend order (Req 9.2). */
export function SearchResultsList({ hits }: SearchResultsListProps): JSX.Element {
  const items = toSearchResultItems(hits);

  return (
    <ol className="search-results" data-testid="search-results">
      {items.map(({ index, item }) => (
        <li key={index} className="search-results__item">
          <div className="search-results__source">{item.sourceRef}</div>
          <p className="search-results__text">{item.text}</p>
          <span className="search-results__score">{item.score}</span>
        </li>
      ))}
    </ol>
  );
}
