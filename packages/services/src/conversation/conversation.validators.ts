/**
 * Conversation History — Validators
 *
 * Pure validation helpers for the Conversation History service.
 *
 * Validates: Requirements 15.1, 15.6
 */

import type { NewConversationEntry } from './conversation.types';

export interface EntryValidationResult {
  valid: boolean;
  /** The offending field when `valid` is false. */
  field?: 'workspaceId' | 'userId' | 'question' | 'answer';
  reason?: string;
}

/**
 * Validates that a new Conversation_History entry carries the fields required to
 * record it: the owning workspace, the submitting user's identity, the question
 * text, and a produced answer (Req 15.1, 15.6).
 *
 * This guards the integration seam so a malformed record request from the
 * Query_Engine is rejected before touching the repository.
 */
export function validateNewEntry(
  entry: NewConversationEntry
): EntryValidationResult {
  if (!entry.workspaceId || entry.workspaceId.trim().length === 0) {
    return { valid: false, field: 'workspaceId', reason: 'workspace id is required' };
  }
  if (!entry.userId || entry.userId.trim().length === 0) {
    return { valid: false, field: 'userId', reason: 'submitting user id is required' };
  }
  if (typeof entry.question !== 'string' || entry.question.length === 0) {
    return { valid: false, field: 'question', reason: 'question is required' };
  }
  if (!entry.answer || typeof entry.answer.text !== 'string') {
    return { valid: false, field: 'answer', reason: 'a produced answer is required' };
  }
  return { valid: true };
}
