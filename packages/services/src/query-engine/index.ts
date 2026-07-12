/**
 * Query Engine — barrel export.
 *
 * The Query Engine domain owns the Vector_Database-facing pipeline for API
 * Copilot AI: semantic indexing (Req 3.1, 3.5) and semantic search (Req 3.2–3.4,
 * 3.6, 3.7). RAG-grounded answering (Req 4) is added by a later task and builds
 * on this same domain.
 */

export { IndexingService, QueryEngine } from './query-engine.service';

export {
  IndexingFailureError,
  InvalidQueryLengthError,
  InvalidQuestionLengthError,
  NoApiSelectedError,
  AnswerGenerationError,
  SearchUnavailableError,
} from './query-engine.errors';
export type {
  IndexingFailurePhase,
  AnswerGenerationFailureKind,
} from './query-engine.errors';

export {
  chunkApiMetadata,
  renderEndpointText,
  renderAuthSchemeText,
  renderRateLimitText,
} from './query-engine.chunker';

export {
  isAuthenticationQuestion,
  buildGroundingContext,
} from './query-engine.answer';

export {
  INDEXING_DEADLINE_MS,
  QUERY_MIN_LENGTH,
  QUERY_MAX_LENGTH,
  MIN_RELEVANCE_SCORE,
  MAX_SEARCH_HITS,
  NO_RELEVANT_CONTENT_MESSAGE,
  QUESTION_MIN_LENGTH,
  QUESTION_MAX_LENGTH,
  NOT_AVAILABLE_MESSAGE,
  PROGRESS_THRESHOLD_MS,
  ANSWER_TIMEOUT_MS,
} from './query-engine.types';
export type {
  ContentChunk,
  IndexResult,
  IndexingService as IIndexingService,
  IndexingServiceDependencies,
  QueryEngine as IQueryEngine,
  QueryEngineDependencies,
  SearchRequest,
  SearchHit,
  SearchResult,
  QuestionRequest,
  QuotaReserver,
  ConversationRecorder,
  Answer,
} from './query-engine.types';
