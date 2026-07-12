/**
 * Unit tests for the API Copilot AI product-shared foundation:
 * infrastructure defaults, repository defaults, DI pattern, and event wiring.
 */

import {
  InMemoryVectorStore,
  FakeEmbeddingProvider,
  FakeLlmProvider,
  InMemoryCryptoProvider,
  FakeHttpClient,
  createInMemoryInfrastructure,
  InMemoryAccountRepository,
  InMemoryApiVersionRepository,
  InMemoryHistoryRepository,
  InMemoryConversationRepository,
  InMemoryProductEventBus,
  defaultIdGenerator,
  defaultDateProvider,
  MAX_HISTORY_ENTRIES,
} from './index';
import type {
  Account,
  ApiVersion,
  HistoryEntry,
  IndexedChunk,
  UsageEvent,
} from './index';

const makeChunk = (id: string, embedding: number[], apiId = 'api1', version = 1): IndexedChunk => ({
  chunkId: id,
  apiId,
  version,
  sourceRef: `GET /${id}`,
  text: `chunk ${id}`,
  embedding,
});

describe('DI pattern defaults', () => {
  it('defaultIdGenerator produces unique, prefixed ids', () => {
    const a = defaultIdGenerator();
    const b = defaultIdGenerator();
    expect(a).toMatch(/^AC_/);
    expect(a).not.toEqual(b);
  });

  it('defaultDateProvider returns a Date', () => {
    expect(defaultDateProvider()).toBeInstanceOf(Date);
  });
});

describe('InMemoryVectorStore', () => {
  it('scopes results by api/version and orders by non-increasing score', async () => {
    const store = new InMemoryVectorStore();
    await store.upsert([
      makeChunk('a', [1, 0, 0]),
      makeChunk('b', [0, 1, 0]),
      makeChunk('other', [1, 0, 0], 'api2', 1),
    ]);

    const hits = await store.query([1, 0, 0], { apiId: 'api1', version: 1 }, 10);

    expect(hits.map((h) => h.chunk.chunkId)).toEqual(['a', 'b']);
    expect(hits[0].score).toBeGreaterThanOrEqual(hits[1].score);
    // Scores are mapped into the 0..1 range.
    for (const h of hits) {
      expect(h.score).toBeGreaterThanOrEqual(0);
      expect(h.score).toBeLessThanOrEqual(1);
    }
  });

  it('respects topK', async () => {
    const store = new InMemoryVectorStore();
    await store.upsert([makeChunk('a', [1, 0]), makeChunk('b', [0.9, 0.1])]);
    const hits = await store.query([1, 0], { apiId: 'api1', version: 1 }, 1);
    expect(hits).toHaveLength(1);
  });
});

describe('FakeEmbeddingProvider', () => {
  it('is deterministic and fixed-length', async () => {
    const provider = new FakeEmbeddingProvider(8);
    const v1 = await provider.embed('hello');
    const v2 = await provider.embed('hello');
    expect(v1).toEqual(v2);
    expect(v1).toHaveLength(8);
  });
});

describe('FakeLlmProvider', () => {
  it('cites every supplied context chunk and stays grounded', async () => {
    const llm = new FakeLlmProvider();
    const answer = await llm.generateGrounded('what?', [
      { sourceRef: 'GET /a', text: 'alpha' },
      { sourceRef: 'GET /b', text: 'beta' },
    ]);
    expect(answer.citations).toEqual(['GET /a', 'GET /b']);
    expect(answer.text).toContain('alpha');
    expect(answer.text).toContain('beta');
  });
});

describe('InMemoryCryptoProvider', () => {
  it('round-trips plaintext without storing it readable', async () => {
    const crypto = new InMemoryCryptoProvider();
    const secret = Buffer.from('super-secret-token');
    const ct = await crypto.encrypt(secret);
    expect(ct.data).not.toContain('super-secret-token');
    const back = await crypto.decrypt(ct);
    expect(back.toString()).toEqual('super-secret-token');
  });
});

describe('FakeHttpClient', () => {
  it('returns registered responses and 404 for unknown routes', async () => {
    const http = new FakeHttpClient();
    http.register('GET', 'https://x/y', { statusCode: 200, headers: {}, body: 'ok' });
    const res = await http.send({ method: 'GET', url: 'https://x/y', headers: {} }, 30000);
    expect(res.statusCode).toBe(200);
    const miss = await http.send({ method: 'GET', url: 'https://x/z', headers: {} }, 30000);
    expect(miss.statusCode).toBe(404);
  });
});

describe('createInMemoryInfrastructure', () => {
  it('provides all five infrastructure abstractions', () => {
    const infra = createInMemoryInfrastructure();
    expect(infra.vectorStore).toBeInstanceOf(InMemoryVectorStore);
    expect(infra.embeddingProvider).toBeInstanceOf(FakeEmbeddingProvider);
    expect(infra.llmProvider).toBeInstanceOf(FakeLlmProvider);
    expect(infra.cryptoProvider).toBeInstanceOf(InMemoryCryptoProvider);
    expect(infra.httpClient).toBeInstanceOf(FakeHttpClient);
  });
});

describe('Repository defaults', () => {
  it('AccountRepository finds by email case-insensitively', async () => {
    const repo = new InMemoryAccountRepository();
    const account: Account = {
      accountId: 'acc1',
      email: 'User@Example.com',
      passwordHash: 'hash',
      tier: 'starter',
    };
    await repo.save(account);
    expect(await repo.findByEmail('user@example.com')).toEqual(account);
    expect(await repo.findById('acc1')).toEqual(account);
  });

  it('ApiVersionRepository lists versions ascending and distinct api ids', async () => {
    const repo = new InMemoryApiVersionRepository();
    const base: Omit<ApiVersion, 'version'> = {
      apiId: 'api1',
      workspaceId: 'ws1',
      metadata: {
        apiId: 'api1',
        title: 'API',
        sourceFormat: 'openapi-3',
        endpoints: [],
        authSchemes: [],
        rateLimits: [],
      },
      createdAt: new Date(),
    };
    await repo.save({ ...base, version: 2 });
    await repo.save({ ...base, version: 1 });
    const versions = await repo.listVersions('ws1', 'api1');
    expect(versions.map((v) => v.version)).toEqual([1, 2]);
    expect(await repo.listApiIds('ws1')).toEqual(['api1']);
  });

  it('HistoryRepository is a bounded most-recent ring buffer', async () => {
    const repo = new InMemoryHistoryRepository(3);
    const mkEntry = (i: number): HistoryEntry => ({
      historyId: `h${i}`,
      workspaceId: 'ws1',
      request: { method: 'GET', url: `https://x/${i}`, headers: {} },
      result: { statusCode: 200, headers: {}, body: '', elapsedMs: 1, outcome: 'success' },
      createdAt: new Date(i),
    });
    for (let i = 0; i < 5; i += 1) {
      await repo.append(mkEntry(i));
    }
    const list = await repo.list('ws1');
    expect(list).toHaveLength(3);
    // Most-recent-first, oldest evicted.
    expect(list.map((e) => e.historyId)).toEqual(['h4', 'h3', 'h2']);
    expect(MAX_HISTORY_ENTRIES).toBe(500);
  });

  it('ConversationRepository lists most-recent-first scoped to workspace', async () => {
    const repo = new InMemoryConversationRepository();
    await repo.save({
      entryId: 'e1',
      workspaceId: 'ws1',
      userId: 'u1',
      question: 'q1',
      answer: { text: 'a1', grounded: true, citations: [] },
      answeredAt: new Date(1),
    });
    await repo.save({
      entryId: 'e2',
      workspaceId: 'ws1',
      userId: 'u1',
      question: 'q2',
      answer: { text: 'a2', grounded: true, citations: [] },
      answeredAt: new Date(2),
    });
    const list = await repo.list('ws1');
    expect(list.map((e) => e.entryId)).toEqual(['e2', 'e1']);
    expect(await repo.list('other')).toEqual([]);
  });
});

describe('InMemoryProductEventBus', () => {
  it('delivers usage events to subscribers and supports unsubscribe', async () => {
    const bus = new InMemoryProductEventBus();
    const received: UsageEvent[] = [];
    const sub = bus.subscribeUsage((e) => {
      received.push(e);
    });
    const event: UsageEvent = { workspaceId: 'ws1', type: 'ai_query', timestamp: new Date() };
    await bus.publishUsage(event);
    expect(received).toHaveLength(1);

    sub.unsubscribe();
    await bus.publishUsage(event);
    expect(received).toHaveLength(1);
  });

  it('does not let a failing subscriber block others', async () => {
    const bus = new InMemoryProductEventBus();
    let reached = false;
    bus.subscribeUsage(() => {
      throw new Error('boom');
    });
    bus.subscribeUsage(() => {
      reached = true;
    });
    await bus.publishUsage({ workspaceId: 'ws1', type: 'api_execution', timestamp: new Date() });
    expect(reached).toBe(true);
  });
});
