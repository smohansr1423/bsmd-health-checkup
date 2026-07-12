/**
 * Execution Engine — barrel export.
 *
 * Plans and performs live, authenticated calls to a target API on behalf of the
 * user: determines required path/query/body/authentication values from
 * metadata, prompts for missing values without sending, sends via the injected
 * HttpClient under a 30-second cap using Auth Assistant material, and returns a
 * structure-preserving response while passing error status/body through
 * unmodified.
 *
 * Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7
 */

export { ExecutionEngine, UnconfiguredAuthPort } from './execution-engine.service';

export {
  MissingParametersError,
  ExecutionFailureError,
  ExecutionTimeoutError,
  NetworkFailureError,
  ApiVersionUnavailableError,
  EndpointNotFoundError,
} from './execution-engine.errors';
export type { ExecutionFailureKind } from './execution-engine.errors';

export {
  computeRequiredValues,
  findMissingValues,
  requiredBodyFields,
  buildUrl,
  buildHeaders,
  prettyPrintBody,
  isRecord,
} from './execution-engine.validators';

export { DEFAULT_EXECUTION_TIMEOUT_MS } from './execution-engine.types';
export type {
  ExecutionTargetRef,
  AuthMaterialPort,
  ParamValues,
  RequiredValueLocation,
  RequiredValueRef,
  PlanExecutionRequest,
  ExecutionPlan,
  ExecutionEngineDependencies,
} from './execution-engine.types';
