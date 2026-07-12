/**
 * Query Engine — Types
 *
 * Types for the semantic-indexing pipeline (Req 3.1, 3.5). The Query Engine
 * domain owns everything that faces the Vector_Database: indexing extracted
 * metadata into retrievable chunks (this task), and — added by later tasks —
 * semantic search (Req 3.2–3.4, 3.6, 3.7) and RAG-grounded answering (Req 4).
 *
 * Cross-domain primitives (ApiMetadata, ApiVersion, IndexedChunk) and the
 * infrastructure abstractions (EmbeddingProvider, VectorStore) come from the
 * API Copilot AI product-shared module.
 *
 * Validates: Requirements 3.1, 3.5
 */

import type {
  Answer,
  ApiMetadata,
  ApiSelection,
  ApiVersion,
  ApiVersionRepository,
  BaseServiceDependencies,
  EmbeddingProvider,
  LlmProvider,
  ProductEventBus,
  UserRef,
  VectorStore,
} from '../api-copilot-shared';

/**
 * The Vector_Database indexing deadline: embeddings must be generated and
 * stored within 60 seconds of extraction completion (Req 3.1). Exposed so the
 * service can record and report indexing duration against this target.
 */
export const INDEXING_DEADLINE_MS = 60_000;

/**
 * A unit of API content to be embedded and indexed, before an embedding is
 * attached. Produced by the chunker from normalized {@link ApiMetadata}.
 */
export interface ContentChunk {
  /**
   * Citation-friendly reference to the source of this chunk — an `endpointId`
   * for endpoint chunks, or a stable `auth:*` / `rateLimit:*` / `api:*` marker
   * for the corresponding metadata sections (Req 4.6).
   */
  sourceRef: string;
  /** Human-readable text describing the chunk, used both for embedding and citation. */
  text: string;
}

/**
 * Outcome of a successful indexing operation (Req 3.1). Returned only when every
 * chunk was embedded and stored; a failure throws {@link IndexingFailureError}
 * and leaves previously indexed content unchanged (Req 3.5).
 */
export interface IndexResult {
  apiId: string;
  version: number;
  /** Ids of the chunks upserted into the Vector_Database. */
  chunkIds: string[];
  /** Number of chunks indexed for this API version. */
  chunkCount: number;
  /** When indexing completed. */
  indexedAt: Date;
  /**
   * Wall-clock duration of the indexing operation. Callers/monitoring can assert
   * this stays within {@link INDEXING_DEADLINE_MS} (Req 3.1).
   */
  durationMs: number;
}

/**
 * Generates embeddings for extracted API_Metadata and stores them in the
 * Vector_Database within 60 seconds of extraction completion (Req 3.1). On
 * embedding or storage failure, previously indexed content is retained
 * unchanged and an indexing-failure indication is surfaced (Req 3.5).
 */
export interface IndexingService {
  /**
   * Chunk the version's metadata, embed each chunk, and upsert the results into
   * the Vector_Database scoped to the version's `apiId`/`version`.
   *
   * @throws IndexingFailureError when embedding generation or vector-store
   *   storage fails; previously indexed content is left unchanged (Req 3.5).
   */
  index(apiVersion: ApiVersion): Promise<IndexResult>;
}

/** Dependencies injected into the {@link IndexingService}. */
export interface IndexingServiceDependencies extends BaseServiceDependencies {
  /** Produces embedding vectors for chunk text (Req 3.1). */
  embeddingProvider: EmbeddingProvider;
  /** Stores indexed chunks for semantic retrieval (Req 3.1). */
  vectorStore: VectorStore;
}

/** Re-exported for convenience so consumers can chunk metadata directly. */
export type { ApiMetadata };

// ---------------------------------------------------------------------------
// Semantic search — Req 3.2, 3.3, 3.4, 3.6, 3.7
// ---------------------------------------------------------------------------

/** Minimum allowed Semantic_Search query length, inclusive (Req 3.6). */
export const QUERY_MIN_LENGTH = 1;

/** Maximum allowed Semantic_Search query length, inclusive (Req 3.6). */
export const QUERY_MAX_LENGTH = 1000;

/**
 * Minimum semantic relevance score, on a 0.0..1.0 scale, that a hit must meet
 * to be included in search results (Req 3.4). Hits below this are dropped.
 */
export const MIN_RELEVANCE_SCORE = 0.7;

/** Maximum number of hits returned for a single Semantic_Search query (Req 3.2). */
export const MAX_SEARCH_HITS = 50;

/** The message returned when no indexed content meets the relevance threshold (Req 3.4). */
export const NO_RELEVANT_CONTENT_MESSAGE = 'No relevant content was found.';

/**
 * A Semantic_Search request. The query is matched by meaning against indexed
 * content scoped to the selected API/version (Req 3.3).
 */
export interface SearchRequest {
  /** The natural-language search query; validated to be 1..1000 characters (Req 3.6). */
  query: string;
  /** The active API/version selection whose indexed content is searched (Req 3.3). */
  selection: ApiSelection;
}

/**
 * A single scored search hit. `score` is on a 0.0..1.0 scale and is always
 * ≥ {@link MIN_RELEVANCE_SCORE} for returned hits (Req 3.4).
 */
export interface SearchHit {
  /** Citation-friendly reference to the source of the matched chunk (Req 4.6). */
  sourceRef: string;
  /** The matched chunk text. */
  text: string;
  /** Semantic relevance score, 0.0..1.0. */
  score: number;
}

/**
 * The result of a Semantic_Search. `hits` is ordered by non-increasing
 * relevance and contains at most {@link MAX_SEARCH_HITS} entries (Req 3.2). When
 * nothing qualifies, `hits` is empty and `message` carries the
 * "no relevant content" indication (Req 3.4).
 */
export interface SearchResult {
  hits: SearchHit[];
  /** Present (the "no relevant content" message) only when `hits` is empty (Req 3.4). */
  message?: string;
}

// ---------------------------------------------------------------------------
// Natural-language Q&A (RAG) — Req 4, 19.2, 19.3, 19.4
// ---------------------------------------------------------------------------

/** Minimum allowed question length, inclusive (Req 4.8). */
export const QUESTION_MIN_LENGTH = 1;

/** Maximum allowed question length, inclusive (Req 4.8). */
export const QUESTION_MAX_LENGTH = 1000;

/**
 * The response returned when retrieval yields nothing at or above the relevance
 * threshold: the answer is not available in the uploaded API knowledge and no
 * ungrounded content is fabricated (Req 4.5).
 */
export const NOT_AVAILABLE_MESSAGE =
  'The answer is not available in the uploaded API knowledge.';

/**
 * Threshold after which a progress indication is shown while the response is
 * still being generated (Req 19.3). Measured from receipt of the question.
 */
export const PROGRESS_THRESHOLD_MS = 3000;

/**
 * Hard timeout for producing an answer (Req 4.1, 19.4). If generation does not
 * complete within this window the query is terminated with an
 * {@link AnswerGenerationError} and the selected API state is preserved.
 */
export const ANSWER_TIMEOUT_MS = 30_000;

/**
 * A natural-language Q&A request. The question is answered using RAG grounded in
 * the indexed content scoped to the selection (Req 4.1).
 */
export interface QuestionRequest {
  /** The natural-language question; validated to be 1..1000 characters (Req 4.8). */
  question: string;
  /**
   * The active API/version selection. `null` (or `undefined`) means no API is
   * selected, which is rejected before any answer is generated (Req 4.7).
   */
  selection: ApiSelection | null;
  /**
   * Identity of the asking user. `accountId` drives quota reservation (Req 17.4)
   * and `userId` attributes the recorded Conversation_History entry (Req 15.6).
   */
  requester: UserRef;
  /**
   * Optional progress callback invoked once if the answer is still being
   * generated after {@link PROGRESS_THRESHOLD_MS} (Req 19.3). Generation
   * continues regardless.
   */
  onProgress?: () => void;
}

/**
 * Reserves a single AI query against the asking account's Query_Quota before an
 * answer is generated (Req 17.4). This is an injectable seam so the Query_Engine
 * stays decoupled from the Plan & Quota domain; it is structurally satisfied by
 * `PlanQuotaService.checkAndReserveQuery`. A rejected reservation throws (e.g.
 * `QuotaExceededError`), which propagates unchanged.
 */
export interface QuotaReserver {
  checkAndReserveQuery(accountId: string): Promise<unknown>;
}

/**
 * Records a produced Q&A entry into Conversation_History (Req 15.1). This is an
 * injectable seam so the Query_Engine stays decoupled from the Conversation
 * domain; it is structurally satisfied by `ConversationService.record`. When
 * recording fails (e.g. `ConversationRecordError`), `QueryEngine.ask` still
 * returns the produced answer (Req 15.2).
 */
export interface ConversationRecorder {
  record(entry: {
    workspaceId: string;
    userId: string;
    question: string;
    answer: Answer;
    answeredAt?: Date;
  }): Promise<unknown>;
}

/**
 * The result of answering a question (Req 4.1). Grounded answers carry the
 * cited source references (Req 4.6); a refusal (Req 4.5) is `grounded: false`
 * with an empty citation set.
 */
export type { Answer };

/**
 * Performs semantic search over indexed API content (Req 3.2–3.4, 3.6, 3.7) and
 * RAG-grounded answering (Req 4).
 */
export interface QueryEngine {
  /**
   * Return up to {@link MAX_SEARCH_HITS} indexed content hits scoped to the
   * selection, ordered by non-increasing relevance and thresholded at
   * {@link MIN_RELEVANCE_SCORE} (Req 3.2–3.4).
   *
   * @throws InvalidQueryLengthError when the query is empty or exceeds
   *   {@link QUERY_MAX_LENGTH} characters (Req 3.6).
   * @throws SearchUnavailableError when the Vector_Database is unavailable; no
   *   partial results are returned (Req 3.7).
   */
  semanticSearch(req: SearchRequest): Promise<SearchResult>;

  /**
   * Answer a natural-language question using RAG grounded in the indexed
   * metadata scoped to the selection (Req 4.1). Reserves quota (Req 17.4),
   * refuses to fabricate when nothing is retrievable (Req 4.5), cites every
   * source chunk used (Req 4.6), records the Q&A (Req 15.1), and emits an
   * `ai_query` usage event (Req 16.1).
   *
   * @throws InvalidQuestionLengthError when the question is empty or exceeds
   *   {@link QUESTION_MAX_LENGTH} characters (Req 4.8).
   * @throws NoApiSelectedError when no API is selected (Req 4.7).
   * @throws AnswerGenerationError when generation fails or exceeds the 30-second
   *   limit; the selected API state is preserved for retry (Req 4.9, 19.4).
   */
  ask(req: QuestionRequest): Promise<Answer>;
}

/** Dependencies injected into the {@link QueryEngine}. */
export interface QueryEngineDependencies extends BaseServiceDependencies {
  /** Produces the embedding vector for the search query (Req 3.2). */
  embeddingProvider: EmbeddingProvider;
  /** Backs semantic retrieval scoped to the selected API/version (Req 3.2, 3.3). */
  vectorStore: VectorStore;
  /** Generates the grounded answer from retrieved context (Req 4.1, 4.6). */
  llmProvider: LlmProvider;
  /**
   * Supplies the selected version's metadata so endpoint answers list the
   * complete required parameters (Req 4.2) and auth answers enumerate every
   * scheme (Req 4.3).
   */
  apiVersionRepository: ApiVersionRepository;
  /** Reserves quota before answering (Req 17.4). */
  quotaReserver: QuotaReserver;
  /** Records the produced Q&A into Conversation_History (Req 15.1). */
  conversationRecorder: ConversationRecorder;
  /** Bus on which the `ai_query` usage event is published (Req 16.1). */
  productEventBus: ProductEventBus;
}
