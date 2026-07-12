/**
 * Execution Engine — Types
 *
 * Types for planning and sending authenticated calls to a target API on behalf
 * of the user (Req 5). The Execution Engine determines the required
 * path/query/body/authentication values from the normalized API metadata,
 * prompts for any missing values without sending, then sends the request via
 * the injected {@link HttpClient} (30 s timeout) using authentication material
 * obtained from the Auth Assistant.
 *
 * Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7
 */

import type {
  ApiSelection,
  ApiVersionRepository,
  AuthMaterial,
  BaseServiceDependencies,
  HttpClient,
  OutboundRequest,
} from '../api-copilot-shared';

/** Default hard cap for a single outbound request: 30 seconds (Req 5.6). */
export const DEFAULT_EXECUTION_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// Target + auth seam
// ---------------------------------------------------------------------------

/**
 * A reference to the target API whose credentials/tokens back an execution.
 * Structurally matches the Auth Assistant's `TargetApiRef` so the Execution
 * Engine can depend on the Auth Assistant through the {@link AuthMaterialPort}
 * seam without importing the auth-assistant module directly.
 */
export interface ExecutionTargetRef {
  targetApiRef: string;
}

/**
 * Injectable seam over the Auth Assistant. The real
 * `apiCopilotAuthAssistant.AuthAssistant` satisfies this interface via its
 * `ensureToken` method (Req 6.2). Depending on the interface (rather than the
 * concrete class) keeps the Execution Engine unit- and property-testable with
 * a fake and avoids a hard cross-domain import.
 */
export interface AuthMaterialPort {
  /** Obtain valid authentication material for the target API before sending. */
  ensureToken(target: ExecutionTargetRef): Promise<AuthMaterial>;
}

// ---------------------------------------------------------------------------
// Provided values + required-value tracking
// ---------------------------------------------------------------------------

/**
 * Values supplied by the user for an execution. Path/query/header values are
 * stringifiable scalars; body is a structured JSON value. `authConfigured`
 * indicates the caller has configured authentication material for the target
 * (a registered credential the Auth Assistant can resolve).
 */
export interface ParamValues {
  path?: Record<string, string | number | boolean>;
  query?: Record<string, string | number | boolean>;
  header?: Record<string, string | number | boolean>;
  cookie?: Record<string, string | number | boolean>;
  body?: Record<string, unknown>;
  /** True when authentication material has been configured for the target. */
  authConfigured?: boolean;
}

/** The distinct locations a required value can occupy. */
export type RequiredValueLocation =
  | 'path'
  | 'query'
  | 'header'
  | 'cookie'
  | 'body'
  | 'authentication';

/** A single value the Execution Engine requires before it will send a request. */
export interface RequiredValueRef {
  location: RequiredValueLocation;
  name: string;
}

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------

/**
 * Input to {@link ExecutionEngine.planExecution}. Conveys the same information
 * as the design's illustrative
 * `planExecution(apiSel, endpointId, provided)` signature, adding the target
 * server `baseUrl` (absent from the format-agnostic metadata model) and an
 * optional explicit `targetApiRef` (defaults to the selection's `apiId`).
 */
export interface PlanExecutionRequest {
  apiSelection: ApiSelection;
  endpointId: string;
  /** Target server base URL the endpoint path is appended to. */
  baseUrl: string;
  /** User-supplied path/query/header/body values and auth configuration. */
  provided: ParamValues;
  /** Target credential reference for auth; defaults to `apiSelection.apiId`. */
  targetApiRef?: string;
}

/**
 * A fully-resolved, ready-to-send plan produced when every required value is
 * present. `request` is the built outbound request *without* authentication
 * material; auth headers are merged in only at {@link ExecutionEngine.execute}
 * time so no credential value is ever stored on the plan.
 */
export interface ExecutionPlan {
  apiSelection: ApiSelection;
  endpointId: string;
  target: ExecutionTargetRef;
  request: OutboundRequest;
  /** Whether the endpoint's metadata declares an authentication requirement. */
  requiresAuth: boolean;
  /** The complete set of values this endpoint required (path/query/body/auth). */
  requiredValues: RequiredValueRef[];
}

// ---------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------

/**
 * Dependencies injected into the Execution Engine. All side-effecting
 * collaborators are injected so planning and execution stay testable with fakes
 * and in-memory stores.
 */
export interface ExecutionEngineDependencies extends BaseServiceDependencies {
  /** Source of stored `ApiVersion` metadata used to resolve required values. */
  apiVersionRepository: ApiVersionRepository;
  /** Outbound HTTP client used to send the request (Req 5.3, 5.6). */
  httpClient: HttpClient;
  /** Auth Assistant seam supplying authentication material (Req 6.2). */
  authProvider: AuthMaterialPort;
  /** Hard cap for a single outbound request (Req 5.6). Defaults to 30 000 ms. */
  timeoutMs: number;
}
