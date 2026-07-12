/**
 * Query Engine — Natural-language Q&A (RAG) unit tests
 *
 * Covers RAG-grounded answering: question-length validation (Req 4.8), the
 * no-API-selected rejection (Req 4.7), quota reservation (Req 17.4), grounding
 * vs refusal (Req 4.1, 4.5), citations (Req 4.6), endpoint answer content
 * (Req 4.2), auth-scheme enumeration (Req 4.3), conversation recording with
 * failure tolerance (Req 15.1, 15.2), the ai_query usage event (Req 16.1),
 * progress indication (Req 19.3), and generation-failure/timeout preservation
 * (Req 4.9, 19.4).
 *
 * Validates: Requirements 4.1, 4.2, 4.3, 4.5, 4.6, 4.7, 4.8, 4.9, 19.3, 19.4
 */

import {
  FakeEmbeddingProvider,
  InMemoryApiVersionRepository,
  InMemoryProductEventBus,
  InMemoryVectorStore,
} from '../api-copilot-shared';
import type {
  ApiMetadata,
  ApiSelection,
  ApiVersion,
  LlmProvider,
  RetrievedChunk,
  UsageEvent,
  UserRef,
} from '../api-copilot-shared';
import { IndexingService, QueryEngine } from './query-engine.service';
import {
  AnswerGenerationError,
  InvalidQuestionLengthError,
  NoApiSelectedError,
} from './query-engine.errors';
import {
  NOT_AVAILABLE_MESSAGE,
  QUESTION_MAX_LENGTH,
  type ConversationRecorder,
  type QuotaReserver,
} from './query-engine.types';

const SELECTION: ApiSelection = {
  workspaceId: 'ws-1',
  apiId: 'api-1',
  version: 1,
};
const REQUESTER: UserRef = { userId: 'user-1', accountId: 'acct-1' };

function metadata(overrides: Partial<ApiMetadata> = {}): ApiMetadata {
  return {
    apiId: SELECTION.apiId,
    title: 'Orders API',
    sourceFormat: 'openapi-3',
    endpoints: [
      {
        endpointId: 'GET /orders/{id}',
        path: '/orders/{id}',
        method: 'GET',
        parameters: [
          { name: 'id', location: 'path', required: true, schema: {} },
          { name: 'apiVersion', location: 'query', required: true, schema: {} },
          { name: 'expand', location: 'query', required: false, schema: {} },
        ],
        responseSchemas: { '200': {} },
        responseExamples: {},
        errorCodes: ['404'],
        authSchemeRefs: ['bearerAuth'],
      },
    ],
    authSchemes: [
      { id: 'bearerAuth', type: 'bearer', details: {} },
      { id: 'apiKeyAuth', type: 'apiKey', details: {} },
      { id: 'oauthAuth', type: 'oauth2', details: {} },
    ],
    rateLimits: [{ id: 'default', limit: 100, windowSeconds: 60 }],
    ...overrides,
  };
}

function apiVersion(meta: ApiMetadata = metadata()): ApiVersion {
  return {
    apiId: meta.apiId,
    workspaceId: SELECTION.workspaceId,
    version: SELECTION.version,
    metadata: meta,
    createdAt: new Date('2024-01-01T00:00:00Z'),
  };
}

/**
 * Build a fully-wired QueryEngine sharing one vector store + embedding provider
 * between indexing and querying, plus a populated version repository.
 */
async function buildEngine(
  deps: {
    meta?: ApiMetadata;
    llmProvider?: LlmProvider;
    quotaReserver?: QuotaReserver;
    conversationRecorder?: ConversationRecorder;
    productEventBus?: InMemoryProductEventBus;
    dateProvider?: () => Date;
  } = {}
): Promise<QueryEngine> {
  const meta = deps.meta ?? metadata();
  const vectorStore = new InMemoryVectorStore();
  const embeddingProvider = new FakeEmbeddingProvider();
  const apiVersionRepository = new InMemoryApiVersionRepository();
  await apiVersionRepository.save(apiVersion(meta));

  // Index the metadata so semantic search can retrieve grounding chunks.
  await new IndexingService({ vectorStore, embeddingProvider }).index(
    apiVersion(meta)
  );

  return new QueryEngine({
    vectorStore,
    embeddingProvider,
    apiVersionRepository,
    llmProvider: deps.llmProvider,
    quotaReserver: deps.quotaReserver,
    conversationRecorder: deps.conversationRecorder,
    productEventBus: deps.productEventBus,
    dateProvider: deps.dateProvider,
  });
}

describe('QueryEngine.ask — validation', () => {
  it('rejects an empty question with a length error and generates no answer (Req 4.8)', async () => {
    const engine = await buildEngine();
    await expect(
      engine.ask({ question: '', selection: SELECTION, requester: REQUESTER })
    ).rejects.toBeInstanceOf(InvalidQuestionLengthError);
  });

  it('rejects a question longer than 1000 characters (Req 4.8)', async () => {
    const engine = await buildEngine();
    await expect(
      engine.ask({
        question: 'a'.repeat(QUESTION_MAX_LENGTH + 1),
        selection: SELECTION,
        requester: REQUESTER,
      })
    ).rejects.toBeInstanceOf(InvalidQuestionLengthError);
  });

  it('rejects a question when no API is selected (Req 4.7)', async () => {
    const engine = await buildEngine();
    await expect(
      engine.ask({ question: 'How do I list orders?', selection: null, requester: REQUESTER })
    ).rejects.toBeInstanceOf(NoApiSelectedError);
  });

  it('does not reserve quota when validation fails (Req 4.7, 4.8)', async () => {
    let reserved = 0;
    const quotaReserver: QuotaReserver = {
      async checkAndReserveQuery() {
        reserved += 1;
        return { allowed: true };
      },
    };
    const engine = await buildEngine({ quotaReserver });

    await expect(
      engine.ask({ question: '', selection: SELECTION, requester: REQUESTER })
    ).rejects.toBeInstanceOf(InvalidQuestionLengthError);
    await expect(
      engine.ask({ question: 'hi', selection: null, requester: REQUESTER })
    ).rejects.toBeInstanceOf(NoApiSelectedError);

    expect(reserved).toBe(0);
  });
});

describe('QueryEngine.ask — grounding and refusal', () => {
  it('refuses without fabricating when nothing is retrievable (Req 4.5)', async () => {
    // Empty vector store => no hits => refusal. LLM must never be called.
    const llmProvider: LlmProvider = {
      async generateGrounded() {
        throw new Error('LLM should not be invoked on refusal');
      },
    };
    const engine = new QueryEngine({
      vectorStore: new InMemoryVectorStore(),
      embeddingProvider: new FakeEmbeddingProvider(),
      apiVersionRepository: new InMemoryApiVersionRepository(),
      llmProvider,
    });

    const answer = await engine.ask({
      question: 'What is the meaning of everything?',
      selection: SELECTION,
      requester: REQUESTER,
    });

    expect(answer.grounded).toBe(false);
    expect(answer.text).toBe(NOT_AVAILABLE_MESSAGE);
    expect(answer.citations).toEqual([]);
  });

  it('produces a grounded answer that cites every retrieved source (Req 4.1, 4.6)', async () => {
    const engine = await buildEngine();

    const answer = await engine.ask({
      question: 'orders',
      selection: SELECTION,
      requester: REQUESTER,
    });

    expect(answer.grounded).toBe(true);
    expect(answer.citations.length).toBeGreaterThan(0);
    // Citations correspond to indexed source refs for the selected API.
    expect(answer.citations).toContain('GET /orders/{id}');
  });

  it('includes endpoint path, method, and every required parameter (Req 4.2)', async () => {
    const engine = await buildEngine();

    const answer = await engine.ask({
      question: 'orders',
      selection: SELECTION,
      requester: REQUESTER,
    });

    expect(answer.text).toContain('/orders/{id}');
    expect(answer.text).toContain('GET');
    // Every required parameter for the endpoint appears.
    expect(answer.text).toContain('id');
    expect(answer.text).toContain('apiVersion');
  });

  it('enumerates every authentication scheme for an auth question (Req 4.3)', async () => {
    const engine = await buildEngine();

    const answer = await engine.ask({
      question: 'How do I authenticate with this API?',
      selection: SELECTION,
      requester: REQUESTER,
    });

    expect(answer.grounded).toBe(true);
    // All three schemes from the metadata are cited/enumerated.
    expect(answer.citations).toContain('auth:bearerAuth');
    expect(answer.citations).toContain('auth:apiKeyAuth');
    expect(answer.citations).toContain('auth:oauthAuth');
  });
});

describe('QueryEngine.ask — quota, recording, and usage events', () => {
  it('propagates a quota rejection and generates no answer (Req 17.4)', async () => {
    const quotaReserver: QuotaReserver = {
      async checkAndReserveQuery() {
        throw new Error('quota exceeded');
      },
    };
    const engine = await buildEngine({ quotaReserver });

    await expect(
      engine.ask({ question: 'orders', selection: SELECTION, requester: REQUESTER })
    ).rejects.toThrow('quota exceeded');
  });

  it('records the Q&A with the submitting user and workspace (Req 15.1)', async () => {
    const recorded: Array<{ workspaceId: string; userId: string; question: string }> = [];
    const conversationRecorder: ConversationRecorder = {
      async record(entry) {
        recorded.push({
          workspaceId: entry.workspaceId,
          userId: entry.userId,
          question: entry.question,
        });
        return undefined;
      },
    };
    const engine = await buildEngine({ conversationRecorder });

    await engine.ask({ question: 'orders', selection: SELECTION, requester: REQUESTER });

    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toEqual({
      workspaceId: SELECTION.workspaceId,
      userId: REQUESTER.userId,
      question: 'orders',
    });
  });

  it('still returns the answer when recording fails (Req 15.2)', async () => {
    const conversationRecorder: ConversationRecorder = {
      async record() {
        throw new Error('conversation store unavailable');
      },
    };
    const engine = await buildEngine({ conversationRecorder });

    const answer = await engine.ask({
      question: 'orders',
      selection: SELECTION,
      requester: REQUESTER,
    });

    expect(answer.grounded).toBe(true);
    expect(answer.text).toContain('/orders/{id}');
  });

  it('emits an ai_query usage event tagged with workspace and timestamp (Req 16.1)', async () => {
    const productEventBus = new InMemoryProductEventBus();
    const events: UsageEvent[] = [];
    productEventBus.subscribeUsage((event) => {
      events.push(event);
    });
    const fixedNow = new Date('2024-02-02T12:00:00Z');
    const engine = await buildEngine({
      productEventBus,
      dateProvider: () => fixedNow,
    });

    await engine.ask({ question: 'orders', selection: SELECTION, requester: REQUESTER });

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('ai_query');
    expect(events[0].workspaceId).toBe(SELECTION.workspaceId);
    expect(events[0].timestamp).toEqual(fixedNow);
  });
});

describe('QueryEngine.ask — progress and failure handling', () => {
  it('invokes the progress callback while a slow answer is still generating (Req 19.3)', async () => {
    jest.useFakeTimers();
    try {
      // Resolves once retrieval has completed and the LLM has been entered, so
      // the test only advances timers after the pending generation is in flight.
      let signalLlmEntered: () => void = () => undefined;
      const llmEntered = new Promise<void>((res) => {
        signalLlmEntered = res;
      });
      let resolveLlm: () => void = () => undefined;
      const slowLlm: LlmProvider = {
        generateGrounded(_question: string, context: RetrievedChunk[]) {
          return new Promise((resolve) => {
            resolveLlm = () =>
              resolve({ text: 'slow', citations: context.map((c) => c.sourceRef) });
            signalLlmEntered();
          });
        },
      };
      const engine = await buildEngine({ llmProvider: slowLlm });
      const onProgress = jest.fn();

      const promise = engine.ask({
        question: 'orders',
        selection: SELECTION,
        requester: REQUESTER,
        onProgress,
      });

      // Wait until retrieval finished and generation is genuinely pending.
      await llmEntered;
      // Before the threshold: no progress indication yet.
      expect(onProgress).not.toHaveBeenCalled();

      // Cross the 3s progress threshold.
      jest.advanceTimersByTime(3000);
      expect(onProgress).toHaveBeenCalledTimes(1);

      // Complete generation and settle.
      resolveLlm();
      await promise;
    } finally {
      jest.useRealTimers();
    }
  });

  it('wraps an LLM failure as AnswerGenerationError preserving the selection (Req 4.9)', async () => {
    const failingLlm: LlmProvider = {
      async generateGrounded() {
        throw new Error('model crashed');
      },
    };
    const engine = await buildEngine({ llmProvider: failingLlm });

    let caught: unknown;
    try {
      await engine.ask({ question: 'orders', selection: SELECTION, requester: REQUESTER });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(AnswerGenerationError);
    const err = caught as AnswerGenerationError;
    expect(err.kind).toBe('dependency');
    expect(err.selection).toEqual(SELECTION);
    expect(err.question).toBe('orders');
  });
});
