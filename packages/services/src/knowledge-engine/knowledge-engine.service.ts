/**
 * Knowledge Engine — Service
 *
 * Storage, versioning, and version selection for uploaded API specifications
 * (Req 1.7, 1.8, 2.1–2.7). Parsing/normalization is delegated to the injected
 * {@link SpecParser} (Req 1.1–1.6); this service adds the persistence and
 * versioning rules on top:
 *
 *   - Store extracted {@link ApiMetadata} against the owning Workspace (Req 1.7, 2.1).
 *   - Create new **immutable** versions with monotonically increasing numbers
 *     starting at 1; prior versions are always retained (Req 2.3).
 *   - Enforce the account's Plan_Tier distinct-API-count limit before adding a
 *     new API, leaving existing APIs unchanged on rejection (Req 2.4, 2.5).
 *   - On storage failure, discard the partial metadata and leave the Workspace
 *     and all previously stored versions unchanged (Req 1.8, 2.2).
 *   - Scope subsequent operations to a selected version until reselected
 *     (Req 2.6); reject an unavailable version and retain the prior scope (Req 2.7).
 *
 * The service performs NO partial writes: metadata is committed by exactly one
 * repository `save`. Every check that could reject the upload (format/size gate,
 * parse, plan-quota) runs before that save, so a rejection never leaves partial
 * state behind.
 *
 * Validates: Requirements 1.7, 1.8, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7
 */

import {
  InMemoryApiVersionRepository,
  defaultDateProvider,
  defaultIdGenerator,
} from '../api-copilot-shared';
import type {
  ApiMetadata,
  ApiSelection,
  ApiVersion,
  ApiVersionRepository,
  DateProvider,
  IdGenerator,
} from '../api-copilot-shared';
import type { ApiLimitDecision } from '../plan-quota';

import {
  MetadataStorageError,
  VersionUnavailableError,
} from './knowledge-engine.errors';
import { SpecParserService } from './knowledge-engine.spec-parser';
import type {
  KnowledgeEngine as IKnowledgeEngine,
  KnowledgeEngineDependencies,
  PlanQuotaGate,
  SpecParser,
  UploadRequest,
} from './knowledge-engine.types';

/**
 * Permissive default Plan_Tier gate used when no plan-quota seam is wired in
 * (development/tests). It never blocks an addition. Production wires in the
 * real `PlanQuotaService.canAddApi` via the composition root so the tier limit
 * is actually enforced (Req 2.4, 2.5).
 */
export class AllowAllPlanQuotaGate implements PlanQuotaGate {
  async canAddApi(
    _accountId: string,
    currentApiCount: number
  ): Promise<ApiLimitDecision> {
    return {
      allowed: true,
      tier: 'enterprise',
      currentApiCount,
      limit: Number.POSITIVE_INFINITY,
    };
  }
}

/**
 * Default {@link IKnowledgeEngine} implementation. Stateless aside from injected
 * dependencies; selection is a pure computation over the version repository, so
 * the service is safe to share across requests.
 */
export class KnowledgeEngineService implements IKnowledgeEngine {
  private readonly idGenerator: IdGenerator;
  private readonly dateProvider: DateProvider;
  private readonly specParser: SpecParser;
  private readonly apiVersionRepository: ApiVersionRepository;
  private readonly planQuotaGate: PlanQuotaGate;

  constructor(deps: Partial<KnowledgeEngineDependencies> = {}) {
    this.idGenerator = deps.idGenerator ?? defaultIdGenerator;
    this.dateProvider = deps.dateProvider ?? defaultDateProvider;
    this.specParser = deps.specParser ?? new SpecParserService(deps);
    this.apiVersionRepository =
      deps.apiVersionRepository ?? new InMemoryApiVersionRepository();
    this.planQuotaGate = deps.planQuotaGate ?? new AllowAllPlanQuotaGate();
  }

  /**
   * Parse an uploaded specification and store it as an immutable API version.
   *
   * @throws UnsupportedUploadError | SpecParseError | NoMetadataFoundError from
   *   the parser (Req 1.4–1.6) — nothing is stored.
   * @throws ApiLimitReachedError (plan-quota domain) when adding a new API would
   *   exceed the Plan_Tier limit; existing APIs are left unchanged (Req 2.5).
   * @throws MetadataStorageError when persistence fails; the partial metadata is
   *   discarded and the workspace is left unchanged (Req 1.8, 2.2).
   */
  async uploadSpecification(input: UploadRequest): Promise<ApiVersion> {
    // 1. Parse + normalize BEFORE any persistence. A parse failure retains no
    //    partial metadata (Req 1.4) because nothing has been stored yet.
    const parsed = await this.specParser.parse(input.raw, input.contentType);

    // 2. Determine whether this is a new version of an existing API or a brand
    //    new distinct API. A caller-supplied apiId that already has versions in
    //    the workspace means "new version of that API" (Req 2.3).
    const existingVersions = input.apiId
      ? await this.apiVersionRepository.listVersions(input.workspaceId, input.apiId)
      : [];
    const isNewApi = existingVersions.length === 0;

    // The stored apiId: for a new version, reuse the existing apiId; for a new
    // API, use the caller-supplied id or the fresh id the parser assigned.
    const apiId = input.apiId ?? parsed.apiId;

    // 3. For a NEW distinct API, enforce the Plan_Tier API-count limit BEFORE
    //    storing anything (Req 2.4, 2.5). Adding a version to an existing API
    //    does not add a distinct API, so the check is skipped in that case.
    if (isNewApi) {
      const currentApiCount = (
        await this.apiVersionRepository.listApiIds(input.workspaceId)
      ).length;
      // Rejection throws ApiLimitReachedError, leaving existing APIs unchanged.
      await this.planQuotaGate.canAddApi(input.accountId, currentApiCount);
    }

    // 4. Compute the next monotonically increasing version number (Req 2.3).
    //    New API → 1; existing API → highest prior version + 1.
    const nextVersion =
      existingVersions.length === 0
        ? 1
        : Math.max(...existingVersions.map((v) => v.version)) + 1;

    // 5. Assemble the immutable version record. The stored metadata carries the
    //    resolved apiId so all versions of an API share one identifier.
    const metadata: ApiMetadata = { ...parsed, apiId };
    const version: ApiVersion = {
      apiId,
      workspaceId: input.workspaceId,
      version: nextVersion,
      metadata,
      createdAt: this.dateProvider(),
    };

    // 6. Commit via the single persistence step. On failure, nothing else was
    //    written, so the workspace and prior versions are unchanged (Req 1.8, 2.2).
    try {
      return await this.apiVersionRepository.save(version);
    } catch (error) {
      throw new MetadataStorageError(
        input.workspaceId,
        apiId,
        error instanceof Error ? error.message : String(error),
        error
      );
    }
  }

  /**
   * Scope subsequent questions, execution, and code generation to a specific
   * API version (Req 2.6). The returned {@link ApiSelection} is the new active
   * scope; the caller keeps it until it selects a different valid version.
   *
   * @throws VersionUnavailableError when the requested version does not exist;
   *   the previous selection (supplied via `previousSelection`) remains the
   *   active scope (Req 2.7).
   */
  async selectVersion(
    workspaceId: string,
    apiId: string,
    version: number,
    previousSelection?: ApiSelection
  ): Promise<ApiSelection> {
    const found = await this.apiVersionRepository.findVersion(
      workspaceId,
      apiId,
      version
    );
    if (!found) {
      // Reject and retain the prior scope (Req 2.7). The caller retains its
      // previous selection by not reassigning it.
      throw new VersionUnavailableError(
        workspaceId,
        apiId,
        version,
        previousSelection
      );
    }
    return { workspaceId, apiId, version };
  }
}
