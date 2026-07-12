/**
 * API Copilot AI — Product-Shared barrel export.
 *
 * Cross-domain types, infrastructure abstractions (with in-memory/fake
 * defaults), per-domain repository interfaces, and event-bus wiring shared by
 * every API Copilot AI domain service.
 *
 * Validates: Requirements 1.1, 6.1, 16.1, 17.1
 */

// Cross-domain types + DI pattern
export type {
  PlanTier,
  AuthScheme,
  UsageEventType,
  SpecFormat,
  HttpMethod,
  Language,
  JsonSchema,
  UserRef,
  ParameterMeta,
  AuthSchemeMeta,
  RateLimitMeta,
  EndpointMeta,
  ApiMetadata,
  ApiVersion,
  ApiSelection,
  ApiScope,
  IndexedChunk,
  ScoredChunk,
  RetrievedChunk,
  Answer,
  Ciphertext,
  StoredCredential,
  AuthMaterial,
  OutboundRequest,
  OutboundRequestSnapshot,
  OutboundResponse,
  ExecutionOutcome,
  ExecutionResult,
  HistoryEntry,
  Account,
  ProductSession,
  Workspace,
  ConversationEntry,
  UsageEvent,
  QuotaState,
  IdGenerator,
  DateProvider,
  BaseServiceDependencies,
} from './shared.types';

export { defaultIdGenerator, defaultDateProvider } from './shared.types';

// Infrastructure abstractions + in-memory/fake defaults
export type {
  VectorStore,
  EmbeddingProvider,
  LlmProvider,
  GroundedAnswer,
  CryptoProvider,
  HttpClient,
  InfrastructureProviders,
} from './infrastructure';

export {
  InMemoryVectorStore,
  FakeEmbeddingProvider,
  FakeLlmProvider,
  InMemoryCryptoProvider,
  FakeHttpClient,
  createInMemoryInfrastructure,
} from './infrastructure';

// Per-domain repository interfaces + in-memory defaults
export type {
  AccountRepository,
  SessionRepository,
  WorkspaceRepository,
  QuotaStateRepository,
  ApiVersionRepository,
  CredentialRepository,
  HistoryRepository,
  ConversationRepository,
  UsageRepository,
} from './repositories';

export {
  MAX_HISTORY_ENTRIES,
  InMemoryAccountRepository,
  InMemorySessionRepository,
  InMemoryWorkspaceRepository,
  InMemoryQuotaStateRepository,
  InMemoryApiVersionRepository,
  InMemoryCredentialRepository,
  InMemoryHistoryRepository,
  InMemoryConversationRepository,
  InMemoryUsageRepository,
} from './repositories';

// Event-bus wiring
export type {
  EventBus,
  EventHandler,
  Subscription,
  ProductEventBus,
  UsageEventHandler,
} from './events';

export { InMemoryEventBus, InMemoryProductEventBus } from './events';
