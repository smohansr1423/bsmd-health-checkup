/**
 * API Copilot AI — Product-Shared Types
 *
 * Cross-domain types and the normalized data model shared by every API Copilot AI
 * domain service (knowledge-engine, query-engine, execution-engine, auth-assistant,
 * code-generator, testing-console, workspace, account-auth, conversation,
 * usage-analytics, plan-quota).
 *
 * These types are grouped in a dedicated product module so the API Copilot AI
 * surface remains cleanly separable from the surrounding health-checkup product.
 *
 * Validates: Requirements 1.1, 6.1, 16.1, 17.1
 */

// ---------------------------------------------------------------------------
// Core cross-domain enumerations
// ---------------------------------------------------------------------------

/** Subscription level of an account (Req 17.1). Exactly one tier per account. */
export type PlanTier = 'starter' | 'pro' | 'enterprise';

/**
 * Authentication schemes supported for target APIs (Req 6.1).
 * Used both in normalized metadata and by the Auth Assistant.
 */
export type AuthScheme =
  | 'oauth2'
  | 'jwt'
  | 'apiKey'
  | 'bearer'
  | 'basic'
  | 'clientCredentials'
  | 'pkce';

/** Categories of billable/measurable usage recorded for analytics (Req 16.1). */
export type UsageEventType = 'ai_query' | 'api_execution' | 'code_generation';

/** Source specification format detected during parsing. */
export type SpecFormat = 'openapi-3' | 'swagger-2';

/** HTTP methods captured from a specification. */
export type HttpMethod =
  | 'GET'
  | 'POST'
  | 'PUT'
  | 'PATCH'
  | 'DELETE'
  | 'HEAD'
  | 'OPTIONS';

/** Code-generation target languages. MVP: python, javascript, curl. */
export type Language =
  | 'python'
  | 'javascript'
  | 'curl'
  | 'java'
  | 'typescript'
  | 'csharp'
  | 'go'
  | 'php'
  | 'ruby'
  | 'kotlin'
  | 'swift'
  | 'powershell';

/** Loosely-typed JSON Schema fragment as normalized from a specification. */
export type JsonSchema = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Identity references
// ---------------------------------------------------------------------------

/**
 * A reference to a user making a request. Used for access-control decisions and
 * for attributing conversation entries and usage events.
 */
export interface UserRef {
  userId: string;
  accountId: string;
}

// ---------------------------------------------------------------------------
// Normalized API metadata (Knowledge Engine) — Req 1, 2
// ---------------------------------------------------------------------------

export interface ParameterMeta {
  name: string;
  location: 'path' | 'query' | 'header' | 'cookie' | 'body';
  required: boolean;
  schema: JsonSchema;
  example?: unknown;
}

export interface AuthSchemeMeta {
  id: string;
  type: AuthScheme;
  details: Record<string, unknown>;
}

export interface RateLimitMeta {
  /** Free-form identifier (e.g., header name or policy name) from the spec. */
  id: string;
  limit?: number;
  windowSeconds?: number;
  details?: Record<string, unknown>;
}

export interface EndpointMeta {
  /** Stable id: `${method} ${path}`. */
  endpointId: string;
  path: string;
  method: HttpMethod;
  parameters: ParameterMeta[];
  requestSchema?: JsonSchema;
  /** Response schemas keyed by status code. */
  responseSchemas: Record<string, JsonSchema>;
  /** Response examples keyed by status code. */
  responseExamples: Record<string, unknown>;
  errorCodes: string[];
  authSchemeRefs: string[];
}

export interface ApiMetadata {
  apiId: string;
  title: string;
  sourceFormat: SpecFormat;
  endpoints: EndpointMeta[];
  authSchemes: AuthSchemeMeta[];
  rateLimits: RateLimitMeta[];
}

// ---------------------------------------------------------------------------
// Versioning, selection, and scope — Req 2
// ---------------------------------------------------------------------------

export interface ApiVersion {
  apiId: string;
  workspaceId: string;
  /** Monotonically increasing, starts at 1. */
  version: number;
  metadata: ApiMetadata;
  createdAt: Date;
}

/** The active API/version scope for questions, execution, and code generation. */
export interface ApiSelection {
  workspaceId: string;
  apiId: string;
  version: number;
}

/** Scope passed to the vector store to restrict search to a selected API/version. */
export interface ApiScope {
  apiId: string;
  version: number;
}

// ---------------------------------------------------------------------------
// Search & RAG — Req 3, 4
// ---------------------------------------------------------------------------

export interface IndexedChunk {
  chunkId: string;
  apiId: string;
  version: number;
  /** endpointId or doc section, used for citation (Req 4.6). */
  sourceRef: string;
  text: string;
  embedding: number[];
}

export interface ScoredChunk {
  chunk: IndexedChunk;
  /** 0.0..1.0 semantic relevance. */
  score: number;
}

/** A chunk supplied to the LLM as grounding context. */
export interface RetrievedChunk {
  sourceRef: string;
  text: string;
}

export interface Answer {
  text: string;
  grounded: boolean;
  /** sourceRefs used to produce the answer (Req 4.6). */
  citations: string[];
}

// ---------------------------------------------------------------------------
// Credentials & tokens — Req 6
// ---------------------------------------------------------------------------

/** Opaque ciphertext envelope. Credential values are never plaintext at rest. */
export interface Ciphertext {
  /** Base64-encoded ciphertext payload. */
  data: string;
  /** Base64-encoded initialization vector / nonce. */
  iv: string;
  /** Base64-encoded authentication tag (AES-GCM). */
  authTag: string;
  /** Identifier of the key-encryption key (KEK) used (envelope encryption). */
  keyId: string;
  /**
   * Envelope encryption: the per-message data key (DEK) wrapped by the KEK,
   * encoded as `keyIv:keyAuthTag:wrappedKey` (each base64). Present when a real
   * envelope provider is used; absent for the fake in-memory provider.
   */
  encryptedDataKey?: string;
}

export interface StoredCredential {
  credentialId: string;
  targetApiRef: string;
  scheme: AuthScheme;
  /** Encrypted; never plaintext at rest (Req 6.8). */
  ciphertext: Ciphertext;
}

export interface AuthMaterial {
  /** Headers applied to the outbound request. */
  headers: Record<string, string>;
  /** Drives token reuse/refresh decisions (Req 6.4, 6.5). */
  expiresAt?: Date;
}

// ---------------------------------------------------------------------------
// Execution & console — Req 5, 8
// ---------------------------------------------------------------------------

export interface OutboundRequest {
  method: HttpMethod;
  url: string;
  headers: Record<string, string>;
  body?: string;
}

/** Immutable snapshot of a sent request, saved to history. */
export interface OutboundRequestSnapshot {
  method: HttpMethod;
  url: string;
  headers: Record<string, string>;
  body?: string;
}

export interface OutboundResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

export type ExecutionOutcome = 'success' | 'error' | 'timeout' | 'network_error';

export interface ExecutionResult {
  statusCode: number;
  headers: Record<string, string>;
  /** Pretty-printed, structure-preserving body (Req 5.4). */
  body: string;
  elapsedMs: number;
  outcome: ExecutionOutcome;
}

export interface HistoryEntry {
  historyId: string;
  workspaceId: string;
  request: OutboundRequestSnapshot;
  result: ExecutionResult;
  createdAt: Date;
}

// ---------------------------------------------------------------------------
// Accounts, workspaces, conversations, usage, plans
// ---------------------------------------------------------------------------

export interface Account {
  accountId: string;
  email: string;
  /** Salted hash — never plaintext (Req 18.1). */
  passwordHash: string;
  tier: PlanTier;
}

/** Product session for the API Copilot AI application (Req 13.4). */
export interface ProductSession {
  sessionId: string;
  accountId: string;
  issuedAt: Date;
  lastActivityAt: Date;
  expiresAt: Date;
}

export interface Workspace {
  workspaceId: string;
  ownerAccountId: string;
  name: string;
  memberUserIds: string[];
}

export interface ConversationEntry {
  entryId: string;
  workspaceId: string;
  userId: string;
  question: string;
  answer: Answer;
  answeredAt: Date;
}

/** A usage event recorded for analytics (Req 16.1). */
export interface UsageEvent {
  workspaceId: string;
  type: UsageEventType;
  timestamp: Date;
}

export interface QuotaState {
  accountId: string;
  billingPeriodStart: Date;
  queryCount: number;
}

// ---------------------------------------------------------------------------
// Dependency-injection pattern (idGenerator / dateProvider) — shared by all services
// ---------------------------------------------------------------------------

/** Injectable identifier generator. Deterministic fakes are supplied in tests. */
export type IdGenerator = () => string;

/** Injectable clock. Deterministic fakes are supplied in tests. */
export type DateProvider = () => Date;

/**
 * Base dependencies every API Copilot AI service accepts via a
 * `Partial<{Domain}Dependencies>` constructor argument. Domain-specific
 * dependency interfaces extend this base.
 */
export interface BaseServiceDependencies {
  idGenerator: IdGenerator;
  dateProvider: DateProvider;
}

/** Default id generator: prefixed timestamp + random suffix. */
export const defaultIdGenerator: IdGenerator = () =>
  `AC_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;

/** Default date provider returning the current system date. */
export const defaultDateProvider: DateProvider = () => new Date();
