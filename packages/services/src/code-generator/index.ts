/**
 * Code Generator — barrel export.
 *
 * Produces syntactically complete client-code snippets for a selected endpoint
 * in Python, JavaScript, or cURL (Req 7.1), scoped to the selected API
 * version's metadata (Req 7.5). Snippets include every required parameter and
 * the endpoint's authentication mechanism (Req 7.3) and render optional
 * parameters as inert commented/placeholder entries (Req 7.4). Errors are raised
 * for a missing endpoint definition (Req 7.6), no valid version selected
 * (Req 7.7), and unsupported languages (Req 7.8).
 *
 * Validates: Requirements 7.1, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8
 */

export { CodeGeneratorService } from './code-generator.service';

export {
  EndpointUnavailableError,
  VersionUnavailableError,
  UnsupportedLanguageError,
} from './code-generator.errors';

export {
  SUPPORTED_LANGUAGES,
  DEFAULT_BASE_URL,
} from './code-generator.types';
export type {
  CodeGenerator,
  CodeGeneratorDependencies,
  CodeSnippet,
  GenerateCodeRequest,
} from './code-generator.types';

export {
  buildRenderModel,
  findEndpoint,
  resolveAuthSchemes,
  renderAuth,
  placeholderFor,
  substitutePath,
  joinUrl,
  bodyFieldsOf,
  isRecord,
} from './code-generator.validators';
export type {
  RenderParam,
  RenderBodyField,
  EndpointRenderModel,
} from './code-generator.validators';

export {
  generatePython,
  generateJavaScript,
  generateCurl,
} from './code-generator.generators';
