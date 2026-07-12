/**
 * Code Generator — Types
 *
 * Types for producing syntactically complete client-code snippets for a
 * selected endpoint in a chosen language (Req 7). The Code Generator resolves
 * the selected API version's normalized metadata, includes every required
 * parameter and the endpoint's authentication mechanism, and renders optional
 * parameters as inert commented/placeholder entries that do not break the
 * snippet's syntactic completeness.
 *
 * MVP languages: `python`, `javascript`, `curl` (Req 7.1). Additional languages
 * (Req 7.2) are POST-MVP and are rejected with an `UnsupportedLanguageError`
 * listing the supported languages (Req 7.8).
 *
 * Validates: Requirements 7.1, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8
 */

import type {
  ApiSelection,
  ApiVersionRepository,
  BaseServiceDependencies,
  Language,
} from '../api-copilot-shared';

/** MVP-supported code-generation languages (Req 7.1). */
export const SUPPORTED_LANGUAGES: readonly Language[] = [
  'python',
  'javascript',
  'curl',
];

/** Default base URL used when a request does not supply one. */
export const DEFAULT_BASE_URL = 'https://api.example.com';

/**
 * A request to generate a client-code snippet for a selected endpoint in a
 * chosen language, scoped to the selected API version (Req 7.5).
 */
export interface GenerateCodeRequest {
  /** The active API/version scope (Req 2.6, 7.5). */
  apiSelection: ApiSelection;
  /** Stable endpoint id (`${method} ${path}`) to generate code for. */
  endpointId: string;
  /** Target language for the snippet. */
  language: Language;
  /** Target server base URL the endpoint path is appended to (optional). */
  baseUrl?: string;
}

/** A generated, syntactically complete client-code snippet (Req 7.1). */
export interface CodeSnippet {
  language: Language;
  endpointId: string;
  apiId: string;
  version: number;
  /** The generated source text. */
  code: string;
}

/**
 * The Code Generator surface (Req 7). Produces a snippet for a selected
 * endpoint/language scoped to the selected version, and reports the languages
 * it supports.
 */
export interface CodeGenerator {
  /**
   * Generate a syntactically complete snippet for the selected endpoint in the
   * requested language, scoped to the selected version's metadata (Req 7.1,
   * 7.3, 7.4, 7.5).
   *
   * @throws VersionUnavailableError when no valid version is selected (Req 7.7)
   * @throws EndpointUnavailableError when the endpoint definition is missing (Req 7.6)
   * @throws UnsupportedLanguageError when the language is not supported (Req 7.8)
   */
  generate(request: GenerateCodeRequest): Promise<CodeSnippet>;

  /** The languages this generator supports (Req 7.1). */
  supportedLanguages(): Language[];
}

/** Dependencies injected into the {@link CodeGenerator} service. */
export interface CodeGeneratorDependencies extends BaseServiceDependencies {
  /** Source of stored `ApiVersion` metadata used to resolve the selection. */
  apiVersionRepository: ApiVersionRepository;
}
