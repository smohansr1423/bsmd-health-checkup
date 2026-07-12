/**
 * Execution Engine — Property-Based Tests
 *
 * Uses fast-check to validate the universal execution properties from the
 * design document:
 *  - Property 19: the plan requires exactly the metadata's required values.
 *  - Property 20: no request is sent while required values are missing.
 *  - Property 21: response status/body fidelity (success and error).
 *  - Property 22: JSON body formatting is structure-preserving.
 *  - Property 23: transient failures classify correctly and retain input.
 *
 * Side-effecting collaborators are injected as deterministic fakes: a
 * deterministic `idGenerator`/`dateProvider`, a programmable `FakeHttpClient`
 * (success/error/timeout/network), a fake `AuthMaterialPort`, and an
 * `InMemoryApiVersionRepository`.
 *
 * Feature: api-copilot-ai
 * Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 8.1, 8.2
 */

import * as fc from 'fast-check';

import {
  FakeHttpClient,
  InMemoryApiVersionRepository,
} from '../api-copilot-shared';
import type {
  ApiMetadata,
  ApiSelection,
  ApiVersion,
  AuthMaterial,
  EndpointMeta,
  HttpMethod,
  IdGenerator,
  DateProvider,
} from '../api-copilot-shared';
import { ExecutionEngine } from './execution-engine.service';
import { prettyPrintBody } from './execution-engine.validators';
import {
  ExecutionTimeoutError,
  MissingParametersError,
  NetworkFailureError,
} from './execution-engine.errors';
import type {
  AuthMaterialPort,
  ExecutionTargetRef,
  ParamValues,
  RequiredValueRef,
} from './execution-engine.types';

const WORKSPACE_ID = 'ws-1';
const API_ID = 'api-1';
const VERSION = 1;
const BASE_URL = 'https://api.example.com/v1';

const SELECTION: ApiSelection = {
  workspaceId: WORKSPACE_ID,
  apiId: API_ID,
  version: VERSION,
};

// ─── Deterministic injected fakes ───────────────────────────────────────────

/** Deterministic id generator so nothing depends on wall-clock/random. */
const fixedIdGenerator: IdGenerator = () => 'exec-fixed-id';
/** Deterministic clock: fixed instant so elapsed is stable and non-negative. */
const fixedDateProvider: DateProvider = () =>
  new Date('2024-01-01T00:00:00.000Z');

/** A fake auth port that records calls and returns fixed, non-secret material. */
class FakeAuthPort implements AuthMaterialPort {
  public calls: ExecutionTargetRef[] = [];
  constructor(
    private readonly material: AuthMaterial = {
      headers: { Authorization: 'Bearer TEST-TOKEN' },
    }
  ) {}
  async ensureToken(target: ExecutionTargetRef): Promise<AuthMaterial> {
    this.calls.push(target);
    return this.material;
  }
}

// ─── Metadata / engine helpers ───────────────────────────────────────────────

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
    idGenerator: fixedIdGenerator,
    dateProvider: fixedDateProvider,
    apiVersionRepository: repo,
    httpClient: opts.httpClient ?? new FakeHttpClient(),
    authProvider: opts.authProvider,
    timeoutMs: opts.timeoutMs,
  });
}

/**
 * Independently derive the set of values an endpoint's metadata declares as
 * required (mirroring the specification, not the implementation): every
 * required parameter, every required request-body field, and a single
 * `authentication` requirement when any auth scheme is declared.
 */
function metadataRequiredSet(endpoint: EndpointMeta): RequiredValueRef[] {
  const required: RequiredValueRef[] = [];
  for (const p of endpoint.parameters) {
    if (p.required) {
      required.push({ location: p.location, name: p.name });
    }
  }
  const bodyRequired = (endpoint.requestSchema as { required?: unknown })
    ?.required;
  if (Array.isArray(bodyRequired)) {
    for (const field of bodyRequired) {
      if (
        typeof field === 'string' &&
        !required.some((r) => r.location === 'body' && r.name === field)
      ) {
        required.push({ location: 'body', name: field });
      }
    }
  }
  if (endpoint.authSchemeRefs.length > 0) {
    required.push({ location: 'authentication', name: 'authentication' });
  }
  return required;
}

/** Canonical key for order-insensitive set comparison of required values. */
const refKey = (r: RequiredValueRef): string => `${r.location}:${r.name}`;

function expectSameRefSet(
  actual: RequiredValueRef[],
  expected: RequiredValueRef[]
): void {
  expect(new Set(actual.map(refKey))).toEqual(new Set(expected.map(refKey)));
  // No duplicates are demanded.
  expect(actual.length).toBe(new Set(actual.map(refKey)).size);
}

/** Build a `ParamValues` bag that satisfies exactly the given required refs. */
function provideFor(refs: RequiredValueRef[]): ParamValues {
  const provided: ParamValues = {};
  for (const ref of refs) {
    switch (ref.location) {
      case 'path':
        (provided.path ??= {})[ref.name] = 'v';
        break;
      case 'query':
        (provided.query ??= {})[ref.name] = 'v';
        break;
      case 'header':
        (provided.header ??= {})[ref.name] = 'v';
        break;
      case 'cookie':
        (provided.cookie ??= {})[ref.name] = 'v';
        break;
      case 'body':
        (provided.body ??= {})[ref.name] = 'v';
        break;
      case 'authentication':
        provided.authConfigured = true;
        break;
    }
  }
  return provided;
}

// ─── Arbitraries ─────────────────────────────────────────────────────────────

const METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

/**
 * Generate an endpoint with a random mix of required/optional path, query,
 * header, and cookie parameters, an optional request body with required fields,
 * and a possibly-empty set of auth scheme references. Names are index-derived so
 * they are unique across parameter and body-field spaces.
 */
const endpointArb: fc.Arbitrary<EndpointMeta> = fc
  .record({
    method: fc.constantFrom(...METHODS),
    params: fc.array(
      fc.record({
        location: fc.constantFrom<'path' | 'query' | 'header' | 'cookie'>(
          'path',
          'query',
          'header',
          'cookie'
        ),
        required: fc.boolean(),
      }),
      { maxLength: 6 }
    ),
    bodyRequiredCount: fc.nat({ max: 3 }),
    authCount: fc.nat({ max: 2 }),
  })
  .map(({ method, params, bodyRequiredCount, authCount }) => {
    const parameters = params.map((p, i) => ({
      name: `p${i}`,
      location: p.location,
      required: p.required,
      schema: {},
    }));
    const bodyFields = Array.from(
      { length: bodyRequiredCount },
      (_v, i) => `b${i}`
    );
    const requestSchema =
      bodyRequiredCount > 0
        ? { type: 'object', required: bodyFields }
        : undefined;
    const authSchemeRefs = Array.from(
      { length: authCount },
      (_v, i) => `scheme${i}`
    );
    const path = '/resource';
    return {
      endpointId: `${method} ${path}`,
      path,
      method,
      parameters,
      ...(requestSchema !== undefined ? { requestSchema } : {}),
      responseSchemas: {},
      responseExamples: {},
      errorCodes: [],
      authSchemeRefs,
    } as EndpointMeta;
  });

/** A JSON value arbitrary; -0 is normalized to 0 to avoid Object.is quirks. */
const jsonValueArb: fc.Arbitrary<unknown> = fc.letrec((tie) => ({
  value: fc.oneof(
    { depthSize: 'small' },
    fc.string(),
    fc.integer(),
    fc
      .double({ noNaN: true, noDefaultInfinity: true })
      .map((x) => (Object.is(x, -0) ? 0 : x)),
    fc.boolean(),
    fc.constant(null),
    fc.array(tie('value'), { maxLength: 4 }),
    fc.dictionary(fc.string({ minLength: 1, maxLength: 6 }), tie('value'), {
      maxKeys: 4,
    })
  ),
})).value;

// ─── Property 19 ─────────────────────────────────────────────────────────────

describe('Execution Engine — required-value planning properties', () => {
  // Feature: api-copilot-ai, Property 19: Execution plan requires exactly the
  // metadata's required values — for any endpoint, the set of required values
  // the Execution_Engine demands (path, query, body, and authentication) equals
  // the required set defined by that endpoint's metadata.
  // Validates: Requirements 5.1
  it('Property 19: the plan demands exactly the metadata-required values', async () => {
    await fc.assert(
      fc.asyncProperty(endpointArb, async (endpoint) => {
        const engine = await makeEngine([endpoint]);
        const expected = metadataRequiredSet(endpoint);

        const plan = await engine.planExecution({
          apiSelection: SELECTION,
          endpointId: endpoint.endpointId,
          baseUrl: BASE_URL,
          provided: provideFor(expected),
        });

        // The engine demands exactly the metadata's required set — no more, no
        // fewer, and no duplicates.
        expectSameRefSet(plan.requiredValues, expected);
        // requiresAuth mirrors whether the metadata declares any auth scheme.
        expect(plan.requiresAuth).toBe(endpoint.authSchemeRefs.length > 0);
      })
    );
  });
});

// ─── Property 20 ─────────────────────────────────────────────────────────────

/** An endpoint arbitrary paired with a strict subset of provided requireds. */
const missingScenarioArb = endpointArb
  .filter((ep) => metadataRequiredSet(ep).length > 0)
  .chain((endpoint) => {
    const required = metadataRequiredSet(endpoint);
    return fc
      .array(fc.boolean(), {
        minLength: required.length,
        maxLength: required.length,
      })
      .map((mask) => {
        // Guarantee at least one required value is withheld.
        const keepMask = mask.slice();
        if (keepMask.every((k) => k)) {
          keepMask[0] = false;
        }
        const kept = required.filter((_r, i) => keepMask[i]);
        const missing = required.filter((_r, i) => !keepMask[i]);
        return { endpoint, kept, missing };
      });
  });

describe('Execution Engine — withheld-send properties', () => {
  // Feature: api-copilot-ai, Property 20: No request is sent while required
  // values are missing — for any execution request missing one or more required
  // parameter or authentication values, the Execution_Engine sends no request to
  // the target API and prompts for each missing value.
  // Validates: Requirements 5.2
  it('Property 20: missing required values prevent the send and are each reported', async () => {
    await fc.assert(
      fc.asyncProperty(missingScenarioArb, async ({ endpoint, kept, missing }) => {
        const httpClient = new FakeHttpClient();
        const sendSpy = jest.spyOn(httpClient, 'send');
        const engine = await makeEngine([endpoint], { httpClient });

        let caught: unknown;
        try {
          await engine.planExecution({
            apiSelection: SELECTION,
            endpointId: endpoint.endpointId,
            baseUrl: BASE_URL,
            provided: provideFor(kept),
          });
        } catch (err) {
          caught = err;
        }

        // Planning rejects, listing exactly the withheld required values...
        expect(caught).toBeInstanceOf(MissingParametersError);
        expectSameRefSet(
          (caught as MissingParametersError).missing,
          missing
        );
        // ...and no request was ever sent to the target API.
        expect(sendSpy).not.toHaveBeenCalled();
      })
    );
  });
});

// ─── Property 21 ─────────────────────────────────────────────────────────────

/** A fixed, dependency-free endpoint so the outbound URL is deterministic. */
const SIMPLE_ENDPOINT: EndpointMeta = {
  endpointId: 'GET /resource',
  path: '/resource',
  method: 'GET',
  parameters: [],
  responseSchemas: {},
  responseExamples: {},
  errorCodes: [],
  authSchemeRefs: [],
};
const SIMPLE_URL = `${BASE_URL}/resource`;

const headersArb = fc.dictionary(
  fc.constantFrom('content-type', 'x-request-id', 'etag', 'x-custom'),
  fc.string({ maxLength: 12 }),
  { maxKeys: 4 }
);

describe('Execution Engine — response fidelity properties', () => {
  // Feature: api-copilot-ai, Property 21: Response fidelity — for any target
  // response (success or error), the status code and response body returned to
  // the user (and displayed by the testing console with method, URL, headers,
  // and elapsed milliseconds) equal the target's status code and body
  // unmodified.
  // Validates: Requirements 5.3, 5.5, 8.1
  it('Property 21: status, headers, and body are returned faithfully for any status', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 100, max: 599 }),
        jsonValueArb,
        headersArb,
        async (statusCode, body, headers) => {
          const httpClient = new FakeHttpClient();
          const rawBody = JSON.stringify(body);
          httpClient.register('GET', SIMPLE_URL, {
            statusCode,
            headers,
            body: rawBody,
          });
          const engine = await makeEngine([SIMPLE_ENDPOINT], { httpClient });

          const plan = await engine.planExecution({
            apiSelection: SELECTION,
            endpointId: SIMPLE_ENDPOINT.endpointId,
            baseUrl: BASE_URL,
            provided: {},
          });
          const result = await engine.execute(plan);

          // Status code passed through unmodified (Req 5.3, 5.5).
          expect(result.statusCode).toBe(statusCode);
          // Error statuses classified as 'error', otherwise 'success'.
          expect(result.outcome).toBe(statusCode >= 400 ? 'error' : 'success');
          // Headers surfaced unmodified for console display (Req 8.1).
          expect(result.headers).toEqual(headers);
          // Elapsed time is present and non-negative (Req 8.1).
          expect(typeof result.elapsedMs).toBe('number');
          expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
          // Body content is unmodified: re-parsing yields the original value.
          expect(JSON.parse(result.body)).toEqual(body);
        }
      )
    );
  });
});

// ─── Property 22 ─────────────────────────────────────────────────────────────

describe('Execution Engine — body formatting properties', () => {
  // Feature: api-copilot-ai, Property 22: Body formatting is structure-preserving
  // — for any structured (JSON) response body, re-parsing the formatted body
  // yields a value structurally equal to the original body.
  // Validates: Requirements 5.4
  it('Property 22: re-parsing the pretty-printed body reproduces the original value', () => {
    fc.assert(
      fc.property(jsonValueArb, (body) => {
        const raw = JSON.stringify(body);
        const formatted = prettyPrintBody(raw);

        // Structural equality is preserved across formatting.
        expect(JSON.parse(formatted)).toEqual(body);
      })
    );
  });
});

// ─── Property 23 ─────────────────────────────────────────────────────────────

/** An endpoint that carries entered values (a query param) and requires auth. */
const RETAIN_ENDPOINT: EndpointMeta = {
  endpointId: 'GET /r',
  path: '/r',
  method: 'GET',
  parameters: [{ name: 'q', location: 'query', required: true, schema: {} }],
  responseSchemas: {},
  responseExamples: {},
  errorCodes: [],
  authSchemeRefs: ['bearer'],
};
const RETAIN_URL = `${BASE_URL}/r?q=x`;

describe('Execution Engine — transient-failure properties', () => {
  // Feature: api-copilot-ai, Property 23: Transient failures classify correctly
  // and retain input — for any execution that times out (no response within 30s)
  // or fails with a network error, the engine cancels/stops the request, returns
  // an error classified as timeout or network-connection respectively, and
  // retains the entered parameters and authentication values.
  // Validates: Requirements 5.6, 5.7, 8.2
  it('Property 23: timeouts and network failures are classified distinctly and retain input', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom<'timeout' | 'network'>('timeout', 'network'),
        async (failureKind) => {
          const httpClient = new FakeHttpClient();
          if (failureKind === 'timeout') {
            // A send that never resolves triggers the timeout race.
            httpClient.register(
              'GET',
              RETAIN_URL,
              () => new Promise<never>(() => undefined)
            );
          } else {
            httpClient.register('GET', RETAIN_URL, () =>
              Promise.reject(new Error('ECONNREFUSED'))
            );
          }
          const engine = await makeEngine([RETAIN_ENDPOINT], {
            httpClient,
            authProvider: new FakeAuthPort(),
            // Small cap keeps the timeout path fast under many runs.
            timeoutMs: failureKind === 'timeout' ? 15 : 1000,
          });

          const plan = await engine.planExecution({
            apiSelection: SELECTION,
            endpointId: RETAIN_ENDPOINT.endpointId,
            baseUrl: BASE_URL,
            provided: { query: { q: 'x' }, authConfigured: true },
          });

          let caught: unknown;
          try {
            await engine.execute(plan);
          } catch (err) {
            caught = err;
          }

          if (failureKind === 'timeout') {
            expect(caught).toBeInstanceOf(ExecutionTimeoutError);
            expect((caught as ExecutionTimeoutError).kind).toBe('timeout');
          } else {
            expect(caught).toBeInstanceOf(NetworkFailureError);
            expect((caught as NetworkFailureError).kind).toBe('network');
          }

          // The entered parameters and auth configuration are retained via the
          // originating plan (identity preserved; request unchanged).
          const retained = caught as ExecutionTimeoutError | NetworkFailureError;
          expect(retained.plan).toBe(plan);
          expect(retained.plan.request).toBe(plan.request);
          expect(retained.plan.request.url).toBe(RETAIN_URL);
          expect(retained.endpointId).toBe(RETAIN_ENDPOINT.endpointId);
          // Auth was still required (the entered auth configuration is retained
          // as part of the plan's required-value set).
          expect(
            retained.plan.requiredValues.some(
              (r) => r.location === 'authentication'
            )
          ).toBe(true);
        }
      )
    );
  });
});
