/**
 * Follow-Up Validators
 * Validation logic for follow-up action assignment and completion.
 * Validates: Requirements 8.1, 8.6
 */

import type { FollowUpAssignmentRequest, FollowUpActionType } from './follow-up.types';
import { FollowUpValidationError } from './follow-up.errors';

const VALID_ACTION_TYPES: FollowUpActionType[] = [
  'specialist_referral',
  'medication_change',
  'lifestyle_recommendation',
  'next_checkup_date',
];

const MAX_DESCRIPTION_LENGTH = 500;
const MIN_DESCRIPTION_LENGTH = 1;
const MAX_ASSIGNEE_NOTE_LENGTH = 300;
const MAX_COMPLETION_NOTES_LENGTH = 1000;

/**
 * Validates a follow-up assignment request.
 * Throws FollowUpValidationError for the first validation failure encountered.
 *
 * @param request - The assignment request to validate
 * @param currentDate - The current date for due date comparison
 */
export function validateAssignmentRequest(
  request: FollowUpAssignmentRequest,
  currentDate: Date
): void {
  // Validate reportId is present
  if (!request.reportId || request.reportId.trim().length === 0) {
    throw new FollowUpValidationError('reportId', 'Report ID is required.');
  }

  // Validate description length (1-500 chars)
  if (!request.description || request.description.trim().length < MIN_DESCRIPTION_LENGTH) {
    throw new FollowUpValidationError(
      'description',
      `Description is required and must be at least ${MIN_DESCRIPTION_LENGTH} character(s).`
    );
  }
  if (request.description.length > MAX_DESCRIPTION_LENGTH) {
    throw new FollowUpValidationError(
      'description',
      `Description must not exceed ${MAX_DESCRIPTION_LENGTH} characters. Received ${request.description.length}.`
    );
  }

  // Validate action type
  if (!request.actionType || !VALID_ACTION_TYPES.includes(request.actionType)) {
    throw new FollowUpValidationError(
      'actionType',
      `Action type must be one of: ${VALID_ACTION_TYPES.join(', ')}. Received '${request.actionType}'.`
    );
  }

  // Validate due date is in the future
  if (!request.dueDate) {
    throw new FollowUpValidationError('dueDate', 'Due date is required.');
  }
  const dueDateTime = new Date(request.dueDate).getTime();
  const currentDateTime = currentDate.getTime();
  if (dueDateTime <= currentDateTime) {
    throw new FollowUpValidationError(
      'dueDate',
      'Due date must be in the future.'
    );
  }

  // Validate optional assignee note length
  if (request.assigneeNote !== undefined && request.assigneeNote !== null) {
    if (request.assigneeNote.length > MAX_ASSIGNEE_NOTE_LENGTH) {
      throw new FollowUpValidationError(
        'assigneeNote',
        `Assignee note must not exceed ${MAX_ASSIGNEE_NOTE_LENGTH} characters. Received ${request.assigneeNote.length}.`
      );
    }
  }
}

/**
 * Validates completion notes length.
 * Throws FollowUpValidationError if notes exceed the maximum length.
 *
 * @param notes - Optional completion notes to validate
 */
export function validateCompletionNotes(notes?: string): void {
  if (notes !== undefined && notes !== null) {
    if (notes.length > MAX_COMPLETION_NOTES_LENGTH) {
      throw new FollowUpValidationError(
        'completionNotes',
        `Completion notes must not exceed ${MAX_COMPLETION_NOTES_LENGTH} characters. Received ${notes.length}.`
      );
    }
  }
}
