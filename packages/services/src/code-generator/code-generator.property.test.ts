/**
 * Code Generator — Property-Based Tests
 *
 * Uses fast-check to validate the universal code-generation properties from the
 * design document:
 *   - Property 27: generated snippets include every required parameter and the
 *     endpoint's authentication mechanism (Req 7.1, 7.3, 7.5).
 *   - Property 28: optional parameters appear only as inert commented/placeholder
 *     entries; the snippet stays syntactically complete without enabling them
 *     (Req 7.4).
 *   - Property 29: a request whose endpoint has no definition yields no snippet,
 *     leaves any prior snippet unchanged, and returns an endpoint-unavailable
 *     error (Req 7.6).
 *   - Property 30: an unsupported language is rejected with an error that lists
 *     exactly the supported languages (Req 7.8).
 *
 * The global fast-check run count is configured in jest.setup.fast-check.ts
 * (numRuns=25); this file adds no inline overrides. A deterministic
 * idGenerator/dateProvider are injected and an InMemoryApiVersionRepository is
 * seeded with generated ApiMetadata/ApiVersion so the tests exercise the real
 * CodeGeneratorService.generate path.
 *
 * Feature: api-copilot-ai
 * Validates: Requirements 7.1, 7.3, 7.4, 7.5, 7.6, 7.8
 */

import * as fc from 'fast-check';

import { InMemoryApiVersionRepository } from '../api-copilot-shared';
import type {
  ApiMetadata,
  ApiSelection,
  ApiVersion,
  AuthScheme,
  AuthSchemeMeta,
  EndpointMeta,
  Language,
  ParameterMeta,
} from '../api-copilot-shared';
import { CodeGeneratorService } from './code-generator.service';
import {
  EndpointUnavailableError,
  UnsupportedLanguageError,
} from './code-generator.errors';
import { DEFAULT_BASE_URL, SUPPORTED_LANGUAGES } from './code-generator.types';
import { buildRenderModel } from './code-generator.validators';

// ─── Fixtures ─────────────────────────────────────────────────────────────

const WORKSPACE_ID = 'ws-1';
const API_ID = 'api-1';
const VERSION = 1;

const SELECTION: ApiSelection = {
  workspaceId: WORKSPACE_ID,
  apiId: API_ID,
  version: VERSION,
};

const SUPPORTED: readonly Language[] = ['python', 'javascript', 'curl'];

/** POST-MVP / unknown languages the MVP generator must reject (Req 7.8). */
const UNSUPPORTED_LANGUAGES: Language[] = [
  'java',
  'typescript',
  'csharp',
  'go',
  'php',
  'ruby',
  'kotlin',
  'swift',
  'powershell',
];

/** The comment prefix each language uses for inert placeholder lines. */
const COMMENT_PREFIX: Record<Language, string> = {
  python: '#',
  javascript: '//',
  curl: '#',
  java: '//',
  typescript: '//',
  csharp: '//',
  go: '//',
  php: '//',
  ruby: '#',
  kotlin: '//',
  swift: '//',
  powershell: '#',
};

// ─── Seeding helpers ────────────────────────────────────────────────────────

async function makeGenerator(version: ApiVersion): Promise<CodeGeneratorService> {
  const repo = new InMemoryApiVersionRepository();
  await repo.save(version);
  return new CodeGeneratorService({
    apiVersionRepository: repo,
    idGenerator: () => 'test-id',
    dateProvider: () => new Date('2024-01-01T00:00:00.000Z'),
  });
}

function versionOf(endpoint: EndpointMeta, authSchemes: AuthSchemeMeta[]): ApiVersion {
  const metadata: ApiMetadata = {
    apiId: API_ID,
    title: 'Generated API',
    sourceFormat: 'openapi-3',
    endpoints: [endpoint],
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

// ─── Arbitraries ──────────────────────────────────────────────────────────

const AUTH_SCHEME_TYPES: AuthScheme[] = [
  'oauth2',
  'jwt',
  'apiKey',
  'bearer',
  'basic',
  'clientCredentials',
  'pkce',
];

/** A scenario: an endpoint plus its resolvable auth schemes, all names unique. */
interface Scenario {
  endpoint: EndpointMeta;
  authSchemes: AuthSchemeMeta[];
}

/**
 * Builds a self-consistent endpoint whose parameter names are unique and of
 * fixed width (`p000`, `p001`, …) so containment assertions never suffer from
 * accidental substring collisions.
 */
const scenarioArb: fc.Arbitrary<Scenario> = fc
  .record({
    method: fc.constantFrom<EndpointMeta['method']>(
      'GET',
      'POST',
      'PUT',
      'PATCH',
      'DELETE'
    ),
    pathCount: fc.nat({ max: 3 }),
    queryFlags: fc.array(fc.boolean(), { maxLength: 4 }),
    headerFlags: fc.array(fc.boolean(), { maxLength: 3 }),
    bodyFlags: fc.array(fc.boolean(), { maxLength: 4 }),
    authTypes: fc.array(fc.constantFrom(...AUTH_SCHEME_TYPES), { maxLength: 3 }),
    apiKeyLocations: fc.array(
      fc.constantFrom<'header' | 'query' | 'cookie'>('header', 'query', 'cookie'),
      { maxLength: 3 }
    ),
  })
  .map(({ method, pathCount, queryFlags, headerFlags, bodyFlags, authTypes, apiKeyLocations }) => {
    let counter = 0;
    const nextName = (): string => `p${String(counter++).padStart(3, '0')}`;

    const pathParams: ParameterMeta[] = Array.from({ length: pathCount }, () => ({
      name: nextName(),
      location: 'path' as const,
      required: true,
      schema: {},
    }));
    const queryParams: ParameterMeta[] = queryFlags.map((required) => ({
      name: nextName(),
      location: 'query' as const,
      required,
      schema: {},
    }));
    const headerParams: ParameterMeta[] = headerFlags.map((required) => ({
      name: nextName(),
      location: 'header' as const,
      required,
      schema: {},
    }));

    const bodyFields = bodyFlags.map((required) => ({ name: nextName(), required }));
    const properties: Record<string, unknown> = {};
    for (const f of bodyFields) {
      properties[f.name] = { type: 'string' };
    }
    const requestSchema =
      bodyFields.length > 0
        ? {
            type: 'object',
            required: bodyFields.filter((f) => f.required).map((f) => f.name),
            properties,
          }
        : undefined;

    const path = '/res' + pathParams.map((p) => `/{${p.name}}`).join('');
    const endpointId = `${method} ${path}`;

    const authSchemes: AuthSchemeMeta[] = authTypes.map((type, i) => {
      if (type === 'apiKey') {
        const location = apiKeyLocations[i] ?? 'header';
        return {
          id: `auth${i}`,
          type,
          details: { in: location, name: `Api-Key-${i}` },
        };
      }
      return { id: `auth${i}`, type, details: {} };
    });

    const endpoint: EndpointMeta = {
      endpointId,
      path,
      method,
      parameters: [...pathParams, ...queryParams, ...headerParams],
      requestSchema,
      responseSchemas: {},
      responseExamples: {},
      errorCodes: [],
      authSchemeRefs: authSchemes.map((s) => s.id),
    };

    return { endpoint, authSchemes };
  });

// ─── Property 27 ────────────────────────────────────────────────────────────

describe('Code Generator — required parameters & authentication', () => {
  // Feature: api-copilot-ai, Property 27: Generated snippets include required
  // parameters and authentication — for any endpoint and any supported language,
  // the generated snippet includes every required parameter and the endpoint's
  // authentication mechanism as defined in the selected version's metadata.
  // Validates: Requirements 7.1, 7.3, 7.5
  it('Property 27: every required parameter and auth mechanism appears in the snippet', async () => {
    await fc.assert(
      fc.asyncProperty(
        scenarioArb,
        fc.constantFrom<Language>('python', 'javascript', 'curl'),
        async ({ endpoint, authSchemes }, language) => {
          const version = versionOf(endpoint, authSchemes);
          const gen = await makeGenerator(version);

          const snippet = await gen.generate({
            apiSelection: SELECTION,
            endpointId: endpoint.endpointId,
            language,
          });

          // The snippet is scoped to the selected version's metadata (Req 7.5).
          expect(snippet.apiId).toBe(API_ID);
          expect(snippet.version).toBe(VERSION);
          expect(snippet.language).toBe(language);

          const model = buildRenderModel(version.metadata, endpoint, DEFAULT_BASE_URL);
          const code = snippet.code;

          // Required path parameters are substituted into the request URL.
          for (const p of endpoint.parameters.filter(
            (x) => x.location === 'path' && x.required
          )) {
            expect(code).toContain(p.name);
          }

          // Required query parameters appear as active entries.
          for (const p of endpoint.parameters.filter(
            (x) => x.location === 'query' && x.required
          )) {
            expect(code).toContain(p.name);
          }

          // Required header parameters appear as active entries.
          for (const p of endpoint.parameters.filter(
            (x) => x.location === 'header' && x.required
          )) {
            expect(code).toContain(p.name);
          }

          // Required body fields appear when the endpoint carries a body.
          if (model.hasBody) {
            for (const f of model.bodyFields.filter((x) => x.required)) {
              expect(code).toContain(f.name);
            }
          }

          // The endpoint's authentication mechanism is present: every resolved
          // auth header (name and value) and every auth query parameter name.
          for (const h of model.authHeaders) {
            expect(code).toContain(h.name);
            expect(code).toContain(h.value);
          }
          for (const q of model.authQuery) {
            expect(code).toContain(q.name);
          }
        }
      )
    );
  });
});

// ─── Property 28 ────────────────────────────────────────────────────────────

describe('Code Generator — optional parameters are inert placeholders', () => {
  // Feature: api-copilot-ai, Property 28: Optional parameters appear as inert
  // placeholders — for any endpoint with optional parameters, each optional
  // parameter appears in the snippet as a commented-out or placeholder entry, and
  // the snippet remains syntactically complete without enabling them.
  // Validates: Requirements 7.4
  it('Property 28: optional parameters appear only on commented lines', async () => {
    await fc.assert(
      fc.asyncProperty(
        scenarioArb,
        fc.constantFrom<Language>('python', 'javascript', 'curl'),
        async ({ endpoint, authSchemes }, language) => {
          const version = versionOf(endpoint, authSchemes);
          const gen = await makeGenerator(version);

          const snippet = await gen.generate({
            apiSelection: SELECTION,
            endpointId: endpoint.endpointId,
            language,
          });

          const model = buildRenderModel(version.metadata, endpoint, DEFAULT_BASE_URL);
          const code = snippet.code;
          const lines = code.split('\n');
          const prefix = COMMENT_PREFIX[language];

          // Optional query/header parameters are always rendered (as comments).
          const optionalNames = new Set<string>();
          for (const p of endpoint.parameters.filter(
            (x) => (x.location === 'query' || x.location === 'header') && !x.required
          )) {
            optionalNames.add(p.name);
          }
          // Optional body fields only render when the endpoint carries a body.
          if (model.hasBody) {
            for (const f of model.bodyFields.filter((x) => !x.required)) {
              optionalNames.add(f.name);
            }
          }

          for (const name of optionalNames) {
            const occurrences = lines.filter((l) => l.includes(name));
            // The optional parameter is present in the snippet…
            expect(occurrences.length).toBeGreaterThan(0);
            // …and only ever on inert (commented) lines.
            for (const line of occurrences) {
              expect(line.trim().startsWith(prefix)).toBe(true);
            }
          }

          // The snippet remains syntactically complete without enabling the
          // optional entries: the active call scaffold is present as produced.
          if (language === 'python') {
            expect(code).toContain('import requests');
            expect(code).toContain('requests.');
          } else if (language === 'javascript') {
            expect(code).toContain('fetch(url, options)');
          } else {
            expect(code).toContain(`curl -X ${endpoint.method}`);
          }
        }
      )
    );
  });
});

// ─── Property 29 ────────────────────────────────────────────────────────────

describe('Code Generator — missing endpoint yields no snippet', () => {
  // Feature: api-copilot-ai, Property 29: Missing endpoint definition yields no
  // snippet — for any code request whose endpoint has no definition in the
  // metadata, no snippet is produced, any prior snippet is unchanged, and an
  // endpoint-unavailable error is returned.
  // Validates: Requirements 7.6
  it('Property 29: an unknown endpoint id rejects with EndpointUnavailableError and leaves a prior snippet unchanged', async () => {
    await fc.assert(
      fc.asyncProperty(
        scenarioArb,
        fc.constantFrom<Language>('python', 'javascript', 'curl'),
        async ({ endpoint, authSchemes }, language) => {
          const version = versionOf(endpoint, authSchemes);
          const gen = await makeGenerator(version);

          // A previously generated, valid snippet that must remain unchanged.
          const priorSnippet = await gen.generate({
            apiSelection: SELECTION,
            endpointId: endpoint.endpointId,
            language,
          });
          const priorSnapshot = { ...priorSnippet };

          const missingEndpointId = `${endpoint.endpointId}__missing__`;
          expect(missingEndpointId).not.toBe(endpoint.endpointId);

          await expect(
            gen.generate({
              apiSelection: SELECTION,
              endpointId: missingEndpointId,
              language,
            })
          ).rejects.toBeInstanceOf(EndpointUnavailableError);

          // No snippet was produced for the missing endpoint; the prior snippet
          // is left exactly as it was.
          expect(priorSnippet).toEqual(priorSnapshot);
        }
      )
    );
  });
});

// ─── Property 30 ────────────────────────────────────────────────────────────

describe('Code Generator — unsupported languages are rejected', () => {
  // Feature: api-copilot-ai, Property 30: Unsupported languages are rejected with
  // the supported list — for any requested language the Code_Generator does not
  // support, no snippet is produced and the error lists exactly the supported
  // languages.
  // Validates: Requirements 7.8
  it('Property 30: an unsupported language rejects with the exact supported list', async () => {
    const unsupportedArb = fc.oneof(
      fc.constantFrom(...UNSUPPORTED_LANGUAGES),
      fc
        .string({ minLength: 1, maxLength: 12 })
        .filter((s) => !SUPPORTED.includes(s as Language))
    );

    await fc.assert(
      fc.asyncProperty(scenarioArb, unsupportedArb, async ({ endpoint, authSchemes }, language) => {
        const version = versionOf(endpoint, authSchemes);
        const gen = await makeGenerator(version);

        let produced = false;
        try {
          await gen.generate({
            apiSelection: SELECTION,
            endpointId: endpoint.endpointId,
            language: language as Language,
          });
          produced = true;
        } catch (err) {
          // No snippet was produced; the error lists exactly the supported set.
          expect(err).toBeInstanceOf(UnsupportedLanguageError);
          const unsupportedError = err as UnsupportedLanguageError;
          expect(unsupportedError.requestedLanguage).toBe(language);
          expect([...unsupportedError.supportedLanguages]).toEqual([...SUPPORTED_LANGUAGES]);
        }
        expect(produced).toBe(false);
      })
    );
  });
});
