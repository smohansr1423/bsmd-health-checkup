/**
 * Query Engine — Errors
 *
 * Error types raised by the semantic-indexing pipeline (Req 3.5), by semantic
 * search (Req 3.6, 3.7), and by RAG-grounded answering (Req 4.7, 4.8, 4.9).
 *
 * Validates: Requirements 3.5, 3.6, 3.7, 4.7, 4.8, 4.9
 */

import type { ApiSelection } from '../api-copilot-shared';

/**
 * The phase of indexing that failed:
 * - `embedding` → generating an embedding vector for a chunk failed. No writes
 *   have been made to the Vector_Database, so previously indexed content is
 *   trivially unchanged (Req 3.5).
 * - `storage`   → persisting the embedded chunks to the Vector_Database failed.
 */
export type IndexingFailurePhase = 'embedding' | 'storage';

/**
 * Thrown when embedding generation or Vector_Database storage fails during
 * indexing (Req 3.5). This is the "indication that indexing failed" the
 * requirement calls for.
 *
 * The indexing operation embeds **all** chunks before performing a single
 * store, so an `embedding`-phase failure guarantees that nothing was written
 * and previously indexed content is untouched. A `storage`-phase failure
 * surfaces the underlying cause without altering already-committed prior
 * content for other API versions.
 */
export class IndexingFailureError extends Error {
  /** The API whose indexing failed. */
  public readonly apiId: string;
  /** The API version whose indexing failed. */
  public readonly version: number;
  /** Which phase failed (embedding vs storage). */
  public readonly phase: IndexingFailurePhase;
  /** Human-readable detail describing the failure. */
  public readonly detail: string;
  /** The underlying cause, when available. */
  public readonly cause?: unknown;

  constructor(
    apiId: string,
    version: number,
    phase: IndexingFailurePhase,
    detail: string,
    cause?: unknown
  ) {
    super(
      `Indexing failed during ${phase} for API ${apiId} version ${version}: ${detail}. ` +
        `Previously indexed content was left unchanged.`
    );
    this.name = 'IndexingFailureError';
    this.apiId = apiId;
    this.version = version;
    this.phase = phase;
    this.detail = detail;
    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}

/**
 * Thrown when a Semantic_Search query is empty or exceeds the allowed length
 * (Req 3.6). The message describes the character-length constraint so callers
 * can surface it directly. No search is performed and no partial results are
 * returned when this is raised.
 */
export class InvalidQueryLengthError extends Error {
  /** Minimum allowed query length (inclusive). */
  public readonly minLength: number;
  /** Maximum allowed query length (inclusive). */
  public readonly maxLength: number;
  /** The length of the query that was rejected. */
  public readonly actualLength: number;

  constructor(actualLength: number, minLength: number, maxLength: number) {
    super(
      `Search query length ${actualLength} is out of range: it must be between ` +
        `${minLength} and ${maxLength} characters.`
    );
    this.name = 'InvalidQueryLengthError';
    this.actualLength = actualLength;
    this.minLength = minLength;
    this.maxLength = maxLength;
  }
}

/**
 * Thrown when the Vector_Database is unavailable while a Semantic_Search query
 * is submitted (Req 3.7). This is the "search is temporarily unavailable"
 * indication the requirement calls for; it is raised instead of returning any
 * partial results.
 */
export class SearchUnavailableError extends Error {
  /** Human-readable detail describing the unavailability. */
  public readonly detail: string;
  /** The underlying cause, when available. */
  public readonly cause?: unknown;

  constructor(detail: string, cause?: unknown) {
    super(`Search is temporarily unavailable: ${detail}. No partial results were returned.`);
    this.name = 'SearchUnavailableError';
    this.detail = detail;
    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}

/**
 * Thrown when a natural-language question is empty or exceeds the allowed length
 * (Req 4.8). The message describes the accepted question-length range so callers
 * can surface it directly. No answer is generated when this is raised.
 */
export class InvalidQuestionLengthError extends Error {
  /** Minimum allowed question length (inclusive). */
  public readonly minLength: number;
  /** Maximum allowed question length (inclusive). */
  public readonly maxLength: number;
  /** The length of the question that was rejected. */
  public readonly actualLength: number;

  constructor(actualLength: number, minLength: number, maxLength: number) {
    super(
      `Question length ${actualLength} is out of range: a question must be ` +
        `between ${minLength} and ${maxLength} characters.`
    );
    this.name = 'InvalidQuestionLengthError';
    this.actualLength = actualLength;
    this.minLength = minLength;
    this.maxLength = maxLength;
  }
}

/**
 * Thrown when a question is submitted while no API is selected (Req 4.7). The
 * Query_Engine rejects the request and generates no answer; an API must be
 * selected before asking a question.
 */
export class NoApiSelectedError extends Error {
  constructor() {
    super('An API must be selected before asking a question.');
    this.name = 'NoApiSelectedError';
  }
}

/**
 * Distinguishes why answer generation could not complete:
 * - `timeout`    → generation exceeded the 30-second hard limit (Req 4.1, 19.4).
 * - `dependency` → an internal or dependency failure (e.g. the LLM provider)
 *   prevented completion (Req 4.9).
 */
export type AnswerGenerationFailureKind = 'timeout' | 'dependency';

/**
 * Thrown when the Query_Engine cannot produce an answer within the 30-second
 * limit or because of an internal/dependency failure (Req 4.9, 19.4). No
 * ungrounded content is fabricated. The error carries the original `question`
 * and `selection` so the caller can preserve the user's input and the selected
 * API state for retry.
 */
export class AnswerGenerationError extends Error {
  /** The question whose answer could not be generated (preserved for retry). */
  public readonly question: string;
  /** The selected API/version, preserved so the caller can retry (Req 4.9). */
  public readonly selection: ApiSelection;
  /** Whether the failure was a timeout or a dependency/internal failure. */
  public readonly kind: AnswerGenerationFailureKind;
  /** Human-readable detail describing the failure. */
  public readonly detail: string;
  /** The underlying cause, when available. */
  public readonly cause?: unknown;

  constructor(
    question: string,
    selection: ApiSelection,
    kind: AnswerGenerationFailureKind,
    detail: string,
    cause?: unknown
  ) {
    super(
      `The answer could not be generated (${kind}): ${detail}. ` +
        `The selected API state and your question were preserved for retry.`
    );
    this.name = 'AnswerGenerationError';
    this.question = question;
    this.selection = selection;
    this.kind = kind;
    this.detail = detail;
    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}
