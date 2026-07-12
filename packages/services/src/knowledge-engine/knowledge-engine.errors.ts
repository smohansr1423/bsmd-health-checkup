/**
 * Knowledge Engine — Errors
 *
 * Error types raised by the Knowledge Engine's specification-upload and
 * extraction flow (Req 1).
 *
 * Validates: Requirements 1.4, 1.5, 1.6, 1.8, 2.2, 2.7
 */

import type { ApiSelection } from '../api-copilot-shared';

/**
 * Reason an upload was rejected before parsing began.
 * - `size`   → the file exceeds the 25 MB limit (Req 1.5)
 * - `format` → the file is not declared as YAML or JSON (Req 1.5)
 */
export type UnsupportedUploadReason = 'size' | 'format';

/**
 * Thrown when an upload is rejected by the pre-parse gate because it exceeds
 * the size limit or is not in a supported format (Req 1.5). No parsing is
 * attempted and no metadata is produced.
 */
export class UnsupportedUploadError extends Error {
  public readonly reason: UnsupportedUploadReason;
  /** Human-readable detail describing the specific limit or format violation. */
  public readonly detail: string;

  constructor(reason: UnsupportedUploadReason, detail: string) {
    super(
      reason === 'size'
        ? `Upload rejected: ${detail}`
        : `Upload rejected: unsupported format — ${detail}`
    );
    this.name = 'UnsupportedUploadError';
    this.reason = reason;
    this.detail = detail;
  }
}

/**
 * Thrown when an uploaded file cannot be parsed as a valid OpenAPI 3.x or
 * Swagger 2.0 specification (Req 1.4).
 *
 * Carries the location (a JSON-path-like pointer, or a line/column for syntax
 * errors) and the reason of the first invalid element. The Knowledge Engine
 * retains no partial metadata when this error is raised.
 */
export class SpecParseError extends Error {
  /**
   * Location of the first invalid element. For syntax errors this is a
   * `line X, column Y` marker; for structural errors it is a JSON-path-like
   * pointer such as `$.openapi` or `$.paths./users.get.responses`.
   */
  public readonly location: string;
  /** The reason the element is invalid. */
  public readonly reason: string;

  constructor(location: string, reason: string) {
    super(`Specification parse failed at ${location}: ${reason}`);
    this.name = 'SpecParseError';
    this.location = location;
    this.reason = reason;
  }
}

/**
 * Thrown when a file parses successfully but contains no extractable
 * API_Metadata — for example, a valid document with no endpoints (Req 1.6).
 */
export class NoMetadataFoundError extends Error {
  public readonly detail: string;

  constructor(detail = 'The specification parsed successfully but contained no extractable API metadata.') {
    super(detail);
    this.name = 'NoMetadataFoundError';
    this.detail = detail;
  }
}

/**
 * Thrown when persisting extracted API_Metadata fails (Req 1.8, 2.2).
 *
 * The Knowledge Engine performs no partial writes: metadata is only ever
 * committed by a single repository `save`. When that save fails this error is
 * raised, the partial metadata is discarded, and the owning Workspace — along
 * with all previously stored versions of the API — is left exactly as it was
 * before the upload.
 */
export class MetadataStorageError extends Error {
  /** The workspace the upload targeted (left unchanged). */
  public readonly workspaceId: string;
  /** The API the upload targeted. */
  public readonly apiId: string;
  /** The underlying cause of the storage failure, when available. */
  public readonly cause?: unknown;

  constructor(workspaceId: string, apiId: string, detail: string, cause?: unknown) {
    super(
      `Failed to store API metadata for API ${apiId} in workspace ${workspaceId}: ${detail}. ` +
        `The upload was discarded and the workspace was left unchanged.`
    );
    this.name = 'MetadataStorageError';
    this.workspaceId = workspaceId;
    this.apiId = apiId;
    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}

/**
 * Thrown when a user selects an API version that does not exist or is no longer
 * available (Req 2.7). The selection is rejected and the previously selected
 * version — carried on {@link priorSelection} when known — remains the active
 * scope. The caller retains its prior selection by not reassigning it.
 */
export class VersionUnavailableError extends Error {
  public readonly workspaceId: string;
  public readonly apiId: string;
  /** The requested (unavailable) version number. */
  public readonly requestedVersion: number;
  /** The selection that remains active because the request was rejected. */
  public readonly priorSelection?: ApiSelection;

  constructor(
    workspaceId: string,
    apiId: string,
    requestedVersion: number,
    priorSelection?: ApiSelection
  ) {
    super(
      `Requested version ${requestedVersion} of API ${apiId} in workspace ${workspaceId} ` +
        `is unavailable; the previously selected version remains active.`
    );
    this.name = 'VersionUnavailableError';
    this.workspaceId = workspaceId;
    this.apiId = apiId;
    this.requestedVersion = requestedVersion;
    if (priorSelection !== undefined) {
      this.priorSelection = priorSelection;
    }
  }
}
