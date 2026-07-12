/**
 * Code Generator — Unit tests
 *
 * Covers snippet generation for Python/JavaScript/cURL scoped to the selected
 * version (Req 7.1, 7.5), inclusion of required parameters and the auth
 * mechanism (Req 7.3), inert optional-parameter placeholders (Req 7.4), and the
 * three error conditions: missing endpoint (Req 7.6), no valid version (Req
 * 7.7), and unsupported language (Req 7.8).
 *
 * Validates: Requirements 7.1, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8
 */

import { InMemoryApiVersionRepository } from '../api-copilot-shared';
import type {
  ApiMetadata,
  ApiSelection,
  ApiVersion,
  AuthSchemeMeta,
  EndpointMeta,
  Language,
} from '../api-copilot-shared';
import { CodeGeneratorService } from './code-generator.service';
import {
  EndpointUnavailableError,
  UnsupportedLanguageError,
  VersionUnavailableError,
} from './code-generator.errors';

const WORKSPACE_ID = 'ws-1';
const API_ID = 'api-1';
const VERSION = 1;
const ENDPOINT_ID = 'POST /users/{id}';

const SELECTION: ApiSelection = {
  workspaceId: WORKSPACE_ID,
  apiId: API_ID,
  version: VERSION,
};

function endpoint(overrides: Partial<EndpointMeta> = {}): EndpointMeta {
  return {
    endpointId: ENDPOINT_ID,
    path: '/users/{id}',
    method: 'POST',
    parameters: [
      { name: 'id', location: 'path', required: true, schema: {} },
      { name: 'filter', location: 'query', required: true, schema: {} },
      { name: 'trace', location: 'query', required: false, schema: {} },
      { name: 'X-Request-Id', location: 'header', required: false, schema: {} },
    ],
    requestSchema: {
      type: 'object',
      required: ['email'],
      properties: {
        email: { type: 'string', example: 'user@example.com' },
        nickname: { type: 'string' },
      },
    },
    responseSchemas: {},
    responseExamples: {},
    errorCodes: [],
    authSchemeRefs: ['bearerAuth'],
    ...overrides,
  };
}

function versionWith(
  endpoints: EndpointMeta[],
  authSchemes: AuthSchemeMeta[] = [
    { id: 'bearerAuth', type: 'bearer', details: {} },
  ]
): ApiVersion {
  const metadata: ApiMetadata = {
    apiId: API_ID,
    title: 'Example',
    sourceFormat: 'openapi-3',
    endpoints,
    authSchemes,
    rateLimits: [],
  };
  return {
    apiId: API_ID,
    workspaceId: WORKSPACE_ID,
    version: VERSION,
    metadata,
    createdAt: new Date('2024-01-01T00:00:00.000Z'),
  };
}

async function makeGenerator(version?: ApiVersion): Promise<CodeGeneratorService> {
  const repo = new InMemoryApiVersionRepository();
  if (version !== undefined) {
    await repo.save(version);
  }
  return new CodeGeneratorService({ apiVersionRepository: repo });
}

describe('CodeGeneratorService.supportedLanguages', () => {
  it('reports the MVP languages', () => {
    const gen = new CodeGeneratorService();
    expect(gen.supportedLanguages()).toEqual(['python', 'javascript', 'curl']);
  });
});

describe('CodeGeneratorService.generate — required params + auth (Req 7.3)', () => {
  it.each<Language>(['python', 'javascript', 'curl'])(
    'includes required parameters and the auth mechanism for %s',
    async (language) => {
      const gen = await makeGenerator(versionWith([endpoint()]));
      const snippet = await gen.generate({
        apiSelection: SELECTION,
        endpointId: ENDPOINT_ID,
        language,
      });

      expect(snippet.language).toBe(language);
      expect(snippet.apiId).toBe(API_ID);
      expect(snippet.version).toBe(VERSION);
      // Required query param present.
      expect(snippet.code).toContain('filter');
      // Required body field present.
      expect(snippet.code).toContain('email');
      // Auth mechanism present.
      expect(snippet.code).toContain('Authorization');
      expect(snippet.code).toContain('Bearer YOUR_ACCESS_TOKEN');
    }
  );
});

describe('CodeGeneratorService.generate — optional placeholders (Req 7.4)', () => {
  it('renders optional query params as commented entries in python', async () => {
    const gen = await makeGenerator(versionWith([endpoint()]));
    const snippet = await gen.generate({
      apiSelection: SELECTION,
      endpointId: ENDPOINT_ID,
      language: 'python',
    });
    // The optional query param appears only in a commented line.
    const traceLines = snippet.code
      .split('\n')
      .filter((l) => l.includes('trace'));
    expect(traceLines.length).toBeGreaterThan(0);
    for (const line of traceLines) {
      expect(line.trim().startsWith('#')).toBe(true);
    }
  });

  it('renders optional body fields as commented entries in javascript', async () => {
    const gen = await makeGenerator(versionWith([endpoint()]));
    const snippet = await gen.generate({
      apiSelection: SELECTION,
      endpointId: ENDPOINT_ID,
      language: 'javascript',
    });
    const nicknameLines = snippet.code
      .split('\n')
      .filter((l) => l.includes('nickname'));
    expect(nicknameLines.length).toBeGreaterThan(0);
    for (const line of nicknameLines) {
      expect(line.trim().startsWith('//')).toBe(true);
    }
  });
});

describe('CodeGeneratorService.generate — scoping and examples (Req 7.5)', () => {
  it('substitutes path params and uses the provided base URL', async () => {
    const ep = endpoint({
      parameters: [
        { name: 'id', location: 'path', required: true, schema: {}, example: '42' },
      ],
      requestSchema: undefined,
    });
    const gen = await makeGenerator(versionWith([ep]));
    const snippet = await gen.generate({
      apiSelection: SELECTION,
      endpointId: ENDPOINT_ID,
      language: 'curl',
      baseUrl: 'https://prod.example.com/v2',
    });
    expect(snippet.code).toContain('https://prod.example.com/v2/users/42');
  });
});

describe('CodeGeneratorService.generate — error conditions', () => {
  it('raises VersionUnavailableError when the version is not stored (Req 7.7)', async () => {
    const gen = await makeGenerator(); // no version saved
    await expect(
      gen.generate({
        apiSelection: SELECTION,
        endpointId: ENDPOINT_ID,
        language: 'python',
      })
    ).rejects.toBeInstanceOf(VersionUnavailableError);
  });

  it('raises EndpointUnavailableError when the endpoint is missing (Req 7.6)', async () => {
    const gen = await makeGenerator(versionWith([endpoint()]));
    await expect(
      gen.generate({
        apiSelection: SELECTION,
        endpointId: 'GET /does-not-exist',
        language: 'python',
      })
    ).rejects.toBeInstanceOf(EndpointUnavailableError);
  });

  it('raises UnsupportedLanguageError listing supported languages (Req 7.8)', async () => {
    const gen = await makeGenerator(versionWith([endpoint()]));
    await expect(
      gen.generate({
        apiSelection: SELECTION,
        endpointId: ENDPOINT_ID,
        language: 'go' as Language,
      })
    ).rejects.toMatchObject({
      name: 'UnsupportedLanguageError',
      supportedLanguages: ['python', 'javascript', 'curl'],
    });
  });
});
