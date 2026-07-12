/**
 * Per-domain `RequestDescriptor` builders (Task 6.1).
 *
 * These are **pure** functions — no I/O, no React, no Electron. Each builder
 * maps one-to-one to a real `/api/copilot/*` Backend_Endpoint (see the mounted
 * routers in `packages/api-gateway/src/index.ts`) and produces a token-less
 * {@link RequestDescriptor}. The main-process broker later attaches the
 * Session_Token (iff `requiresAuth`) and joins the relative `path` with the
 * stored HTTPS base URL, so no token or `Authorization` header is ever set here
 * (Req 4.2).
 *
 * Endpoint map (verified against the gateway routes):
 *  - account         → POST /api/copilot/account/sign-up | sign-in           (public)
 *  - workspaces      → POST /api/copilot/workspaces, GET :id/access,
 *                      POST :id/members, DELETE :id/members/:userId
 *  - planQuota       → GET  /api/copilot/plan-quota/limits | tier
 *  - knowledgeEngine → POST /api/copilot/knowledge-engine/uploads | versions/select
 *  - queryEngine     → POST /api/copilot/query-engine/questions | search
 *  - executionEngine → POST /api/copilot/execution-engine/plan | execute
 *  - authAssistant   → GET  /api/copilot/auth-assistant/schemes,
 *                      POST /api/copilot/auth-assistant/credentials
 *  - codeGenerator   → GET  /api/copilot/code-generator/languages,
 *                      POST /api/copilot/code-generator/generate
 *  - testingConsole  → POST /api/copilot/testing-console/runs,
 *                      GET  /api/copilot/testing-console/:ws/history,
 *                      POST /api/copilot/testing-console/:ws/replays/:historyId
 *  - conversations   → GET  /api/copilot/conversations/:workspaceId
 *  - usageAnalytics  → GET  /api/copilot/usage-analytics/:workspaceId/dashboard
 *
 * Client-side length/format validation and selection gating live in
 * `validation.ts` (Task 3.1) and run *before* these builders. Builders concern
 * themselves only with correct descriptor construction.
 */

import type {
  apiCopilotShared,
  executionEngine as executionEngineTypes,
} from '@health-checkup/services';
import type {
  RequestDescriptor,
  HttpMethod,
  SignUpInput,
  SignInInput,
  UploadFile,
  CredentialInput,
  ConsoleRunInput,
} from './types';

// ---- Path & timeout constants (single source of truth) --------------------

/** Root namespace all Backend_Endpoints are mounted under. */
export const API_COPILOT_BASE = '/api/copilot';

/** Q&A deadline: the backend may take up to 30 s to generate an answer (Req 8.7). */
export const QA_TIMEOUT_MS = 30_000;

/** Default deadline for every non-Q&A call. */
export const DEFAULT_TIMEOUT_MS = 15_000;

// ---- Gating result --------------------------------------------------------

/**
 * Returned instead of a {@link RequestDescriptor} when a version-scoped or
 * workspace-scoped operation is attempted without the required selection
 * (Req 6.2, 7.5, 8.3, 13.4). The caller surfaces this as a "selection required"
 * indication and sends nothing.
 */
export interface SelectionRequired {
  kind: 'selection_required';
  /** Which selection must be made before the operation can proceed. */
  requires: 'workspace' | 'apiVersion';
  message: string;
}

/** A gated builder yields either a descriptor or a selection-required indication. */
export type GatedDescriptor = RequestDescriptor | SelectionRequired;

/** Type guard: `true` when a gated builder produced no descriptor. */
export function isSelectionRequired(
  result: GatedDescriptor,
): result is SelectionRequired {
  return (result as SelectionRequired).kind === 'selection_required';
}

// ---- Internal descriptor helpers ------------------------------------------

/** Build a descriptor, defaulting the timeout unless overridden. */
function descriptor(
  method: HttpMethod,
  path: string,
  requiresAuth: boolean,
  options: { body?: unknown; timeoutMs?: number } = {},
): RequestDescriptor {
  const built: RequestDescriptor = {
    method,
    path,
    requiresAuth,
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  };
  if (options.body !== undefined) {
    built.body = options.body;
  }
  return built;
}

/** Encode a path segment so ids with reserved characters resolve correctly. */
function seg(value: string): string {
  return encodeURIComponent(value);
}

// ---------------------------------------------------------------------------
// account — public (mounted before the gateway auth middleware) (Req 2.1, 3.1)
// ---------------------------------------------------------------------------

export const account = {
  /** POST /api/copilot/account/sign-up — create an Account (Req 2.1). Public. */
  signUp(input: SignUpInput): RequestDescriptor {
    return descriptor('POST', `${API_COPILOT_BASE}/account/sign-up`, false, {
      body: input,
    });
  },

  /** POST /api/copilot/account/sign-in — establish a Session (Req 3.1). Public. */
  signIn(input: SignInInput): RequestDescriptor {
    return descriptor('POST', `${API_COPILOT_BASE}/account/sign-in`, false, {
      body: input,
    });
  },
};

// ---------------------------------------------------------------------------
// workspaces — protected (Req 5.2, 5.5, 5.6)
// ---------------------------------------------------------------------------

export const workspaces = {
  /** POST /api/copilot/workspaces — create a Workspace (Req 5.2). */
  create(name: string): RequestDescriptor {
    return descriptor('POST', `${API_COPILOT_BASE}/workspaces`, true, {
      body: { name },
    });
  },

  /** GET /api/copilot/workspaces/:workspaceId/access — access decision (Req 5.5). */
  access(workspaceId: string): RequestDescriptor {
    return descriptor(
      'GET',
      `${API_COPILOT_BASE}/workspaces/${seg(workspaceId)}/access`,
      true,
    );
  },

  /** POST /api/copilot/workspaces/:workspaceId/members — add a member (Req 5.6). */
  addMember(workspaceId: string, userId: string): RequestDescriptor {
    return descriptor(
      'POST',
      `${API_COPILOT_BASE}/workspaces/${seg(workspaceId)}/members`,
      true,
      { body: { userId } },
    );
  },

  /** DELETE /api/copilot/workspaces/:workspaceId/members/:userId — remove a member. */
  removeMember(workspaceId: string, userId: string): RequestDescriptor {
    return descriptor(
      'DELETE',
      `${API_COPILOT_BASE}/workspaces/${seg(workspaceId)}/members/${seg(userId)}`,
      true,
    );
  },
};

// ---------------------------------------------------------------------------
// planQuota — protected (Req 15.3)
// ---------------------------------------------------------------------------

export const planQuota = {
  /** GET /api/copilot/plan-quota/limits — tier limits incl. query quota (Req 15.3). */
  limits(): RequestDescriptor {
    return descriptor('GET', `${API_COPILOT_BASE}/plan-quota/limits`, true);
  },

  /** GET /api/copilot/plan-quota/tier — the account's plan tier. */
  tier(): RequestDescriptor {
    return descriptor('GET', `${API_COPILOT_BASE}/plan-quota/tier`, true);
  },
};

// ---------------------------------------------------------------------------
// knowledgeEngine — protected (Req 6.1, 6.2, 7.2)
// ---------------------------------------------------------------------------

export const knowledgeEngine = {
  /**
   * POST /api/copilot/knowledge-engine/uploads — upload a specification (Req 6.1).
   * Gated: without an Active_Workspace no descriptor is produced (Req 6.2).
   * The declared content type and UTF-8 spec text are sent in the body.
   */
  upload(
    activeWorkspaceId: string | null,
    file: UploadFile,
    apiId?: string,
  ): GatedDescriptor {
    if (!activeWorkspaceId) {
      return {
        kind: 'selection_required',
        requires: 'workspace',
        message: 'Select a workspace before uploading a specification',
      };
    }
    const body: Record<string, unknown> = {
      workspaceId: activeWorkspaceId,
      spec: new TextDecoder().decode(file.bytes),
      contentType: file.contentType,
    };
    if (apiId !== undefined) {
      body.apiId = apiId;
    }
    return descriptor('POST', `${API_COPILOT_BASE}/knowledge-engine/uploads`, true, {
      body,
    });
  },

  /**
   * POST /api/copilot/knowledge-engine/versions/select — scope to a version (Req 7.2).
   * The previously active selection is forwarded so the backend can retain it on
   * an unavailable-version rejection (Req 7.4).
   */
  selectVersion(
    selection: apiCopilotShared.ApiSelection,
    previousSelection?: apiCopilotShared.ApiSelection,
  ): RequestDescriptor {
    const body: Record<string, unknown> = {
      workspaceId: selection.workspaceId,
      apiId: selection.apiId,
      version: selection.version,
    };
    if (previousSelection !== undefined) {
      body.previousSelection = previousSelection;
    }
    return descriptor(
      'POST',
      `${API_COPILOT_BASE}/knowledge-engine/versions/select`,
      true,
      { body },
    );
  },
};

// ---------------------------------------------------------------------------
// queryEngine — protected (Req 8.1, 8.3, 9.1, 7.5)
// ---------------------------------------------------------------------------

export const queryEngine = {
  /**
   * POST /api/copilot/query-engine/questions — natural-language Q&A (Req 8.1).
   * Gated on an Active_API_Version (Req 8.3, 7.5). Uses the 30 s Q&A timeout (Req 8.7).
   */
  ask(
    selection: apiCopilotShared.ApiSelection | null,
    question: string,
  ): GatedDescriptor {
    if (!selection) {
      return apiVersionRequired();
    }
    return descriptor('POST', `${API_COPILOT_BASE}/query-engine/questions`, true, {
      body: { question, selection },
      timeoutMs: QA_TIMEOUT_MS,
    });
  },

  /**
   * POST /api/copilot/query-engine/search — semantic search (Req 9.1).
   * Gated on an Active_API_Version (Req 7.5).
   */
  search(
    selection: apiCopilotShared.ApiSelection | null,
    query: string,
  ): GatedDescriptor {
    if (!selection) {
      return apiVersionRequired();
    }
    return descriptor('POST', `${API_COPILOT_BASE}/query-engine/search`, true, {
      body: { query, selection },
    });
  },
};

// ---------------------------------------------------------------------------
// executionEngine — protected (Req 11.1, 11.3)
// ---------------------------------------------------------------------------

export const executionEngine = {
  /** POST /api/copilot/execution-engine/plan — resolve required values (Req 11.1). */
  plan(request: executionEngineTypes.PlanExecutionRequest): RequestDescriptor {
    return descriptor('POST', `${API_COPILOT_BASE}/execution-engine/plan`, true, {
      body: request,
    });
  },

  /** POST /api/copilot/execution-engine/execute — send the planned request (Req 11.3). */
  execute(plan: executionEngineTypes.ExecutionPlan): RequestDescriptor {
    return descriptor('POST', `${API_COPILOT_BASE}/execution-engine/execute`, true, {
      body: { plan },
    });
  },
};

// ---------------------------------------------------------------------------
// authAssistant — protected (Req 10.1, 10.2)
// ---------------------------------------------------------------------------

export const authAssistant = {
  /** GET /api/copilot/auth-assistant/schemes — supported auth schemes (Req 10.1). */
  schemes(): RequestDescriptor {
    return descriptor('GET', `${API_COPILOT_BASE}/auth-assistant/schemes`, true);
  },

  /** POST /api/copilot/auth-assistant/credentials — register a credential (Req 10.2). */
  setCredential(input: CredentialInput): RequestDescriptor {
    return descriptor('POST', `${API_COPILOT_BASE}/auth-assistant/credentials`, true, {
      body: input,
    });
  },
};

// ---------------------------------------------------------------------------
// codeGenerator — protected (Req 13.1, 13.2, 13.4, 7.5)
// ---------------------------------------------------------------------------

export const codeGenerator = {
  /** GET /api/copilot/code-generator/languages — supported languages (Req 13.1). */
  languages(): RequestDescriptor {
    return descriptor('GET', `${API_COPILOT_BASE}/code-generator/languages`, true);
  },

  /**
   * POST /api/copilot/code-generator/generate — generate a Code_Snippet (Req 13.2).
   * Gated on an Active_API_Version (Req 13.4, 7.5).
   */
  generate(
    selection: apiCopilotShared.ApiSelection | null,
    endpointId: string,
    language: string,
  ): GatedDescriptor {
    if (!selection) {
      return apiVersionRequired();
    }
    return descriptor('POST', `${API_COPILOT_BASE}/code-generator/generate`, true, {
      body: { selection, endpointId, language },
    });
  },
};

// ---------------------------------------------------------------------------
// testingConsole — protected (Req 12.1, 12.4)
// ---------------------------------------------------------------------------

export const testingConsole = {
  /** POST /api/copilot/testing-console/runs — run a request from the console (Req 12.1). */
  run(input: ConsoleRunInput): RequestDescriptor {
    return descriptor('POST', `${API_COPILOT_BASE}/testing-console/runs`, true, {
      body: input,
    });
  },

  /**
   * GET /api/copilot/testing-console/:workspaceId/history — the workspace's saved
   * run history, returned most-recent-first for display (Req 12.3). The relative
   * path follows the router's `/:workspaceId/*` convention (see the replay route).
   */
  history(workspaceId: string): RequestDescriptor {
    return descriptor(
      'GET',
      `${API_COPILOT_BASE}/testing-console/${seg(workspaceId)}/history`,
      true,
    );
  },

  /**
   * POST /api/copilot/testing-console/:workspaceId/replays/:historyId — replay a
   * saved run (Req 12.4).
   */
  replay(workspaceId: string, historyId: string): RequestDescriptor {
    return descriptor(
      'POST',
      `${API_COPILOT_BASE}/testing-console/${seg(workspaceId)}/replays/${seg(historyId)}`,
      true,
    );
  },
};

// ---------------------------------------------------------------------------
// conversations — protected (Req 14.1)
// ---------------------------------------------------------------------------

export const conversations = {
  /** GET /api/copilot/conversations/:workspaceId — conversation history (Req 14.1). */
  list(workspaceId: string): RequestDescriptor {
    return descriptor(
      'GET',
      `${API_COPILOT_BASE}/conversations/${seg(workspaceId)}`,
      true,
    );
  },
};

// ---------------------------------------------------------------------------
// usageAnalytics — protected (Req 15.1)
// ---------------------------------------------------------------------------

export const usageAnalytics = {
  /** GET /api/copilot/usage-analytics/:workspaceId/dashboard — dashboard data (Req 15.1). */
  dashboard(workspaceId: string): RequestDescriptor {
    return descriptor(
      'GET',
      `${API_COPILOT_BASE}/usage-analytics/${seg(workspaceId)}/dashboard`,
      true,
    );
  },
};

// ---- Shared gating helper -------------------------------------------------

/** The selection-required indication for version-scoped operations (Req 7.5). */
function apiVersionRequired(): SelectionRequired {
  return {
    kind: 'selection_required',
    requires: 'apiVersion',
    message: 'Select an API version before continuing',
  };
}

// ---------------------------------------------------------------------------
// Aggregate client — one object exposing every domain's builders.
// ---------------------------------------------------------------------------

/**
 * The typed HTTP API client: pure `RequestDescriptor` builders grouped by
 * domain, each mapping to a real `/api/copilot/*` endpoint.
 */
export const copilotApiClient = {
  account,
  workspaces,
  planQuota,
  knowledgeEngine,
  queryEngine,
  executionEngine,
  authAssistant,
  codeGenerator,
  testingConsole,
  conversations,
  usageAnalytics,
} as const;

export type CopilotApiClient = typeof copilotApiClient;
