/**
 * Interactive API Testing Console — Property-Based Tests
 *
 * Uses fast-check to validate the universal correctness properties from the
 * design document (Properties 31–33). These property tests complement the
 * example-based unit tests in `testing-console.service.test.ts`: they exercise
 * the same public API (`TestingConsole.run` / `TestingConsole.replay`) across a
 * broad, generated input space, using the real 500-cap
 * `InMemoryHistoryRepository` ring buffer and a programmable fake Execution
 * Engine seam.
 *
 * Global fast-check iteration count is configured in
 * `jest.setup.fast-check.ts` (numRuns=25); no inline overrides are used.
 *
 * Feature: api-copilot-ai
 * Validates: Requirements 8.3, 8.4, 8.5
 */

import * as fc from 'fast-check';

import {
  InMemoryHistoryRepository,
  MAX_HISTORY_ENTRIES,
} from '../api-copilot-shared';
import type {
  DateProvider,
  ExecutionResult,
  IdGenerator,
} from '../api-copilot-shared';
import type {
  ExecutionPlan,
  PlanExecutionRequest,
} from '../execution-engine';
import { TestingConsole } from './testing-console.service';
import type { ExecutionEnginePort } from './testing-console.types';
import { SavedAuthInvalidError } from './testing-console.errors';

// ─── Constants ───────────────────────────────────────────────────────────────

const WORKSPACE_ID = 'ws-prop';
const API_ID = 'api-prop';
const VERSION = 1;
const BASE_URL = 'https://api.example.com/v1';
const SELECTION = { workspaceId: WORKSPACE_ID, apiId: API_ID, version: VERSION };

// ─── Deterministic dependencies ───────────────────────────────────────────────

/** Deterministic, monotonically increasing history-id generator. */
function makeIdGenerator(): IdGenerator {
  let counter = 0;
  return () => {
    counter += 1;
    return `h_${counter}`;
  };
}

/** Deterministic, fixed clock. Ordering in the repo is by insertion order. */
function makeDateProvider(): DateProvider {
  return () => new Date('2024-01-01T00:00:00.000Z');
}

// ─── Fake Execution Engine seam ────────────────────────────────────────────────

/** What the fake engine's `execute` should do for the next call(s). */
type ExecuteBehavior = ExecutionResult | (() => Promise<ExecutionResult>);

const SUCCESS_RESULT: ExecutionResult = {
  statusCode: 200,
  headers: { 'content-type': 'application/json' },
  body: '{}',
  elapsedMs: 5,
  outcome: 'success',
};

/**
 * Programmable fake Execution Engine. `planExecution` builds a deterministic
 * plan whose outbound request (method/url/headers/body) is derived from the
 * run request, so history ordering and replay reproduction can be asserted.
 * `execute` returns the currently-registered behavior and records every plan it
 * was asked to send; `completedSends` counts only calls that returned a
 * response (i.e., an actual send), so a throwing auth failure counts as no send.
 */
class FakeExecutionEngine implements ExecutionEnginePort {
  public planCalls: PlanExecutionRequest[] = [];
  public executeCalls: ExecutionPlan[] = [];
  /** Number of `execute` calls that returned a response (an actual send). */
  public completedSends = 0;
  private behavior: ExecuteBehavior = SUCCESS_RESULT;

  setExecuteBehavior(behavior: ExecuteBehavior): void {
    this.behavior = behavior;
  }

  async planExecution(request: PlanExecutionRequest): Promise<ExecutionPlan> {
    this.planCalls.push(request);
    const method = request.provided.header?.method
      ? String(request.provided.header.method)
      : 'GET';
    // endpointId is unique per run in these tests, so the url is unique too.
    const url = `${BASE_URL}${request.endpointId.replace(/^\S+\s/, '')}`;
    const headers: Record<string, string> = { 'x-endpoint': request.endpointId };
    const body =
      request.provided.body !== undefined
        ? JSON.stringify(request.provided.body)
        : undefined;
    return {
      apiSelection: request.apiSelection,
      endpointId: request.endpointId,
      target: {
        targetApiRef: request.targetApiRef ?? request.apiSelection.apiId,
      },
      request: { method: method as ExecutionPlan['request']['method'], url, headers, body },
      requiresAuth: request.provided.authConfigured === true,
      requiredValues: [],
    };
  }

  async execute(plan: ExecutionPlan): Promise<ExecutionResult> {
    this.executeCalls.push(plan);
    const result =
      typeof this.behavior === 'function'
        ? await this.behavior()
        : this.behavior;
    this.completedSends += 1;
    return result;
  }
}

/** Build a run request; endpointId is the primary knob for a unique request. */
function runRequest(
  endpointId: string,
  overrides: Partial<PlanExecutionRequest> = {}
): PlanExecutionRequest {
  return {
    apiSelection: SELECTION,
    endpointId,
    baseUrl: BASE_URL,
    provided: {},
    ...overrides,
  };
}

/** Fresh console wired to the real 500-cap ring buffer and a fake engine. */
function makeConsole(): {
  console: TestingConsole;
  engine: FakeExecutionEngine;
  history: InMemoryHistoryRepository;
} {
  const engine = new FakeExecutionEngine();
  const history = new InMemoryHistoryRepository(); // default cap === 500
  const console = new TestingConsole({
    idGenerator: makeIdGenerator(),
    dateProvider: makeDateProvider(),
    executionEngine: engine,
    historyRepository: history,
  });
  return { console, engine, history };
}

// ─── Property 31: History is a bounded most-recent ring buffer ──────────────────
// Feature: api-copilot-ai, Property 31: For any sequence of n completed runs in a
// Workspace, the saved history contains min(n, 500) entries and, when n > 500,
// exactly the 500 most recent runs with the oldest evicted.
// Validates: Requirements 8.3

describe('Property 31: History is a bounded most-recent ring buffer', () => {
  it('retains all runs (most-recent-first) while n is within the 500 cap', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 120 }),
        async (n) => {
          const { console, history } = makeConsole();

          for (let i = 0; i < n; i += 1) {
            await console.run(runRequest(`GET /r${i}`));
          }

          const saved = await history.list(WORKSPACE_ID);
          // n <= cap, so min(n, 500) === n and nothing is evicted.
          expect(saved).toHaveLength(Math.min(n, MAX_HISTORY_ENTRIES));
          expect(saved).toHaveLength(n);
          // Most-recent-first: index n-1 down to 0.
          const expectedUrls = Array.from(
            { length: n },
            (_, i) => `${BASE_URL}/r${n - 1 - i}`
          );
          expect(saved.map((e) => e.request.url)).toEqual(expectedUrls);
        }
      )
    );
  });

  it('caps at exactly 500 most-recent runs and evicts the oldest when n > 500', async () => {
    await fc.assert(
      fc.asyncProperty(
        // n strictly greater than the 500 cap.
        fc.integer({ min: 1, max: 60 }),
        async (extra) => {
          const n = MAX_HISTORY_ENTRIES + extra;
          const { console, history } = makeConsole();

          for (let i = 0; i < n; i += 1) {
            await console.run(runRequest(`GET /r${i}`));
          }

          const saved = await history.list(WORKSPACE_ID);
          // min(n, 500) === 500 entries retained.
          expect(saved).toHaveLength(MAX_HISTORY_ENTRIES);
          // Exactly the 500 most recent runs (indices n-500 .. n-1),
          // most-recent-first, with the oldest `extra` runs evicted.
          const expectedUrls = Array.from(
            { length: MAX_HISTORY_ENTRIES },
            (_, i) => `${BASE_URL}/r${n - 1 - i}`
          );
          expect(saved.map((e) => e.request.url)).toEqual(expectedUrls);
          // The evicted oldest run must be absent.
          expect(saved.some((e) => e.request.url === `${BASE_URL}/r0`)).toBe(
            false
          );
        }
      )
    );
  });
});

// ─── Property 32: Replay reproduces the saved request ───────────────────────────
// Feature: api-copilot-ai, Property 32: For any saved history entry with valid
// authentication, replaying it issues an outbound request equal to the saved
// request's parameters and authentication.
// Validates: Requirements 8.4

describe('Property 32: Replay reproduces the saved request', () => {
  it('re-issues an outbound request equal to the saved request', async () => {
    const requestArb = fc.record({
      endpointId: fc
        .string({ minLength: 1, maxLength: 12 })
        .map((s) => `GET /${encodeURIComponent(s)}`),
      method: fc.constantFrom('GET', 'POST', 'PUT', 'DELETE', 'PATCH'),
      authConfigured: fc.boolean(),
      hasBody: fc.boolean(),
      bodyValue: fc.string({ maxLength: 8 }),
    });

    await fc.assert(
      fc.asyncProperty(requestArb, async (spec) => {
        const { console, engine, history } = makeConsole();

        const provided: PlanExecutionRequest['provided'] = {
          authConfigured: spec.authConfigured,
          header: { method: spec.method },
        };
        if (spec.hasBody) {
          provided.body = { payload: spec.bodyValue };
        }

        // Valid authentication → execute succeeds for both run and replay.
        engine.setExecuteBehavior(SUCCESS_RESULT);

        const first = await console.run(
          runRequest(spec.endpointId, { provided })
        );
        const sendsAfterRun = engine.completedSends;
        const planSentOnRun = engine.executeCalls[engine.executeCalls.length - 1];

        const replayed = await console.replay(WORKSPACE_ID, first.historyId);

        // Replay completed and issued exactly one additional send.
        expect(replayed.status).toBe('completed');
        expect(engine.completedSends).toBe(sendsAfterRun + 1);

        // The replayed outcome's request equals the originally saved request.
        expect(replayed.request).toEqual(first.request);

        // The outbound request the engine was asked to send on replay equals
        // the one sent on the original run (same parameters + resolved auth).
        const planSentOnReplay =
          engine.executeCalls[engine.executeCalls.length - 1];
        expect(planSentOnReplay.request).toEqual(planSentOnRun.request);
        expect(planSentOnReplay.target).toEqual(planSentOnRun.target);
        expect(planSentOnReplay.requiresAuth).toBe(planSentOnRun.requiresAuth);

        // The saved history entry still reproduces the same request.
        const savedEntry = await history.findById(
          WORKSPACE_ID,
          first.historyId
        );
        expect(savedEntry?.request).toEqual(first.request);
      })
    );
  });
});

// ─── Property 33: Replay with unusable auth does not send ────────────────────────
// Feature: api-copilot-ai, Property 33: For any saved request whose
// authentication is missing, invalid, or expired, replay sends no request,
// returns an authentication error, and leaves the saved request unchanged.
// Validates: Requirements 8.5

describe('Property 33: Replay with unusable auth does not send', () => {
  it('returns an auth error, sends nothing new, and retains the saved request unchanged', async () => {
    // Each variant is an error the Execution Engine raises while resolving saved
    // authentication, paired with the saved-auth problem it must classify to.
    const authFailureArb = fc.constantFrom(
      { make: () => Object.assign(new Error('none'), { name: 'CredentialNotFoundError' }), problem: 'missing' },
      { make: () => Object.assign(new Error('exp'), { name: 'NoRefreshMechanismError', reason: 'no_refresh_mechanism' }), problem: 'expired' },
      { make: () => Object.assign(new Error('exp'), { name: 'RefreshFailedError', reason: 'refresh_failed' }), problem: 'expired' },
      { make: () => Object.assign(new Error('inv'), { name: 'InvalidCredentialsError', reason: 'invalid_credentials' }), problem: 'invalid' },
      { make: () => Object.assign(new Error('scheme'), { name: 'UnsupportedSchemeError', reason: 'unsupported_scheme' }), problem: 'invalid' },
      { make: () => Object.assign(new Error('to'), { name: 'AuthTimeoutError', reason: 'timeout' }), problem: 'invalid' }
    );

    await fc.assert(
      fc.asyncProperty(
        fc
          .string({ minLength: 1, maxLength: 12 })
          .map((s) => `GET /${encodeURIComponent(s)}`),
        authFailureArb,
        async (endpointId, variant) => {
          const { console, engine, history } = makeConsole();

          // Original run succeeds (auth configured) and is saved to history.
          const first = await console.run(
            runRequest(endpointId, { provided: { authConfigured: true } })
          );
          const sendsAfterRun = engine.completedSends;
          const historyAfterRun = (await history.list(WORKSPACE_ID)).length;
          const savedBefore = await history.findById(
            WORKSPACE_ID,
            first.historyId
          );

          // On replay, auth resolution fails (missing/invalid/expired).
          engine.setExecuteBehavior(async () => {
            throw variant.make();
          });

          let caught: unknown;
          try {
            await console.replay(WORKSPACE_ID, first.historyId);
          } catch (err) {
            caught = err;
          }

          // Returns an authentication error classified from the failure.
          expect(caught).toBeInstanceOf(SavedAuthInvalidError);
          const error = caught as SavedAuthInvalidError;
          expect(error.problem).toBe(variant.problem);
          expect(error.workspaceId).toBe(WORKSPACE_ID);
          expect(error.historyId).toBe(first.historyId);

          // Sends no request: no send completed and no new history entry saved.
          expect(engine.completedSends).toBe(sendsAfterRun);
          expect(await history.list(WORKSPACE_ID)).toHaveLength(
            historyAfterRun
          );

          // Leaves the saved request unchanged.
          expect(error.savedRequest).toEqual(first.request);
          const savedAfter = await history.findById(
            WORKSPACE_ID,
            first.historyId
          );
          expect(savedAfter).toEqual(savedBefore);
          expect(savedAfter?.request).toEqual(first.request);
        }
      )
    );
  });
});
