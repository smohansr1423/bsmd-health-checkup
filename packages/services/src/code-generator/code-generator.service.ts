/**
 * Code Generator — Service
 *
 * Produces syntactically complete client-code snippets for a selected endpoint
 * in a chosen language, scoped to the selected API version's metadata (Req 7).
 *
 * - Resolves the selected version from the injected `ApiVersionRepository`;
 *   raises `VersionUnavailableError` when it is absent (Req 7.7).
 * - Resolves the endpoint within that version; raises `EndpointUnavailableError`
 *   when it is missing, producing no snippet and leaving any prior snippet
 *   unchanged (Req 7.6).
 * - Rejects unsupported languages with `UnsupportedLanguageError`, listing the
 *   supported languages (Req 7.8).
 * - The generated snippet includes every required parameter and the endpoint's
 *   authentication mechanism (Req 7.3), and renders optional parameters as inert
 *   commented/placeholder entries (Req 7.4).
 *
 * Validates: Requirements 7.1, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8
 */

import {
  InMemoryApiVersionRepository,
  defaultDateProvider,
  defaultIdGenerator,
} from '../api-copilot-shared';
import type {
  ApiVersionRepository,
  DateProvider,
  IdGenerator,
  Language,
} from '../api-copilot-shared';
import type {
  CodeGenerator,
  CodeGeneratorDependencies,
  CodeSnippet,
  GenerateCodeRequest,
} from './code-generator.types';
import { DEFAULT_BASE_URL, SUPPORTED_LANGUAGES } from './code-generator.types';
import {
  EndpointUnavailableError,
  UnsupportedLanguageError,
  VersionUnavailableError,
} from './code-generator.errors';
import { buildRenderModel, findEndpoint } from './code-generator.validators';
import {
  generateCurl,
  generateJavaScript,
  generatePython,
} from './code-generator.generators';

export class CodeGeneratorService implements CodeGenerator {
  private readonly idGenerator: IdGenerator;
  private readonly dateProvider: DateProvider;
  private readonly apiVersionRepository: ApiVersionRepository;

  constructor(deps: Partial<CodeGeneratorDependencies> = {}) {
    this.idGenerator = deps.idGenerator ?? defaultIdGenerator;
    this.dateProvider = deps.dateProvider ?? defaultDateProvider;
    this.apiVersionRepository =
      deps.apiVersionRepository ?? new InMemoryApiVersionRepository();
  }

  supportedLanguages(): Language[] {
    return [...SUPPORTED_LANGUAGES];
  }

  async generate(request: GenerateCodeRequest): Promise<CodeSnippet> {
    const { apiSelection, endpointId, language } = request;

    // Req 7.8: reject unsupported languages with the supported list before any
    // snippet is produced.
    if (!SUPPORTED_LANGUAGES.includes(language)) {
      throw new UnsupportedLanguageError(language, SUPPORTED_LANGUAGES);
    }

    // Req 7.7: a valid API version must be selected.
    const apiVersion = await this.apiVersionRepository.findVersion(
      apiSelection.workspaceId,
      apiSelection.apiId,
      apiSelection.version
    );
    if (apiVersion === null) {
      throw new VersionUnavailableError(
        apiSelection.workspaceId,
        apiSelection.apiId,
        apiSelection.version
      );
    }

    // Req 7.6: the endpoint definition must exist in the selected version.
    const endpoint = findEndpoint(apiVersion.metadata, endpointId);
    if (endpoint === undefined) {
      throw new EndpointUnavailableError(
        apiSelection.apiId,
        apiSelection.version,
        endpointId
      );
    }

    // Req 7.3, 7.4, 7.5: render the snippet from the selected version's metadata.
    const baseUrl = request.baseUrl ?? DEFAULT_BASE_URL;
    const model = buildRenderModel(apiVersion.metadata, endpoint, baseUrl);

    let code: string;
    switch (language) {
      case 'python':
        code = generatePython(model);
        break;
      case 'javascript':
        code = generateJavaScript(model);
        break;
      case 'curl':
        code = generateCurl(model);
        break;
      default:
        // Unreachable: guarded by the SUPPORTED_LANGUAGES check above.
        throw new UnsupportedLanguageError(language, SUPPORTED_LANGUAGES);
    }

    return {
      language,
      endpointId,
      apiId: apiSelection.apiId,
      version: apiSelection.version,
      code,
    };
  }
}
