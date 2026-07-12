/**
 * Client-side, pre-send validation and selection gating (Task 3.1).
 *
 * These are **pure** functions — no I/O, no React, no Electron. They run in the
 * renderer *before* any {@link RequestDescriptor} is built, so an invalid
 * submission or an ungated operation produces no descriptor and nothing is ever
 * transmitted, satisfying the "reject before sending" acceptance criteria.
 *
 * Two concerns live here:
 *
 * 1. **Validators** — inspect a single form/input value and return either
 *    `null` (valid; a descriptor may be built) or a field-identified
 *    {@link ValidationError} naming the offending field.
 *      - Sign-up: email contains "@", password length 8..128, no empty required field (Req 2.3)
 *      - Sign-in: non-empty email/password (Req 3.3)
 *      - Workspace name: length 1..100 (Req 5.3)
 *      - Upload: size <= 25 MB and YAML/JSON content type only (Req 6.3)
 *      - Question / search query: length 1..1000 (Req 8.2, 9.4)
 *
 * 2. **Gating predicates** — decide whether an operation may proceed given the
 *    current selection state. Upload requires an Active_Workspace (Req 6.2);
 *    ask / search / code-gen require an Active_API_Version (Req 7.5, 8.3, 13.4).
 *    A gate that is not satisfied yields a {@link SelectionRequired} indication
 *    so the caller surfaces a "selection required" message and produces no
 *    descriptor.
 */

import type { apiCopilotShared } from '@health-checkup/services';
import type { SignUpInput, SignInInput, UploadFile, UiOutcome } from './types';

/**
 * The client-side validation failure shape — the `validation_error` variant of
 * {@link UiOutcome}. A `null` result from any validator means "valid".
 */
export type ValidationError = Extract<UiOutcome<never>, { kind: 'validation_error' }>;

// ---- Constraint constants (single source of truth for limits) ----

/** Minimum accepted password length (Req 2.3). */
export const PASSWORD_MIN_LENGTH = 8;
/** Maximum accepted password length (Req 2.3). */
export const PASSWORD_MAX_LENGTH = 128;
/** Minimum accepted workspace-name length (Req 5.3). */
export const WORKSPACE_NAME_MIN_LENGTH = 1;
/** Maximum accepted workspace-name length (Req 5.3). */
export const WORKSPACE_NAME_MAX_LENGTH = 100;
/** Minimum accepted question / search-query length (Req 8.2, 9.4). */
export const TEXT_QUERY_MIN_LENGTH = 1;
/** Maximum accepted question / search-query length (Req 8.2, 9.4). */
export const TEXT_QUERY_MAX_LENGTH = 1000;
/** Maximum accepted upload size in bytes: 25 MB (Req 6.3). */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
/** Supported upload content types (Req 6.3). */
export const SUPPORTED_UPLOAD_CONTENT_TYPES = ['yaml', 'json'] as const;

/** Build a field-identified validation error. */
function invalid(field: string, message: string): ValidationError {
  return { kind: 'validation_error', field, message };
}

// ---------------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------------

/**
 * Validate a sign-up submission (Req 2.3).
 *
 * Rejects when any provided registration field is empty (or whitespace-only),
 * when the email does not contain an "@" character, or when the password length
 * falls outside 8..128 characters.
 */
export function validateSignUp(input: SignUpInput): ValidationError | null {
  // No empty required field: every provided field value must be non-empty.
  for (const [field, value] of Object.entries(input)) {
    if (typeof value !== 'string' || value.trim().length === 0) {
      return invalid(field, `${field} is required`);
    }
  }

  if (!input.email.includes('@')) {
    return invalid('email', 'Email must contain an "@" character');
  }

  if (
    input.password.length < PASSWORD_MIN_LENGTH ||
    input.password.length > PASSWORD_MAX_LENGTH
  ) {
    return invalid(
      'password',
      `Password must be between ${PASSWORD_MIN_LENGTH} and ${PASSWORD_MAX_LENGTH} characters`,
    );
  }

  return null;
}

/**
 * Validate a sign-in submission (Req 3.3).
 *
 * Rejects when the email or the password is empty.
 */
export function validateSignIn(input: SignInInput): ValidationError | null {
  if (input.email.trim().length === 0) {
    return invalid('email', 'Email is required');
  }
  if (input.password.length === 0) {
    return invalid('password', 'Password is required');
  }
  return null;
}

/**
 * Validate a workspace name (Req 5.3).
 *
 * Rejects when the name is empty or exceeds 100 characters.
 */
export function validateWorkspaceName(name: string): ValidationError | null {
  if (
    name.length < WORKSPACE_NAME_MIN_LENGTH ||
    name.length > WORKSPACE_NAME_MAX_LENGTH
  ) {
    return invalid(
      'name',
      `Workspace name must be between ${WORKSPACE_NAME_MIN_LENGTH} and ${WORKSPACE_NAME_MAX_LENGTH} characters`,
    );
  }
  return null;
}

/**
 * Validate an upload file selection (Req 6.3).
 *
 * Rejects when the file exceeds 25 MB or its content type is not YAML/JSON.
 */
export function validateUpload(file: UploadFile): ValidationError | null {
  if (file.sizeBytes > MAX_UPLOAD_BYTES) {
    return invalid('file', 'The specification file must not exceed 25 MB');
  }
  if (
    !SUPPORTED_UPLOAD_CONTENT_TYPES.includes(
      file.contentType as (typeof SUPPORTED_UPLOAD_CONTENT_TYPES)[number],
    )
  ) {
    return invalid('file', 'Only YAML or JSON specifications are supported');
  }
  return null;
}

/** Shared 1..1000 length check for free-text inputs (Req 8.2, 9.4). */
function validateTextLength(
  value: string,
  field: string,
  label: string,
): ValidationError | null {
  if (
    value.length < TEXT_QUERY_MIN_LENGTH ||
    value.length > TEXT_QUERY_MAX_LENGTH
  ) {
    return invalid(
      field,
      `${label} must be between ${TEXT_QUERY_MIN_LENGTH} and ${TEXT_QUERY_MAX_LENGTH} characters`,
    );
  }
  return null;
}

/**
 * Validate a natural-language question (Req 8.2).
 *
 * Rejects when the question is empty or exceeds 1000 characters.
 */
export function validateQuestion(question: string): ValidationError | null {
  return validateTextLength(question, 'question', 'Question');
}

/**
 * Validate a semantic search query (Req 9.4).
 *
 * Rejects when the query is empty or exceeds 1000 characters.
 */
export function validateSearchQuery(query: string): ValidationError | null {
  return validateTextLength(query, 'query', 'Search query');
}

// ---------------------------------------------------------------------------
// Selection gating
// ---------------------------------------------------------------------------

/** Which selection an operation requires before it may proceed. */
export type GateRequirement = 'workspace' | 'apiVersion';

/**
 * Returned instead of a descriptor when a workspace-scoped or version-scoped
 * operation is attempted without the required selection (Req 6.2, 7.5, 8.3,
 * 13.4). The caller surfaces this as a "selection required" indication and
 * sends nothing.
 */
export interface SelectionRequired {
  kind: 'selection_required';
  /** Which selection must be made before the operation can proceed. */
  requires: GateRequirement;
  message: string;
}

/** Type guard: `true` when a gate produced a selection-required indication. */
export function isSelectionRequired(
  result: SelectionRequired | null,
): result is SelectionRequired {
  return result !== null && result.kind === 'selection_required';
}

/**
 * Predicate: is an Active_Workspace selected?
 *
 * Upload requires an Active_Workspace (Req 6.2). A `null`, `undefined`, or empty
 * workspace id means no workspace is active.
 */
export function hasActiveWorkspace(
  activeWorkspaceId: string | null | undefined,
): boolean {
  return typeof activeWorkspaceId === 'string' && activeWorkspaceId.length > 0;
}

/**
 * Predicate: is an Active_API_Version selected?
 *
 * Ask, search, and code generation require an Active_API_Version (Req 7.5, 8.3,
 * 13.4). A `null` or `undefined` selection means no version is active.
 */
export function hasActiveApiVersion(
  activeApiVersion: apiCopilotShared.ApiSelection | null | undefined,
): boolean {
  return activeApiVersion !== null && activeApiVersion !== undefined;
}

/**
 * Gate an upload on an Active_Workspace (Req 6.2).
 *
 * Returns a {@link SelectionRequired} indication when no workspace is active, or
 * `null` when the upload may proceed and a descriptor may be built.
 */
export function gateUpload(
  activeWorkspaceId: string | null | undefined,
): SelectionRequired | null {
  if (hasActiveWorkspace(activeWorkspaceId)) {
    return null;
  }
  return {
    kind: 'selection_required',
    requires: 'workspace',
    message: 'Select a workspace before uploading a specification',
  };
}

/**
 * Gate a version-scoped operation (ask / search / code-gen) on an
 * Active_API_Version (Req 7.5, 8.3, 13.4).
 *
 * Returns a {@link SelectionRequired} indication when no version is active, or
 * `null` when the operation may proceed and a descriptor may be built.
 */
export function gateApiVersionOperation(
  activeApiVersion: apiCopilotShared.ApiSelection | null | undefined,
): SelectionRequired | null {
  if (hasActiveApiVersion(activeApiVersion)) {
    return null;
  }
  return {
    kind: 'selection_required',
    requires: 'apiVersion',
    message: 'Select an API version before continuing',
  };
}
