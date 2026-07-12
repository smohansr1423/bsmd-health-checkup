/**
 * Interactive API Testing Console — Unit tests
 *
 * Covers run success display and history save (Req 8.1, 8.3), transient
 * failure classification with parameter preservation (Req 8.2), the bounded
 * per-workspace ring buffer (Req 8.3), replay reproduction of the saved request
 * (Req 8.4), and replay refusal with unusable saved authentication (Req 8.5).
 *
 * Validates: Requirements 8.1, 8.2, 8.3, 8.4, 8.5
 */

import {
  InMemoryHistoryRepository,
  MAX_HISTORY_ENTRIES,
} from '../api-copilot-shared';
import type { ExecutionResult } from '../api-copilot-shared';
import {
  ExecutionTimeoutError,
  NetworkFailureError,
} from '../execution-engine';
import type {
  ExecutionPlan,
  PlanExecutionRequest,
} from '../execution-engine';
import { TestingConsole } from './testing-console.service';
import type { ExecutionEnginePort } from './testing-console.types';
import {
  HistoryEntryNotFoundError,
  SavedAuthInvalidError,
} from './testing-console.errors';

const WORKSPACE_ID = 'ws-1';
const API_ID = 'api-1';
const VERSION = 1;
const BASE_URL = 'https://api.example.com/v1';

const selection = { workspaceId: WORKSPACE_ID, apiId: API_ID, version: VERSION };

/** Behavior a test wants the fake engine's execute() to exhibit for a plan. */
type ExecuteBehavior = ExecutionResult | (() => Promise<ExecutionResult>);

/**
 * Fake Execution Engine seam. `planExecution` builds a deterministic plan from
 * the request; `execute` returns a queued/registered behavior (result or throw)
 * so success, timeout, network, and auth-failure paths are exercised without
 * real I/O.
 */
class FakeExecutionEngine implements ExecutionEnginePort {
  public planCalls: PlanExecutionRequest[] = [];
  public executeCalls: ExecutionPlan[] = [];
  private behavior: ExecuteBehavior = {
    statusCode: 200,
    headers: { 'content-type': 'application/json' },
    body: '{}',
    elapsedMs: 5,
    outcome: 'success',
  };

  setExecuteBehavior(behavior: ExecuteBehavior): void {
    this.behavior = behavior;
  }

  async planExecution(request: PlanExecutionRequest): Promise<ExecutionPlan> {
    this.planCalls.push(request);
    const method = 'GET';
    const url = `${BASE_URL}${request.endpointId.replace(/^\S+\s/, '')}`;
    const requiresAuth = request.provided.authConfigured === true;
    return {
      apiSelection: request.apiSelection,
      endpointId: request.endpointId,
      target: { targetApiRef: request.targetApiRef ?? request.apiSelection.apiId },
      request: { method, url, headers: { 'x-test': '1' } },
      requiresAuth,
      requiredValues: [],
    };
  }

  async execute(plan: ExecutionPlan): Promise<ExecutionResult> {
    this.executeCalls.push(plan);
    return typeof this.behavior === 'function' ? this.behavior() : this.behavior;
  }
}

function runRequest(
  overrides: Partial<PlanExecutionRequest> = {}
): PlanExecutionRequest {
  return {
    apiSelection: selection,
    endpointId: 'GET /users',
    baseUrl: BASE_URL,
    provided: {},
    ...overrides,
  };
}

describe('TestingConsole.run', () => {
  it('returns the sent request and received response and saves history (Req 8.1, 8.3)', async () => {
    const engine = new FakeExecutionEngine();
    const response: ExecutionResult = {
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: '{\n  "ok": true\n}',
      elapsedMs: 12,
      outcome: 'success',
    };
    engine.setExecuteBehavior(response);
    const history = new InMemoryHistoryRepository();
    const console = new TestingConsole({ executionEngine: engine, historyRepository: history });

    const outcome = await console.run(runRequest());

    expect(outcome.status).toBe('completed');
    expect(outcome.request).toEqual({
      method: 'GET',
      url: `${BASE_URL}/users`,
      headers: { 'x-test': '1' },
      body: undefined,
    });
    expect(outcome.result).toEqual(response);
    expect(outcome.failure).toBeUndefined();

    const saved = await history.list(WORKSPACE_ID);
    expect(saved).toHaveLength(1);
    expect(saved[0].historyId).toBe(outcome.historyId);
    expect(saved[0].result.statusCode).toBe(200);
  });

  it('saves failed runs and classifies a timeout, preserving the request (Req 8.2, 8.3)', async () => {
    const engine = new FakeExecutionEngine();
    const history = new InMemoryHistoryRepository();
    const console = new TestingConsole({ executionEngine: engine, historyRepository: history });
    const request = runRequest();

    engine.setExecuteBehavior(async () => {
      const plan = engine.executeCalls[engine.executeCalls.length - 1];
      throw new ExecutionTimeoutError(plan, 30_000);
    });

    const outcome = await console.run(request);

    expect(outcome.status).toBe('timeout');
    expect(outcome.failure).toEqual({
      kind: 'timeout',
      message: expect.stringContaining('timed out'),
    });
    expect(outcome.result.outcome).toBe('timeout');
    expect(outcome.result.statusCode).toBe(0);
    // Original request preserved for re-editing (Req 8.2).
    expect(outcome.preservedRequest).toEqual(request);

    const saved = await history.list(WORKSPACE_ID);
    expect(saved).toHaveLength(1);
    expect(saved[0].result.outcome).toBe('timeout');
  });

  it('classifies a network failure and preserves the request (Req 8.2)', async () => {
    const engine = new FakeExecutionEngine();
    const console = new TestingConsole({ executionEngine: engine });
    const request = runRequest();

    engine.setExecuteBehavior(async () => {
      const plan = engine.executeCalls[engine.executeCalls.length - 1];
      throw new NetworkFailureError(plan);
    });

    const outcome = await console.run(request);

    expect(outcome.status).toBe('network_error');
    expect(outcome.failure?.kind).toBe('network');
    expect(outcome.result.outcome).toBe('network_error');
    expect(outcome.preservedRequest).toEqual(request);
  });

  it('keeps history bounded to the cap, evicting the oldest (Req 8.3)', async () => {
    const engine = new FakeExecutionEngine();
    const history = new InMemoryHistoryRepository(3);
    const console = new TestingConsole({
      executionEngine: engine,
      historyRepository: history,
    });

    for (let i = 0; i < 5; i += 1) {
      await console.run(runRequest({ endpointId: `GET /r${i}` }));
    }

    const saved = await history.list(WORKSPACE_ID);
    expect(saved).toHaveLength(3);
    // Most-recent-first; the two oldest were evicted.
    expect(saved.map((e) => e.request.url)).toEqual([
      `${BASE_URL}/r4`,
      `${BASE_URL}/r3`,
      `${BASE_URL}/r2`,
    ]);
  });

  it('does not save history when required values are missing (no request sent)', async () => {
    const engine = new FakeExecutionEngine();
    const history = new InMemoryHistoryRepository();
    const console = new TestingConsole({ executionEngine: engine, historyRepository: history });
    jest.spyOn(engine, 'planExecution').mockRejectedValue(
      Object.assign(new Error('missing'), { name: 'MissingParametersError' })
    );

    await expect(console.run(runRequest())).rejects.toMatchObject({
      name: 'MissingParametersError',
    });
    expect(engine.executeCalls).toHaveLength(0);
    expect(await history.list(WORKSPACE_ID)).toHaveLength(0);
  });

  it('defaults the history cap to 500 (Req 8.3)', () => {
    expect(MAX_HISTORY_ENTRIES).toBe(500);
  });
});

describe('TestingConsole.replay', () => {
  it('replays the saved request using the saved plan (Req 8.4)', async () => {
    const engine = new FakeExecutionEngine();
    const history = new InMemoryHistoryRepository();
    const console = new TestingConsole({ executionEngine: engine, historyRepository: history });

    const first = await console.run(runRequest({ endpointId: 'GET /users' }));
    const replayed = await console.replay(WORKSPACE_ID, first.historyId);

    expect(replayed.status).toBe('completed');
    // The exact saved request was re-sent.
    expect(replayed.request).toEqual(first.request);
    // execute was called for both the run and the replay with the same plan.
    expect(engine.executeCalls).toHaveLength(2);
    expect(engine.executeCalls[1].request.url).toBe(first.request.url);
    // The replay is itself saved to history (Req 8.3).
    expect(await history.list(WORKSPACE_ID)).toHaveLength(2);
  });

  it('throws HistoryEntryNotFoundError for an unknown entry', async () => {
    const engine = new FakeExecutionEngine();
    const console = new TestingConsole({ executionEngine: engine });
    await expect(console.replay(WORKSPACE_ID, 'nope')).rejects.toBeInstanceOf(
      HistoryEntryNotFoundError
    );
  });

  it('refuses to send when saved auth is missing/invalid/expired and retains the entry (Req 8.5)', async () => {
    const engine = new FakeExecutionEngine();
    const history = new InMemoryHistoryRepository();
    const console = new TestingConsole({ executionEngine: engine, historyRepository: history });

    const first = await console.run(runRequest({ provided: { authConfigured: true } }));
    expect(engine.executeCalls).toHaveLength(1);

    // On replay, the Execution Engine's auth resolution fails (expired token).
    engine.setExecuteBehavior(async () => {
      throw Object.assign(new Error('expired'), {
        name: 'NoRefreshMechanismError',
        reason: 'no_refresh_mechanism',
      });
    });

    let caught: unknown;
    try {
      await console.replay(WORKSPACE_ID, first.historyId);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(SavedAuthInvalidError);
    const error = caught as SavedAuthInvalidError;
    expect(error.problem).toBe('expired');
    expect(error.savedRequest).toEqual(first.request);
    // The error is composed only from non-secret identifiers + a fixed reason.
    expect(error.message).toContain(first.historyId);
    expect(error.message).toContain('expired');
    // The saved history entry is retained unchanged; no new entry was saved.
    expect(await history.list(WORKSPACE_ID)).toHaveLength(1);
  });

  it('classifies a missing credential as a "missing" saved-auth problem (Req 8.5)', async () => {
    const engine = new FakeExecutionEngine();
    const console = new TestingConsole({ executionEngine: engine });

    const first = await console.run(runRequest({ provided: { authConfigured: true } }));
    engine.setExecuteBehavior(async () => {
      throw Object.assign(new Error('none'), { name: 'CredentialNotFoundError' });
    });

    await expect(console.replay(WORKSPACE_ID, first.historyId)).rejects.toMatchObject({
      name: 'SavedAuthInvalidError',
      problem: 'missing',
    });
  });
});
