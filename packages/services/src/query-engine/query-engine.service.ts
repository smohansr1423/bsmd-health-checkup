/**
 * Query Engine — Indexing Service
 *
 * Generates embeddings for extracted API_Metadata and stores them in the
 * Vector_Database within 60 seconds of extraction completion (Req 3.1). On
 * embedding or storage failure, previously indexed content is retained
 * unchanged and an indexing-failure indication is surfaced (Req 3.5).
 *
 * Failure atomicity (Req 3.5): the service embeds **every** chunk before it
 * performs a single `upsert`. An embedding-phase failure therefore guarantees
 * that nothing was written, so previously indexed content is trivially intact.
 * A storage-phase failure surfaces the cause without touching already-committed
 * content for other API versions (each version's chunks carry distinct ids).
 *
 * Validates: Requirements 3.1, 3.5
 */

import {
  FakeEmbeddingProvider,
  FakeLlmProvider,
  InMemoryApiVersionRepository,
  InMemoryProductEventBus,
  InMemoryVectorStore,
  defaultDateProvider,
  defaultIdGenerator,
} from '../api-copilot-shared';
import type {
  Answer,
  ApiSelection,
  ApiVersion,
  ApiVersionRepository,
  DateProvider,
  EmbeddingProvider,
  IdGenerator,
  IndexedChunk,
  LlmProvider,
  ProductEventBus,
  ScoredChunk,
  VectorStore,
} from '../api-copilot-shared';

import { buildGroundingContext, isAuthenticationQuestion } from './query-engine.answer';
import { chunkApiMetadata } from './query-engine.chunker';
import {
  AnswerGenerationError,
  IndexingFailureError,
  InvalidQuestionLengthError,
  InvalidQueryLengthError,
  NoApiSelectedError,
  SearchUnavailableError,
} from './query-engine.errors';
import {
  ANSWER_TIMEOUT_MS,
  MAX_SEARCH_HITS,
  MIN_RELEVANCE_SCORE,
  NO_RELEVANT_CONTENT_MESSAGE,
  NOT_AVAILABLE_MESSAGE,
  PROGRESS_THRESHOLD_MS,
  QUERY_MAX_LENGTH,
  QUERY_MIN_LENGTH,
  QUESTION_MAX_LENGTH,
  QUESTION_MIN_LENGTH,
} from './query-engine.types';
import type {
  ConversationRecorder,
  IndexResult,
  IndexingService as IIndexingService,
  IndexingServiceDependencies,
  QueryEngine as IQueryEngine,
  QueryEngineDependencies,
  QuestionRequest,
  QuotaReserver,
  SearchHit,
  SearchRequest,
  SearchResult,
} from './query-engine.types';

/**
 * Permissive default quota reserver used when no Plan & Quota seam is injected.
 * The composition root injects the authoritative `PlanQuotaService`; this
 * default keeps the Query_Engine usable standalone in development and tests.
 */
const allowAllQuotaReserver: QuotaReserver = {
  async checkAndReserveQuery(): Promise<unknown> {
    return { allowed: true };
  },
};

/**
 * No-op default conversation recorder used when no Conversation seam is
 * injected. The composition root injects the authoritative `ConversationService`.
 */
const noopConversationRecorder: ConversationRecorder = {
  async record(): Promise<unknown> {
    return undefined;
  },
};

/**
 * Race a unit of work against a hard timeout. On timeout the returned promise
 * rejects with the error produced by `onTimeout`; the pending timer is always
 * cleared so it never keeps the event loop alive.
 */
function withTimeout<T>(
  work: Promise<T>,
  timeoutMs: number,
  onTimeout: () => Error
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(onTimeout()), timeoutMs);
    if (typeof (timer as { unref?: () => void }).unref === 'function') {
      (timer as { unref: () => void }).unref();
    }
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

/**
 * Default {@link IIndexingService} implementation. Stateless aside from injected
 * dependencies, so it is safe to share across requests.
 */
export class IndexingService implements IIndexingService {
  private readonly idGenerator: IdGenerator;
  private readonly dateProvider: DateProvider;
  private readonly embeddingProvider: EmbeddingProvider;
  private readonly vectorStore: VectorStore;

  constructor(deps: Partial<IndexingServiceDependencies> = {}) {
    this.idGenerator = deps.idGenerator ?? defaultIdGenerator;
    this.dateProvider = deps.dateProvider ?? defaultDateProvider;
    this.embeddingProvider = deps.embeddingProvider ?? new FakeEmbeddingProvider();
    this.vectorStore = deps.vectorStore ?? new InMemoryVectorStore();
  }

  async index(apiVersion: ApiVersion): Promise<IndexResult> {
    const start = this.dateProvider();
    const { apiId, version, metadata } = apiVersion;

    // 1. Chunk the metadata. Pure computation, no side effects.
    const contentChunks = chunkApiMetadata(metadata);

    // 2. Embed EVERY chunk before any write. A failure here means nothing was
    //    stored, so previously indexed content is unchanged (Req 3.5).
    const indexedChunks: IndexedChunk[] = [];
    for (const chunk of contentChunks) {
      let embedding: number[];
      try {
        embedding = await this.embeddingProvider.embed(chunk.text);
      } catch (error) {
        throw new IndexingFailureError(
          apiId,
          version,
          'embedding',
          error instanceof Error ? error.message : String(error),
          error
        );
      }
      indexedChunks.push({
        chunkId: this.idGenerator(),
        apiId,
        version,
        sourceRef: chunk.sourceRef,
        text: chunk.text,
        embedding,
      });
    }

    // 3. Store all chunks in a single upsert (Req 3.1). On failure, surface the
    //    indexing-failure indication; content committed for other versions is
    //    left unchanged (Req 3.5).
    try {
      await this.vectorStore.upsert(indexedChunks);
    } catch (error) {
      throw new IndexingFailureError(
        apiId,
        version,
        'storage',
        error instanceof Error ? error.message : String(error),
        error
      );
    }

    const indexedAt = this.dateProvider();
    return {
      apiId,
      version,
      chunkIds: indexedChunks.map((c) => c.chunkId),
      chunkCount: indexedChunks.length,
      indexedAt,
      durationMs: indexedAt.getTime() - start.getTime(),
    };
  }
}

/**
 * Default {@link IQueryEngine} implementation for semantic search (Req 3.2–3.4,
 * 3.6, 3.7).
 *
 * The pipeline is: validate the query length (Req 3.6) → embed the query →
 * retrieve the top hits scoped to the selected API/version from the
 * Vector_Database (Req 3.3), surfacing a temporary-unavailability error with no
 * partial results if that retrieval fails (Req 3.7) → drop hits below the
 * relevance threshold (Req 3.4) → return at most {@link MAX_SEARCH_HITS} hits
 * ordered by non-increasing relevance (Req 3.2), or an empty result carrying the
 * "no relevant content" message when nothing qualifies (Req 3.4).
 *
 * Stateless aside from injected dependencies, so it is safe to share across
 * requests.
 */
export class QueryEngine implements IQueryEngine {
  private readonly dateProvider: DateProvider;
  private readonly embeddingProvider: EmbeddingProvider;
  private readonly vectorStore: VectorStore;
  private readonly llmProvider: LlmProvider;
  private readonly apiVersionRepository: ApiVersionRepository;
  private readonly quotaReserver: QuotaReserver;
  private readonly conversationRecorder: ConversationRecorder;
  private readonly productEventBus: ProductEventBus;

  constructor(deps: Partial<QueryEngineDependencies> = {}) {
    this.dateProvider = deps.dateProvider ?? defaultDateProvider;
    this.embeddingProvider = deps.embeddingProvider ?? new FakeEmbeddingProvider();
    this.vectorStore = deps.vectorStore ?? new InMemoryVectorStore();
    this.llmProvider = deps.llmProvider ?? new FakeLlmProvider();
    this.apiVersionRepository =
      deps.apiVersionRepository ?? new InMemoryApiVersionRepository();
    this.quotaReserver = deps.quotaReserver ?? allowAllQuotaReserver;
    this.conversationRecorder =
      deps.conversationRecorder ?? noopConversationRecorder;
    this.productEventBus = deps.productEventBus ?? new InMemoryProductEventBus();
  }

  async semanticSearch(req: SearchRequest): Promise<SearchResult> {
    const { query, selection } = req;

    // 1. Validate the query length 1..1000 (Req 3.6). Reject before any work.
    const length = query.length;
    if (length < QUERY_MIN_LENGTH || length > QUERY_MAX_LENGTH) {
      throw new InvalidQueryLengthError(length, QUERY_MIN_LENGTH, QUERY_MAX_LENGTH);
    }

    // 2. Embed the query. An embedding failure means we cannot search, which is
    //    surfaced as a temporary-unavailability indication with no partial
    //    results (Req 3.7).
    let vector: number[];
    try {
      vector = await this.embeddingProvider.embed(query);
    } catch (error) {
      throw new SearchUnavailableError(
        error instanceof Error ? error.message : String(error),
        error
      );
    }

    // 3. Retrieve the top hits scoped to the selected API/version (Req 3.3).
    //    A store failure is surfaced without returning partial results (Req 3.7).
    let scored: ScoredChunk[];
    try {
      scored = await this.vectorStore.query(
        vector,
        { apiId: selection.apiId, version: selection.version },
        MAX_SEARCH_HITS
      );
    } catch (error) {
      throw new SearchUnavailableError(
        error instanceof Error ? error.message : String(error),
        error
      );
    }

    // 4. Drop hits below the relevance threshold (Req 3.4), order by
    //    non-increasing relevance, and cap at the maximum hit count (Req 3.2).
    const hits: SearchHit[] = scored
      .filter((s) => s.score >= MIN_RELEVANCE_SCORE)
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_SEARCH_HITS)
      .map((s) => ({
        sourceRef: s.chunk.sourceRef,
        text: s.chunk.text,
        score: s.score,
      }));

    // 5. When nothing qualifies, return an empty result with the
    //    "no relevant content" message (Req 3.4).
    if (hits.length === 0) {
      return { hits: [], message: NO_RELEVANT_CONTENT_MESSAGE };
    }

    return { hits };
  }

  /**
   * Answer a natural-language question using RAG grounded in the indexed
   * metadata scoped to the selection (Req 4).
   *
   * Pipeline (mirrors the design's Q&A sequence):
   * 1. Validate the question length 1..1000 (Req 4.8).
   * 2. Reject when no API is selected (Req 4.7).
   * 3. Reserve quota for the asking account (Req 17.4); a rejection propagates.
   * 4. Retrieve grounding chunks via {@link semanticSearch}. If nothing scores
   *    ≥ 0.7, refuse without fabricating (Req 4.5).
   * 5. Otherwise generate a grounded answer via the {@link LlmProvider} that
   *    cites every source chunk (Req 4.1, 4.6), including endpoint path/method/
   *    required parameters (Req 4.2) and enumerating every auth scheme (Req 4.3).
   * 6. Record the Q&A (Req 15.1); a record failure still returns the answer
   *    (Req 15.2).
   * 7. Emit an `ai_query` usage event (Req 16.1).
   *
   * A progress indication is scheduled after {@link PROGRESS_THRESHOLD_MS}
   * (Req 19.3) and a hard timeout terminates generation after
   * {@link ANSWER_TIMEOUT_MS}, raising {@link AnswerGenerationError} while
   * preserving the selected API state for retry (Req 4.9, 19.4).
   */
  async ask(req: QuestionRequest): Promise<Answer> {
    const { question, selection, requester, onProgress } = req;

    // 1. Validate the question length 1..1000 (Req 4.8). Reject before any work
    //    and before consuming quota, generating no answer.
    const length = question.length;
    if (length < QUESTION_MIN_LENGTH || length > QUESTION_MAX_LENGTH) {
      throw new InvalidQuestionLengthError(
        length,
        QUESTION_MIN_LENGTH,
        QUESTION_MAX_LENGTH
      );
    }

    // 2. Reject when no API is selected (Req 4.7). No answer is generated.
    if (selection === null || selection === undefined) {
      throw new NoApiSelectedError();
    }

    // 3. Reserve quota for the asking account (Req 17.4). A rejection (e.g.
    //    QuotaExceededError) propagates unchanged and no answer is generated.
    await this.quotaReserver.checkAndReserveQuery(requester.accountId);

    // Schedule the progress indication after the 3s threshold (Req 19.3).
    // Generation continues regardless; the timer is cleared once done.
    let progressTimer: ReturnType<typeof setTimeout> | undefined;
    if (onProgress) {
      progressTimer = setTimeout(() => {
        try {
          onProgress();
        } catch {
          // A misbehaving progress callback must not affect generation.
        }
      }, PROGRESS_THRESHOLD_MS);
      if (typeof (progressTimer as { unref?: () => void }).unref === 'function') {
        (progressTimer as { unref: () => void }).unref();
      }
    }

    // 4–5. Retrieve + generate under a 30s hard timeout (Req 4.1, 19.4).
    let answer: Answer;
    try {
      answer = await withTimeout(
        this.generateAnswer(question, selection),
        ANSWER_TIMEOUT_MS,
        () =>
          new AnswerGenerationError(
            question,
            selection,
            'timeout',
            `Answer generation exceeded ${ANSWER_TIMEOUT_MS} ms.`
          )
      );
    } finally {
      if (progressTimer) {
        clearTimeout(progressTimer);
      }
    }

    // 6. Record the Q&A into Conversation_History (Req 15.1). On any record
    //    failure (e.g. ConversationRecordError) still return the produced answer
    //    so it is not lost (Req 15.2).
    try {
      await this.conversationRecorder.record({
        workspaceId: selection.workspaceId,
        userId: requester.userId,
        question,
        answer,
      });
    } catch {
      // Preserve the answer for display despite the record failure (Req 15.2).
    }

    // 7. Emit an ai_query usage event (Req 16.1). Emission never blocks or fails
    //    the query.
    try {
      await this.productEventBus.publishUsage({
        workspaceId: selection.workspaceId,
        type: 'ai_query',
        timestamp: this.dateProvider(),
      });
    } catch {
      // Analytics emission is best-effort and must not affect the answer.
    }

    return answer;
  }

  /**
   * Retrieve grounding chunks and produce the answer. Separated from {@link ask}
   * so the retrieval + generation phase can be raced against the hard timeout.
   *
   * @throws AnswerGenerationError when the LLM provider fails (Req 4.9).
   */
  private async generateAnswer(
    question: string,
    selection: ApiSelection
  ): Promise<Answer> {
    // Retrieve grounding chunks scoped to the selection (reuses semanticSearch,
    // which applies the 0.7 threshold, scoping, and ranking — Req 3.2–3.4).
    const search = await this.semanticSearch({ query: question, selection });

    // Nothing scored ≥ 0.7: the answer is not available in the uploaded API
    // knowledge and no ungrounded content is fabricated (Req 4.5).
    if (search.hits.length === 0) {
      return { text: NOT_AVAILABLE_MESSAGE, grounded: false, citations: [] };
    }

    // Load the selected version's metadata so endpoint answers carry the
    // complete required-parameter list (Req 4.2) and auth answers enumerate
    // every scheme (Req 4.3).
    const version = await this.apiVersionRepository.findVersion(
      selection.workspaceId,
      selection.apiId,
      selection.version
    );
    const metadata = version?.metadata ?? null;
    const authQuestion = isAuthenticationQuestion(question);
    const context = buildGroundingContext(search.hits, metadata, authQuestion);

    // Generate a grounded answer citing every source chunk used (Req 4.1, 4.6).
    let generated;
    try {
      generated = await this.llmProvider.generateGrounded(question, context);
    } catch (error) {
      throw new AnswerGenerationError(
        question,
        selection,
        'dependency',
        error instanceof Error ? error.message : String(error),
        error
      );
    }

    return {
      text: generated.text,
      grounded: true,
      // Cite each source chunk used; fall back to the context refs so a grounded
      // answer always carries a non-empty citation set (Req 4.6).
      citations:
        generated.citations.length > 0
          ? generated.citations
          : context.map((c) => c.sourceRef),
    };
  }
}
