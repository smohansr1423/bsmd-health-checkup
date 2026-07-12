/**
 * Knowledge Engine — barrel export.
 *
 * Specification parsing and normalization (Req 1) plus metadata storage,
 * immutable versioning, and version selection (Req 2) for the API Copilot AI
 * Knowledge Engine. Indexing is added by a later task.
 */

export { SpecParserService } from './knowledge-engine.spec-parser';

export {
  KnowledgeEngineService,
  AllowAllPlanQuotaGate,
} from './knowledge-engine.service';

export {
  SpecParseError,
  UnsupportedUploadError,
  NoMetadataFoundError,
  MetadataStorageError,
  VersionUnavailableError,
} from './knowledge-engine.errors';
export type { UnsupportedUploadReason } from './knowledge-engine.errors';

export {
  MAX_SPEC_SIZE_BYTES,
  SUPPORTED_CONTENT_TYPES,
} from './knowledge-engine.types';
export type {
  SpecParser,
  SpecParserDependencies,
  UploadContentType,
  KnowledgeEngine,
  KnowledgeEngineDependencies,
  UploadRequest,
  PlanQuotaGate,
} from './knowledge-engine.types';

export { validateUploadGate, isRecord } from './knowledge-engine.validators';
