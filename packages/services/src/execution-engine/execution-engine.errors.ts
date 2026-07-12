/**
 * Execution Engine — Errors
 *
 * - `MissingParametersError` (Req 5.2): raised at planning time when one or more
 *   required parameter or authentication values are absent. Carries the full
 *   list of missing values so callers can prompt for each, and guarantees no
 *   request was sent.
 * - `ExecutionTimeoutError` (Req 5.6) and `NetworkFailureError` (Req 5.7): raised
 *   at execution time and classified distinctly. Both retain the entered
 *   parameter and authentication values (via the originating plan, whose
 *   `request` never contains credential material) so the caller can re-edit and
 *   retry.
 *
 * Validates: Requirements 5.2, 5.6, 5.7
 */

import type { ExecutionPlan, RequiredValueRef } from './execution-engine.types';

/** Discriminator for the transient-failure classification (Req 5.6, 5.7). */
export type ExecutionFailureKind = 'timeout' | 'network';

/**
 * Raised when required parameter or authentication values are missing when
 * execution is requested. The request is NOT sent (Req 5.2). `missing` lists
 * every absent value so the caller can prompt for each.
 */
export class MissingParametersError extends Error {
  public readonly endpointId: string;
  public readonly missing: RequiredValueRef[];

  constructor(endpointId: string, missing: RequiredValueRef[]) {
    const summary = missing
      .map((m) => `${m.location}:${m.name}`)
      .join(', ');
    super(
      `Cannot execute endpoint "${endpointId}": ${missing.length} required ` +
        `value(s) are missing and must be supplied before sending — ${summary}.`
    );
    this.name = 'MissingParametersError';
    this.endpointId = endpointId;
    this.missing = missing;
  }
}

/**
 * Base class for transient execution failures that occur after a request is
 * attempted. Retains the originating plan so the entered parameters and
 * authentication configuration are preserved for re-editing (Req 5.6, 5.7).
 * The retained `plan.request` carries no injected credential material.
 */
export class ExecutionFailureError extends Error {
  public readonly kind: ExecutionFailureKind;
  public readonly endpointId: string;
  /** The plan whose entered values are retained for retry. */
  public readonly plan: ExecutionPlan;

  constructor(
    kind: ExecutionFailureKind,
    plan: ExecutionPlan,
    message: string
  ) {
    super(message);
    this.name = 'ExecutionFailureError';
    this.kind = kind;
    this.endpointId = plan.endpointId;
    this.plan = plan;
  }
}

/**
 * Req 5.6: the target API did not respond within the 30-second cap. The request
 * is cancelled and the entered values are retained.
 */
export class ExecutionTimeoutError extends ExecutionFailureError {
  constructor(plan: ExecutionPlan, timeoutMs: number) {
    super(
      'timeout',
      plan,
      `Execution of endpoint "${plan.endpointId}" timed out after ${timeoutMs} ms; ` +
        `the request was cancelled and the entered values were retained.`
    );
    this.name = 'ExecutionTimeoutError';
  }
}

/**
 * Req 5.7: the request could not complete due to a network connection failure.
 * The failure is classified as a network condition and the entered values are
 * retained.
 */
export class NetworkFailureError extends ExecutionFailureError {
  constructor(plan: ExecutionPlan) {
    super(
      'network',
      plan,
      `Execution of endpoint "${plan.endpointId}" failed due to a network ` +
        `connection error; the entered values were retained.`
    );
    this.name = 'NetworkFailureError';
  }
}

/** Raised when the selected API version cannot be found in storage. */
export class ApiVersionUnavailableError extends Error {
  public readonly apiId: string;
  public readonly version: number;

  constructor(apiId: string, version: number) {
    super(`API version not found: apiId "${apiId}", version ${version}.`);
    this.name = 'ApiVersionUnavailableError';
    this.apiId = apiId;
    this.version = version;
  }
}

/** Raised when the requested endpoint has no definition in the metadata. */
export class EndpointNotFoundError extends Error {
  public readonly endpointId: string;

  constructor(endpointId: string) {
    super(`Endpoint definition not found: "${endpointId}".`);
    this.name = 'EndpointNotFoundError';
    this.endpointId = endpointId;
  }
}
