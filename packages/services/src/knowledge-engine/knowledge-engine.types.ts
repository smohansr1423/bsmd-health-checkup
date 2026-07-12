/**
 * Knowledge Engine — Types
 *
 * Types for the specification-upload gate and the SpecParser (Req 1). Storage,
 * versioning, and indexing types are added by later tasks.
 *
 * Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 1.6
 */

import type {
  ApiMetadata,
  ApiSelection,
  ApiVersion,
  ApiVersionRepository,
  BaseServiceDependencies,
} from '../api-copilot-shared';
import type { ApiLimitDecision } from '../plan-quota';

/** Maximum accepted upload size: 25 MB (Req 1.5). */
export const MAX_SPEC_SIZE_BYTES = 25 * 1024 * 1024;

/** Content formats accepted for specification uploads (Req 1.1, 1.2, 1.5). */
export type UploadContentType = 'yaml' | 'json';

/** The set of accepted upload content types. */
export const SUPPORTED_CONTENT_TYPES: readonly string[] = ['yaml', 'json'];

/**
 * Parses an uploaded specification into normalized {@link ApiMetadata}.
 *
 * Detects format (OpenAPI 3.x / Swagger 2.0), validates it, dereferences local
 * `$ref`s, and normalizes both formats into a single {@link ApiMetadata} model.
 * Enforces the 25 MB size and YAML/JSON format gate before parsing.
 */
export interface SpecParser {
  /**
   * @param raw          the raw uploaded file bytes
   * @param contentType  the declared content type (`yaml` or `json`)
   * @throws UnsupportedUploadError when the size/format gate rejects the upload
   * @throws SpecParseError when the content is not a valid OpenAPI 3.x / Swagger 2.0 spec
   * @throws NoMetadataFoundError when the spec is valid but yields no metadata
   */
  parse(raw: Buffer, contentType: string): Promise<ApiMetadata>;
}

/** Dependencies injected into the SpecParser (DI pattern shared by all services). */
export interface SpecParserDependencies extends BaseServiceDependencies {
  /** Generates the stable `apiId` assigned to extracted metadata. */
  idGenerator: BaseServiceDependencies['idGenerator'];
}

// ---------------------------------------------------------------------------
// Storage, versioning, and selection — Req 1.7, 1.8, 2.1–2.7
// ---------------------------------------------------------------------------

/**
 * A request to upload a specification and store it as an API version (Req 1, 2).
 *
 * When {@link apiId} is omitted, the upload is treated as a **new** distinct API
 * (subject to the account's Plan_Tier API-count limit, Req 2.4, 2.5) and is
 * stored as version 1. When {@link apiId} refers to an API that already has
 * stored versions in the workspace, the upload is recorded as the next
 * immutable version of that API (Req 2.3) and the API-count limit is not
 * re-checked (adding a version does not add a distinct API).
 */
export interface UploadRequest {
  /** The owning Workspace the stored metadata is associated with (Req 2.1). */
  workspaceId: string;
  /** The account whose Plan_Tier bounds the distinct-API count (Req 2.4, 2.5). */
  accountId: string;
  /** Raw uploaded specification bytes. */
  raw: Buffer;
  /** Declared content type (`yaml` or `json`). */
  contentType: string;
  /**
   * When provided and already present in the workspace, the upload becomes the
   * next version of this existing API (Req 2.3). Otherwise a new API is created.
   */
  apiId?: string;
}

/**
 * Injectable seam over the Plan & Quota domain's API-count check (Req 2.4, 2.5,
 * 17.5). The Knowledge Engine depends on this narrow interface rather than the
 * concrete `PlanQuotaService`, so wiring stays clean and the engine remains
 * unit-testable. `PlanQuotaService.canAddApi` satisfies this shape directly.
 */
export interface PlanQuotaGate {
  /**
   * Resolves when another distinct API may be added; rejects (throwing the
   * plan-quota domain's `ApiLimitReachedError`) when the tier limit is reached,
   * leaving existing APIs unchanged.
   *
   * @param accountId        the owning account.
   * @param currentApiCount  the workspace's current distinct-API count.
   */
  canAddApi(accountId: string, currentApiCount: number): Promise<ApiLimitDecision>;
}

/**
 * The Knowledge Engine's storage, versioning, and selection surface (Req 2).
 */
export interface KnowledgeEngine {
  /**
   * Parse an uploaded specification and store it as an immutable API version
   * associated with the owning workspace (Req 1.7, 2.1, 2.3). Enforces the
   * Plan_Tier API-count limit before adding a new API (Req 2.4, 2.5). On storage
   * failure, discards the partial metadata and leaves the workspace unchanged
   * (Req 1.8, 2.2).
   */
  uploadSpecification(input: UploadRequest): Promise<ApiVersion>;

  /**
   * Scope subsequent questions, execution, and code generation to a specific
   * API version (Req 2.6). Rejects an unavailable version, retaining the prior
   * selection as the active scope (Req 2.7).
   */
  selectVersion(
    workspaceId: string,
    apiId: string,
    version: number,
    previousSelection?: ApiSelection
  ): Promise<ApiSelection>;
}

/** Dependencies injected into the {@link KnowledgeEngine} service. */
export interface KnowledgeEngineDependencies extends BaseServiceDependencies {
  /** Parses uploaded specifications into normalized {@link ApiMetadata}. */
  specParser: SpecParser;
  /** Persists immutable {@link ApiVersion} records. */
  apiVersionRepository: ApiVersionRepository;
  /** Enforces the Plan_Tier distinct-API-count limit (Req 2.4, 2.5). */
  planQuotaGate: PlanQuotaGate;
}
