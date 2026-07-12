/**
 * Query Engine — Indexing Property-Based Tests
 *
 * Uses fast-check to validate the universal indexing properties from the design
 * document against the real IndexingService pipeline (chunk -> embed -> store).
 *
 * Feature: api-copilot-ai
 * Validates: Requirements 3.1, 3.5
 */

import * as fc from 'fast-check';

import {
  FakeEmbeddingProvider,
  InMemoryVectorStore,
} from '../api-copilot-shared';
import type {
  ApiMetadata,
  ApiVersion,
  AuthScheme,
  EmbeddingProvider,
  HttpMethod,
  IndexedChunk,
  ScoredChunk,
  VectorStore,
} from '../api-copilot-shared';
import { IndexingService } from './query-engine.service';
import { chunkApiMetadata } from './query-engine.chunker';
import { IndexingFailureError } from './query-engine.errors';

const WORKSPACE_ID = 'ws-1';

// ─── Arbitraries ────────────────────────────────────────────────────────────

/** Non-empty alphanumeric token, safe to embed in ids and source refs. */
const alnumArb = (maxLength = 8): fc.Arbitrary<string> =>
  fc
    .array(
      fc.constantFrom(
        ...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split(
          ''
        )
      ),
      { minLength: 1, maxLength: maxLength }
    )
    .map((cs) => cs.join(''));

const httpMethodArb: fc.Arbitrary<HttpMethod> = fc.constantFrom(
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS'
);

const authTypeArb: fc.Arbitrary<AuthScheme> = fc.constantFrom(
  'oauth2',
  'jwt',
  'apiKey',
  'bearer',
  'basic',
  'clientCredentials',
  'pkce'
);

const paramSeedArb = fc.record({
  name: alnumArb(6),
  location: fc.constantFrom(
    'path' as const,
    'query' as const,
    'header' as const,
    'cookie' as const,
    'body' as const
  ),
  required: fc.boolean(),
});

const endpointSeedArb = fc.record({
  method: httpMethodArb,
  path: alnumArb(6),
  parameters: fc.array(paramSeedArb, { maxLength: 4 }),
  errorCodes: fc.array(alnumArb(3), { maxLength: 2 }),
});

const authSeedArb = fc.record({ id: alnumArb(6), type: authTypeArb });

const rateSeedArb = fc.record({
  id: alnumArb(6),
  limit: fc.integer({ min: 1, max: 1000 }),
  windowSeconds: fc.integer({ min: 1, max: 3600 }),
});

/**
 * Generate a well-formed {@link ApiMetadata}. Endpoint / auth / rate-limit ids
 * are made unique by index prefix so every generated chunk has a distinct
 * `sourceRef`.
 */
const apiMetadataArb = (apiId: string): fc.Arbitrary<ApiMetadata> =>
  fc
    .record({
      title: alnumArb(12),
      sourceFormat: fc.constantFrom('openapi-3' as const, 'swagger-2' as const),
      endpoints: fc.array(endpointSeedArb, { minLength: 0, maxLength: 5 }),
      authSchemes: fc.array(authSeedArb, { minLength: 0, maxLength: 4 }),
      rateLimits: fc.array(rateSeedArb, { minLength: 0, maxLength: 3 }),
    })
    .map((m) => ({
      apiId,
      title: m.title,
      sourceFormat: m.sourceFormat,
      endpoints: m.endpoints.map((e, i) => {
        const path = `/r${i}/${e.path}`;
        return {
          endpointId: `${e.method} ${path}`,
          path,
          method: e.method,
          parameters: e.parameters.map((p) => ({ ...p, schema: {} })),
          responseSchemas: {},
          responseExamples: {},
          errorCodes: e.errorCodes,
          authSchemeRefs: [],
        };
      }),
      authSchemes: m.authSchemes.map((s, i) => ({
        id: `scheme${i}_${s.id}`,
        type: s.type,
        details: {},
      })),
      rateLimits: m.rateLimits.map((r, i) => ({
        id: `rl${i}_${r.id}`,
        limit: r.limit,
        windowSeconds: r.windowSeconds,
      })),
    }));

function apiVersion(metadata: ApiMetadata, version: number): ApiVersion {
  return {
    apiId: metadata.apiId,
    workspaceId: WORKSPACE_ID,
    version,
    metadata,
    createdAt: new Date('2024-01-01T00:00:00Z'),
  };
}

/** A vector store that delegates to an in-memory store but can fail the next upsert. */
class FailableVectorStore implements VectorStore {
  public failNextUpsert = false;
  private readonly inner = new InMemoryVectorStore();

  async upsert(items: IndexedChunk[]): Promise<void> {
    if (this.failNextUpsert) {
      throw new Error('vector store unavailable');
    }
    await this.inner.upsert(items);
  }

  async query(
    vector: number[],
    scope: { apiId: string; version: number },
    topK: number
  ): Promise<ScoredChunk[]> {
    return this.inner.query(vector, scope, topK);
  }
}

// ─── Property 9 ───────────────────────────────────────────────────────────────

describe('Query Engine — Indexing properties', () => {
  // Feature: api-copilot-ai, Property 9: Every indexed chunk becomes queryable —
  // for any successfully extracted metadata, each generated content chunk is
  // present in the Vector_Database and retrievable by a semantic query scoped to
  // its API.
  // Validates: Requirements 3.1
  it('Property 9: every indexed chunk becomes queryable within its API scope', async () => {
    await fc.assert(
      fc.asyncProperty(
        apiMetadataArb('api-under-test'),
        fc.integer({ min: 1, max: 25 }),
        async (metadata, version) => {
          const vectorStore = new InMemoryVectorStore();
          const embeddingProvider = new FakeEmbeddingProvider();
          const service = new IndexingService({ vectorStore, embeddingProvider });

          const result = await service.index(apiVersion(metadata, version));
          const expectedChunks = chunkApiMetadata(metadata);

          // Every generated chunk was embedded and stored.
          expect(result.chunkCount).toBe(expectedChunks.length);
          expect(new Set(result.chunkIds).size).toBe(expectedChunks.length);

          // A scoped semantic query retrieves every generated chunk.
          const probe = await embeddingProvider.embed('anything');
          const hits = await vectorStore.query(
            probe,
            { apiId: metadata.apiId, version },
            expectedChunks.length + 10
          );

          expect(hits).toHaveLength(expectedChunks.length);
          const retrievedRefs = new Set(hits.map((h) => h.chunk.sourceRef));
          for (const chunk of expectedChunks) {
            expect(retrievedRefs.has(chunk.sourceRef)).toBe(true);
          }
          // Every retrieved chunk belongs to the queried API scope.
          for (const hit of hits) {
            expect(hit.chunk.apiId).toBe(metadata.apiId);
            expect(hit.chunk.version).toBe(version);
          }
        }
      )
    );
  });

  // ─── Property 11 ──────────────────────────────────────────────────────────

  // Feature: api-copilot-ai, Property 11: Index remains intact on indexing
  // failure — for any indexing operation that fails during embedding or storage,
  // the previously indexed content is unchanged and an indexing-failure
  // indication is produced.
  // Validates: Requirements 3.5
  it('Property 11: a failed indexing operation leaves previously indexed content unchanged', async () => {
    await fc.assert(
      fc.asyncProperty(
        apiMetadataArb('api-prior'),
        apiMetadataArb('api-failing'),
        fc.constantFrom<'embedding' | 'storage'>('embedding', 'storage'),
        async (priorMeta, failingMeta, phase) => {
          const vectorStore = new FailableVectorStore();
          const goodEmbedder = new FakeEmbeddingProvider();

          // Index the prior API successfully.
          const priorService = new IndexingService({
            vectorStore,
            embeddingProvider: goodEmbedder,
          });
          const priorResult = await priorService.index(apiVersion(priorMeta, 1));

          // Attempt to index a second API that fails in the chosen phase.
          const failingEmbedder: EmbeddingProvider = {
            async embed(): Promise<number[]> {
              throw new Error('embedding model unavailable');
            },
          };
          const badService = new IndexingService({
            vectorStore,
            embeddingProvider: phase === 'embedding' ? failingEmbedder : goodEmbedder,
          });
          if (phase === 'storage') {
            vectorStore.failNextUpsert = true;
          }

          let caught: unknown;
          try {
            await badService.index(apiVersion(failingMeta, 1));
          } catch (error) {
            caught = error;
          }

          // An indexing-failure indication is produced, tagged with the phase.
          expect(caught).toBeInstanceOf(IndexingFailureError);
          expect((caught as IndexingFailureError).phase).toBe(phase);
          expect((caught as IndexingFailureError).apiId).toBe(failingMeta.apiId);

          // Previously indexed content is fully retrievable, unchanged.
          const probe = await goodEmbedder.embed('probe');
          const priorHits = await vectorStore.query(
            probe,
            { apiId: priorMeta.apiId, version: 1 },
            priorResult.chunkCount + 10
          );
          expect(priorHits).toHaveLength(priorResult.chunkCount);

          // Nothing was committed for the failed API.
          const failedHits = await vectorStore.query(
            probe,
            { apiId: failingMeta.apiId, version: 1 },
            100
          );
          expect(failedHits).toHaveLength(0);
        }
      )
    );
  });
});
