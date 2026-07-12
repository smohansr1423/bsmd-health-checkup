/**
 * Query Engine — Indexing Service unit tests
 *
 * Covers the semantic-indexing pipeline: chunking + embedding + storage within
 * the deadline (Req 3.1), queryability of every indexed chunk, and the
 * failure-atomicity contract that retains previously indexed content unchanged
 * and surfaces an indexing-failure indication (Req 3.5).
 *
 * Validates: Requirements 3.1, 3.5
 */

import {
  FakeEmbeddingProvider,
  InMemoryVectorStore,
} from '../api-copilot-shared';
import type {
  ApiMetadata,
  ApiVersion,
  EmbeddingProvider,
  IndexedChunk,
  VectorStore,
} from '../api-copilot-shared';
import { IndexingService } from './query-engine.service';
import { IndexingFailureError } from './query-engine.errors';
import { INDEXING_DEADLINE_MS } from './query-engine.types';

const WORKSPACE_ID = 'ws-1';

function metadata(overrides: Partial<ApiMetadata> = {}): ApiMetadata {
  return {
    apiId: 'api-1',
    title: 'Orders API',
    sourceFormat: 'openapi-3',
    endpoints: [
      {
        endpointId: 'GET /orders/{id}',
        path: '/orders/{id}',
        method: 'GET',
        parameters: [
          { name: 'id', location: 'path', required: true, schema: {} },
          { name: 'expand', location: 'query', required: false, schema: {} },
        ],
        responseSchemas: { '200': {} },
        responseExamples: {},
        errorCodes: ['404'],
        authSchemeRefs: ['bearerAuth'],
      },
      {
        endpointId: 'POST /orders',
        path: '/orders',
        method: 'POST',
        parameters: [],
        requestSchema: {},
        responseSchemas: { '201': {} },
        responseExamples: {},
        errorCodes: [],
        authSchemeRefs: ['bearerAuth'],
      },
    ],
    authSchemes: [{ id: 'bearerAuth', type: 'bearer', details: {} }],
    rateLimits: [{ id: 'default', limit: 100, windowSeconds: 60 }],
    ...overrides,
  };
}

function apiVersion(overrides: Partial<ApiVersion> = {}): ApiVersion {
  const meta = overrides.metadata ?? metadata();
  return {
    apiId: meta.apiId,
    workspaceId: WORKSPACE_ID,
    version: 1,
    metadata: meta,
    createdAt: new Date('2024-01-01T00:00:00Z'),
    ...overrides,
  };
}

/** Deterministic incrementing id generator for stable assertions. */
function seqIdGenerator(): () => string {
  let n = 0;
  return () => `chunk-${(n += 1)}`;
}

describe('IndexingService.index', () => {
  it('embeds and stores one chunk per endpoint, auth scheme, rate limit, plus an overview', async () => {
    const vectorStore = new InMemoryVectorStore();
    const service = new IndexingService({
      vectorStore,
      embeddingProvider: new FakeEmbeddingProvider(),
      idGenerator: seqIdGenerator(),
    });

    const result = await service.index(apiVersion());

    // 1 overview + 2 endpoints + 1 auth scheme + 1 rate limit = 5 chunks.
    expect(result.chunkCount).toBe(5);
    expect(result.chunkIds).toHaveLength(5);
    expect(new Set(result.chunkIds).size).toBe(5); // unique ids
    expect(result.apiId).toBe('api-1');
    expect(result.version).toBe(1);
  });

  it('makes every indexed chunk retrievable by a scoped semantic query (Req 3.1)', async () => {
    const vectorStore = new InMemoryVectorStore();
    const embeddingProvider = new FakeEmbeddingProvider();
    const service = new IndexingService({ vectorStore, embeddingProvider });

    const version = apiVersion();
    const result = await service.index(version);

    // Query with an arbitrary vector; topK large enough to return everything.
    const probe = await embeddingProvider.embed('orders');
    const hits = await vectorStore.query(
      probe,
      { apiId: version.apiId, version: version.version },
      100
    );

    expect(hits).toHaveLength(result.chunkCount);
    for (const hit of hits) {
      expect(hit.chunk.apiId).toBe(version.apiId);
      expect(hit.chunk.version).toBe(version.version);
    }
    // Each source section is represented.
    const sourceRefs = hits.map((h) => h.chunk.sourceRef);
    expect(sourceRefs).toContain('GET /orders/{id}');
    expect(sourceRefs).toContain('POST /orders');
    expect(sourceRefs).toContain('auth:bearerAuth');
    expect(sourceRefs).toContain('rateLimit:default');
  });

  it('records an indexing duration within the 60s deadline (Req 3.1)', async () => {
    const service = new IndexingService();
    const result = await service.index(apiVersion());

    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.durationMs).toBeLessThanOrEqual(INDEXING_DEADLINE_MS);
  });

  it('leaves previously indexed content unchanged when embedding fails (Req 3.5)', async () => {
    const vectorStore = new InMemoryVectorStore();

    // First, successfully index a different API version.
    const good = new IndexingService({
      vectorStore,
      embeddingProvider: new FakeEmbeddingProvider(),
    });
    const priorVersion = apiVersion();
    const priorResult = await good.index(priorVersion);

    // Now attempt to index a second API with a failing embedding provider.
    const failingEmbedder: EmbeddingProvider = {
      async embed(): Promise<number[]> {
        throw new Error('embedding model unavailable');
      },
    };
    const bad = new IndexingService({
      vectorStore,
      embeddingProvider: failingEmbedder,
    });
    const secondMeta = metadata({ apiId: 'api-2' });

    await expect(bad.index(apiVersion({ apiId: 'api-2', metadata: secondMeta })))
      .rejects.toBeInstanceOf(IndexingFailureError);

    // The prior API's content is still fully retrievable — unchanged.
    const probe = await new FakeEmbeddingProvider().embed('orders');
    const priorHits = await vectorStore.query(
      probe,
      { apiId: priorVersion.apiId, version: priorVersion.version },
      100
    );
    expect(priorHits).toHaveLength(priorResult.chunkCount);

    // Nothing was written for the failed API.
    const failedHits = await vectorStore.query(probe, { apiId: 'api-2', version: 1 }, 100);
    expect(failedHits).toHaveLength(0);
  });

  it('surfaces an indexing-failure indication when storage fails (Req 3.5)', async () => {
    const failingStore: VectorStore = {
      async upsert(): Promise<void> {
        throw new Error('vector store unavailable');
      },
      async query(): Promise<never[]> {
        return [];
      },
    };
    const service = new IndexingService({
      vectorStore: failingStore,
      embeddingProvider: new FakeEmbeddingProvider(),
    });

    let caught: unknown;
    try {
      await service.index(apiVersion());
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(IndexingFailureError);
    const err = caught as IndexingFailureError;
    expect(err.phase).toBe('storage');
    expect(err.apiId).toBe('api-1');
    expect(err.version).toBe(1);
  });

  it('embeds all chunks before writing, so an embedding failure writes nothing (Req 3.5)', async () => {
    const upserted: IndexedChunk[][] = [];
    const trackingStore: VectorStore = {
      async upsert(items: IndexedChunk[]): Promise<void> {
        upserted.push(items);
      },
      async query(): Promise<never[]> {
        return [];
      },
    };
    // Fail on the second endpoint chunk's embedding.
    let calls = 0;
    const flakyEmbedder: EmbeddingProvider = {
      async embed(): Promise<number[]> {
        calls += 1;
        if (calls >= 3) {
          throw new Error('boom');
        }
        return [0.1, 0.2];
      },
    };
    const service = new IndexingService({
      vectorStore: trackingStore,
      embeddingProvider: flakyEmbedder,
    });

    await expect(service.index(apiVersion())).rejects.toBeInstanceOf(
      IndexingFailureError
    );
    // upsert was never called: no partial writes.
    expect(upserted).toHaveLength(0);
  });
});
