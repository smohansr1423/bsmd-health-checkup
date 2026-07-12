/**
 * Knowledge Engine — SpecParser unit tests
 *
 * Verifies the pre-parse gate, format detection, $ref dereferencing, and
 * normalization of both OpenAPI 3.x and Swagger 2.0 into ApiMetadata (Req 1).
 */

import {
  NoMetadataFoundError,
  SpecParseError,
  UnsupportedUploadError,
} from './knowledge-engine.errors';
import { SpecParserService } from './knowledge-engine.spec-parser';
import { MAX_SPEC_SIZE_BYTES } from './knowledge-engine.types';

function buf(value: string): Buffer {
  return Buffer.from(value, 'utf8');
}

const parser = new SpecParserService({ idGenerator: () => 'api-fixed-id' });

const OPENAPI_3_JSON = JSON.stringify({
  openapi: '3.0.3',
  info: { title: 'Pet Store', version: '1.0.0' },
  components: {
    schemas: {
      Pet: { type: 'object', properties: { id: { type: 'integer' } } },
    },
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      apiKeyAuth: { type: 'apiKey', in: 'header', name: 'X-API-Key' },
    },
  },
  security: [{ bearerAuth: [] }],
  paths: {
    '/pets/{petId}': {
      parameters: [
        { name: 'petId', in: 'path', required: true, schema: { type: 'string' } },
      ],
      get: {
        parameters: [{ name: 'expand', in: 'query', schema: { type: 'boolean' } }],
        responses: {
          '200': {
            description: 'ok',
            headers: { 'X-RateLimit-Limit': { schema: { type: 'integer' } } },
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Pet' },
                example: { id: 7 },
              },
            },
          },
          '404': { description: 'not found' },
        },
      },
      post: {
        requestBody: {
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/Pet' } },
          },
        },
        responses: { '201': { description: 'created' } },
      },
    },
  },
});

const SWAGGER_2_JSON = JSON.stringify({
  swagger: '2.0',
  info: { title: 'Legacy API', version: '1.0.0' },
  securityDefinitions: {
    basicAuth: { type: 'basic' },
    oauth: { type: 'oauth2', flow: 'application', tokenUrl: 'https://x/token' },
  },
  definitions: {
    Widget: { type: 'object', properties: { name: { type: 'string' } } },
  },
  paths: {
    '/widgets': {
      post: {
        parameters: [
          { name: 'body', in: 'body', required: true, schema: { $ref: '#/definitions/Widget' } },
          { name: 'trace', in: 'query', type: 'string' },
        ],
        responses: {
          '200': { description: 'ok', schema: { $ref: '#/definitions/Widget' } },
          '400': { description: 'bad request' },
        },
      },
    },
  },
});

describe('SpecParserService — upload gate (Req 1.5)', () => {
  it('rejects files that exceed the 25 MB limit', async () => {
    const oversized = Buffer.alloc(MAX_SPEC_SIZE_BYTES + 1, 0x20);
    await expect(parser.parse(oversized, 'json')).rejects.toBeInstanceOf(
      UnsupportedUploadError
    );
    await expect(parser.parse(oversized, 'json')).rejects.toMatchObject({ reason: 'size' });
  });

  it('rejects unsupported content types', async () => {
    await expect(parser.parse(buf(OPENAPI_3_JSON), 'xml')).rejects.toMatchObject({
      name: 'UnsupportedUploadError',
      reason: 'format',
    });
  });
});

describe('SpecParserService — OpenAPI 3.x (Req 1.1, 1.3)', () => {
  it('normalizes endpoints, params, schemas, examples, auth, and rate limits', async () => {
    const meta = await parser.parse(buf(OPENAPI_3_JSON), 'json');

    expect(meta.sourceFormat).toBe('openapi-3');
    expect(meta.title).toBe('Pet Store');
    expect(meta.apiId).toBe('api-fixed-id');
    expect(meta.endpoints).toHaveLength(2);

    const get = meta.endpoints.find((e) => e.endpointId === 'GET /pets/{petId}');
    expect(get).toBeDefined();
    // Path-level + operation-level params are merged.
    expect(get?.parameters.map((p) => p.name).sort()).toEqual(['expand', 'petId']);
    const petId = get?.parameters.find((p) => p.name === 'petId');
    expect(petId?.required).toBe(true);
    // $ref dereferenced into the response schema.
    expect(get?.responseSchemas['200']).toMatchObject({ type: 'object' });
    expect(get?.responseExamples['200']).toEqual({ id: 7 });
    expect(get?.errorCodes).toEqual(['404']);

    const post = meta.endpoints.find((e) => e.endpointId === 'POST /pets/{petId}');
    expect(post?.requestSchema).toMatchObject({ type: 'object' });

    // Auth scheme type mapping.
    const bearer = meta.authSchemes.find((s) => s.id === 'bearerAuth');
    expect(bearer?.type).toBe('jwt');
    const apiKey = meta.authSchemes.find((s) => s.id === 'apiKeyAuth');
    expect(apiKey?.type).toBe('apiKey');

    // Rate-limit header captured.
    expect(meta.rateLimits.map((r) => r.id)).toContain('X-RateLimit-Limit');
  });
});

describe('SpecParserService — Swagger 2.0 (Req 1.2, 1.3)', () => {
  it('normalizes body params to request schema and maps auth', async () => {
    const meta = await parser.parse(buf(SWAGGER_2_JSON), 'json');

    expect(meta.sourceFormat).toBe('swagger-2');
    const post = meta.endpoints.find((e) => e.endpointId === 'POST /widgets');
    expect(post?.requestSchema).toMatchObject({ type: 'object' });
    // Body param is not double-listed as a parameter.
    expect(post?.parameters.map((p) => p.name)).toEqual(['trace']);
    expect(post?.errorCodes).toEqual(['400']);

    expect(meta.authSchemes.find((s) => s.id === 'basicAuth')?.type).toBe('basic');
    expect(meta.authSchemes.find((s) => s.id === 'oauth')?.type).toBe('clientCredentials');
  });
});

describe('SpecParserService — failures (Req 1.4, 1.6)', () => {
  it('raises SpecParseError with a location for malformed JSON', async () => {
    await expect(parser.parse(buf('{ "openapi": '), 'json')).rejects.toBeInstanceOf(
      SpecParseError
    );
  });

  it('raises SpecParseError for an unrecognized specification', async () => {
    await expect(
      parser.parse(buf(JSON.stringify({ hello: 'world' })), 'json')
    ).rejects.toMatchObject({ name: 'SpecParseError' });
  });

  it('raises SpecParseError for an unresolved $ref', async () => {
    const spec = JSON.stringify({
      openapi: '3.0.0',
      info: { title: 'X' },
      paths: {
        '/a': {
          get: {
            responses: {
              '200': { description: 'ok', content: { 'application/json': { schema: { $ref: '#/components/schemas/Missing' } } } },
            },
          },
        },
      },
    });
    await expect(parser.parse(buf(spec), 'json')).rejects.toBeInstanceOf(SpecParseError);
  });

  it('raises NoMetadataFoundError when the spec has no endpoints', async () => {
    const spec = JSON.stringify({ openapi: '3.0.0', info: { title: 'Empty' }, paths: {} });
    await expect(parser.parse(buf(spec), 'json')).rejects.toBeInstanceOf(
      NoMetadataFoundError
    );
  });

  it('parses YAML input equivalently', async () => {
    const yaml = [
      'openapi: 3.0.0',
      'info:',
      '  title: YAML API',
      'paths:',
      '  /ping:',
      '    get:',
      '      responses:',
      "        '200':",
      '          description: ok',
    ].join('\n');
    const meta = await parser.parse(buf(yaml), 'yaml');
    expect(meta.title).toBe('YAML API');
    expect(meta.endpoints).toHaveLength(1);
  });
});
