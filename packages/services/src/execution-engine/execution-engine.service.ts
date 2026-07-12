/**
 * Execution Engine — Service
 *
 * Performs live, authenticated calls to a target API on behalf of the user.
 *
 * - `planExecution` resolves the selected endpoint's metadata, computes the
 *   required path/query/body/authentication values, and — if any are missing —
 *   throws a `MissingParametersError` listing each without sending a request
 *   (Req 5.1, 5.2). When everything is present it returns a ready-to-send
 *   `ExecutionPlan` whose request carries no credential material.
 * - `execute` obtains authentication material from the Auth Assistant seam
 *   (Req 6.2), sends the request via the injected `HttpClient` under a 30-second
 *   cap (Req 5.6), and returns the status, headers, and a pretty-printed,
 *   structure-preserving body (Req 5.3, 5.4). Error statuses and bodies are
 *   passed through unmodified (Req 5.5). A timeout is classified as
 *   `ExecutionTimeoutError` and a connection failure as `NetworkFailureError`,
 *   both retaining the entered values (Req 5.6, 5.7).
 *
 * The Auth Assistant is consumed through the injectable `AuthMaterialPort` seam
 * so this service never imports the auth-assistant module directly and stays
 * unit- and property-testable with fakes.
 *
 * Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7
 */

import {
  FakeHttpClient,
  InMemoryApiVersionRepository,
  defaultDateProvider,
  defaultIdGenerator,
} from '../api-copilot-shared';
import type {
  ApiVersionRepository,
  DateProvider,
  EndpointMeta,
  ExecutionOutcome,
  ExecutionResult,
  HttpClient,
  IdGenerator,
  OutboundRequest,
  OutboundResponse,
} from '../api-copilot-shared';
import type {
  AuthMaterialPort,
  ExecutionEngineDependencies,
  ExecutionPlan,
  PlanExecutionRequest,
} from './execution-engine.types';
import { DEFAULT_EXECUTION_TIMEOUT_MS } from './execution-engine.types';
import {
  ApiVersionUnavailableError,
  EndpointNotFoundError,
  ExecutionTimeoutError,
  MissingParametersError,
  NetworkFailureError,
} from './execution-engine.errors';
import {
  buildHeaders,
  buildUrl,
  computeRequiredValues,
  findMissingValues,
  prettyPrintBody,
} from './execution-engine.validators';

/** Internal sentinel used to distinguish a timeout from a network rejection. */
class TimeoutSignal extends Error {
  constructor() {
    super('timeout');
    this.name = 'TimeoutSignal';
  }
}

/**
 * Default auth port. It performs no work and reports that no material is
 * available, so executions requiring authentication fail closed until a real
 * Auth Assistant (or a test fake) is injected.
 */
export class UnconfiguredAuthPort implements AuthMaterialPort {
  async ensureToken(): Promise<never> {
    throw new Error('No authentication provider configured');
  }
}

export class ExecutionEngine {
  private readonly idGenerator: IdGenerator;
  private readonly dateProvider: DateProvider;
  private readonly apiVersionRepository: ApiVersionRepository;
  private readonly httpClient: HttpClient;
  private readonly authProvider: AuthMaterialPort;
  private readonly timeoutMs: number;

  constructor(deps: Partial<ExecutionEngineDependencies> = {}) {
    this.idGenerator = deps.idGenerator ?? defaultIdGenerator;
    this.dateProvider = deps.dateProvider ?? defaultDateProvider;
    this.apiVersionRepository =
      deps.apiVersionRepository ?? new InMemoryApiVersionRepository();
    this.httpClient = deps.httpClient ?? new FakeHttpClient();
    this.authProvider = deps.authProvider ?? new UnconfiguredAuthPort();
    this.timeoutMs = deps.timeoutMs ?? DEFAULT_EXECUTION_TIMEOUT_MS;
  }

  /**
   * Resolve the endpoint's metadata, determine the required values, and either
   * return a ready-to-send plan or throw `MissingParametersError` (no request
   * is sent) when any required value is absent (Req 5.1, 5.2).
   */
  async planExecution(request: PlanExecutionRequest): Promise<ExecutionPlan> {
    const { apiSelection, endpointId, provided } = request;

    const apiVersion = await this.apiVersionRepository.findVersion(
      apiSelection.workspaceId,
      apiSelection.apiId,
      apiSelection.version
    );
    if (apiVersion === null) {
      throw new ApiVersionUnavailableError(
        apiSelection.apiId,
        apiSelection.version
      );
    }

    const endpoint = apiVersion.metadata.endpoints.find(
      (e) => e.endpointId === endpointId
    );
    if (endpoint === undefined) {
      throw new EndpointNotFoundError(endpointId);
    }

    const requiredValues = computeRequiredValues(endpoint);
    const missing = findMissingValues(requiredValues, provided);
    if (missing.length > 0) {
      // Req 5.2: prompt for each missing value and do NOT send.
      throw new MissingParametersError(endpointId, missing);
    }

    const request$ = this.buildRequest(endpoint, request);
    const targetApiRef = request.targetApiRef ?? apiSelection.apiId;

    return {
      apiSelection,
      endpointId,
      target: { targetApiRef },
      request: request$,
      requiresAuth: endpoint.authSchemeRefs.length > 0,
      requiredValues,
    };
  }

  /**
   * Send the planned request and return the target's response. Applies
   * authentication material (Req 6.2), enforces the 30-second cap (Req 5.6),
   * pretty-prints the body preserving structure (Req 5.4), passes error status
   * and body through unmodified (Req 5.5), and classifies transient failures
   * (Req 5.6, 5.7).
   */
  async execute(plan: ExecutionPlan): Promise<ExecutionResult> {
    const outbound: OutboundRequest = {
      ...plan.request,
      headers: { ...plan.request.headers },
    };

    // Req 6.2: obtain and apply authentication material before sending. Auth
    // headers are merged here (locally) and never persisted on the plan.
    if (plan.requiresAuth) {
      const material = await this.authProvider.ensureToken(plan.target);
      outbound.headers = { ...outbound.headers, ...material.headers };
    }

    const start = this.dateProvider().getTime();
    let response: OutboundResponse;
    try {
      response = await this.withTimeout(
        this.httpClient.send(outbound, this.timeoutMs)
      );
    } catch (err) {
      if (err instanceof TimeoutSignal) {
        // Req 5.6: timeout — cancel and retain entered values.
        throw new ExecutionTimeoutError(plan, this.timeoutMs);
      }
      // Req 5.7: network connection failure — retain entered values.
      throw new NetworkFailureError(plan);
    }
    const elapsedMs = this.dateProvider().getTime() - start;

    // Req 5.3/5.5: return the target's status, headers, and body. Error
    // statuses and bodies pass through unmodified; the body is pretty-printed
    // in a structure-preserving way (Req 5.4).
    const outcome: ExecutionOutcome = response.statusCode >= 400 ? 'error' : 'success';
    return {
      statusCode: response.statusCode,
      headers: response.headers,
      body: prettyPrintBody(response.body),
      elapsedMs,
      outcome,
    };
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  /** Build the outbound request (URL, headers, body) from provided values. */
  private buildRequest(
    endpoint: EndpointMeta,
    request: PlanExecutionRequest
  ): OutboundRequest {
    const { baseUrl, provided } = request;
    const hasBody = provided.body !== undefined;
    const url = buildUrl(baseUrl, endpoint.path, provided.path, provided.query);
    const headers = buildHeaders(provided.header, hasBody);
    const body = hasBody ? JSON.stringify(provided.body) : undefined;
    return {
      method: endpoint.method,
      url,
      headers,
      body,
    };
  }

  /**
   * Race the outbound send against the hard timeout. Rejects with a
   * `TimeoutSignal` when the cap is exceeded so the caller can classify the
   * failure as a timeout (Req 5.6) distinctly from a network rejection
   * (Req 5.7).
   */
  private withTimeout<T>(operation: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new TimeoutSignal()), this.timeoutMs);
    });
    return Promise.race([operation, timeout]).finally(() => {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    });
  }
}
