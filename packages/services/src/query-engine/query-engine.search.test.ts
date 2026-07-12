/**
 * Query Engine — Semantic Search unit tests
 *
 * Covers the semantic-search pipeline: query-length validation (Req 3.6),
 * scoping to the selected API/version (Req 3.3), relevance thresholding and
 * ranking with a hit cap (Req 3.2, 3.4), the empty-result "no relevant content"
 * message (Req 3.4), and the temporary-unavailability error with no partial
 * results when the Vector_Database is unavailable (Req 3.7).
 *
 * Validates: Requirements 3.2, 3.3, 3.4, 3.6, 3.7
 */

import { FakeEmbeddingProvider } from '../api-copilot-shared';
import type {
  ApiScope,
  ApiSelection,
  EmbeddingProvider,
  IndexedChunk,
  ScoredChunk,
  VectorStore,
} from '../api-copilot-shared';
import { QueryEngine } from './query-engine.service';
import {
  InvalidQueryLengthError,
  SearchUnavailableError,
} from './query-engine.errors';
import {
  MAX_SEARCH_HITS,
  MIN_RELEVANCE_SCORE,
  NO_RELEVANT_CONTENT_MESSAGE,
  QUERY_MAX_LENGTH,
} from './query-engine.types';

const SELECTION: ApiSelection = { workspaceId: 'ws-1', apiId: 'api-1', version: 2 };

function chunk(sourceRef: string): IndexedChunk {
  return {
    chunkId: `id-${sourceRef}`,
    apiId: SELECTION.apiId,
    version: SELECTION.version,
    sourceRef,
    text: `text for ${sourceRef}`,
    embedding: [0.1, 0.2],
  };
}

/** A programmable vector store that returns a fixed set of scored chunks and
 *  records the scope/topK it was queried with. */
class StubVectorStore implements VectorStore {
  public lastScope?: ApiScope;
  public lastTopK?: number;

  constructor(private readonly result: ScoredChunk[]) {}

  async upsert(): Promise<void> {
    /* not used */
  }

  async query(_vector: number[], scope: ApiScope, topK: number): Promise<ScoredChunk[]> {
    this.lastScope = scope;
    this.lastTopK = topK;
    return this.result;
  }
}

describe('QueryEngine.semanticSearch', () => {
  it('rejects an empty query with a length error and does not search (Req 3.6)', async () => {
    const store = new StubVectorStore([]);
    const engine = new QueryEngine({ vectorStore: store });

    await expect(
      engine.semanticSearch({ query: '', selection: SELECTION })
    ).rejects.toBeInstanceOf(InvalidQueryLengthError);

    // No retrieval attempted.
    expect(store.lastScope).toBeUndefined();
  });

  it('rejects a query longer than the maximum with a length error (Req 3.6)', async () => {
    const store = new StubVectorStore([]);
    const engine = new QueryEngine({ vectorStore: store });

    const tooLong = 'a'.repeat(QUERY_MAX_LENGTH + 1);
    let caught: unknown;
    try {
      await engine.semanticSearch({ query: tooLong, selection: SELECTION });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(InvalidQueryLengthError);
    const err = caught as InvalidQueryLengthError;
    expect(err.actualLength).toBe(QUERY_MAX_LENGTH + 1);
    expect(err.maxLength).toBe(QUERY_MAX_LENGTH);
    expect(store.lastScope).toBeUndefined();
  });

  it('accepts a boundary-length query and searches (Req 3.6)', async () => {
    const store = new StubVectorStore([{ chunk: chunk('a'), score: 0.9 }]);
    const engine = new QueryEngine({ vectorStore: store });

    const maxQuery = 'a'.repeat(QUERY_MAX_LENGTH);
    const result = await engine.semanticSearch({ query: maxQuery, selection: SELECTION });

    expect(result.hits).toHaveLength(1);
  });

  it('scopes retrieval to the selected API/version (Req 3.3)', async () => {
    const store = new StubVectorStore([{ chunk: chunk('a'), score: 0.9 }]);
    const engine = new QueryEngine({ vectorStore: store });

    await engine.semanticSearch({ query: 'orders', selection: SELECTION });

    expect(store.lastScope).toEqual({ apiId: SELECTION.apiId, version: SELECTION.version });
    expect(store.lastTopK).toBe(MAX_SEARCH_HITS);
  });

  it('drops hits scoring below the relevance threshold (Req 3.4)', async () => {
    const store = new StubVectorStore([
      { chunk: chunk('keep'), score: MIN_RELEVANCE_SCORE },
      { chunk: chunk('drop-just-below'), score: MIN_RELEVANCE_SCORE - 0.0001 },
      { chunk: chunk('drop-low'), score: 0.1 },
    ]);
    const engine = new QueryEngine({ vectorStore: store });

    const result = await engine.semanticSearch({ query: 'orders', selection: SELECTION });

    expect(result.hits.map((h) => h.sourceRef)).toEqual(['keep']);
    for (const hit of result.hits) {
      expect(hit.score).toBeGreaterThanOrEqual(MIN_RELEVANCE_SCORE);
    }
  });

  it('orders hits by non-increasing relevance (Req 3.2)', async () => {
    const store = new StubVectorStore([
      { chunk: chunk('mid'), score: 0.8 },
      { chunk: chunk('high'), score: 0.95 },
      { chunk: chunk('low'), score: 0.75 },
    ]);
    const engine = new QueryEngine({ vectorStore: store });

    const result = await engine.semanticSearch({ query: 'orders', selection: SELECTION });

    expect(result.hits.map((h) => h.sourceRef)).toEqual(['high', 'mid', 'low']);
    const scores = result.hits.map((h) => h.score);
    for (let i = 1; i < scores.length; i += 1) {
      expect(scores[i - 1]).toBeGreaterThanOrEqual(scores[i]);
    }
  });

  it('returns at most the maximum number of hits (Req 3.2)', async () => {
    const many: ScoredChunk[] = Array.from({ length: MAX_SEARCH_HITS + 20 }, (_, i) => ({
      chunk: chunk(`c-${i}`),
      score: 0.9,
    }));
    const store = new StubVectorStore(many);
    const engine = new QueryEngine({ vectorStore: store });

    const result = await engine.semanticSearch({ query: 'orders', selection: SELECTION });

    expect(result.hits).toHaveLength(MAX_SEARCH_HITS);
  });

  it('returns an empty result with the "no relevant content" message when nothing qualifies (Req 3.4)', async () => {
    const store = new StubVectorStore([
      { chunk: chunk('low-1'), score: 0.5 },
      { chunk: chunk('low-2'), score: 0.2 },
    ]);
    const engine = new QueryEngine({ vectorStore: store });

    const result = await engine.semanticSearch({ query: 'orders', selection: SELECTION });

    expect(result.hits).toEqual([]);
    expect(result.message).toBe(NO_RELEVANT_CONTENT_MESSAGE);
  });

  it('raises SearchUnavailableError with no partial results when the vector store is unavailable (Req 3.7)', async () => {
    const failingStore: VectorStore = {
      async upsert(): Promise<void> {
        /* not used */
      },
      async query(): Promise<ScoredChunk[]> {
        throw new Error('vector store unavailable');
      },
    };
    const engine = new QueryEngine({ vectorStore: failingStore });

    let caught: unknown;
    try {
      await engine.semanticSearch({ query: 'orders', selection: SELECTION });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(SearchUnavailableError);
  });

  it('raises SearchUnavailableError when the embedding provider is unavailable (Req 3.7)', async () => {
    const failingEmbedder: EmbeddingProvider = {
      async embed(): Promise<number[]> {
        throw new Error('embedding model unavailable');
      },
    };
    const engine = new QueryEngine({
      vectorStore: new StubVectorStore([]),
      embeddingProvider: failingEmbedder,
    });

    await expect(
      engine.semanticSearch({ query: 'orders', selection: SELECTION })
    ).rejects.toBeInstanceOf(SearchUnavailableError);
  });

  it('embeds the query text before retrieval', async () => {
    const embedSpy = jest.fn(async (text: string) => new FakeEmbeddingProvider().embed(text));
    const store = new StubVectorStore([{ chunk: chunk('a'), score: 0.9 }]);
    const engine = new QueryEngine({
      vectorStore: store,
      embeddingProvider: { embed: embedSpy },
    });

    await engine.semanticSearch({ query: 'how do I authenticate', selection: SELECTION });

    expect(embedSpy).toHaveBeenCalledWith('how do I authenticate');
  });
});
