/**
 * Interactive API Testing Console — Errors
 *
 * - `SavedAuthInvalidError` (Req 8.5): raised at replay time when a saved
 *   request's authentication is missing, invalid, or expired. The request is
 *   NOT sent and the saved history entry is retained unchanged. The error
 *   identifies the affected history entry and carries the saved request plus a
 *   redacted reason describing the authentication problem — never any credential
 *   value.
 * - `HistoryEntryNotFoundError`: raised when a replay references a history entry
 *   that does not exist for the workspace.
 *
 * Validates: Requirements 8.5
 */

import type { OutboundRequestSnapshot } from '../api-copilot-shared';

/** Machine-readable classification of a saved-authentication problem. */
export type SavedAuthProblem = 'missing' | 'invalid' | 'expired';

/**
 * Raised when a replayed request cannot be sent because its saved
 * authentication is missing, invalid, or expired (Req 8.5). The request is not
 * sent; the saved history entry is retained unchanged. Carries only non-secret
 * identifiers plus a redacted reason — no credential value is ever included.
 */
export class SavedAuthInvalidError extends Error {
  public readonly workspaceId: string;
  public readonly historyId: string;
  public readonly problem: SavedAuthProblem;
  /** The saved request, retained so the caller can display it unchanged. */
  public readonly savedRequest: OutboundRequestSnapshot;

  constructor(
    workspaceId: string,
    historyId: string,
    problem: SavedAuthProblem,
    savedRequest: OutboundRequestSnapshot,
    reasonPhrase: string
  ) {
    super(
      `Cannot replay saved request "${historyId}" in workspace ` +
        `"${workspaceId}": saved authentication is ${problem} — ${reasonPhrase}. ` +
        `The request was not sent and the saved request was retained.`
    );
    this.name = 'SavedAuthInvalidError';
    this.workspaceId = workspaceId;
    this.historyId = historyId;
    this.problem = problem;
    this.savedRequest = savedRequest;
  }
}

/** Raised when a replay references a history entry that cannot be found. */
export class HistoryEntryNotFoundError extends Error {
  public readonly workspaceId: string;
  public readonly historyId: string;

  constructor(workspaceId: string, historyId: string) {
    super(
      `No saved request "${historyId}" was found in workspace "${workspaceId}".`
    );
    this.name = 'HistoryEntryNotFoundError';
    this.workspaceId = workspaceId;
    this.historyId = historyId;
  }
}
