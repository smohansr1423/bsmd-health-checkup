/**
 * Query Engine — Natural-language Q&A (RAG) Property-Based Tests
 *
 * Uses fast-check to validate the universal RAG answering properties from the
 * design document: grounding vs refusal (Property 13), endpoint answer content
 * (Property 14), authentication enumeration (Property 15), citations (Property
 * 16), the selected-API requirement (Property 17), and generation-failure
 * preservation (Property 18).
 *
 * Feature: api-copilot-ai
 * Validates: Requirements 4.1, 4.2, 4.3, 4.5, 4.6, 4.7, 4.9, 19.4
 */

import * as fc from 'fast-check';

import {
  FakeEmbeddingProvider,
  FakeLlmProvider,
  InMemoryApiVersionRepository,
} from '../api-copilot-shared';
import type {
  ApiMetadata,
  ApiSelection,
  AuthScheme,
  AuthSchemeMeta,
  EndpointMeta,
  HttpMethod,
  IndexedChunk,
  LlmProvider,
  ScoredChunk,
  UserRef,
  VectorStore,
} from '../api-copilot-shared';
import { QueryEngine } from './query-engine.service';
import {
  AnswerGenerationError,
  NoApiSelectedError,
} from './query-engine.errors';
import {
  MIN_RELEVANCE_SCORE,
  NOT_AVAILABLE_MESSAGE,
} from './query-engine.types';

const SELECTION: ApiSelection = { workspaceId: 'ws-1', apiId: 'api-1', version: 1 };
const REQUESTER: UserRef = { userId: 'user-1', accountId: 'acct-1' };

/** A programmable vector store returning a fixed scored set. */
class StubVectorStore implements VectorStore {
  constructor(private readonly result: ScoredChunk[]) {}

  async upsert(): Promise<void> {
    /* not used */
  }

  async query(): Promise<ScoredChunk[]> {
    return this.result;
  }
}

function scoredChunk(sourceRef: string, score: number): ScoredChunk {
  const chunk: IndexedChunk = {
    chunkId: `id-${sourceRef}`,
    apiId: SELECTION.apiId,
    version: SELECTION.version,
    sourceRef,
    text: `content for ${sourceRef}`,
    embedding: [0.1, 0.2],
  };
  return { chunk, score };
}

// ─── Arbitraries ────────────────────────────────────────────────────────────

const alnumArb = (maxLength = 8): fc.Arbitrary<string> =>
  fc
    .array(
      fc.constantFrom(
        ...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split(
          ''
        )
      ),
      { minLength: 1, maxLength: maxLength }
    )
    .map((cs) => cs.join(''));

/** A short, valid, non-authentication question. */
const questionArb: fc.Arbitrary<string> = alnumArb(40);

const scoreArb = fc.double({ min: 0, max: 1, noNaN: true });

const scoredListArb: fc.Arbitrary<ScoredChunk[]> = fc
  .array(scoreArb, { minLength: 0, maxLength: 12 })
  .map((scores) => scores.map((score, i) => scoredChunk(`ref-${i}`, score)));

/** A scored list guaranteed to contain at least one qualifying (≥ 0.7) hit. */
const groundedScoredListArb: fc.Arbitrary<ScoredChunk[]> = fc
  .tuple(
    fc.double({ min: MIN_RELEVANCE_SCORE, max: 1, noNaN: true }),
    fc.array(scoreArb, { minLength: 0, maxLength: 8 })
  )
  .map(([guaranteed, rest]) =>
    [guaranteed, ...rest].map((score, i) => scoredChunk(`ref-${i}`, score))
  );

const httpMethodArb: fc.Arbitrary<HttpMethod> = fc.constantFrom(
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS'
);

const authTypeArb: fc.Arbitrary<AuthScheme> = fc.constantFrom(
  'oauth2',
  'jwt',
  'apiKey',
  'bearer',
  'basic',
  'clientCredentials',
  'pkce'
);

/** A single endpoint with unique, clean parameter names. */
const endpointArb: fc.Arbitrary<EndpointMeta> = fc
  .record({
    method: httpMethodArb,
    path: alnumArb(6),
    params: fc.array(
      fc.record({
        name: alnumArb(6),
        location: fc.constantFrom(
          'path' as const,
          'query' as const,
          'header' as const
        ),
        required: fc.boolean(),
      }),
      { minLength: 0, maxLength: 5 }
    ),
  })
  .map((e) => {
    const path = `/${e.path}/{id}`;
    // De-duplicate parameter names so a required name appears predictably.
    const seen = new Set<string>();
    const parameters = e.params
      .filter((p) => {
        if (seen.has(p.name)) return false;
        seen.add(p.name);
        return true;
      })
      .map((p) => ({ ...p, schema: {} }));
    return {
      endpointId: `${e.method} ${path}`,
      path,
      method: e.method,
      parameters,
      responseSchemas: {},
      responseExamples: {},
      errorCodes: [],
      authSchemeRefs: [],
    };
  });

/** A non-empty set of authentication schemes with unique ids. */
const authSchemesArb: fc.Arbitrary<AuthSchemeMeta[]> = fc
  .array(fc.record({ id: alnumArb(6), type: authTypeArb }), {
    minLength: 1,
    maxLength: 5,
  })
  .map((schemes) =>
    schemes.map((s, i) => ({ id: `auth${i}_${s.id}`, type: s.type, details: {} }))
  );

function metadataWith(overrides: Partial<ApiMetadata>): ApiMetadata {
  return {
    apiId: SELECTION.apiId,
    title: 'API',
    sourceFormat: 'openapi-3',
    endpoints: [],
    authSchemes: [],
    rateLimits: [],
    ...overrides,
  };
}

async function repoWith(metadata: ApiMetadata): Promise<InMemoryApiVersionRepository> {
  const repo = new InMemoryApiVersionRepository();
  await repo.save({
    apiId: metadata.apiId,
    workspaceId: SELECTION.workspaceId,
    version: SELECTION.version,
    metadata,
    createdAt: new Date('2024-01-01T00:00:00Z'),
  });
  return repo;
}

// ─── Property 13 ──────────────────────────────────────────────────────────────

describe('Query Engine — Q&A (RAG) properties', () => {
  // Feature: api-copilot-ai, Property 13: Answers are grounded or refused — when
  // retrieval returns no chunk at or above the relevance threshold the engine
  // returns the "not available" response and generates no ungrounded content;
  // otherwise the answer references only retrieved chunks.
  // Validates: Requirements 4.1, 4.5
  it('Property 13: answers are refused when nothing is retrievable, else reference only retrieved chunks', async () => {
    await fc.assert(
      fc.asyncProperty(scoredListArb, questionArb, async (scored, question) => {
        let llmCalls = 0;
        const llmProvider: LlmProvider = {
          async generateGrounded(q, ctx) {
            llmCalls += 1;
            return new FakeLlmProvider().generateGrounded(q, ctx);
          },
        };
        const engine = new QueryEngine({
          vectorStore: new StubVectorStore(scored),
          embeddingProvider: new FakeEmbeddingProvider(),
          apiVersionRepository: new InMemoryApiVersionRepository(),
          llmProvider,
        });

        const answer = await engine.ask({
          question,
          selection: SELECTION,
          requester: REQUESTER,
        });

        const qualifying = scored.filter((s) => s.score >= MIN_RELEVANCE_SCORE);

        if (qualifying.length === 0) {
          // Refusal: no ungrounded content and the LLM is never invoked.
          expect(answer.grounded).toBe(false);
          expect(answer.text).toBe(NOT_AVAILABLE_MESSAGE);
          expect(answer.citations).toEqual([]);
          expect(llmCalls).toBe(0);
        } else {
          // Grounded: every citation corresponds to a retrieved chunk.
          expect(answer.grounded).toBe(true);
          expect(answer.citations.length).toBeGreaterThan(0);
          const retrievedRefs = new Set(scored.map((s) => s.chunk.sourceRef));
          for (const citation of answer.citations) {
            expect(retrievedRefs.has(citation)).toBe(true);
          }
          expect(llmCalls).toBe(1);
        }
      })
    );
  });

  // ─── Property 14 ──────────────────────────────────────────────────────────

  // Feature: api-copilot-ai, Property 14: Endpoint answers include path, method,
  // and required parameters — for any answer that references a specific
  // endpoint, the answer text contains that endpoint's path, HTTP method, and
  // every required parameter defined for it in the metadata.
  // Validates: Requirements 4.2
  it('Property 14: an endpoint answer contains the path, method, and every required parameter', async () => {
    await fc.assert(
      fc.asyncProperty(endpointArb, questionArb, async (endpoint, question) => {
        const metadata = metadataWith({ endpoints: [endpoint] });
        const repo = await repoWith(metadata);
        const store = new StubVectorStore([scoredChunk(endpoint.endpointId, 0.95)]);
        const engine = new QueryEngine({
          vectorStore: store,
          embeddingProvider: new FakeEmbeddingProvider(),
          apiVersionRepository: repo,
        });

        const answer = await engine.ask({
          question,
          selection: SELECTION,
          requester: REQUESTER,
        });

        expect(answer.grounded).toBe(true);
        expect(answer.text).toContain(endpoint.path);
        expect(answer.text).toContain(endpoint.method);
        for (const param of endpoint.parameters.filter((p) => p.required)) {
          expect(answer.text).toContain(param.name);
        }
      })
    );
  });

  // ─── Property 15 ──────────────────────────────────────────────────────────

  // Feature: api-copilot-ai, Property 15: Authentication answers enumerate every
  // scheme — for any selected API and a question about authentication, the answer
  // names each authentication scheme defined in the metadata.
  // Validates: Requirements 4.3
  it('Property 15: an authentication answer enumerates every scheme defined in the metadata', async () => {
    await fc.assert(
      fc.asyncProperty(authSchemesArb, async (schemes) => {
        const metadata = metadataWith({ authSchemes: schemes });
        const repo = await repoWith(metadata);
        // A single retrieved doc chunk ensures retrieval is non-empty (not a refusal).
        const store = new StubVectorStore([scoredChunk('doc:overview', 0.95)]);
        const engine = new QueryEngine({
          vectorStore: store,
          embeddingProvider: new FakeEmbeddingProvider(),
          apiVersionRepository: repo,
        });

        const answer = await engine.ask({
          question: 'How do I authenticate with this API?',
          selection: SELECTION,
          requester: REQUESTER,
        });

        expect(answer.grounded).toBe(true);
        for (const scheme of schemes) {
          expect(answer.citations).toContain(`auth:${scheme.id}`);
          expect(answer.text).toContain(scheme.id);
        }
      })
    );
  });

  // ─── Property 16 ──────────────────────────────────────────────────────────

  // Feature: api-copilot-ai, Property 16: Grounded answers cite their sources —
  // for any grounded answer, the citation set is non-empty and every citation
  // corresponds to a chunk that was retrieved for that question.
  // Validates: Requirements 4.6
  it('Property 16: a grounded answer has a non-empty citation set drawn from retrieved chunks', async () => {
    await fc.assert(
      fc.asyncProperty(groundedScoredListArb, questionArb, async (scored, question) => {
        const engine = new QueryEngine({
          vectorStore: new StubVectorStore(scored),
          embeddingProvider: new FakeEmbeddingProvider(),
          apiVersionRepository: new InMemoryApiVersionRepository(),
        });

        const answer = await engine.ask({
          question,
          selection: SELECTION,
          requester: REQUESTER,
        });

        expect(answer.grounded).toBe(true);
        expect(answer.citations.length).toBeGreaterThan(0);
        const retrievedRefs = new Set(scored.map((s) => s.chunk.sourceRef));
        for (const citation of answer.citations) {
          expect(retrievedRefs.has(citation)).toBe(true);
        }
      })
    );
  });

  // ─── Property 17 ──────────────────────────────────────────────────────────

  // Feature: api-copilot-ai, Property 17: Questions require a selected API — for
  // any question submitted when no API is selected, the request is rejected with
  // a selection-required error and no answer is generated.
  // Validates: Requirements 4.7
  it('Property 17: a question with no selected API is rejected and generates no answer', async () => {
    await fc.assert(
      fc.asyncProperty(questionArb, async (question) => {
        let quotaReservations = 0;
        let llmCalls = 0;
        const engine = new QueryEngine({
          vectorStore: new StubVectorStore([scoredChunk('ref-0', 0.95)]),
          embeddingProvider: new FakeEmbeddingProvider(),
          apiVersionRepository: new InMemoryApiVersionRepository(),
          quotaReserver: {
            async checkAndReserveQuery() {
              quotaReservations += 1;
              return { allowed: true };
            },
          },
          llmProvider: {
            async generateGrounded() {
              llmCalls += 1;
              return { text: 'x', citations: [] };
            },
          },
        });

        await expect(
          engine.ask({ question, selection: null, requester: REQUESTER })
        ).rejects.toBeInstanceOf(NoApiSelectedError);

        // No answer generated: no quota reserved and no LLM call.
        expect(quotaReservations).toBe(0);
        expect(llmCalls).toBe(0);
      })
    );
  });

  // ─── Property 18 ──────────────────────────────────────────────────────────

  // Feature: api-copilot-ai, Property 18: Generation failure preserves selection
  // for retry — for any question whose answer generation fails, an error is
  // returned, no answer is fabricated, and the selected API state is preserved
  // for retry.
  // Validates: Requirements 4.9, 19.4
  it('Property 18: a generation failure returns an error preserving the question and selection', async () => {
    const selectionArb: fc.Arbitrary<ApiSelection> = fc.record({
      workspaceId: alnumArb(8),
      apiId: alnumArb(8),
      version: fc.integer({ min: 1, max: 25 }),
    });

    await fc.assert(
      fc.asyncProperty(selectionArb, questionArb, async (selection, question) => {
        const failingLlm: LlmProvider = {
          async generateGrounded(): Promise<never> {
            throw new Error('model crashed');
          },
        };
        const engine = new QueryEngine({
          vectorStore: new StubVectorStore([scoredChunk('ref-0', 0.95)]),
          embeddingProvider: new FakeEmbeddingProvider(),
          apiVersionRepository: new InMemoryApiVersionRepository(),
          llmProvider: failingLlm,
        });

        let caught: unknown;
        let returned: unknown;
        try {
          returned = await engine.ask({ question, selection, requester: REQUESTER });
        } catch (error) {
          caught = error;
        }

        // No answer was fabricated.
        expect(returned).toBeUndefined();
        // An error is returned that preserves the question and selection for retry.
        expect(caught).toBeInstanceOf(AnswerGenerationError);
        const err = caught as AnswerGenerationError;
        expect(err.kind).toBe('dependency');
        expect(err.question).toBe(question);
        expect(err.selection).toEqual(selection);
      })
    );
  });
});
