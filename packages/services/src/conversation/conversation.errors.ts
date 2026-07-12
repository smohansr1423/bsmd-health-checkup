/**
 * Conversation History — Errors
 *
 * Custom error types for recording and reading Conversation_History.
 *
 * Validates: Requirements 15.2, 15.4
 */

import type { Answer } from '../api-copilot-shared';

/**
 * Thrown when persisting a Conversation_History entry fails (Req 15.2).
 *
 * The error deliberately carries the `question` and the produced `answer` so
 * the caller (e.g. `QueryEngine.ask`) can still surface the answer to the
 * requesting user without loss even though it could not be saved. `cause`
 * preserves the underlying repository failure for diagnostics.
 */
export class ConversationRecordError extends Error {
  public readonly workspaceId: string;
  public readonly userId: string;
  public readonly question: string;
  /** The produced answer, preserved for display despite the save failure. */
  public readonly answer: Answer;
  public readonly cause?: unknown;

  constructor(
    workspaceId: string,
    userId: string,
    question: string,
    answer: Answer,
    cause?: unknown
  ) {
    super(
      `Failed to save conversation entry for workspace "${workspaceId}"; ` +
        `the answer was preserved for display but could not be recorded.`
    );
    this.name = 'ConversationRecordError';
    this.workspaceId = workspaceId;
    this.userId = userId;
    this.question = question;
    this.answer = answer;
    this.cause = cause;
  }
}

/**
 * Thrown when a user who is not an authorized member of a Workspace requests its
 * Conversation_History (Req 15.4). The error discloses no history content — only
 * the workspace and requesting user ids — so denial leaks nothing.
 */
export class ConversationAccessError extends Error {
  public readonly workspaceId: string;
  public readonly userId: string;

  constructor(workspaceId: string, userId: string) {
    super(
      `Access denied: user "${userId}" is not authorized to read conversation ` +
        `history for workspace "${workspaceId}".`
    );
    this.name = 'ConversationAccessError';
    this.workspaceId = workspaceId;
    this.userId = userId;
  }
}
