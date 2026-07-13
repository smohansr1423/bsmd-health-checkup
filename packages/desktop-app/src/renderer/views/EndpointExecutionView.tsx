/**
 * Endpoint-execution view (Task 13.10 — Req 11.1, 11.2, 11.3, 11.4, 11.5, 11.6).
 *
 * Drives the execute-an-endpoint flow the API browser hands off to:
 *
 *   1. Request an execution plan from the `execution-engine` plan endpoint for
 *      the Active_API_Version + selected endpoint (Req 11.1). The plan reports
 *      the complete set of required path/query/header/cookie/body/authentication
 *      values.
 *   2. Prompt the User for each reported required value and **block** the
 *      execute request until every reported value is supplied — the client
 *      never produces an execute `RequestDescriptor` while any value is missing
 *      (Req 11.2 / Property 18). The gating itself lives in the pure
 *      {@link gateExecution} helper so the rule is verifiable in isolation.
 *   3. Once all values are supplied, send the Execution_Request to the
 *      `execution-engine` execute endpoint and show a Loading_Indicator until a
 *      response is received (Req 11.3).
 *   4. Display the response status code, headers, and body **exactly as
 *      returned** with the elapsed time unaltered, via {@link ResponseDetails}
 *      (Req 11.4, 11.6) — target-API error statuses/bodies pass through the same
 *      presenter untouched.
 *   5. On a target timeout or network-connection failure, surface the reported
 *      failure type and **retain** the entered parameter and authentication
 *      values so the User can retry without re-typing (Req 11.5). The retained
 *      values are seeded from `state.retainedInputs['api-browser']`, where the
 *      wiring layer writes them on a transient failure.
 *
 * Endpoint execution is initiated from the API browser (there is no dedicated
 * top-level route), so its loading/retention are tracked under the
 * `api-browser` view id. This component owns the execution surface; the exact
 * response rendering is delegated to the shared response-presentation
 * component so the "present exactly as returned" guarantee lives in one place.
 */

import React, { useState } from 'react';
import type {
  apiCopilotShared,
  executionEngine as executionEngineTypes,
} from '@health-checkup/services';
import { executionEngine } from '../app-client/builders';
import {
  findMissingPlanValues,
  gateExecution,
  isValuesRequired,
} from '../app-client/execution-gating';
import { ResponseDetails } from '../components/ResponseDetails';
import { LoadingIndicator } from '../components/LoadingIndicator';
import { useAppStore } from '../state/store';
import { useViewActions } from './actions';

/** Stable operation id for the execution-plan request (Req 11.1). */
export const PLAN_OP = 'execution-engine:plan';

/** Stable operation id for the execute request (Req 11.3). */
export const EXECUTE_OP = 'execution-engine:execute';

/**
 * Endpoint execution is reached from the API browser and has no route of its
 * own, so its transient-failure input retention is keyed under `api-browser`
 * (Req 11.5). Kept as a constant so the seed-read and the retain-write agree.
 */
const EXECUTION_VIEW = 'api-browser' as const;

/** Secret-free, user-facing messages for the execution outcomes (Req 11.5). */
export const EXECUTION_MESSAGES = {
  /** Req 11.2 — the plan still reports one or more missing required values. */
  valuesRequired:
    'Supply every required value before executing. Missing values are marked below.',
  /** Req 11.5 — the target API could not be reached before a response arrived. */
  networkFailure:
    'The target API could not be reached (network failure). Your entered values were kept — you can try again.',
  /** Req 11.5 — the target API did not respond before the deadline. */
  timeout:
    'The target API did not respond in time (timeout). Your entered values were kept — you can try again.',
} as const;

/** The shape of the input retained for endpoint execution on a transient failure. */
interface RetainedExecution {
  /** Supplied scalar/body values, keyed by `${location}:${name}`. */
  values: Record<string, string>;
  /** Whether the User indicated authentication is configured for the target. */
  authConfigured: boolean;
}

export interface EndpointExecutionViewProps {
  /** The endpoint the User chose to execute (from the API browser). */
  endpointId?: string;
  /** Target server base URL the endpoint path is appended to (Req 11.1). */
  baseUrl?: string;
  /**
   * The execution plan returned by the Backend_Gateway, reporting the required
   * values (Req 11.1). `undefined` before a plan has been requested/received.
   */
  plan?: executionEngineTypes.ExecutionPlan;
  /**
   * The execution response to present verbatim (Req 11.4, 11.6). `undefined`
   * before a request has completed successfully.
   */
  result?: apiCopilotShared.ExecutionResult;
  /**
   * A reported transient failure to surface while retaining the entered values
   * (Req 11.5). `undefined` when the last attempt did not fail transiently.
   */
  failure?: 'timeout' | 'network_error';
}

/** Read the retained execution input for the api-browser view, if any (Req 11.5). */
function retainedExecution(retained: unknown): RetainedExecution {
  if (
    typeof retained === 'object' &&
    retained !== null &&
    typeof (retained as RetainedExecution).values === 'object' &&
    (retained as RetainedExecution).values !== null
  ) {
    const candidate = retained as RetainedExecution;
    return {
      values: { ...candidate.values },
      authConfigured: candidate.authConfigured === true,
    };
  }
  return { values: {}, authConfigured: false };
}

/** Canonical key pairing a required value with the supplied-values map. */
function refKey(ref: executionEngineTypes.RequiredValueRef): string {
  return `${ref.location}:${ref.name}`;
}

/**
 * Assemble the flat supplied-values form state into the structured
 * {@link executionEngineTypes.ParamValues} the gating helper compares against
 * the plan. Empty scalar entries are still carried (they count as *not*
 * provided under the same rule the backend enforces), and `authConfigured`
 * satisfies the `authentication` requirement.
 */
function assembleParamValues(
  values: Record<string, string>,
  authConfigured: boolean,
): executionEngineTypes.ParamValues {
  const path: Record<string, string> = {};
  const query: Record<string, string> = {};
  const header: Record<string, string> = {};
  const cookie: Record<string, string> = {};
  const body: Record<string, unknown> = {};

  for (const key of Object.keys(values)) {
    const sep = key.indexOf(':');
    const location = key.slice(0, sep);
    const name = key.slice(sep + 1);
    const value = values[key];
    switch (location) {
      case 'path':
        path[name] = value;
        break;
      case 'query':
        query[name] = value;
        break;
      case 'header':
        header[name] = value;
        break;
      case 'cookie':
        cookie[name] = value;
        break;
      case 'body':
        // Only a non-empty body field counts as provided (Req 11.2).
        if (value.length > 0) {
          body[name] = value;
        }
        break;
      default:
        break;
    }
  }

  const assembled: executionEngineTypes.ParamValues = { authConfigured };
  if (Object.keys(path).length > 0) assembled.path = path;
  if (Object.keys(query).length > 0) assembled.query = query;
  if (Object.keys(header).length > 0) assembled.header = header;
  if (Object.keys(cookie).length > 0) assembled.cookie = cookie;
  if (Object.keys(body).length > 0) assembled.body = body;
  return assembled;
}

export function EndpointExecutionView({
  endpointId,
  baseUrl,
  plan,
  result,
  failure,
}: EndpointExecutionViewProps): React.ReactElement {
  const { state } = useAppStore();
  const actions = useViewActions();
  const selection = state.activeApiVersion;

  // Seed the form from any values retained after a transient failure so they
  // survive a remount and are ready for retry (Req 11.5).
  const seed = retainedExecution(state.retainedInputs[EXECUTION_VIEW]);
  const [values, setValues] = useState<Record<string, string>>(seed.values);
  const [authConfigured, setAuthConfigured] = useState<boolean>(
    seed.authConfigured,
  );
  const [message, setMessage] = useState<string | null>(null);

  const planning = state.requests[PLAN_OP] === 'loading';
  const executing = state.requests[EXECUTE_OP] === 'loading';

  const supplied = assembleParamValues(values, authConfigured);
  const missing = plan ? findMissingPlanValues(plan, supplied) : [];
  // Property 18 / Req 11.2: block execute until every reported value is supplied.
  const executeBlocked = plan === undefined || missing.length > 0;

  const setValue = (key: string, value: string): void => {
    setValues((prev) => ({ ...prev, [key]: value }));
  };

  const requestPlan = (): void => {
    if (!selection || !endpointId) {
      setMessage('Select an API version and an endpoint before executing.');
      return;
    }
    setMessage(null);
    void actions.runRequest?.({
      operationId: PLAN_OP,
      view: EXECUTION_VIEW,
      descriptor: executionEngine.plan({
        apiSelection: selection,
        endpointId,
        baseUrl: baseUrl ?? '',
        provided: supplied,
      }),
    });
  };

  const execute = (): void => {
    if (!plan) {
      return;
    }
    const gate = gateExecution(plan, supplied);
    if (isValuesRequired(gate)) {
      // Never send while any reported value is missing (Req 11.2 / Property 18).
      setMessage(EXECUTION_MESSAGES.valuesRequired);
      return;
    }
    setMessage(null);
    void actions.runRequest?.({
      operationId: EXECUTE_OP,
      view: EXECUTION_VIEW,
      descriptor: gate,
      // Retain the entered values so a timeout/network failure keeps them for
      // retry without re-typing (Req 11.5).
      retainInput: { values, authConfigured } satisfies RetainedExecution,
    });
  };

  const handlePlanSubmit = (event: React.FormEvent): void => {
    event.preventDefault();
    requestPlan();
  };

  const handleExecuteSubmit = (event: React.FormEvent): void => {
    event.preventDefault();
    execute();
  };

  return (
    <section
      className="view view--endpoint-execution"
      aria-labelledby="endpoint-execution-title"
    >
      <h1 id="endpoint-execution-title">Execute Endpoint</h1>

      {selection === null ? (
        <p className="notice notice--selection-required" role="status">
          Select an API version before executing an endpoint.
        </p>
      ) : (
        <p className="notice notice--active-version">
          Active version: {selection.apiId} @ {selection.version}
          {endpointId ? ` — ${endpointId}` : ''}
        </p>
      )}

      {message !== null ? (
        <p className="error" role="alert">
          {message}
        </p>
      ) : null}

      {/* Step 1: request the execution plan (Req 11.1). */}
      <form onSubmit={handlePlanSubmit}>
        <button
          type="submit"
          disabled={planning || selection === null || !endpointId}
        >
          Request execution plan
        </button>
      </form>

      {planning ? <LoadingIndicator label="Resolving required values…" /> : null}

      {/* Step 2: prompt for each reported required value (Req 11.2). */}
      {plan ? (
        <form onSubmit={handleExecuteSubmit}>
          <fieldset>
            <legend>Required values</legend>
            {plan.requiredValues.length === 0 ? (
              <p className="endpoint-execution__no-values">
                This endpoint requires no additional values.
              </p>
            ) : (
              <ul className="endpoint-execution__required">
                {plan.requiredValues.map((ref) => {
                  const key = refKey(ref);
                  const isMissing = missing.some(
                    (m) => m.location === ref.location && m.name === ref.name,
                  );
                  if (ref.location === 'authentication') {
                    return (
                      <li key={key} className="endpoint-execution__value">
                        <label>
                          <input
                            type="checkbox"
                            checked={authConfigured}
                            onChange={(e) => setAuthConfigured(e.target.checked)}
                          />
                          Authentication configured
                        </label>
                        {isMissing ? (
                          <span className="endpoint-execution__missing" role="note">
                            required
                          </span>
                        ) : null}
                      </li>
                    );
                  }
                  return (
                    <li key={key} className="endpoint-execution__value">
                      <label>
                        {ref.name} ({ref.location})
                        <input
                          type="text"
                          value={values[key] ?? ''}
                          aria-invalid={isMissing}
                          onChange={(e) => setValue(key, e.target.value)}
                        />
                      </label>
                      {isMissing ? (
                        <span className="endpoint-execution__missing" role="note">
                          required
                        </span>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </fieldset>

          {/* Step 3: execute — blocked until every reported value is supplied. */}
          <button type="submit" disabled={executeBlocked || executing}>
            Execute
          </button>
        </form>
      ) : null}

      {executing ? <LoadingIndicator label="Executing request…" /> : null}

      {/* Step 5: transient failure — reported and values retained (Req 11.5). */}
      {failure !== undefined ? (
        <div className="error error--transient" role="alert">
          <p>
            {failure === 'timeout'
              ? EXECUTION_MESSAGES.timeout
              : EXECUTION_MESSAGES.networkFailure}
          </p>
          <button type="button" disabled={executeBlocked || executing} onClick={execute}>
            Retry
          </button>
        </div>
      ) : null}

      {/* Step 4: present the response exactly as returned (Req 11.4, 11.6). */}
      {result !== undefined ? <ResponseDetails result={result} /> : null}
    </section>
  );
}
