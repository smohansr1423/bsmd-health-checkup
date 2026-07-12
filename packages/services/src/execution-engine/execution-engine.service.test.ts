/**
 * Execution Engine — Unit tests
 *
 * Covers required-value planning, withheld sends on missing values, response
 * fidelity, structure-preserving body formatting, error pass-through, and the
 * timeout/network failure classification with value retention.
 *
 * Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7
 */

import {
  FakeHttpClient,
  InMemoryApiVersionRepository,
} from '../api-copilot-shared';
import type {
  ApiMetadata,
  ApiVersion,
  AuthMaterial,
  EndpointMeta,
} from '../api-copilot-shared';
import { ExecutionEngine } from './execution-engine.service';
import type {
  AuthMaterialPort,
  ExecutionTargetRef,
} from './execution-engine.types';
import {
  ApiVersionUnavailableError,
  EndpointNotFoundError,
  ExecutionTimeoutError,
  MissingParametersError,
  NetworkFailureError,
} from './execution-engine.errors';

const WORKSPACE_ID = 'ws-1';
const API_ID = 'api-1';
const VERSION = 1;
const BASE_URL = 'https://api.example.com/v1';

/** A fake auth port that records calls and returns fixed material. */
class RecordingAuthPort implements AuthMaterialPort {
  public calls: ExecutionTargetRef[] = [];
  constructor(private readonly material: AuthMaterial) {}
  async ensureToken(target: ExecutionTargetRef): Promise<AuthMaterial> {
    this.calls.push(target);
    return this.material;
  }
}

function endpoint(overrides: Partial<EndpointMeta> = {}): EndpointMeta {
  return {
    endpointId: 'GET /users/{id}',
    path: '/users/{id}',
    method: 'GET',
    parameters: [
      { name: 'id', location: 'path', required: true, schema: {} },
      { name: 'verbose', location: 'query', required: false, schema: {} },
    ],
    responseSchemas: {},
    responseExamples: {},
    errorCodes: [],
    authSchemeRefs: [],
    ...overrides,
  };
}

function versionWith(endpoints: EndpointMeta[]): ApiVersion {
  const metadata: ApiMetadata = {
    apiId: API_ID,
    title: 'Example',
    sourceFormat: 'openapi-3',
    endpoints,
    authSchemes: [],
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

async function makeEngine(
  endpoints: EndpointMeta[],
  opts: {
    httpClient?: FakeHttpClient;
    authProvider?: AuthMaterialPort;
    timeoutMs?: number;
  } = {}
): Promise<ExecutionEngine> {
  const repo = new InMemoryApiVersionRepository();
  await repo.save(versionWith(endpoints));
  return new ExecutionEngine({
    apiVersionRepository: repo,
    httpClient: opts.httpClient ?? new FakeHttpClient(),
    authProvider: opts.authProvider,
    timeoutMs: opts.timeoutMs,
  });
}

const selection = { workspaceId: WORKSPACE_ID, apiId: API_ID, version: VERSION };

describe('ExecutionEngine.planExecution', () => {
  it('builds a plan when all required values are provided (Req 5.1)', async () => {
    const engine = await makeEngine([endpoint()]);
    const plan = await engine.planExecution({
      apiSelection: selection,
      endpointId: 'GET /users/{id}',
      baseUrl: BASE_URL,
      provided: { path: { id: '42' }, query: { verbose: true } },
    });

    expect(plan.request.method).toBe('GET');
    expect(plan.request.url).toBe('https://api.example.com/v1/users/42?verbose=true');
    expect(plan.requiresAuth).toBe(false);
    expect(plan.requiredValues).toEqual([{ location: 'path', name: 'id' }]);
  });

  it('throws MissingParametersError listing each missing value and does not send (Req 5.2)', async () => {
    const httpClient = new FakeHttpClient();
    const sendSpy = jest.spyOn(httpClient, 'send');
    const ep = endpoint({
      parameters: [
        { name: 'id', location: 'path', required: true, schema: {} },
        { name: 'q', location: 'query', required: true, schema: {} },
      ],
      authSchemeRefs: ['bearerAuth'],
    });
    const engine = await makeEngine([ep], { httpClient });

    await expect(
      engine.planExecution({
        apiSelection: selection,
        endpointId: 'GET /users/{id}',
        baseUrl: BASE_URL,
        provided: {},
      })
    ).rejects.toMatchObject({
      name: 'MissingParametersError',
      missing: [
        { location: 'path', name: 'id' },
        { location: 'query', name: 'q' },
        { location: 'authentication', name: 'authentication' },
      ],
    });
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it('treats required request-body fields as required values (Req 5.1)', async () => {
    const ep = endpoint({
      endpointId: 'POST /users',
      path: '/users',
      method: 'POST',
      parameters: [],
      requestSchema: { type: 'object', required: ['name', 'email'] },
    });
    const engine = await makeEngine([ep]);

    await expect(
      engine.planExecution({
        apiSelection: selection,
        endpointId: 'POST /users',
        baseUrl: BASE_URL,
        provided: { body: { name: 'Ada' } },
      })
    ).rejects.toMatchObject({
      missing: [{ location: 'body', name: 'email' }],
    });
  });

  it('requires authentication when the endpoint declares an auth scheme (Req 5.1)', async () => {
    const ep = endpoint({ authSchemeRefs: ['oauth'] });
    const engine = await makeEngine([ep]);

    const plan = await engine.planExecution({
      apiSelection: selection,
      endpointId: 'GET /users/{id}',
      baseUrl: BASE_URL,
      provided: { path: { id: '1' }, authConfigured: true },
    });
    expect(plan.requiresAuth).toBe(true);
    expect(plan.requiredValues).toContainEqual({
      location: 'authentication',
      name: 'authentication',
    });
  });

  it('throws when the API version is unavailable', async () => {
    const engine = await makeEngine([endpoint()]);
    await expect(
      engine.planExecution({
        apiSelection: { ...selection, version: 99 },
        endpointId: 'GET /users/{id}',
        baseUrl: BASE_URL,
        provided: { path: { id: '1' } },
      })
    ).rejects.toBeInstanceOf(ApiVersionUnavailableError);
  });

  it('throws when the endpoint definition is missing', async () => {
    const engine = await makeEngine([endpoint()]);
    await expect(
      engine.planExecution({
        apiSelection: selection,
        endpointId: 'DELETE /nope',
        baseUrl: BASE_URL,
        provided: {},
      })
    ).rejects.toBeInstanceOf(EndpointNotFoundError);
  });
});

describe('ExecutionEngine.execute', () => {
  it('returns status, headers, and a pretty-printed structure-preserving body (Req 5.3, 5.4)', async () => {
    const httpClient = new FakeHttpClient();
    const original = { id: 42, tags: ['a', 'b'], nested: { ok: true } };
    httpClient.register('GET', 'https://api.example.com/v1/users/42', {
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(original),
    });
    const engine = await makeEngine([endpoint()], { httpClient });

    const plan = await engine.planExecution({
      apiSelection: selection,
      endpointId: 'GET /users/{id}',
      baseUrl: BASE_URL,
      provided: { path: { id: '42' } },
    });
    const result = await engine.execute(plan);

    expect(result.statusCode).toBe(200);
    expect(result.outcome).toBe('success');
    expect(result.headers).toEqual({ 'content-type': 'application/json' });
    // Pretty-printed with indentation...
    expect(result.body).toContain('\n');
    // ...but structurally equal to the original (Req 5.4 / Property 22).
    expect(JSON.parse(result.body)).toEqual(original);
  });

  it('passes error status and body through unmodified (Req 5.5)', async () => {
    const httpClient = new FakeHttpClient();
    const errorBody = { error: 'not_found', message: 'no such user' };
    httpClient.register('GET', 'https://api.example.com/v1/users/42', {
      statusCode: 404,
      headers: {},
      body: JSON.stringify(errorBody),
    });
    const engine = await makeEngine([endpoint()], { httpClient });

    const plan = await engine.planExecution({
      apiSelection: selection,
      endpointId: 'GET /users/{id}',
      baseUrl: BASE_URL,
      provided: { path: { id: '42' } },
    });
    const result = await engine.execute(plan);

    expect(result.statusCode).toBe(404);
    expect(result.outcome).toBe('error');
    expect(JSON.parse(result.body)).toEqual(errorBody);
  });

  it('returns a non-JSON body unchanged', async () => {
    const httpClient = new FakeHttpClient();
    httpClient.register('GET', 'https://api.example.com/v1/users/42', {
      statusCode: 200,
      headers: {},
      body: 'plain text response',
    });
    const engine = await makeEngine([endpoint()], { httpClient });
    const plan = await engine.planExecution({
      apiSelection: selection,
      endpointId: 'GET /users/{id}',
      baseUrl: BASE_URL,
      provided: { path: { id: '42' } },
    });
    const result = await engine.execute(plan);
    expect(result.body).toBe('plain text response');
  });

  it('applies Auth Assistant material before sending (Req 6.2)', async () => {
    const httpClient = new FakeHttpClient();
    let sentAuth: string | undefined;
    httpClient.register('GET', 'https://api.example.com/v1/users/1', {
      statusCode: 200,
      headers: {},
      body: '{}',
    });
    const originalSend = httpClient.send.bind(httpClient);
    jest.spyOn(httpClient, 'send').mockImplementation(async (req, timeout) => {
      sentAuth = req.headers.Authorization;
      return originalSend(req, timeout);
    });
    const authPort = new RecordingAuthPort({
      headers: { Authorization: 'Bearer TOKEN123' },
    });
    const ep = endpoint({
      endpointId: 'GET /users/{id}',
      authSchemeRefs: ['oauth'],
    });
    const engine = await makeEngine([ep], { httpClient, authProvider: authPort });

    const plan = await engine.planExecution({
      apiSelection: selection,
      endpointId: 'GET /users/{id}',
      baseUrl: BASE_URL,
      provided: { path: { id: '1' }, authConfigured: true },
    });
    await engine.execute(plan);

    expect(authPort.calls).toEqual([{ targetApiRef: API_ID }]);
    expect(sentAuth).toBe('Bearer TOKEN123');
  });

  it('classifies a timeout distinctly and retains the plan (Req 5.6)', async () => {
    const httpClient = new FakeHttpClient();
    // A send that never resolves triggers the timeout race.
    httpClient.register(
      'GET',
      'https://api.example.com/v1/users/42',
      () => new Promise(() => undefined)
    );
    const engine = await makeEngine([endpoint()], { httpClient, timeoutMs: 20 });
    const plan = await engine.planExecution({
      apiSelection: selection,
      endpointId: 'GET /users/{id}',
      baseUrl: BASE_URL,
      provided: { path: { id: '42' } },
    });

    await expect(engine.execute(plan)).rejects.toMatchObject({
      name: 'ExecutionTimeoutError',
      kind: 'timeout',
      plan: { endpointId: 'GET /users/{id}' },
    });
  });

  it('classifies a network failure distinctly and retains the plan (Req 5.7)', async () => {
    const httpClient = new FakeHttpClient();
    httpClient.register('GET', 'https://api.example.com/v1/users/42', () =>
      Promise.reject(new Error('ECONNREFUSED'))
    );
    const engine = await makeEngine([endpoint()], { httpClient, timeoutMs: 1000 });
    const plan = await engine.planExecution({
      apiSelection: selection,
      endpointId: 'GET /users/{id}',
      baseUrl: BASE_URL,
      provided: { path: { id: '42' } },
    });

    let caught: unknown;
    try {
      await engine.execute(plan);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(NetworkFailureError);
    expect((caught as NetworkFailureError).kind).toBe('network');
    // Entered values retained via the plan.
    expect((caught as NetworkFailureError).plan.request.url).toBe(
      'https://api.example.com/v1/users/42'
    );
  });
});
