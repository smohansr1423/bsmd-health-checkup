/**
 * Knowledge Engine — Upload rejection unit tests
 *
 * Verifies the pre-parse size/format gate (Req 1.5) and the parsed-but-empty
 * rejection (Req 1.6), both directly through the SpecParser and end-to-end
 * through the KnowledgeEngineService so that a rejection is confirmed to leave
 * no partial metadata in the workspace.
 *
 * Validates: Requirements 1.5, 1.6
 */

import { InMemoryApiVersionRepository } from '../api-copilot-shared';

import {
  NoMetadataFoundError,
  UnsupportedUploadError,
} from './knowledge-engine.errors';
import { KnowledgeEngineService } from './knowledge-engine.service';
import { SpecParserService } from './knowledge-engine.spec-parser';
import { MAX_SPEC_SIZE_BYTES } from './knowledge-engine.types';

function buf(value: string): Buffer {
  return Buffer.from(value, 'utf8');
}

const parser = new SpecParserService({ idGenerator: () => 'api-fixed' });

function makeService(): {
  service: KnowledgeEngineService;
  repository: InMemoryApiVersionRepository;
} {
  const repository = new InMemoryApiVersionRepository();
  const service = new KnowledgeEngineService({
    specParser: parser,
    apiVersionRepository: repository,
    dateProvider: () => new Date('2024-06-01T00:00:00.000Z'),
  });
  return { service, repository };
}

const WORKSPACE_ID = 'ws-1';
const ACCOUNT_ID = 'acct-1';

const VALID_MINIMAL_SPEC = JSON.stringify({
  openapi: '3.0.0',
  info: { title: 'Empty', version: '1.0.0' },
  paths: {},
});

describe('SpecParser — size/format gate (Req 1.5)', () => {
  it('rejects a file that exceeds the 25 MB limit with a size reason', async () => {
    const oversized = Buffer.alloc(MAX_SPEC_SIZE_BYTES + 1, 0x20);
    await expect(parser.parse(oversized, 'json')).rejects.toBeInstanceOf(
      UnsupportedUploadError
    );
    await expect(parser.parse(oversized, 'json')).rejects.toMatchObject({
      name: 'UnsupportedUploadError',
      reason: 'size',
    });
  });

  it('accepts a file exactly at the 25 MB boundary (size gate is exclusive)', async () => {
    // A buffer of exactly the limit made of spaces is not a valid spec, so it
    // fails parsing — but crucially NOT with a size rejection.
    const atLimit = Buffer.alloc(MAX_SPEC_SIZE_BYTES, 0x20);
    await expect(parser.parse(atLimit, 'json')).rejects.not.toMatchObject({
      reason: 'size',
    });
  });

  it.each(['xml', 'text', 'yml', 'application/json', ''])(
    'rejects unsupported content type %p with a format reason',
    async (contentType) => {
      await expect(parser.parse(buf(VALID_MINIMAL_SPEC), contentType)).rejects.toMatchObject(
        { name: 'UnsupportedUploadError', reason: 'format' }
      );
    }
  );

  it('accepts yaml and json content types (case-insensitive, trimmed)', async () => {
    const spec = JSON.stringify({
      openapi: '3.0.0',
      info: { title: 'Ping', version: '1.0.0' },
      paths: { '/ping': { get: { responses: { '200': { description: 'ok' } } } } },
    });
    await expect(parser.parse(buf(spec), '  JSON  ')).resolves.toMatchObject({
      title: 'Ping',
    });
    const yaml = 'openapi: 3.0.0\ninfo:\n  title: Ping\npaths:\n  /ping:\n    get:\n      responses:\n        "200":\n          description: ok\n';
    await expect(parser.parse(buf(yaml), 'YAML')).resolves.toMatchObject({
      title: 'Ping',
    });
  });
});

describe('SpecParser — parsed but no metadata (Req 1.6)', () => {
  it('rejects a valid OpenAPI 3.x document with no endpoints', async () => {
    await expect(parser.parse(buf(VALID_MINIMAL_SPEC), 'json')).rejects.toBeInstanceOf(
      NoMetadataFoundError
    );
  });

  it('rejects a valid Swagger 2.0 document with no endpoints', async () => {
    const emptySwagger = JSON.stringify({
      swagger: '2.0',
      info: { title: 'Empty', version: '1.0.0' },
      paths: {},
    });
    await expect(parser.parse(buf(emptySwagger), 'json')).rejects.toBeInstanceOf(
      NoMetadataFoundError
    );
  });
});

describe('KnowledgeEngineService — rejections leave no partial state (Req 1.5, 1.6)', () => {
  it('rejects an oversized upload and stores nothing', async () => {
    const { service, repository } = makeService();
    const oversized = Buffer.alloc(MAX_SPEC_SIZE_BYTES + 1, 0x20);

    await expect(
      service.uploadSpecification({
        workspaceId: WORKSPACE_ID,
        accountId: ACCOUNT_ID,
        raw: oversized,
        contentType: 'json',
      })
    ).rejects.toMatchObject({ name: 'UnsupportedUploadError', reason: 'size' });

    expect(await repository.listApiIds(WORKSPACE_ID)).toEqual([]);
  });

  it('rejects an unsupported format and stores nothing', async () => {
    const { service, repository } = makeService();

    await expect(
      service.uploadSpecification({
        workspaceId: WORKSPACE_ID,
        accountId: ACCOUNT_ID,
        raw: buf(VALID_MINIMAL_SPEC),
        contentType: 'xml',
      })
    ).rejects.toMatchObject({ name: 'UnsupportedUploadError', reason: 'format' });

    expect(await repository.listApiIds(WORKSPACE_ID)).toEqual([]);
  });

  it('rejects a parsed-but-empty specification and stores nothing', async () => {
    const { service, repository } = makeService();

    await expect(
      service.uploadSpecification({
        workspaceId: WORKSPACE_ID,
        accountId: ACCOUNT_ID,
        raw: buf(VALID_MINIMAL_SPEC),
        contentType: 'json',
      })
    ).rejects.toBeInstanceOf(NoMetadataFoundError);

    expect(await repository.listApiIds(WORKSPACE_ID)).toEqual([]);
  });
});
