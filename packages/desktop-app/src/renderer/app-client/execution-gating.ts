/**
 * Execution-plan gating logic (Task 12.1).
 *
 * A **pure** module — no I/O, no React, no Electron — that implements the
 * client side of Req 11.2:
 *
 *   > WHEN the Backend_Gateway reports that one or more required values are
 *   > missing, THE Desktop_App SHALL prompt the User to supply each reported
 *   > missing value and SHALL NOT send an execute request until the User
 *   > provides the reported values.
 *
 * After a plan request (see {@link executionEngine.plan}) the backend returns an
 * {@link executionEngineTypes.ExecutionPlan} that reports the complete set of
 * `requiredValues` (path / query / header / cookie / body / authentication) for
 * the endpoint. This module compares those reported requirements against the
 * values the User has supplied so far and either:
 *
 *  - surfaces the still-missing values as a {@link ValuesRequired} indication
 *    and produces **no** execute `RequestDescriptor` (the caller prompts for
 *    each missing value), or
 *  - once every reported value is supplied, produces the execute descriptor by
 *    delegating to {@link executionEngine.execute}.
 *
 * The missing-value detection mirrors the backend's own `findMissingValues`
 * contract (`packages/services/src/execution-engine/execution-engine.validators.ts`)
 * so the client gates on exactly the same rule the backend enforces. It is
 * re-implemented here rather than imported because the desktop client depends on
 * `@health-checkup/services` for **types only**, never runtime code.
 *
 * _Requirements: 11.2_
 */

import type { executionEngine as executionEngineTypes } from '@health-checkup/services';
import type { RequestDescriptor } from './types';
import { executionEngine } from './builders';

/**
 * Produced instead of an execute {@link RequestDescriptor} when the reported
 * plan still has one or more required values the User has not supplied
 * (Req 11.2). The caller prompts for each entry in `missing` and sends nothing.
 */
export interface ValuesRequired {
  kind: 'values_required';
  /** Every reported required value that is still absent from the supplied set. */
  missing: executionEngineTypes.RequiredValueRef[];
}

/**
 * The result of gating an execution: either the execute request descriptor
 * (all reported values supplied) or a {@link ValuesRequired} indication.
 */
export type ExecutionGateResult = RequestDescriptor | ValuesRequired;

/** Type guard: `true` when gating produced no execute descriptor (Req 11.2). */
export function isValuesRequired(
  result: ExecutionGateResult,
): result is ValuesRequired {
  return (result as ValuesRequired).kind === 'values_required';
}

/**
 * Return every value the plan reported as required that is still absent from the
 * User-supplied set, preserving the plan's reported order. A value is present
 * when its corresponding supplied entry exists and is non-empty; the
 * `authentication` requirement is satisfied by `supplied.authConfigured`.
 */
export function findMissingPlanValues(
  plan: Pick<executionEngineTypes.ExecutionPlan, 'requiredValues'>,
  supplied: executionEngineTypes.ParamValues,
): executionEngineTypes.RequiredValueRef[] {
  return plan.requiredValues.filter((ref) => !isProvided(ref, supplied));
}

/**
 * Gate an endpoint execution against the values the User has supplied.
 *
 * When any reported required value is missing, returns a {@link ValuesRequired}
 * indication and produces no descriptor (Req 11.2). When every reported value is
 * supplied, produces the execute `RequestDescriptor` by delegating to
 * {@link executionEngine.execute}.
 */
export function gateExecution(
  plan: executionEngineTypes.ExecutionPlan,
  supplied: executionEngineTypes.ParamValues,
): ExecutionGateResult {
  const missing = findMissingPlanValues(plan, supplied);
  if (missing.length > 0) {
    return { kind: 'values_required', missing };
  }
  return executionEngine.execute(plan);
}

// ---- Missing-value detection (mirrors the backend's isProvided rule) -------

function isProvided(
  ref: executionEngineTypes.RequiredValueRef,
  provided: executionEngineTypes.ParamValues,
): boolean {
  switch (ref.location) {
    case 'authentication':
      return provided.authConfigured === true;
    case 'body':
      return hasBodyField(provided.body, ref.name);
    case 'path':
      return hasScalar(provided.path, ref.name);
    case 'query':
      return hasScalar(provided.query, ref.name);
    case 'header':
      return hasScalar(provided.header, ref.name);
    case 'cookie':
      return hasScalar(provided.cookie, ref.name);
    default:
      return false;
  }
}

function hasScalar(
  bag: Record<string, string | number | boolean> | undefined,
  name: string,
): boolean {
  if (bag === undefined) {
    return false;
  }
  const value = bag[name];
  if (value === undefined || value === null) {
    return false;
  }
  return !(typeof value === 'string' && value.length === 0);
}

function hasBodyField(
  body: Record<string, unknown> | undefined,
  name: string,
): boolean {
  if (body === undefined) {
    return false;
  }
  const value = body[name];
  return value !== undefined && value !== null;
}
