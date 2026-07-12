/**
 * Query Engine — Semantic Search Property-Based Tests
 *
 * Uses fast-check to validate the universal search properties from the design
 * document: results are scoped, thresholded and ranked (Property 10) and query
 * length is validated (Property 12).
 *
 * Feature: api-copilot-ai
 * Validates: Requirements 3.2, 3.3, 3.4, 3.6, 4.8
 */

import * as fc from 'fast-check';

import {
  FakeEmbeddingProvider,
  InMemoryVectorStore,
} from '../api-copilot-shared';
import type {
  ApiScope,
  ApiSelection,
  IndexedChunk,
  ScoredChunk,
  UserRef,
  VectorStore,
} from '../api-copilot-shared';
import { IndexingService, QueryEngine } from './query-engine.service';
import { chunkApiMetadata } from './query-engine.chunker';
import {
  InvalidQueryLengthError,
  InvalidQuestionLengthError,
} from './query-engine.errors';
import {
  MAX_SEARCH_HITS,
  MIN_RELEVANCE_SCORE,
  NO_RELEVANT_CONTENT_MESSAGE,
  QUERY_MAX_LENGTH,
  QUESTION_MAX_LENGTH,
} from './query-engine.types';

const SELECTION: ApiSelection = { workspaceId: 'ws-1', apiId: 'api-1', version: 2 };
const REQUESTER: UserRef = { userId: 'user-1', accountId: 'acct-1' };

/** A programmable vector store returning a fixed scored set, recording the scope. */
class StubVectorStore implements VectorStore {
  public lastScope?: ApiScope;
  public queryCalls = 0;

  constructor(private readonly result: ScoredChunk[]) {}

  async upsert(): Promise<void> {
    /* not used */
  }

  async query(_vector: number[], scope: ApiScope, _topK: number): Promise<ScoredChunk[]> {
    this.queryCalls += 1;
    this.lastScope = scope;
    return this.result;
  }
}

function scoredChunk(sourceRef: string, score: number): ScoredChunk {
  const chunk: IndexedChunk = {
    chunkId: `id-${sourceRef}`,
    apiId: SELECTION.apiId,
    version: SELECTION.version,
    sourceRef,
    text: `content for ${sourceRef}`,
    embedding: [0.1, 0.2],
  };
  return { chunk, score };
}

// ─── Arbitraries ────────────────────────────────────────────────────────────

const scoreArb = fc.double({ min: 0, max: 1, noNaN: true });

/** A list of scored chunks with unique source refs. */
const scoredListArb: fc.Arbitrary<ScoredChunk[]> = fc
  .array(scoreArb, { minLength: 0, maxLength: MAX_SEARCH_HITS + 25 })
  .map((scores) => scores.map((score, i) => scoredChunk(`ref-${i}`, score)));

/** An out-of-range length string: empty, or strictly longer than the max. */
const invalidLengthArb = (max: number): fc.Arbitrary<string> =>
  fc.oneof(
    fc.constant(''),
    fc.string({ minLength: max + 1, maxLength: max + 40 })
  );

// ─── Property 10 ──────────────────────────────────────────────────────────────

describe('Query Engine — Semantic Search properties', () => {
  // Feature: api-copilot-ai, Property 10: Search results are scoped, thresholded,
  // and ranked — every returned hit belongs to the selected API scope, has
  // relevance ≥ 0.7, the result count is at most 50, and results are ordered by
  // non-increasing relevance; when nothing scores ≥ 0.7 the result set is empty
  // with a "no relevant content" message.
  // Validates: Requirements 3.2, 3.3, 3.4
  it('Property 10: results are thresholded at 0.7, capped at 50, and ranked; empty otherwise', async () => {
    await fc.assert(
      fc.asyncProperty(scoredListArb, async (scored) => {
        const store = new StubVectorStore(scored);
        const engine = new QueryEngine({ vectorStore: store });

        const result = await engine.semanticSearch({
          query: 'find something',
          selection: SELECTION,
        });

        // Retrieval was scoped to the selected API/version (Req 3.3).
        expect(store.lastScope).toEqual({
          apiId: SELECTION.apiId,
          version: SELECTION.version,
        });

        const qualifying = scored.filter((s) => s.score >= MIN_RELEVANCE_SCORE);

        if (qualifying.length === 0) {
          // Nothing qualifies: empty result carrying the no-content message.
          expect(result.hits).toEqual([]);
          expect(result.message).toBe(NO_RELEVANT_CONTENT_MESSAGE);
          return;
        }

        // Count is min(qualifying, 50) and never exceeds the cap.
        expect(result.hits.length).toBe(Math.min(qualifying.length, MAX_SEARCH_HITS));
        expect(result.hits.length).toBeLessThanOrEqual(MAX_SEARCH_HITS);

        // Every returned hit is at or above the relevance threshold.
        for (const hit of result.hits) {
          expect(hit.score).toBeGreaterThanOrEqual(MIN_RELEVANCE_SCORE);
        }

        // Ordered by non-increasing relevance.
        for (let i = 1; i < result.hits.length; i += 1) {
          expect(result.hits[i - 1].score).toBeGreaterThanOrEqual(result.hits[i].score);
        }

        // Every returned hit corresponds to a qualifying retrieved chunk.
        const qualifyingRefs = new Set(qualifying.map((s) => s.chunk.sourceRef));
        for (const hit of result.hits) {
          expect(qualifyingRefs.has(hit.sourceRef)).toBe(true);
        }
      })
    );
  });

  // Feature: api-copilot-ai, Property 10: Search results are scoped, thresholded,
  // and ranked — end-to-end scoping over a multi-API corpus: no hit from a
  // non-selected API is ever returned.
  // Validates: Requirements 3.2, 3.3, 3.4
  it('Property 10: over a multi-API corpus, every returned hit belongs to the selected scope', async () => {
    const selectedMeta = {
      apiId: 'api-selected',
      title: 'Selected',
      sourceFormat: 'openapi-3' as const,
      endpoints: [
        {
          endpointId: 'GET /sel/{id}',
          path: '/sel/{id}',
          method: 'GET' as const,
          parameters: [{ name: 'id', location: 'path' as const, required: true, schema: {} }],
          responseSchemas: { '200': {} },
          responseExamples: {},
          errorCodes: [],
          authSchemeRefs: [],
        },
      ],
      authSchemes: [{ id: 'sel-auth', type: 'bearer' as const, details: {} }],
      rateLimits: [],
    };
    const otherMeta = {
      ...selectedMeta,
      apiId: 'api-other',
      endpoints: [
        {
          ...selectedMeta.endpoints[0],
          endpointId: 'GET /other/{id}',
          path: '/other/{id}',
        },
      ],
      authSchemes: [{ id: 'other-auth', type: 'bearer' as const, details: {} }],
    };

    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 60 }),
        async (query) => {
          const vectorStore = new InMemoryVectorStore();
          const embeddingProvider = new FakeEmbeddingProvider();
          const indexer = new IndexingService({ vectorStore, embeddingProvider });
          await indexer.index({
            apiId: 'api-selected',
            workspaceId: SELECTION.workspaceId,
            version: SELECTION.version,
            metadata: selectedMeta,
            createdAt: new Date('2024-01-01T00:00:00Z'),
          });
          await indexer.index({
            apiId: 'api-other',
            workspaceId: SELECTION.workspaceId,
            version: SELECTION.version,
            metadata: otherMeta,
            createdAt: new Date('2024-01-01T00:00:00Z'),
          });

          const engine = new QueryEngine({ vectorStore, embeddingProvider });
          const result = await engine.semanticSearch({
            query,
            selection: {
              workspaceId: SELECTION.workspaceId,
              apiId: 'api-selected',
              version: SELECTION.version,
            },
          });

          const selectedRefs = new Set(
            chunkApiMetadata(selectedMeta).map((c) => c.sourceRef)
          );
          for (const hit of result.hits) {
            expect(selectedRefs.has(hit.sourceRef)).toBe(true);
          }
        }
      )
    );
  });

  // ─── Property 12 ──────────────────────────────────────────────────────────

  // Feature: api-copilot-ai, Property 12: Query and question length validation —
  // for any search query or question that is empty or longer than 1000
  // characters, the request is rejected with a length-constraint error and no
  // answer is generated.
  // Validates: Requirements 3.6, 4.8
  it('Property 12: an empty or over-long search query is rejected without searching (Req 3.6)', async () => {
    await fc.assert(
      fc.asyncProperty(invalidLengthArb(QUERY_MAX_LENGTH), async (query) => {
        const store = new StubVectorStore([scoredChunk('ref-0', 0.9)]);
        const engine = new QueryEngine({ vectorStore: store });

        await expect(
          engine.semanticSearch({ query, selection: SELECTION })
        ).rejects.toBeInstanceOf(InvalidQueryLengthError);

        // No retrieval was attempted.
        expect(store.queryCalls).toBe(0);
        expect(store.lastScope).toBeUndefined();
      })
    );
  });

  it('Property 12: an empty or over-long question is rejected without answering (Req 4.8)', async () => {
    await fc.assert(
      fc.asyncProperty(invalidLengthArb(QUESTION_MAX_LENGTH), async (question) => {
        const store = new StubVectorStore([scoredChunk('ref-0', 0.9)]);
        let quotaReservations = 0;
        let llmCalls = 0;
        const engine = new QueryEngine({
          vectorStore: store,
          quotaReserver: {
            async checkAndReserveQuery() {
              quotaReservations += 1;
              return { allowed: true };
            },
          },
          llmProvider: {
            async generateGrounded() {
              llmCalls += 1;
              return { text: 'x', citations: [] };
            },
          },
        });

        await expect(
          engine.ask({ question, selection: SELECTION, requester: REQUESTER })
        ).rejects.toBeInstanceOf(InvalidQuestionLengthError);

        // No answer generated: no retrieval, no quota reserved, no LLM call.
        expect(store.queryCalls).toBe(0);
        expect(quotaReservations).toBe(0);
        expect(llmCalls).toBe(0);
      })
    );
  });

  it('Property 12: valid-length queries (1..1000) are not rejected for length', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: QUERY_MAX_LENGTH }),
        async (len) => {
          const store = new StubVectorStore([scoredChunk('ref-0', 0.9)]);
          const engine = new QueryEngine({ vectorStore: store });

          const result = await engine.semanticSearch({
            query: 'a'.repeat(len),
            selection: SELECTION,
          });

          // A valid query proceeds to search (no length error thrown).
          expect(store.queryCalls).toBe(1);
          expect(result.hits.length).toBeGreaterThanOrEqual(0);
        }
      )
    );
  });
});
