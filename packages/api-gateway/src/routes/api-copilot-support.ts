/**
 * API Copilot AI — Route Support
 *
 * Shared helpers for the API Copilot AI domain routes:
 * - `ApiCopilotServices`: the shape of the API Copilot service instances the
 *   composition root (task 18.1) wires onto `app.locals.services`.
 * - `getApiCopilotServices` / `requireService`: read services from
 *   `app.locals.services`, surfacing a 503 while a service is not yet wired.
 * - `requesterOf`: derives the `{ userId, accountId }` requester from the
 *   authenticated request for workspace-scoped access control.
 * - `mapApiCopilotError`: maps every API Copilot domain error class to its HTTP
 *   status per the design's Error Categories and Mapping table.
 * - `wrap`: an async handler wrapper that funnels domain errors through the
 *   mapper into the gateway's `errorHandler` middleware.
 *
 * Validates: Requirements 4.7, 5.2, 7.8, 14.4, 15.4, 16.5, 18.4, 18.5
 */

import type { Response, NextFunction, RequestHandler } from 'express';
import {
  accountAuth,
  workspace,
  planQuota,
  knowledgeEngine,
  queryEngine,
  executionEngine,
  apiCopilotAuthAssistant,
  codeGenerator,
  testingConsole,
  conversation,
  usageAnalytics,
} from '@health-checkup/services';
import type { apiCopilotShared } from '@health-checkup/services';
import { AppError, serviceUnavailable } from '../middleware';

/** The requester identity shape used for workspace-scoped access control. */
type UserRef = apiCopilotShared.UserRef;
import type { AuthenticatedRequest } from '../types';

/**
 * The API Copilot AI service instances read from `app.locals.services`.
 *
 * Every entry is optional: the composition root (task 18.1) instantiates and
 * wires the concrete services, and until then a route surfaces a 503 via
 * {@link requireService} rather than crashing. The property names here are the
 * contract task 18.1 wires against.
 */
export interface ApiCopilotServices {
  accountAuthService?: accountAuth.AccountAuthService;
  workspaceService?: workspace.WorkspaceService;
  planQuotaService?: planQuota.PlanQuotaService;
  knowledgeEngineService?: knowledgeEngine.KnowledgeEngineService;
  queryEngine?: queryEngine.QueryEngine;
  indexingService?: queryEngine.IndexingService;
  executionEngine?: executionEngine.ExecutionEngine;
  authAssistant?: apiCopilotAuthAssistant.AuthAssistant;
  codeGeneratorService?: codeGenerator.CodeGeneratorService;
  testingConsole?: testingConsole.TestingConsole;
  conversationService?: conversation.ConversationService;
  // Distinct from the health-checkup `analyticsService` (health analytics) also
  // held on `app.locals.services`; this is the API Copilot usage-analytics one.
  usageAnalyticsService?: usageAnalytics.AnalyticsService;
}

/** Read the API Copilot service registry from `app.locals.services`. */
export function getApiCopilotServices(req: AuthenticatedRequest): ApiCopilotServices {
  return (req.app.locals.services ?? {}) as ApiCopilotServices;
}

/**
 * Resolve a specific API Copilot service, throwing a 503 when it has not yet
 * been wired onto the registry (task 18.1 wires the concrete instances).
 */
export function requireService<K extends keyof ApiCopilotServices>(
  req: AuthenticatedRequest,
  key: K,
  label: string
): NonNullable<ApiCopilotServices[K]> {
  const service = getApiCopilotServices(req)[key];
  if (!service) {
    throw serviceUnavailable(`${label} is not available.`);
  }
  return service as NonNullable<ApiCopilotServices[K]>;
}

/**
 * Derive the requester identity for workspace-scoped access control (Req 14.3,
 * 15.4, 16.5, 18.4, 18.5). `userId` comes from the authenticated token; the
 * owning account may be supplied via the `x-account-id` header and otherwise
 * defaults to the user id.
 */
export function requesterOf(req: AuthenticatedRequest): UserRef {
  const userId = req.auth?.userId ?? '';
  const header = req.headers['x-account-id'];
  const accountId = (Array.isArray(header) ? header[0] : header) || userId;
  return { userId, accountId };
}

/** Convert an error class name into a SCREAMING_SNAKE_CASE error code. */
function toCode(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .toUpperCase();
}

/** Build an {@link AppError} from a domain error and its mapped HTTP status. */
function appError(status: number, error: Error, details?: unknown): AppError {
  return new AppError(status, toCode(error.name), error.message, details);
}

/**
 * Map an API Copilot AI domain error to its HTTP status per the design's Error
 * Categories and Mapping table. Returns `undefined` for errors that are not
 * recognized domain errors so the caller can fall back to the default handler.
 *
 * Validates: Requirements 4.7, 5.2, 7.8, 14.4, 15.4, 16.5, 18.4, 18.5
 */
export function mapApiCopilotError(error: unknown): AppError | undefined {
  if (!(error instanceof Error)) {
    return undefined;
  }

  // --- Knowledge Engine (Req 1.4, 1.5, 1.6, 1.8, 2.2, 2.7) ---
  if (error instanceof knowledgeEngine.SpecParseError) {
    return appError(422, error, { location: error.location, reason: error.reason });
  }
  if (error instanceof knowledgeEngine.UnsupportedUploadError) {
    // Size → 413 Payload Too Large; format → 415 Unsupported Media Type.
    return appError(error.reason === 'size' ? 413 : 415, error, { reason: error.reason });
  }
  if (error instanceof knowledgeEngine.NoMetadataFoundError) {
    return appError(422, error);
  }
  if (error instanceof knowledgeEngine.MetadataStorageError) {
    return appError(500, error);
  }
  if (error instanceof knowledgeEngine.VersionUnavailableError) {
    return appError(409, error);
  }

  // --- Plan & Quota (Req 2.5, 17.4, 17.5, 17.9) ---
  if (error instanceof planQuota.QuotaExceededError) {
    return appError(429, error);
  }
  if (error instanceof planQuota.ApiLimitReachedError) {
    return appError(409, error);
  }
  if (error instanceof planQuota.EnterpriseConfigMissingError) {
    return appError(409, error);
  }
  if (error instanceof planQuota.AccountNotFoundError) {
    return appError(404, error);
  }

  // --- Query Engine (Req 3.6, 3.7, 4.7, 4.8, 4.9, 19.4) ---
  if (
    error instanceof queryEngine.InvalidQueryLengthError ||
    error instanceof queryEngine.InvalidQuestionLengthError
  ) {
    return appError(400, error);
  }
  if (error instanceof queryEngine.NoApiSelectedError) {
    return appError(409, error);
  }
  if (error instanceof queryEngine.SearchUnavailableError) {
    return appError(503, error);
  }
  if (error instanceof queryEngine.AnswerGenerationError) {
    return appError(504, error);
  }
  if (error instanceof queryEngine.IndexingFailureError) {
    return appError(500, error);
  }

  // --- Execution Engine (Req 5.2, 5.6, 5.7) ---
  if (error instanceof executionEngine.MissingParametersError) {
    return appError(400, error);
  }
  if (error instanceof executionEngine.ExecutionTimeoutError) {
    return appError(504, error);
  }
  if (error instanceof executionEngine.NetworkFailureError) {
    return appError(502, error);
  }
  if (error instanceof executionEngine.ApiVersionUnavailableError) {
    return appError(409, error);
  }
  if (error instanceof executionEngine.EndpointNotFoundError) {
    return appError(404, error);
  }
  if (error instanceof executionEngine.ExecutionFailureError) {
    return appError(502, error);
  }

  // --- Auth Assistant (Req 6.3, 6.6, 6.7, 6.9) — subclasses before AuthError ---
  if (error instanceof apiCopilotAuthAssistant.CredentialNotFoundError) {
    return appError(404, error);
  }
  if (error instanceof apiCopilotAuthAssistant.UnsupportedSchemeError) {
    return appError(400, error);
  }
  if (error instanceof apiCopilotAuthAssistant.AuthError) {
    return appError(401, error);
  }

  // --- Code Generator (Req 7.6, 7.7, 7.8) ---
  if (error instanceof codeGenerator.EndpointUnavailableError) {
    return appError(404, error);
  }
  if (error instanceof codeGenerator.UnsupportedLanguageError) {
    return appError(400, error);
  }
  if (error instanceof codeGenerator.VersionUnavailableError) {
    return appError(409, error);
  }

  // --- Testing Console (Req 8.5) ---
  if (error instanceof testingConsole.SavedAuthInvalidError) {
    return appError(401, error);
  }
  if (error instanceof testingConsole.HistoryEntryNotFoundError) {
    return appError(404, error);
  }

  // --- Account Auth (Req 13.2, 13.3, 13.6) ---
  if (error instanceof accountAuth.EmailAlreadyRegisteredError) {
    return appError(409, error);
  }
  if (error instanceof accountAuth.InvalidRegistrationError) {
    return appError(400, error);
  }
  if (error instanceof accountAuth.AccountLockedError) {
    return appError(423, error);
  }
  if (error instanceof accountAuth.InvalidCredentialsError) {
    return appError(401, error);
  }

  // --- Workspace (Req 14.2, 14.4, 14.6, 18.5) ---
  if (error instanceof workspace.AuthorizationError) {
    return appError(403, error);
  }
  if (error instanceof workspace.WorkspaceNameError) {
    return appError(400, error);
  }
  if (error instanceof workspace.TierMemberLimitError) {
    return appError(409, error);
  }
  if (error instanceof workspace.WorkspaceNotFoundError) {
    return appError(404, error);
  }

  // --- Conversation (Req 15.2, 15.4) ---
  if (error instanceof conversation.ConversationAccessError) {
    return appError(403, error);
  }
  if (error instanceof conversation.ConversationRecordError) {
    return appError(500, error);
  }

  // --- Usage Analytics (Req 16.5, 16.7) ---
  if (error instanceof usageAnalytics.AuthorizationError) {
    return appError(403, error);
  }
  if (error instanceof usageAnalytics.DashboardLoadError) {
    return appError(503, error);
  }

  return undefined;
}

/** The async route handler signature used by the API Copilot routes. */
export type ApiCopilotHandler = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => Promise<void>;

/**
 * Wrap an async handler so any thrown API Copilot domain error is mapped to its
 * HTTP status and forwarded to the gateway `errorHandler` middleware. Unmapped
 * errors are forwarded unchanged (the handler produces a standardized 500).
 */
export function wrap(handler: ApiCopilotHandler): RequestHandler {
  return (req, res, next) => {
    handler(req as AuthenticatedRequest, res, next).catch((error: unknown) => {
      next(mapApiCopilotError(error) ?? error);
    });
  };
}
