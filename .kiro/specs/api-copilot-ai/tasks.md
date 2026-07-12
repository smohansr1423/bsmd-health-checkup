# Implementation Plan: API Copilot AI

## Overview

This plan implements the MVP boundary defined in the requirements and design: authentication and workspace management, specification upload and metadata extraction, semantic indexing and search, natural-language Q&A with RAG, authenticated API execution, an interactive testing console, code generation (Python/JavaScript/cURL), conversation history, an analytics dashboard, plan/quota enforcement, and cross-cutting security.

Implementation is in **TypeScript**, following the existing monorepo conventions: each domain lives under `packages/services/src/{domain}/` with `{domain}.service.ts`, `{domain}.types.ts`, `{domain}.errors.ts`, `{domain}.validators.ts`, `index.ts`, and co-located `*.test.ts` / `*.property.test.ts` files. Services take a `Partial<{Domain}Dependencies>` constructor (repositories, event bus, `idGenerator`, `dateProvider`, and injected providers) with `InMemory*` defaults. HTTP is exposed through the Express BFF in `packages/api-gateway`. Property tests use `fast-check` (min 100 iterations), tagged `// Feature: api-copilot-ai, Property N: <text>` and `// Validates: Requirements X.Y`.

Each task builds on the previous ones and ends with wiring everything into the gateway composition root, so no code is left orphaned.

## Tasks

- [x] 1. Set up product foundation: shared types and infrastructure abstractions
  - [x] 1.1 Create shared product types and infrastructure interfaces
    - Add shared cross-domain types (`PlanTier`, `AuthScheme`, `UsageEventType`, `ApiSelection`, `UserRef`) in a product-shared module under `packages/services/src`
    - Define infrastructure interfaces: `VectorStore`, `EmbeddingProvider`, `LlmProvider`, `CryptoProvider`, `HttpClient`, and per-domain repository interfaces, each with an `InMemory*`/fake default
    - Wire the `EventBus`/`InMemoryEventBus` abstraction from `@health-checkup/shared` for the new product domains
    - Establish the `idGenerator: () => string` and `dateProvider: () => Date` injection pattern for all new services
    - _Requirements: 1.1, 6.1, 16.1, 17.1_

- [x] 2. Implement Plan & Quota service
  - [x] 2.1 Implement PlanQuotaService with tier limits and quota accounting
    - Create `plan-quota` domain (`.service.ts`, `.types.ts`, `.errors.ts`, `.validators.ts`, `index.ts`)
    - Implement `tierOf`, `checkAndReserveQuery`, `canAddApi`, `resetBillingPeriod`, `applyTierChange`
    - Encode Starter (1 API / 100 queries), Pro (unlimited APIs / 10,000 queries), Enterprise (config-record limits); reject at quota leaving stored count unchanged; apply upgrade/downgrade rules
    - Define `ApiLimitReachedError` and `QuotaExceededError`
    - _Requirements: 17.1, 17.2, 17.3, 17.4, 17.5, 17.6, 17.7, 17.8, 17.9, 2.4, 2.5_
  - [x]* 2.2 Write property test for API count limit
    - **Property 8: API count never exceeds the tier limit**
    - **Validates: Requirements 2.4, 2.5, 17.5**
  - [x]* 2.3 Write property test for query quota enforcement
    - **Property 48: Query quota is never exceeded**
    - **Validates: Requirements 17.4, 17.9**
  - [x]* 2.4 Write property test for billing-period reset
    - **Property 49: Billing-period reset restores capacity**
    - **Validates: Requirements 17.7**
  - [x]* 2.5 Write property test for tier upgrade
    - **Property 50: Tier upgrade applies new limits and retains count**
    - **Validates: Requirements 17.8**
  - [x]* 2.6 Write unit tests for Enterprise config and downgrade edge cases
    - Cover Enterprise configuration-record limits and immediate downgrade blocking
    - _Requirements: 17.1, 17.6, 17.9_

- [x] 3. Implement Account Auth service
  - [x] 3.1 Implement AccountAuthService sign-up, sign-in, sessions, and lockout
    - Create `account-auth` domain files
    - Implement `signUp` (email/password/required-field validation, duplicate-email rejection, salted password hashing — never plaintext) and `signIn` (session with 30-min inactivity expiry, lockout for 15 min after 5 failed attempts within 15 min)
    - Define `EmailAlreadyRegisteredError`, `InvalidRegistrationError`, `AccountLockedError`
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 18.1_
  - [x]* 3.2 Write property test for valid sign-up
    - **Property 34: Valid sign-up creates a retrievable account**
    - **Validates: Requirements 13.1**
  - [x]* 3.3 Write property test for email uniqueness
    - **Property 35: Email uniqueness is enforced**
    - **Validates: Requirements 13.2**
  - [x]* 3.4 Write property test for invalid registration rejection
    - **Property 36: Invalid registrations are rejected with the offending detail**
    - **Validates: Requirements 13.3**
  - [x]* 3.5 Write property test for session validity
    - **Property 37: Session validity follows the inactivity rule**
    - **Validates: Requirements 13.4, 13.5**
  - [x]* 3.6 Write property test for account lockout
    - **Property 38: Lockout after repeated failures**
    - **Validates: Requirements 13.6**

- [x] 4. Implement Workspace service and access control
  - [x] 4.1 Implement WorkspaceService create, authorize, and membership management
    - Create `workspace` domain files
    - Implement `create` (name length 1..100), `authorize` (owner or authorized member only), `addMember` (capped by tier member limit), `removeMember` (revoke access, retain data)
    - Provide the central access-control decision used by conversation and analytics reads; define `AuthorizationError`
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.7, 18.4, 18.5_
  - [x]* 4.2 Write property test for workspace name bounds
    - **Property 39: Workspace name length bounds**
    - **Validates: Requirements 14.1, 14.2**
  - [x]* 4.3 Write property test for isolation and access control
    - **Property 40: Workspace isolation and access control**
    - **Validates: Requirements 14.3, 14.4, 15.4, 16.5, 18.4, 18.5**
  - [x]* 4.4 Write property test for member count limit
    - **Property 41: Member count never exceeds the tier limit**
    - **Validates: Requirements 14.5, 14.6**
  - [x]* 4.5 Write property test for member removal
    - **Property 42: Member removal revokes access but retains data**
    - **Validates: Requirements 14.7**

- [x] 5. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Implement Knowledge Engine: parsing, storage, and versioning
  - [x] 6.1 Implement SpecParser for OpenAPI 3.x and Swagger 2.0
    - Create `knowledge-engine` domain files and the `SpecParser`
    - Enforce 25 MB size and YAML/JSON format gate before parsing; detect format, validate, dereference `$ref`s, and normalize both formats into `ApiMetadata`
    - Capture every endpoint, method, parameter, request/response schema, auth scheme, response example, error code, and rate-limit entry
    - On parse failure raise `SpecParseError` carrying the first-invalid-element location and retain no partial metadata; raise `UnsupportedUploadError` and `NoMetadataFoundError` as appropriate
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6_
  - [x]* 6.2 Write property test for metadata extraction completeness
    - **Property 1: Metadata extraction is complete**
    - **Validates: Requirements 1.1, 1.2, 1.3**
  - [x]* 6.3 Write property test for invalid-spec rejection
    - **Property 2: Invalid specifications are rejected with no partial state**
    - **Validates: Requirements 1.4**
  - [x] 6.4 Implement metadata storage, versioning, and version selection
    - Implement `KnowledgeEngine.uploadSpecification` (store `ApiMetadata` against owning workspace; discard partial and leave workspace unchanged on storage failure) and `selectVersion`
    - Create new immutable versions with monotonically increasing numbers starting at 1; enforce plan-quota `canAddApi` before adding an API
    - Define `MetadataStorageError` and `VersionUnavailableError` (prior selection retained)
    - _Requirements: 1.7, 1.8, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7_
  - [x]* 6.5 Write property test for storage round-trip
    - **Property 3: Metadata storage round-trip**
    - **Validates: Requirements 1.7, 2.1**
  - [x]* 6.6 Write property test for storage-failure atomicity
    - **Property 4: Storage failure preserves prior state**
    - **Validates: Requirements 1.8, 2.2**
  - [x]* 6.7 Write property test for version numbering
    - **Property 5: Version numbering is a retained, increasing sequence**
    - **Validates: Requirements 2.3**
  - [x]* 6.8 Write property test for version-selection persistence
    - **Property 6: Version selection persists until reselected**
    - **Validates: Requirements 2.6, 7.5**
  - [x]* 6.9 Write property test for invalid version selection
    - **Property 7: Invalid version selection retains prior scope**
    - **Validates: Requirements 2.7, 7.7**
  - [x]* 6.10 Write unit tests for upload rejections
    - Cover size/format rejection and parsed-but-no-metadata rejection
    - _Requirements: 1.5, 1.6_

- [x] 7. Implement semantic indexing and search
  - [x] 7.1 Implement IndexingService
    - Chunk extracted metadata, generate embeddings via `EmbeddingProvider`, and upsert into `VectorStore` within 60s of extraction
    - On embedding/storage failure, retain previously indexed content unchanged and surface an indexing-failure indication
    - _Requirements: 3.1, 3.5_
  - [x]* 7.2 Write property test for chunk queryability
    - **Property 9: Every indexed chunk becomes queryable**
    - **Validates: Requirements 3.1**
  - [x]* 7.3 Write property test for index intactness on failure
    - **Property 11: Index remains intact on indexing failure**
    - **Validates: Requirements 3.5**
  - [x] 7.4 Implement QueryEngine.semanticSearch
    - Validate query length 1..1000; scope results to selected API/version; drop hits below score 0.7; return ≤ 50 hits ordered by non-increasing relevance; empty result with "no relevant content" message when nothing qualifies
    - Raise `SearchUnavailableError` (no partial results) when the vector store is unavailable; define `InvalidQueryLengthError`
    - _Requirements: 3.2, 3.3, 3.4, 3.6, 3.7_
  - [x]* 7.5 Write property test for scoped/thresholded/ranked results
    - **Property 10: Search results are scoped, thresholded, and ranked**
    - **Validates: Requirements 3.2, 3.3, 3.4**
  - [x]* 7.6 Write property test for query length validation
    - **Property 12: Query and question length validation**
    - **Validates: Requirements 3.6, 4.8**
  - [x]* 7.7 Write unit test for vector-store unavailability
    - Assert temporary-unavailability error without partial results
    - _Requirements: 3.7_

- [x] 8. Implement natural-language Q&A (RAG)
  - [x] 8.1 Implement QueryEngine.ask with grounded generation
    - Reserve quota via PlanQuotaService; reject when no API selected (`NoApiSelectedError`); validate question length 1..1000
    - Retrieve chunks; when nothing scores ≥ 0.7 return the "not available in the uploaded API knowledge" response without fabricating; otherwise generate a grounded answer via `LlmProvider` citing every retrieved source chunk
    - Include endpoint path/method/required parameters for endpoint answers and enumerate every scheme for auth questions
    - Emit progress indication after 3s, hard timeout at 30s with `AnswerGenerationError`, preserving selected API state; emit an `ai_query` usage event
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 19.2, 19.3, 19.4_
  - [x]* 8.2 Write property test for grounding/refusal
    - **Property 13: Answers are grounded or refused**
    - **Validates: Requirements 4.1, 4.5**
  - [x]* 8.3 Write property test for endpoint answer content
    - **Property 14: Endpoint answers include path, method, and required parameters**
    - **Validates: Requirements 4.2**
  - [x]* 8.4 Write property test for authentication answers
    - **Property 15: Authentication answers enumerate every scheme**
    - **Validates: Requirements 4.3**
  - [x]* 8.5 Write property test for citations
    - **Property 16: Grounded answers cite their sources**
    - **Validates: Requirements 4.6**
  - [x]* 8.6 Write property test for API-selection requirement
    - **Property 17: Questions require a selected API**
    - **Validates: Requirements 4.7**
  - [x]* 8.7 Write property test for generation-failure retry preservation
    - **Property 18: Generation failure preserves selection for retry**
    - **Validates: Requirements 4.9, 19.4**

- [x] 9. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 10. Implement Auth Assistant
  - [x] 10.1 Implement CryptoProvider envelope encryption and AuthAssistant
    - Create `auth-assistant` domain files and an AES-256-GCM envelope `CryptoProvider`
    - Implement `supportedSchemes` (OAuth2, JWT, ApiKey, Bearer, Basic, ClientCredentials, PKCE) and `ensureToken` (acquire with 30s cap, reuse valid tokens, auto-refresh expired tokens when a refresh mechanism exists)
    - Store credentials encrypted at rest; make AuthAssistant the sole decryptor; construct every `AuthError` to identify target + scheme + reason with no credential value in message, details, or serialized form
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9_
  - [x]* 10.2 Write property test for token reuse
    - **Property 24: Valid tokens are reused**
    - **Validates: Requirements 6.4**
  - [x]* 10.3 Write property test for token auto-refresh
    - **Property 25: Expired tokens auto-refresh when a refresh mechanism exists**
    - **Validates: Requirements 6.5**
  - [x]* 10.4 Write property test for credential non-exposure
    - **Property 26: Credentials are never exposed in plaintext**
    - **Validates: Requirements 6.3, 6.6, 6.7, 6.8, 6.9**

- [x] 11. Implement Execution Engine
  - [x] 11.1 Implement ExecutionEngine planExecution and execute
    - Create `execution-engine` domain files; determine required path/query/body/auth values from metadata and prompt for any missing values without sending (`MissingParametersError`)
    - Send via `HttpClient` (30s timeout) using AuthAssistant material; return status, headers, and pretty-printed structure-preserving body; pass through unmodified error status/body
    - Distinguish timeout (`ExecutionTimeoutError`) from network failure (`NetworkFailureError`), retaining entered values in both cases
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7_
  - [x]* 11.2 Write property test for required-value planning
    - **Property 19: Execution plan requires exactly the metadata's required values**
    - **Validates: Requirements 5.1**
  - [x]* 11.3 Write property test for withheld sends
    - **Property 20: No request is sent while required values are missing**
    - **Validates: Requirements 5.2**
  - [x]* 11.4 Write property test for response fidelity
    - **Property 21: Response fidelity**
    - **Validates: Requirements 5.3, 5.5, 8.1**
  - [x]* 11.5 Write property test for body formatting
    - **Property 22: Body formatting is structure-preserving**
    - **Validates: Requirements 5.4**
  - [x]* 11.6 Write property test for transient failure classification
    - **Property 23: Transient failures classify correctly and retain input**
    - **Validates: Requirements 5.6, 5.7, 8.2**

- [x] 12. Implement Interactive Testing Console
  - [x] 12.1 Implement TestingConsole run and replay
    - Create `testing-console` domain files wrapping the Execution Engine
    - Display request (method, URL, headers, body) and response (status, headers, body, elapsed ms) on success; on timeout/network error stop and describe failure type while preserving params for re-editing
    - Save every completed run to a per-workspace ring buffer capped at 500, evicting the oldest; replay uses saved params/auth and refuses to send with `SavedAuthInvalidError` when saved auth is missing/invalid/expired, retaining the saved request
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_
  - [x]* 12.2 Write property test for bounded history
    - **Property 31: History is a bounded most-recent ring buffer**
    - **Validates: Requirements 8.3**
  - [x]* 12.3 Write property test for replay reproduction
    - **Property 32: Replay reproduces the saved request**
    - **Validates: Requirements 8.4**
  - [x]* 12.4 Write property test for replay with unusable auth
    - **Property 33: Replay with unusable auth does not send**
    - **Validates: Requirements 8.5**

- [x] 13. Implement Code Generator
  - [x] 13.1 Implement CodeGenerator for Python, JavaScript, and cURL
    - Create `code-generator` domain files; generate syntactically complete snippets scoped to the selected version's metadata, including all required parameters and the endpoint's auth mechanism
    - Render optional parameters as commented/placeholder entries that do not break syntactic completeness
    - Raise `EndpointUnavailableError` (leave prior snippet unchanged) when the endpoint definition is missing, `VersionUnavailableError` when no valid version is selected, and `UnsupportedLanguageError` listing supported languages for unsupported requests
    - _Requirements: 7.1, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8_
  - [x]* 13.2 Write property test for required params and auth in snippets
    - **Property 27: Generated snippets include required parameters and authentication**
    - **Validates: Requirements 7.1, 7.3, 7.5**
  - [x]* 13.3 Write property test for optional-parameter placeholders
    - **Property 28: Optional parameters appear as inert placeholders**
    - **Validates: Requirements 7.4**
  - [x]* 13.4 Write property test for missing endpoint definition
    - **Property 29: Missing endpoint definition yields no snippet**
    - **Validates: Requirements 7.6**
  - [x]* 13.5 Write property test for unsupported language rejection
    - **Property 30: Unsupported languages are rejected with the supported list**
    - **Validates: Requirements 7.8**

- [x] 14. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 15. Implement Conversation History
  - [x] 15.1 Implement ConversationService record and list
    - Create `conversation` domain files; record each Q&A entry within 2s carrying submitting user identity and answer timestamp, and on record failure surface a save error while preserving the answer for display
    - List most-recent-first for authorized members, return empty list without error when none, deny unauthorized readers disclosing nothing, and retain entries ≥ 365 days
    - Integrate recording into `QueryEngine.ask`
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 15.6, 15.7_
  - [x]* 15.2 Write property test for history round-trip and ordering
    - **Property 43: Conversation history round-trip and ordering**
    - **Validates: Requirements 15.1, 15.3, 15.6**
  - [x]* 15.3 Write property test for record-failure preservation
    - **Property 44: Record failure preserves the answer**
    - **Validates: Requirements 15.2**

- [x] 16. Implement Usage Analytics
  - [x] 16.1 Implement AnalyticsService recording and dashboard
    - Create `usage-analytics` domain files; subscribe to `UsageEvent`s on the event bus tagged with workspace id, type, timestamp
    - Retry recording ≤ 3 times then drop without blocking the originating operation; render dashboard counts within 3s, zeros + "no usage data" when empty, deny unauthorized, show consumed query count vs tier limit, and on load failure show retry while retaining events
    - _Requirements: 16.1, 16.2, 16.3, 16.4, 16.5, 16.6, 16.7_
  - [x]* 16.2 Write property test for bounded-retry non-blocking recording
    - **Property 45: Analytics recording is bounded-retry and non-blocking**
    - **Validates: Requirements 16.2**
  - [x]* 16.3 Write property test for dashboard counts and quota
    - **Property 46: Dashboard counts match recorded usage and show quota**
    - **Validates: Requirements 16.1, 16.3, 16.6**
  - [x]* 16.4 Write property test for dashboard load-failure preservation
    - **Property 47: Dashboard load failure preserves events**
    - **Validates: Requirements 16.7**

- [x] 17. Implement gateway routes and cross-cutting security
  - [x] 17.1 Add domain routes and role guards to the API gateway
    - Add one `*.routes.ts` per domain under `packages/api-gateway/src/routes/`, register them in `routes/index.ts`, and mount in `index.ts`
    - Protect routes with existing `auth`, `rate-limiter`, `request-validator`, and `error-handler` middleware and `createRoleGuard`; map each domain error class to its HTTP status per the design's error table
    - _Requirements: 4.7, 5.2, 7.8, 14.4, 15.4, 16.5, 18.4, 18.5_
  - [x] 17.2 Implement TLS enforcement, health check, and personal-data deletion
    - Add middleware that requires transport-layer encryption and refuses connections without it
    - Add a health-check endpoint underpinning the availability measurement and a personal-data deletion endpoint that confirms completion within 30 days
    - _Requirements: 18.2, 18.3, 18.7, 19.1_
  - [x]* 17.3 Write integration tests for route error mapping and role guards
    - Assert error-class-to-status mapping and that unauthorized access changes/discloses no data
    - _Requirements: 18.4, 18.5_

- [x] 18. Wire the composition root
  - [x] 18.1 Implement createServiceRegistry and event subscriptions
    - Instantiate every service, wire shared infrastructure (event bus, DB/repositories, vector store, embedding/LLM/crypto/HTTP providers), register analytics subscriptions for `UsageEvent`s, and store the registry on `app.locals.services`
    - _Requirements: 3.1, 16.1, 16.2_
  - [x]* 18.2 Write end-to-end integration test with fakes
    - Exercise upload → index → ask → execute → history/analytics through the gateway using in-memory repositories and fake providers
    - _Requirements: 1.7, 3.1, 4.1, 5.3, 15.1, 16.1_

- [x] 19. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP; they are property, unit, and integration tests.
- Each task references specific requirements for traceability, and every property sub-task references a numbered correctness property from the design.
- Checkpoints ensure incremental validation at natural boundaries.
- Property tests use `fast-check` with a minimum of 100 iterations and inject deterministic `idGenerator`/`dateProvider` plus fake providers and in-memory stores, matching the existing `*.property.test.ts` pattern in the repo.
- POST-MVP and DEFERRED requirements (Req 1.9, 7.2/7.9, 8.6/8.7, 9-12, 18.6, 20, 21) are intentionally out of scope for these tasks.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["2.1", "3.1", "4.1", "6.1", "10.1", "15.1", "16.1"] },
    { "id": 2, "tasks": ["6.4", "11.1", "17.2", "2.2", "2.3", "2.4", "2.5", "2.6", "3.2", "3.3", "3.4", "3.5", "3.6", "4.2", "4.3", "4.4", "4.5", "6.2", "6.3", "6.10", "10.2", "10.3", "10.4", "15.2", "15.3", "16.2", "16.3", "16.4"] },
    { "id": 3, "tasks": ["7.1", "12.1", "13.1", "6.5", "6.6", "6.7", "6.8", "6.9", "11.2", "11.3", "11.4", "11.5", "11.6"] },
    { "id": 4, "tasks": ["7.4", "7.2", "7.3", "12.2", "12.3", "12.4", "13.2", "13.3", "13.4", "13.5"] },
    { "id": 5, "tasks": ["8.1", "7.5", "7.6", "7.7"] },
    { "id": 6, "tasks": ["17.1", "8.2", "8.3", "8.4", "8.5", "8.6", "8.7"] },
    { "id": 7, "tasks": ["18.1"] },
    { "id": 8, "tasks": ["17.3", "18.2"] }
  ]
}
```
