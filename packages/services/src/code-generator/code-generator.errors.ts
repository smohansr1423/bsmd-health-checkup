/**
 * Code Generator — Errors
 *
 * - `EndpointUnavailableError` (Req 7.6): the selected endpoint has no
 *   definition in the selected version's metadata. No snippet is produced and
 *   any prior snippet is left unchanged.
 * - `VersionUnavailableError` (Req 7.7): no API version is selected or the
 *   selected version is not present in the metadata. No snippet is produced.
 * - `UnsupportedLanguageError` (Req 7.8): the requested language is not
 *   supported. No snippet is produced; the error lists the supported languages.
 *
 * Validates: Requirements 7.6, 7.7, 7.8
 */

import type { Language } from '../api-copilot-shared';

/**
 * Raised when the selected endpoint has no endpoint definition available in the
 * selected version's metadata (Req 7.6). No snippet is produced and any prior
 * snippet remains unchanged (the caller retains it by not reassigning it).
 */
export class EndpointUnavailableError extends Error {
  public readonly apiId: string;
  public readonly version: number;
  public readonly endpointId: string;

  constructor(apiId: string, version: number, endpointId: string) {
    super(
      `Endpoint definition unavailable: "${endpointId}" is not defined in ` +
        `version ${version} of API "${apiId}"; no snippet was produced and any ` +
        `prior snippet was left unchanged.`
    );
    this.name = 'EndpointUnavailableError';
    this.apiId = apiId;
    this.version = version;
    this.endpointId = endpointId;
  }
}

/**
 * Raised when no API version is selected or the selected version is not present
 * in the metadata (Req 7.7). Code generation produces no snippet under this
 * condition.
 */
export class VersionUnavailableError extends Error {
  public readonly workspaceId: string;
  public readonly apiId: string;
  public readonly requestedVersion: number;

  constructor(workspaceId: string, apiId: string, requestedVersion: number) {
    super(
      `A valid API version must be selected: version ${requestedVersion} of API ` +
        `"${apiId}" in workspace "${workspaceId}" is not available; no snippet ` +
        `was produced.`
    );
    this.name = 'VersionUnavailableError';
    this.workspaceId = workspaceId;
    this.apiId = apiId;
    this.requestedVersion = requestedVersion;
  }
}

/**
 * Raised when a user requests code in a language the Code Generator does not
 * support (Req 7.8). No snippet is produced; the error lists the supported
 * languages so the caller can choose one.
 */
export class UnsupportedLanguageError extends Error {
  public readonly requestedLanguage: string;
  public readonly supportedLanguages: readonly Language[];

  constructor(requestedLanguage: string, supportedLanguages: readonly Language[]) {
    super(
      `Unsupported language "${requestedLanguage}"; no snippet was produced. ` +
        `Supported languages: ${supportedLanguages.join(', ')}.`
    );
    this.name = 'UnsupportedLanguageError';
    this.requestedLanguage = requestedLanguage;
    this.supportedLanguages = supportedLanguages;
  }
}
