/**
 * API Copilot AI — Infrastructure Abstractions
 *
 * Side-effecting dependencies (vector store, embeddings, LLM, crypto, outbound
 * HTTP) are expressed as interfaces so domain logic stays unit- and
 * property-testable. Each interface ships with an in-memory / fake default
 * suitable for development and tests; production swaps in real adapters.
 *
 * Validates: Requirements 1.1, 6.1, 16.1, 17.1
 */

import type {
  ApiScope,
  Ciphertext,
  IndexedChunk,
  OutboundRequest,
  OutboundResponse,
  RetrievedChunk,
  ScoredChunk,
} from './shared.types';

// ---------------------------------------------------------------------------
// Vector store — Req 3
// ---------------------------------------------------------------------------

export interface VectorStore {
  upsert(items: IndexedChunk[]): Promise<void>;
  query(vector: number[], scope: ApiScope, topK: number): Promise<ScoredChunk[]>;
}

/** Compute cosine similarity, mapped from [-1,1] to [0,1] to match the 0..1 score scale. */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) {
    return 0;
  }
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  if (magA === 0 || magB === 0) {
    return 0;
  }
  const raw = dot / (Math.sqrt(magA) * Math.sqrt(magB));
  // Map [-1, 1] -> [0, 1].
  return (raw + 1) / 2;
}

/**
 * In-memory vector store backed by brute-force cosine similarity.
 * Suitable for development and tests; production swaps in a managed vector DB.
 */
export class InMemoryVectorStore implements VectorStore {
  private chunks: Map<string, IndexedChunk> = new Map();

  async upsert(items: IndexedChunk[]): Promise<void> {
    for (const item of items) {
      this.chunks.set(item.chunkId, item);
    }
  }

  async query(vector: number[], scope: ApiScope, topK: number): Promise<ScoredChunk[]> {
    const scored: ScoredChunk[] = [];
    for (const chunk of this.chunks.values()) {
      if (chunk.apiId !== scope.apiId || chunk.version !== scope.version) {
        continue;
      }
      scored.push({ chunk, score: cosineSimilarity(vector, chunk.embedding) });
    }
    scored.sort((x, y) => y.score - x.score);
    return scored.slice(0, Math.max(0, topK));
  }

  /** Utility for testing: remove all indexed chunks. */
  clear(): void {
    this.chunks.clear();
  }
}

// ---------------------------------------------------------------------------
// Embedding provider — Req 3
// ---------------------------------------------------------------------------

export interface EmbeddingProvider {
  embed(text: string): Promise<number[]>;
}

/**
 * Deterministic fake embedding provider: hashes text into a fixed-length,
 * L2-normalized vector. Same text always yields the same embedding, so tests
 * can reason about relevance without a real model.
 */
export class FakeEmbeddingProvider implements EmbeddingProvider {
  constructor(private readonly dimensions: number = 16) {}

  async embed(text: string): Promise<number[]> {
    const vec = new Array<number>(this.dimensions).fill(0);
    for (let i = 0; i < text.length; i += 1) {
      const code = text.charCodeAt(i);
      vec[code % this.dimensions] += ((code % 13) + 1) / 13;
    }
    const mag = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
    if (mag === 0) {
      return vec;
    }
    return vec.map((v) => v / mag);
  }
}

// ---------------------------------------------------------------------------
// LLM provider — Req 4
// ---------------------------------------------------------------------------

export interface GroundedAnswer {
  text: string;
  /** sourceRefs the answer draws upon (Req 4.6). */
  citations: string[];
}

export interface LlmProvider {
  generateGrounded(question: string, context: RetrievedChunk[]): Promise<GroundedAnswer>;
}

/**
 * Deterministic fake LLM: echoes the question and stitches together the
 * provided context, citing every supplied chunk. It never fabricates content
 * beyond the supplied context, matching the grounding contract used in tests.
 */
export class FakeLlmProvider implements LlmProvider {
  async generateGrounded(
    question: string,
    context: RetrievedChunk[]
  ): Promise<GroundedAnswer> {
    const body = context.map((c) => c.text).join('\n');
    return {
      text: `Q: ${question}\n${body}`,
      citations: context.map((c) => c.sourceRef),
    };
  }
}

// ---------------------------------------------------------------------------
// Crypto provider — Req 6
// ---------------------------------------------------------------------------

export interface CryptoProvider {
  encrypt(plaintext: Buffer): Promise<Ciphertext>;
  decrypt(ciphertext: Ciphertext): Promise<Buffer>;
}

/**
 * Fake crypto provider for tests. It preserves the envelope shape and is
 * reversible, but performs only reversible obfuscation (NOT real encryption).
 * Production uses an AES-256-GCM, KMS-backed adapter. The fake still guarantees
 * that stored artifacts are not human-readable plaintext.
 */
export class InMemoryCryptoProvider implements CryptoProvider {
  constructor(private readonly keyId: string = 'in-memory-key') {}

  async encrypt(plaintext: Buffer): Promise<Ciphertext> {
    return {
      data: plaintext.toString('base64'),
      iv: Buffer.from('iv').toString('base64'),
      authTag: Buffer.from('tag').toString('base64'),
      keyId: this.keyId,
    };
  }

  async decrypt(ciphertext: Ciphertext): Promise<Buffer> {
    return Buffer.from(ciphertext.data, 'base64');
  }
}

// ---------------------------------------------------------------------------
// Outbound HTTP client — Req 5
// ---------------------------------------------------------------------------

export interface HttpClient {
  send(req: OutboundRequest, timeoutMs: number): Promise<OutboundResponse>;
}

/**
 * Programmable fake HTTP client for tests. Responses (or thrown errors) are
 * registered per method+url; unmatched requests return 404. This lets execution
 * and console tests exercise success, error, timeout, and network paths without
 * real network I/O.
 */
export class FakeHttpClient implements HttpClient {
  private responses: Map<string, OutboundResponse | (() => Promise<OutboundResponse>)> =
    new Map();

  private key(method: string, url: string): string {
    return `${method} ${url}`;
  }

  /** Register a canned response (or async factory to simulate timeouts/errors). */
  register(
    method: string,
    url: string,
    response: OutboundResponse | (() => Promise<OutboundResponse>)
  ): void {
    this.responses.set(this.key(method, url), response);
  }

  async send(req: OutboundRequest, _timeoutMs: number): Promise<OutboundResponse> {
    const match = this.responses.get(this.key(req.method, req.url));
    if (match === undefined) {
      return { statusCode: 404, headers: {}, body: '' };
    }
    return typeof match === 'function' ? match() : match;
  }

  /** Utility for testing: clear all registered responses. */
  clear(): void {
    this.responses.clear();
  }
}

// ---------------------------------------------------------------------------
// Convenience: default infrastructure bundle
// ---------------------------------------------------------------------------

/** The full set of injectable infrastructure providers used across services. */
export interface InfrastructureProviders {
  vectorStore: VectorStore;
  embeddingProvider: EmbeddingProvider;
  llmProvider: LlmProvider;
  cryptoProvider: CryptoProvider;
  httpClient: HttpClient;
}

/** Build an in-memory / fake infrastructure bundle for development and tests. */
export function createInMemoryInfrastructure(): InfrastructureProviders {
  return {
    vectorStore: new InMemoryVectorStore(),
    embeddingProvider: new FakeEmbeddingProvider(),
    llmProvider: new FakeLlmProvider(),
    cryptoProvider: new InMemoryCryptoProvider(),
    httpClient: new FakeHttpClient(),
  };
}
