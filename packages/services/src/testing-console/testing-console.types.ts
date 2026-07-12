/**
 * Interactive API Testing Console — Types
 *
 * Request shapes, the Execution Engine seam, and the dependency-injection
 * contract for the Testing Console (`run` and `replay`).
 *
 * The Testing Console wraps the Execution Engine: it runs a request, displays
 * the sent request and received response (or a classified failure), saves every
 * completed run to a per-workspace history ring buffer capped at 500 entries,
 * and replays a saved request using its saved parameters and authentication.
 *
 * The Execution Engine is consumed through the injectable {@link ExecutionEnginePort}
 * seam so this domain never imports the concrete engine class and stays unit-
 * and property-testable with a fake.
 *
 * Validates: Requirements 8.1, 8.2, 8.3, 8.4, 8.5
 */

import type {
  BaseServiceDependencies,
  ExecutionResult,
  HistoryEntry,
  HistoryRepository,
  OutboundRequestSnapshot,
} from '../api-copilot-shared';
import type {
  ExecutionPlan,
  PlanExecutionRequest,
} from '../execution-engine';

/**
 * Default hard cap for a single console request, mirroring the Execution
 * Engine's 30-second timeout (Req 8.1, 8.2).
 */
export const DEFAULT_CONSOLE_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// Execution Engine seam
// ---------------------------------------------------------------------------

/**
 * Injectable seam over the Execution Engine. The concrete
 * `executionEngine.ExecutionEngine` satisfies this interface structurally via
 * its `planExecution` and `execute` methods. Depending on the interface keeps
 * the Testing Console testable with a fake and avoids a hard cross-domain
 * import of the engine implementation.
 */
export interface ExecutionEnginePort {
  /** Resolve the endpoint, compute required values, and build a ready plan. */
  planExecution(request: PlanExecutionRequest): Promise<ExecutionPlan>;
  /** Send the planned request and return the response (Req 8.1). */
  execute(plan: ExecutionPlan): Promise<ExecutionResult>;
}

// ---------------------------------------------------------------------------
// Run / replay request + outcome shapes
// ---------------------------------------------------------------------------

/**
 * A request to run from the console. It carries exactly the information the
 * Execution Engine needs to plan and send a request; the owning workspace is
 * taken from `apiSelection.workspaceId`.
 */
export type ConsoleRunRequest = PlanExecutionRequest;

/** How a completed console run classifies (drives display — Req 8.1, 8.2). */
export type ConsoleRunStatus = 'completed' | 'timeout' | 'network_error';

/** Classification of a transient failure preserved for display (Req 8.2). */
export interface ConsoleFailure {
  /** `timeout` (Req 8.2 / 5.6) or `network` (Req 8.2 / 5.7). */
  kind: 'timeout' | 'network';
  /** Human-readable description of the failure type. */
  message: string;
}

/**
 * The outcome of a `run` or `replay`. Always carries the request that was sent
 * (method, URL, headers, body — Req 8.1) and the saved history entry id. On
 * success `result` holds the received response; on a transient failure `result`
 * carries the classified failure outcome and `failure` describes its type while
 * the original request is preserved for re-editing (Req 8.2).
 */
export interface ConsoleRunOutcome {
  status: ConsoleRunStatus;
  workspaceId: string;
  /** Id of the history entry saved for this run (Req 8.3). */
  historyId: string;
  /** The request that was sent (Req 8.1). */
  request: OutboundRequestSnapshot;
  /** The response received or the classified failure result. */
  result: ExecutionResult;
  /** Present on a transient failure — describes the failure type (Req 8.2). */
  failure?: ConsoleFailure;
  /**
   * The original run request, preserved so the user can re-edit and retry after
   * a transient failure (Req 8.2). Present only for a failed `run`.
   */
  preservedRequest?: ConsoleRunRequest;
}

// ---------------------------------------------------------------------------
// Dependency injection — extends the shared base (idGenerator, dateProvider)
// ---------------------------------------------------------------------------

/**
 * Dependencies for the Testing Console. Supplied as a
 * `Partial<TestingConsoleDependencies>`; anything omitted falls back to an
 * in-memory / default implementation.
 */
export interface TestingConsoleDependencies extends BaseServiceDependencies {
  /** The Execution Engine seam used to plan and send requests (Req 8.1). */
  executionEngine: ExecutionEnginePort;
  /** Per-workspace history ring buffer capped at 500 entries (Req 8.3). */
  historyRepository: HistoryRepository;
  /** Hard cap for a single console request; defaults to 30 000 ms (Req 8.1). */
  timeoutMs: number;
}

export type { HistoryEntry, OutboundRequestSnapshot, ExecutionResult };
