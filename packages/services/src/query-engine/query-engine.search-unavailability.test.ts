/**
 * Query Engine — Vector-store Unavailability unit test (Task 7.7)
 *
 * When the Vector_Database is unavailable while a Semantic_Search query is
 * submitted, the engine surfaces a temporary-unavailability indication
 * (SearchUnavailableError) and returns NO partial results — the underlying
 * cause is preserved and no SearchResult is produced.
 *
 * Validates: Requirements 3.7
 */

import type {
  ApiSelection,
  ScoredChunk,
  VectorStore,
} from '../api-copilot-shared';
import { QueryEngine } from './query-engine.service';
import { SearchUnavailableError } from './query-engine.errors';

const SELECTION: ApiSelection = { workspaceId: 'ws-1', apiId: 'api-1', version: 1 };

describe('QueryEngine.semanticSearch — vector-store unavailability (Req 3.7)', () => {
  it('surfaces a temporary-unavailability error and returns no partial results when the store fails', async () => {
    const cause = new Error('vector store connection refused');
    const failingStore: VectorStore = {
      async upsert(): Promise<void> {
        /* not used */
      },
      async query(): Promise<ScoredChunk[]> {
        throw cause;
      },
    };
    const engine = new QueryEngine({ vectorStore: failingStore });

    let caught: unknown;
    let result: unknown;
    try {
      result = await engine.semanticSearch({ query: 'orders', selection: SELECTION });
    } catch (error) {
      caught = error;
    }

    // The temporary-unavailability indication is raised...
    expect(caught).toBeInstanceOf(SearchUnavailableError);
    // ...instead of returning any (partial) result.
    expect(result).toBeUndefined();
    // The underlying cause is preserved for diagnostics.
    expect((caught as SearchUnavailableError).cause).toBe(cause);
    expect((caught as SearchUnavailableError).detail).toContain(
      'vector store connection refused'
    );
  });

  it('does not silently degrade to an empty result set on store failure', async () => {
    // A store that would have had matching content but errors on query must not
    // yield an empty SearchResult — it must raise the unavailability error.
    const failingStore: VectorStore = {
      async upsert(): Promise<void> {
        /* not used */
      },
      async query(): Promise<ScoredChunk[]> {
        throw new Error('timeout talking to vector database');
      },
    };
    const engine = new QueryEngine({ vectorStore: failingStore });

    await expect(
      engine.semanticSearch({ query: 'how do I authenticate', selection: SELECTION })
    ).rejects.toBeInstanceOf(SearchUnavailableError);
  });
});
