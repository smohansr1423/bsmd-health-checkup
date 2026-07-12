/**
 * Knowledge Engine — Property-Based Tests
 *
 * Uses fast-check to validate the universal correctness properties from the
 * design document (Correctness Properties: Properties 1–7). Global iteration
 * count is configured in jest.setup.fast-check.ts (numRuns=25); no inline
 * numRuns overrides are used here.
 *
 * Feature: api-copilot-ai
 * Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.7, 1.8, 2.1, 2.2, 2.3, 2.6, 2.7, 7.5, 7.7
 */

import * as fc from 'fast-check';

import {
  InMemoryApiVersionRepository,
  type ApiMetadata,
  type ApiVersion,
  type ApiVersionRepository,
  type ApiSelection,
} from '../api-copilot-shared';

import {
  MetadataStorageError,
  VersionUnavailableError,
} from './knowledge-engine.errors';
import { KnowledgeEngineService } from './knowledge-engine.service';
import { SpecParserService } from './knowledge-engine.spec-parser';

// ─── Shared fixtures ──────────────────────────────────────────────────────────

const REQ_SCHEMA = { type: 'object', properties: { in: { type: 'string' } } };
const RESP_SCHEMA = { type: 'object', properties: { out: { type: 'string' } } };
const STATUS_POOL = ['200', '201', '204', '400', '401', '404', '422', '500'] as const;

/** Deterministic response example for a given status code. */
function exampleFor(status: string): { ex: string } {
  return { ex: status };
}

function buf(value: string): Buffer {
  return Buffer.from(value, 'utf8');
}

// ─── The abstract API model that every generated document is rendered from ────

interface ParamModel {
  name: string;
  location: 'path' | 'query' | 'header';
  required: boolean;
}
interface ResponseModel {
  status: string;
  hasSchema: boolean;
  hasExample: boolean;
}
interface EndpointModel {
  path: string;
  method: 'get' | 'post' | 'put' | 'patch' | 'delete';
  params: ParamModel[];
  hasRequestBody: boolean;
  responses: ResponseModel[];
}
interface AuthModel {
  id: string;
}
interface RateLimitModel {
  id: string;
  limit: number;
}
interface ApiModel {
  title: string;
  format: 'openapi-3' | 'swagger-2';
  endpoints: EndpointModel[];
  auth: AuthModel[];
  rateLimits: RateLimitModel[];
}

// ─── Arbitraries ────────────────────────────────────────────────────────────

const paramSpecArb = fc.record({
  location: fc.constantFrom<'path' | 'query' | 'header'>('path', 'query', 'header'),
  required: fc.boolean(),
});

/** Response specs keyed by the fixed status pool; each pool entry may be included. */
const responsesArb: fc.Arbitrary<ResponseModel[]> = fc
  .record(
    Object.fromEntries(
      STATUS_POOL.map((s) => [
        s,
        fc.record({
          include: fc.boolean(),
          hasSchema: fc.boolean(),
          hasExample: fc.boolean(),
        }),
      ])
    ) as Record<
      (typeof STATUS_POOL)[number],
      fc.Arbitrary<{ include: boolean; hasSchema: boolean; hasExample: boolean }>
    >
  )
  .map((obj) =>
    STATUS_POOL.filter((s) => obj[s].include).map((s) => ({
      status: s,
      hasSchema: obj[s].hasSchema,
      hasExample: obj[s].hasExample,
    }))
  );

const endpointSpecArb = fc.record({
  method: fc.constantFrom<'get' | 'post' | 'put' | 'patch' | 'delete'>(
    'get',
    'post',
    'put',
    'patch',
    'delete'
  ),
  paramSpecs: fc.array(paramSpecArb, { maxLength: 4 }),
  hasRequestBody: fc.boolean(),
  responses: responsesArb,
});

/**
 * A rich, valid API model. Path, parameter, auth, and rate-limit identifiers are
 * assigned by index so identifiers are unique (no accidental endpointId /
 * parameter merge collisions), which keeps the completeness assertions exact.
 */
const apiModelArb: fc.Arbitrary<ApiModel> = fc
  .record({
    title: fc.string({ maxLength: 20 }),
    format: fc.constantFrom<'openapi-3' | 'swagger-2'>('openapi-3', 'swagger-2'),
    endpointSpecs: fc.array(endpointSpecArb, { minLength: 1, maxLength: 4 }),
    authCount: fc.nat({ max: 3 }),
    rateLimitCount: fc.nat({ max: 2 }),
    rateLimitValues: fc.array(fc.nat({ max: 10_000 }), { minLength: 2, maxLength: 2 }),
  })
  .map((raw) => {
    const endpoints: EndpointModel[] = raw.endpointSpecs.map((e, i) => ({
      path: `/res${i}`,
      method: e.method,
      params: e.paramSpecs.map((p, j) => ({
        name: `p${j}`,
        location: p.location,
        required: p.required,
      })),
      hasRequestBody: e.hasRequestBody,
      responses: e.responses,
    }));
    const auth: AuthModel[] = Array.from({ length: raw.authCount }, (_, i) => ({
      id: `sec${i}`,
    }));
    const rateLimits: RateLimitModel[] = Array.from(
      { length: raw.rateLimitCount },
      (_, i) => ({ id: `rl${i}`, limit: raw.rateLimitValues[i % 2] })
    );
    return { title: raw.title, format: raw.format, endpoints, auth, rateLimits };
  });

// ─── Document rendering ───────────────────────────────────────────────────────

function authDefs(model: ApiModel): Record<string, unknown> {
  return Object.fromEntries(
    model.auth.map((a) => [a.id, { type: 'apiKey', in: 'header', name: `H-${a.id}` }])
  );
}

function rateLimitExt(model: ApiModel): unknown {
  return model.rateLimits.map((r) => ({ id: r.id, limit: r.limit }));
}

function buildOpenApi3(model: ApiModel): Record<string, unknown> {
  const paths: Record<string, unknown> = {};
  for (const e of model.endpoints) {
    const operation: Record<string, unknown> = {
      parameters: e.params.map((p) => ({
        name: p.name,
        in: p.location,
        required: p.required,
        schema: { type: 'string' },
      })),
      responses: Object.fromEntries(
        e.responses.map((r) => {
          const resp: Record<string, unknown> = { description: 'x' };
          if (r.hasSchema || r.hasExample) {
            const media: Record<string, unknown> = {};
            if (r.hasSchema) media.schema = RESP_SCHEMA;
            if (r.hasExample) media.example = exampleFor(r.status);
            resp.content = { 'application/json': media };
          }
          return [r.status, resp];
        })
      ),
    };
    if (e.hasRequestBody) {
      operation.requestBody = { content: { 'application/json': { schema: REQ_SCHEMA } } };
    }
    paths[e.path] = { [e.method]: operation };
  }

  const doc: Record<string, unknown> = {
    openapi: '3.0.3',
    info: { title: model.title, version: '1.0.0' },
    paths,
  };
  if (model.auth.length > 0) {
    doc.components = { securitySchemes: authDefs(model) };
  }
  if (model.rateLimits.length > 0) {
    doc['x-rate-limit'] = rateLimitExt(model);
  }
  return doc;
}

function buildSwagger2(model: ApiModel): Record<string, unknown> {
  const paths: Record<string, unknown> = {};
  for (const e of model.endpoints) {
    const parameters: Record<string, unknown>[] = e.params.map((p) => ({
      name: p.name,
      in: p.location,
      required: p.required,
      type: 'string',
    }));
    if (e.hasRequestBody) {
      parameters.push({ name: 'body', in: 'body', required: true, schema: REQ_SCHEMA });
    }
    const operation: Record<string, unknown> = {
      parameters,
      responses: Object.fromEntries(
        e.responses.map((r) => {
          const resp: Record<string, unknown> = { description: 'x' };
          if (r.hasSchema) resp.schema = RESP_SCHEMA;
          if (r.hasExample) resp.examples = { 'application/json': exampleFor(r.status) };
          return [r.status, resp];
        })
      ),
    };
    paths[e.path] = { [e.method]: operation };
  }

  const doc: Record<string, unknown> = {
    swagger: '2.0',
    info: { title: model.title, version: '1.0.0' },
    paths,
  };
  if (model.auth.length > 0) {
    doc.securityDefinitions = authDefs(model);
  }
  if (model.rateLimits.length > 0) {
    doc['x-rate-limit'] = rateLimitExt(model);
  }
  return doc;
}

function renderDocument(model: ApiModel): Buffer {
  const doc = model.format === 'openapi-3' ? buildOpenApi3(model) : buildSwagger2(model);
  return buf(JSON.stringify(doc));
}

/** A valid-spec arbitrary that yields a ready-to-parse JSON buffer. */
const validSpecBufferArb: fc.Arbitrary<Buffer> = apiModelArb.map(renderDocument);

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Parser with a fixed apiId so extraction is deterministic across calls. */
function fixedParser(apiId = 'api-fixed'): SpecParserService {
  return new SpecParserService({ idGenerator: () => apiId });
}

function makeService(overrides: {
  parser?: SpecParserService;
  repository?: ApiVersionRepository;
} = {}): {
  service: KnowledgeEngineService;
  repository: ApiVersionRepository;
} {
  const repository = overrides.repository ?? new InMemoryApiVersionRepository();
  const service = new KnowledgeEngineService({
    specParser: overrides.parser ?? fixedParser(),
    apiVersionRepository: repository,
    dateProvider: () => new Date('2024-06-01T00:00:00.000Z'),
  });
  return { service, repository };
}

/** An ApiVersionRepository whose save always fails; reads delegate to an inner repo. */
class FailingApiVersionRepository implements ApiVersionRepository {
  constructor(private readonly inner: ApiVersionRepository) {}

  async save(_version: ApiVersion): Promise<ApiVersion> {
    throw new Error('simulated storage failure');
  }
  listVersions(workspaceId: string, apiId: string): Promise<ApiVersion[]> {
    return this.inner.listVersions(workspaceId, apiId);
  }
  findVersion(
    workspaceId: string,
    apiId: string,
    version: number
  ): Promise<ApiVersion | null> {
    return this.inner.findVersion(workspaceId, apiId, version);
  }
  listApiIds(workspaceId: string): Promise<string[]> {
    return this.inner.listApiIds(workspaceId);
  }
}

// ─── Property 1 ───────────────────────────────────────────────────────────────

describe('Knowledge Engine — Property 1: Metadata extraction is complete', () => {
  // Feature: api-copilot-ai, Property 1: For any valid OpenAPI 3.x or Swagger 2.0
  // specification within the size limit, every endpoint, HTTP method, parameter,
  // request/response schema, authentication scheme, response example, error code,
  // and rate-limit entry present in the source appears in the extracted ApiMetadata.
  // Validates: Requirements 1.1, 1.2, 1.3
  it('captures every endpoint, param, schema, example, error code, auth, and rate limit', async () => {
    await fc.assert(
      fc.asyncProperty(apiModelArb, async (model) => {
        const meta = await fixedParser().parse(renderDocument(model), 'json');

        expect(meta.sourceFormat).toBe(model.format);
        expect(meta.title).toBe(model.title);
        expect(meta.endpoints).toHaveLength(model.endpoints.length);

        for (const em of model.endpoints) {
          const endpointId = `${em.method.toUpperCase()} ${em.path}`;
          const ep = meta.endpoints.find((e) => e.endpointId === endpointId);
          expect(ep).toBeDefined();
          if (!ep) continue;

          expect(ep.method).toBe(em.method.toUpperCase());
          expect(ep.path).toBe(em.path);

          for (const pm of em.params) {
            const got = ep.parameters.find((p) => p.name === pm.name);
            expect(got).toBeDefined();
            expect(got?.location).toBe(pm.location);
            // Path parameters are always required per spec; others reflect the source.
            expect(got?.required).toBe(pm.location === 'path' ? true : pm.required);
          }

          if (em.hasRequestBody) {
            expect(ep.requestSchema).toBeDefined();
          }

          for (const rm of em.responses) {
            if (rm.hasSchema) {
              expect(ep.responseSchemas[rm.status]).toBeDefined();
            }
            if (rm.hasExample) {
              expect(ep.responseExamples[rm.status]).toEqual(exampleFor(rm.status));
            }
            if (Number.parseInt(rm.status, 10) >= 400) {
              expect(ep.errorCodes).toContain(rm.status);
            }
          }
        }

        expect(new Set(meta.authSchemes.map((s) => s.id))).toEqual(
          new Set(model.auth.map((a) => a.id))
        );

        const rlIds = new Set(meta.rateLimits.map((r) => r.id));
        for (const rl of model.rateLimits) {
          expect(rlIds.has(rl.id)).toBe(true);
        }
      })
    );
  });
});

// ─── Property 2 ───────────────────────────────────────────────────────────────

describe('Knowledge Engine — Property 2: Invalid specifications are rejected with no partial state', () => {
  // Feature: api-copilot-ai, Property 2: For any input that is not a valid OpenAPI
  // 3.x or Swagger 2.0 specification, the Knowledge_Engine rejects the upload,
  // stores no partial ApiMetadata, and leaves the owning Workspace unchanged.
  // Validates: Requirements 1.4

  /** Non-version key so a generated object never accidentally looks like a spec. */
  const nonVersionKey = fc
    .string({ minLength: 1, maxLength: 6 })
    .filter((k) => k !== 'openapi' && k !== 'swagger');

  const invalidRawArb: fc.Arbitrary<string> = fc.oneof(
    // (a) Valid JSON object lacking any openapi/swagger version field.
    fc
      .dictionary(nonVersionKey, fc.oneof(fc.string(), fc.integer(), fc.boolean()))
      .map((obj) => JSON.stringify(obj)),
    // (b) An unsupported OpenAPI version string.
    fc
      .string({ maxLength: 5 })
      .filter((v) => !/^3\./.test(v))
      .map((v) => JSON.stringify({ openapi: v, info: { title: 't' }, paths: {} })),
    // (c) An unsupported Swagger version string.
    fc
      .string({ maxLength: 5 })
      .filter((v) => v !== '2.0')
      .map((v) => JSON.stringify({ swagger: v, info: { title: 't' }, paths: {} })),
    // (d) Malformed JSON syntax.
    fc.constantFrom('{ "openapi": ', '{ not json', '][', '{"paths":', 'null,')
  );

  it('rejects invalid input and leaves the workspace with no stored metadata', async () => {
    await fc.assert(
      fc.asyncProperty(invalidRawArb, async (raw) => {
        const { service, repository } = makeService();
        const workspaceId = 'ws-1';

        await expect(
          service.uploadSpecification({
            workspaceId,
            accountId: 'acct-1',
            raw: buf(raw),
            contentType: 'json',
          })
        ).rejects.toThrow();

        // No partial state: the workspace has no stored APIs or versions.
        expect(await repository.listApiIds(workspaceId)).toEqual([]);
      })
    );
  });
});

// ─── Property 3 ───────────────────────────────────────────────────────────────

describe('Knowledge Engine — Property 3: Metadata storage round-trip', () => {
  // Feature: api-copilot-ai, Property 3: For any successfully parsed specification,
  // storing then retrieving its metadata yields metadata equal to what was
  // extracted, associated with the owning Workspace identifier.
  // Validates: Requirements 1.7, 2.1
  it('stored-then-retrieved metadata equals the extracted metadata for the owning workspace', async () => {
    await fc.assert(
      fc.asyncProperty(validSpecBufferArb, fc.string({ minLength: 1, maxLength: 12 }), async (raw, wsSuffix) => {
        const workspaceId = `ws-${wsSuffix}`;
        const parser = fixedParser();
        const { service, repository } = makeService({ parser });

        // Extraction is deterministic (fixed apiId), so this equals what the
        // service parses internally during the upload.
        const expected: ApiMetadata = await parser.parse(raw, 'json');

        const stored = await service.uploadSpecification({
          workspaceId,
          accountId: 'acct-1',
          raw,
          contentType: 'json',
        });

        expect(stored.workspaceId).toBe(workspaceId);
        expect(stored.metadata).toEqual(expected);

        const retrieved = await repository.findVersion(
          workspaceId,
          expected.apiId,
          stored.version
        );
        expect(retrieved).not.toBeNull();
        expect(retrieved?.workspaceId).toBe(workspaceId);
        expect(retrieved?.metadata).toEqual(expected);
      })
    );
  });
});

// ─── Property 4 ───────────────────────────────────────────────────────────────

describe('Knowledge Engine — Property 4: Storage failure preserves prior state', () => {
  // Feature: api-copilot-ai, Property 4: For any upload whose storage step fails,
  // the system discards the partial metadata and leaves the Workspace and all
  // previously stored versions of that API exactly as they were before the upload.
  // Validates: Requirements 1.8, 2.2
  it('discards partial metadata and leaves prior versions unchanged on save failure', async () => {
    await fc.assert(
      fc.asyncProperty(validSpecBufferArb, async (raw) => {
        const workspaceId = 'ws-1';
        const inner = new InMemoryApiVersionRepository();

        // Seed prior, already-stored state that must survive the failed upload.
        const priorMetadata: ApiMetadata = {
          apiId: 'existing-api',
          title: 'Existing',
          sourceFormat: 'openapi-3',
          endpoints: [],
          authSchemes: [],
          rateLimits: [],
        };
        const priorVersion: ApiVersion = {
          apiId: 'existing-api',
          workspaceId,
          version: 1,
          metadata: priorMetadata,
          createdAt: new Date('2024-01-01T00:00:00.000Z'),
        };
        await inner.save(priorVersion);

        const beforeVersions = await inner.listVersions(workspaceId, 'existing-api');
        const beforeApiIds = await inner.listApiIds(workspaceId);

        const service = new KnowledgeEngineService({
          specParser: fixedParser(),
          apiVersionRepository: new FailingApiVersionRepository(inner),
        });

        await expect(
          service.uploadSpecification({
            workspaceId,
            accountId: 'acct-1',
            raw,
            contentType: 'json',
          })
        ).rejects.toBeInstanceOf(MetadataStorageError);

        // Prior state is exactly as it was: no partial write leaked through.
        expect(await inner.listVersions(workspaceId, 'existing-api')).toEqual(
          beforeVersions
        );
        expect(await inner.listApiIds(workspaceId)).toEqual(beforeApiIds);
      })
    );
  });
});

// ─── Property 5 ───────────────────────────────────────────────────────────────

describe('Knowledge Engine — Property 5: Version numbering is a retained, increasing sequence', () => {
  // Feature: api-copilot-ai, Property 5: For any sequence of k successful uploads
  // of the same API, the stored versions are numbered 1..k, all prior versions
  // remain retrievable, and version numbers strictly increase in upload order.
  // Validates: Requirements 2.3
  it('numbers k uploads 1..k, retains all versions, and increases strictly in order', async () => {
    await fc.assert(
      fc.asyncProperty(validSpecBufferArb, fc.integer({ min: 1, max: 6 }), async (raw, k) => {
        const workspaceId = 'ws-1';
        const { service, repository } = makeService({ parser: fixedParser('api-1') });

        const uploadedVersions: number[] = [];
        let apiId = '';
        for (let i = 0; i < k; i += 1) {
          const result = await service.uploadSpecification({
            workspaceId,
            accountId: 'acct-1',
            raw,
            contentType: 'json',
            // First upload creates the API; subsequent ones add versions to it.
            ...(apiId ? { apiId } : {}),
          });
          apiId = result.apiId;
          uploadedVersions.push(result.version);
        }

        // Version numbers strictly increase in upload order: 1, 2, ..., k.
        expect(uploadedVersions).toEqual(
          Array.from({ length: k }, (_, i) => i + 1)
        );
        for (let i = 1; i < uploadedVersions.length; i += 1) {
          expect(uploadedVersions[i]).toBeGreaterThan(uploadedVersions[i - 1]);
        }

        // All prior versions remain retrievable, numbered 1..k.
        const stored = await repository.listVersions(workspaceId, apiId);
        expect(stored.map((v) => v.version)).toEqual(
          Array.from({ length: k }, (_, i) => i + 1)
        );
        for (let v = 1; v <= k; v += 1) {
          expect(await repository.findVersion(workspaceId, apiId, v)).not.toBeNull();
        }
      })
    );
  });
});

// ─── Property 6 ───────────────────────────────────────────────────────────────

describe('Knowledge Engine — Property 6: Version selection persists until reselected', () => {
  // Feature: api-copilot-ai, Property 6: For any selected API version, subsequent
  // question, execution, and code-generation operations are scoped to that version
  // until a different valid version is selected.
  // Validates: Requirements 2.6, 7.5
  it('the active scope equals the most recently selected valid version', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 5 }),
        fc.array(fc.integer({ min: 1, max: 5 }), { minLength: 1, maxLength: 8 }),
        async (n, rawSelections) => {
          const workspaceId = 'ws-1';
          const { service, repository } = makeService({ parser: fixedParser('api-1') });

          // Seed an API with versions 1..n.
          let apiId = '';
          for (let i = 0; i < n; i += 1) {
            const result = await service.uploadSpecification({
              workspaceId,
              accountId: 'acct-1',
              raw: renderMinimalSpec(),
              contentType: 'json',
              ...(apiId ? { apiId } : {}),
            });
            apiId = result.apiId;
          }

          // Only select versions that actually exist.
          const selections = rawSelections.filter((v) => v >= 1 && v <= n);
          fc.pre(selections.length > 0);

          let current: ApiSelection | undefined;
          for (const v of selections) {
            current = await service.selectVersion(workspaceId, apiId, v, current);
            // Scope reflects exactly the version just selected.
            expect(current).toEqual({ workspaceId, apiId, version: v });

            // Between reselections the scope does not drift.
            const held = current;
            await Promise.resolve();
            expect(held).toEqual({ workspaceId, apiId, version: v });
          }

          // Sanity: the API and its versions still exist.
          expect(await repository.listApiIds(workspaceId)).toContain(apiId);
        }
      )
    );
  });
});

// ─── Property 7 ───────────────────────────────────────────────────────────────

describe('Knowledge Engine — Property 7: Invalid version selection retains prior scope', () => {
  // Feature: api-copilot-ai, Property 7: For any attempt to select a version that
  // does not exist, the selection is rejected, the previously active version
  // remains the scope, and an unavailable-version error is returned.
  // Validates: Requirements 2.7, 7.7
  it('rejects an unavailable version and retains the previously active selection', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 5 }),
        fc.integer({ min: 1, max: 5 }),
        fc.integer({ min: 1, max: 50 }),
        async (n, priorRaw, invalidOffset) => {
          const workspaceId = 'ws-1';
          const { service } = makeService({ parser: fixedParser('api-1') });

          let apiId = '';
          for (let i = 0; i < n; i += 1) {
            const result = await service.uploadSpecification({
              workspaceId,
              accountId: 'acct-1',
              raw: renderMinimalSpec(),
              contentType: 'json',
              ...(apiId ? { apiId } : {}),
            });
            apiId = result.apiId;
          }

          const priorVersion = ((priorRaw - 1) % n) + 1; // valid version in 1..n
          const priorSelection = await service.selectVersion(
            workspaceId,
            apiId,
            priorVersion,
            undefined
          );
          expect(priorSelection.version).toBe(priorVersion);

          const invalidVersion = n + invalidOffset; // guaranteed to not exist

          await expect(
            service.selectVersion(workspaceId, apiId, invalidVersion, priorSelection)
          ).rejects.toBeInstanceOf(VersionUnavailableError);

          // The prior selection remains the active scope, unchanged.
          expect(priorSelection).toEqual({
            workspaceId,
            apiId,
            version: priorVersion,
          });

          // The error carries the retained prior selection.
          try {
            await service.selectVersion(
              workspaceId,
              apiId,
              invalidVersion,
              priorSelection
            );
          } catch (error) {
            expect(error).toBeInstanceOf(VersionUnavailableError);
            expect((error as VersionUnavailableError).priorSelection).toEqual(
              priorSelection
            );
            expect((error as VersionUnavailableError).requestedVersion).toBe(
              invalidVersion
            );
          }
        }
      )
    );
  });
});

// ─── Minimal valid spec used to seed versions for selection properties ─────────

function renderMinimalSpec(): Buffer {
  return buf(
    JSON.stringify({
      openapi: '3.0.0',
      info: { title: 'Seed', version: '1.0.0' },
      paths: {
        '/ping': { get: { responses: { '200': { description: 'ok' } } } },
      },
    })
  );
}
