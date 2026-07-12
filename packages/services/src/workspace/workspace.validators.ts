/**
 * Workspace — Validators
 *
 * Pure validation helpers for the Workspace service.
 *
 * Validates: Requirements 14.1, 14.2
 */

import {
  WORKSPACE_NAME_MAX_LENGTH,
  WORKSPACE_NAME_MIN_LENGTH,
} from './workspace.types';

export interface NameValidationResult {
  valid: boolean;
  length: number;
}

/**
 * Validates that a Workspace name is between 1 and 100 characters (inclusive).
 *
 * The raw string length is used so that leading/trailing whitespace counts
 * toward the bound; a name consisting solely of characters within the range is
 * accepted while empty or over-long names are rejected (Req 14.1, 14.2).
 */
export function validateWorkspaceName(name: string): NameValidationResult {
  const length = name.length;
  const valid =
    length >= WORKSPACE_NAME_MIN_LENGTH && length <= WORKSPACE_NAME_MAX_LENGTH;
  return { valid, length };
}
