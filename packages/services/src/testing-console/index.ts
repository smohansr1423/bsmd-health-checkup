/**
 * Interactive API Testing Console (`testing-console`) — barrel export.
 *
 * Wraps the Execution Engine to run requests, display the sent request and
 * received response (or a classified transient failure), save every completed
 * run to a per-workspace history ring buffer capped at 500 entries, and replay
 * a saved request using its saved parameters and authentication — refusing to
 * send when the saved authentication is missing, invalid, or expired.
 *
 * Validates: Requirements 8.1, 8.2, 8.3, 8.4, 8.5
 */

export { TestingConsole, DEFAULT_CONSOLE_TIMEOUT_MS } from './testing-console.service';

export {
  SavedAuthInvalidError,
  HistoryEntryNotFoundError,
} from './testing-console.errors';
export type { SavedAuthProblem } from './testing-console.errors';

export {
  toSnapshot,
  buildFailureResult,
  classifySavedAuthProblem,
} from './testing-console.validators';
export type { SavedAuthClassification } from './testing-console.validators';

export type {
  ExecutionEnginePort,
  ConsoleRunRequest,
  ConsoleRunStatus,
  ConsoleFailure,
  ConsoleRunOutcome,
  TestingConsoleDependencies,
} from './testing-console.types';
