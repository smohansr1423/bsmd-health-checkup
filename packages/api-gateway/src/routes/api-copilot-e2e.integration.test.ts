/**
 * API Copilot AI — End-to-End Integration Test (with fakes)
 *
 * Exercises the full cross-domain flow through the real gateway app backed by
 * the composition root's in-memory repositories and fake providers:
 *
 *   upload → index → ask → execute → conversation history → analytics dashboard
 *
 * Every step drives the actual gateway HTTP surface except indexing, which has
 * no HTTP route (it is an internal pipeline step); indexing is driven through
 * the registry's `indexingService`, keeping the flow a genuine cross-domain
 * chain that shares one vector store, one API-version store, one conversation
 * store, and one usage-event store.
 *
 * Validates: Requirements 1.7, 3.1, 4.1, 5.3, 15.1, 16.1
 */

import { apiCopilotShared, queryEngine } from '@health-checkup/services';

import {
  buildTestGateway,
  startServer,
  httpRequest,
  WIDGET_OPENAPI_SPEC,
  TEST_TOKEN,
  TEST_USER_ID,
  type RunningServer,
} from './api-copilot-integration.harness';
import { clearRateLimitStore, stopRateLimitCleanup } from '../middleware';
import type { ServiceRegistry } from '../service-registry';

describe('API Copilot AI — end-to-end flow through the gateway (integration)', () => {
  let running: RunningServer;
  let services: ServiceRegistry;
  let port: number;

  beforeAll(async () => {
    const gateway = buildTestGateway();
    services = gateway.services;
    running = await startServer(gateway.app);
    port = running.port;
  });

  afterAll(async () => {
    await running.close();
    stopRateLimitCleanup();
  });

  beforeEach(() => {
    clearRateLimitStore();
  });

  it('runs upload → index → ask → execute → history → analytics with fakes', async () => {
    // --- Seed an account so the plan-quota API-count gate can resolve its tier
    // during upload. The account repository is shared with plan-quota. ---
    const account = await services.accountAuthService.signUp({
      email: 'e2e@example.com',
      password: 'password123',
    });
    const accountId = account.accountId;

    // --- Create a workspace (HTTP) owned by the seeded account (Req 14.1). ---
    const createWs = await httpRequest(port, 'POST', '/api/copilot/workspaces', {
      token: TEST_TOKEN,
      accountId,
      body: { name: 'E2E Workspace' },
    });
    expect(createWs.status).toBe(201);
    const workspaceId = createWs.body.data.workspaceId as string;
    expect(workspaceId).toBeTruthy();

    // --- 1. Upload a specification; it is parsed and stored as version 1
    //        associated with the workspace (Req 1.7). ---
    const upload = await httpRequest(
      port,
      'POST',
      '/api/copilot/knowledge-engine/uploads',
      {
        token: TEST_TOKEN,
        accountId,
        body: {
          workspaceId,
          spec: WIDGET_OPENAPI_SPEC,
          contentType: 'yaml',
        },
      }
    );
    expect(upload.status).toBe(201);
    const version = upload.body.data as apiCopilotShared.ApiVersion;
    expect(version.workspaceId).toBe(workspaceId);
    expect(version.version).toBe(1);
    expect(version.metadata.title).toBe('Widget API');
    const endpoint = version.metadata.endpoints[0];
    expect(endpoint.endpointId).toBe('GET /widgets');

    const apiId = version.apiId;
    const selection = { workspaceId, apiId, version: version.version };

    // --- 2. Index the stored version into the shared vector store (Req 3.1).
    //        Indexing has no HTTP route, so it is driven through the registry
    //        service that shares the vector store with the query engine. ---
    const indexResult = await services.indexingService.index(
      version as unknown as apiCopilotShared.ApiVersion
    );
    expect(indexResult.chunkCount).toBeGreaterThan(0);
    expect(indexResult.apiId).toBe(apiId);

    // Reproduce the API-overview chunk deterministically so the semantic query
    // matches indexed content (the fake embedder is deterministic, so identical
    // text yields an exact-match hit above the 0.7 relevance threshold).
    const chunks = queryEngine.chunkApiMetadata(version.metadata);
    const overviewChunk = chunks[0];
    expect(overviewChunk.sourceRef).toBe(`api:${apiId}`);

    // --- 3. Ask a question grounded in the indexed content (Req 4.1). ---
    const ask = await httpRequest(
      port,
      'POST',
      '/api/copilot/query-engine/questions',
      {
        token: TEST_TOKEN,
        accountId,
        body: { question: overviewChunk.text, selection },
      }
    );
    expect(ask.status).toBe(200);
    const answer = ask.body.data as apiCopilotShared.Answer;
    expect(answer.grounded).toBe(true);
    expect(answer.citations.length).toBeGreaterThan(0);
    expect(answer.citations).toContain(overviewChunk.sourceRef);

    // --- 4. Plan and execute a call to the target API (Req 5.3). The endpoint
    //        is unauthenticated; the fake HTTP client returns a 404 for the
    //        unregistered target, which the engine passes through unmodified,
    //        demonstrating status/body fidelity. ---
    const plan = await httpRequest(
      port,
      'POST',
      '/api/copilot/execution-engine/plan',
      {
        token: TEST_TOKEN,
        accountId,
        body: {
          apiSelection: selection,
          endpointId: endpoint.endpointId,
          baseUrl: 'https://widgets.example.com',
          provided: {},
        },
      }
    );
    expect(plan.status).toBe(200);
    expect(plan.body.data.requiresAuth).toBe(false);
    expect(plan.body.data.request.method).toBe('GET');

    const execute = await httpRequest(
      port,
      'POST',
      '/api/copilot/execution-engine/execute',
      { token: TEST_TOKEN, accountId, body: { plan: plan.body.data } }
    );
    expect(execute.status).toBe(200);
    const result = execute.body.data as apiCopilotShared.ExecutionResult;
    // The target response's status and body are returned (Req 5.3), passed
    // through unmodified from the fake client.
    expect(typeof result.statusCode).toBe('number');
    expect(result.statusCode).toBe(404);
    expect(result.outcome).toBe('error');
    expect(result).toHaveProperty('headers');
    expect(result).toHaveProperty('body');

    // --- 5. Conversation history captured the Q&A during `ask` (Req 15.1). ---
    const history = await httpRequest(
      port,
      'GET',
      `/api/copilot/conversations/${workspaceId}`,
      { token: TEST_TOKEN, accountId }
    );
    expect(history.status).toBe(200);
    const entries = history.body.data as apiCopilotShared.ConversationEntry[];
    expect(entries.length).toBeGreaterThanOrEqual(1);
    expect(entries[0].question).toBe(overviewChunk.text);
    expect(entries[0].userId).toBe(TEST_USER_ID);
    expect(entries[0].answer.grounded).toBe(true);

    // --- 6. Analytics dashboard reflects the ai_query usage event emitted by
    //        `ask` (Req 16.1). ---
    const dashboard = await httpRequest(
      port,
      'GET',
      `/api/copilot/usage-analytics/${workspaceId}/dashboard`,
      { token: TEST_TOKEN, accountId }
    );
    expect(dashboard.status).toBe(200);
    const view = dashboard.body.data;
    expect(view.workspaceId).toBe(workspaceId);
    expect(view.totalEvents).toBeGreaterThanOrEqual(1);
    expect(view.counts.ai_query).toBeGreaterThanOrEqual(1);
    expect(view.empty).toBe(false);
  });
});
