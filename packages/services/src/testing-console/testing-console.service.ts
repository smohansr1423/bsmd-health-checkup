/**
 * Interactive API Testing Console — Service
 *
 * Wraps the Execution Engine to run requests, display results, save request
 * history, and replay saved requests.
 *
 * Business rules:
 * - `run` plans and sends a request via the Execution Engine seam. On success
 *   within the 30-second cap it returns the sent request (method, URL, headers,
 *   body) and the received response (status, headers, body, elapsed ms)
 *   (Req 8.1). On a timeout or network failure it stops, classifies the failure
 *   type, and preserves the original request parameters for re-editing
 *   (Req 8.2).
 * - Every completed run — whether it received a response or failed transiently —
 *   is saved to the workspace's history, a per-workspace ring buffer capped at
 *   500 entries that evicts the oldest beyond the cap (Req 8.3).
 * - `replay` re-sends a saved request using its saved parameters and
 *   authentication (Req 8.4). If the saved authentication is missing, invalid,
 *   or expired, the request is NOT sent; a {@link SavedAuthInvalidError}
 *   describes the authentication problem while the saved history entry is
 *   retained unchanged (Req 8.5).
 *
 * The Execution Engine is consumed through the injectable
 * {@link ExecutionEnginePort} seam, so this service never imports the concrete
 * engine class and stays unit- and property-testable with a fake.
 *
 * Validates: Requirements 8.1, 8.2, 8.3, 8.4, 8.5
 */

import {
  InMemoryHistoryRepository,
  defaultDateProvider,
  defaultIdGenerator,
} from '../api-copilot-shared';
import type {
  DateProvider,
  ExecutionResult,
  HistoryEntry,
  HistoryRepository,
  IdGenerator,
} from '../api-copilot-shared';
import {
  ExecutionEngine,
  ExecutionTimeoutError,
  NetworkFailureError,
} from '../execution-engine';
import type { ExecutionPlan } from '../execution-engine';
import {
  DEFAULT_CONSOLE_TIMEOUT_MS,
  type ConsoleFailure,
  type ConsoleRunOutcome,
  type ConsoleRunRequest,
  type ExecutionEnginePort,
  type TestingConsoleDependencies,
} from './testing-console.types';
import {
  HistoryEntryNotFoundError,
  SavedAuthInvalidError,
} from './testing-console.errors';
import {
  buildFailureResult,
  classifySavedAuthProblem,
  toSnapshot,
} from './testing-console.validators';

export { DEFAULT_CONSOLE_TIMEOUT_MS };

export class TestingConsole {
  private readonly idGenerator: IdGenerator;
  private readonly dateProvider: DateProvider;
  private readonly executionEngine: ExecutionEnginePort;
  private readonly historyRepository: HistoryRepository;
  private readonly timeoutMs: number;

  /**
   * Replay context keyed by `${workspaceId}::${historyId}`. Retains the
   * ready-to-send plan (whose request carries no credential material) so a
   * replay re-resolves saved authentication through the Execution Engine
   * (Req 8.4, 8.5).
   */
  private readonly replayPlans: Map<string, ExecutionPlan> = new Map();

  constructor(deps: Partial<TestingConsoleDependencies> = {}) {
    this.idGenerator = deps.idGenerator ?? defaultIdGenerator;
    this.dateProvider = deps.dateProvider ?? defaultDateProvider;
    this.executionEngine = deps.executionEngine ?? new ExecutionEngine();
    this.historyRepository =
      deps.historyRepository ?? new InMemoryHistoryRepository();
    this.timeoutMs = deps.timeoutMs ?? DEFAULT_CONSOLE_TIMEOUT_MS;
  }

  /**
   * Run a request from the console (Req 8.1, 8.2, 8.3).
   *
   * Plans the request via the Execution Engine (missing required values surface
   * as the engine's `MissingParametersError` and no request is sent), sends it,
   * and returns the sent request plus the received response. A timeout or
   * network failure is classified and the original request is preserved for
   * re-editing. Every completed run is saved to the workspace history.
   */
  async run(request: ConsoleRunRequest): Promise<ConsoleRunOutcome> {
    const workspaceId = request.apiSelection.workspaceId;
    // May throw MissingParametersError / version / endpoint errors before any
    // request is sent (Req 8 relies on the Execution Engine's Req 5.2 guard).
    const plan = await this.executionEngine.planExecution(request);
    return this.executeAndRecord(plan, workspaceId, request);
  }

  /**
   * Replay a saved request using its saved parameters and authentication
   * (Req 8.4). If the saved authentication is missing, invalid, or expired the
   * request is not sent and a {@link SavedAuthInvalidError} is thrown while the
   * saved history entry is retained unchanged (Req 8.5).
   *
   * @throws HistoryEntryNotFoundError when no entry matches the id.
   * @throws SavedAuthInvalidError when saved auth cannot be used.
   */
  async replay(
    workspaceId: string,
    historyId: string
  ): Promise<ConsoleRunOutcome> {
    const saved = await this.historyRepository.findById(workspaceId, historyId);
    if (saved === null) {
      throw new HistoryEntryNotFoundError(workspaceId, historyId);
    }

    const plan = this.resolveReplayPlan(workspaceId, historyId, saved);

    try {
      // Re-resolves saved authentication via the Execution Engine before
      // sending; transient failures are classified and recorded within.
      return await this.executeAndRecord(plan, workspaceId);
    } catch (error) {
      // Any non-transient failure from execute is an authentication problem
      // (the plan is fully resolved, so send-time transient failures are
      // already handled). Do not send / re-save; retain the saved request.
      const { problem, reasonPhrase } = classifySavedAuthProblem(error);
      throw new SavedAuthInvalidError(
        workspaceId,
        historyId,
        problem,
        saved.request,
        reasonPhrase
      );
    }
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  /**
   * Execute a plan, classify a transient failure, save the completed run to
   * history, and return the outcome. Non-transient failures (e.g., auth) are
   * rethrown for the caller to handle.
   */
  private async executeAndRecord(
    plan: ExecutionPlan,
    workspaceId: string,
    preservedRequest?: ConsoleRunRequest
  ): Promise<ConsoleRunOutcome> {
    const startedAt = this.dateProvider().getTime();

    let result: ExecutionResult;
    let failure: ConsoleFailure | undefined;
    try {
      result = await this.executionEngine.execute(plan);
    } catch (error) {
      if (error instanceof ExecutionTimeoutError) {
        failure = {
          kind: 'timeout',
          message: `Request timed out after ${this.timeoutMs} ms without a response.`,
        };
      } else if (error instanceof NetworkFailureError) {
        failure = {
          kind: 'network',
          message: 'Request failed due to a network connection error.',
        };
      } else {
        // Non-transient (e.g., authentication) failure — the caller decides.
        throw error;
      }
      const elapsedMs = this.dateProvider().getTime() - startedAt;
      result = buildFailureResult(failure, elapsedMs);
    }

    const entry = await this.saveHistory(workspaceId, plan, result);

    return {
      status: failure === undefined ? 'completed' : result.outcome === 'timeout' ? 'timeout' : 'network_error',
      workspaceId,
      historyId: entry.historyId,
      request: entry.request,
      result,
      failure,
      preservedRequest: failure !== undefined ? preservedRequest : undefined,
    };
  }

  /** Save a completed run to the workspace history ring buffer (Req 8.3). */
  private async saveHistory(
    workspaceId: string,
    plan: ExecutionPlan,
    result: ExecutionResult
  ): Promise<HistoryEntry> {
    const entry: HistoryEntry = {
      historyId: this.idGenerator(),
      workspaceId,
      request: toSnapshot(plan.request),
      result,
      createdAt: this.dateProvider(),
    };
    await this.historyRepository.append(entry);
    // Retain the plan so this entry can itself be replayed with saved auth.
    this.replayPlans.set(this.replayKey(workspaceId, entry.historyId), plan);
    return entry;
  }

  /**
   * Resolve the ready-to-send plan for a saved entry. Uses the retained plan
   * when available; otherwise reconstructs a no-auth plan from the saved
   * request snapshot so a credential-free request can still be replayed.
   */
  private resolveReplayPlan(
    workspaceId: string,
    historyId: string,
    saved: HistoryEntry
  ): ExecutionPlan {
    const retained = this.replayPlans.get(this.replayKey(workspaceId, historyId));
    if (retained !== undefined) {
      return retained;
    }
    return {
      apiSelection: { workspaceId, apiId: '', version: 0 },
      endpointId: '',
      target: { targetApiRef: '' },
      request: {
        method: saved.request.method,
        url: saved.request.url,
        headers: { ...saved.request.headers },
        body: saved.request.body,
      },
      requiresAuth: false,
      requiredValues: [],
    };
  }

  private replayKey(workspaceId: string, historyId: string): string {
    return `${workspaceId}::${historyId}`;
  }
}
