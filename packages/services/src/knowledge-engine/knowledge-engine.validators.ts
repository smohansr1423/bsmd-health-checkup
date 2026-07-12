/**
 * Knowledge Engine — Validators
 *
 * Pure functions that enforce the pre-parse upload gate (Req 1.5) and provide
 * small structural helpers used during normalization.
 *
 * Validates: Requirements 1.5
 */

import { UnsupportedUploadError } from './knowledge-engine.errors';
import { MAX_SPEC_SIZE_BYTES, SUPPORTED_CONTENT_TYPES } from './knowledge-engine.types';

/** Format a byte count as MB for human-readable error messages. */
function toMb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * Enforce the 25 MB size and YAML/JSON format gate BEFORE any parsing occurs
 * (Req 1.5). Throws {@link UnsupportedUploadError} on violation; returns the
 * normalized content type on success.
 */
export function validateUploadGate(raw: Buffer, contentType: string): 'yaml' | 'json' {
  // Size gate first — reject oversized uploads without inspecting content.
  if (raw.length > MAX_SPEC_SIZE_BYTES) {
    throw new UnsupportedUploadError(
      'size',
      `file size ${toMb(raw.length)} exceeds the ${toMb(MAX_SPEC_SIZE_BYTES)} limit`
    );
  }

  const normalized = contentType.trim().toLowerCase();
  if (!SUPPORTED_CONTENT_TYPES.includes(normalized)) {
    throw new UnsupportedUploadError(
      'format',
      `content type "${contentType}" is not supported; only YAML or JSON are accepted`
    );
  }

  return normalized as 'yaml' | 'json';
}

/** True when a value is a non-null, non-array plain object. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
