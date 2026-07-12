# Implementation Plan: API Copilot Desktop

## Overview

This plan implements the Electron + TypeScript + React desktop client for the API Copilot AI backend as described in the design. Work proceeds from the bottom up: shared types and the pure, highly-testable core (validators, request-descriptor builders, response mapper), then the main-process services (config/base-URL, secure store, request broker), then the reducer-driven app store, then the preload bridge, window/updater services, and finally the React views and full wiring. Each step builds on the previous one and ends by wiring components together so there is no orphaned code.

Property-based tests use `fast-check` with an inline `{ numRuns: 100 }` option (overriding the global default of 25 in `jest.setup.fast-check.ts`) and each is tagged in the repo format:

```
// Feature: api-copilot-desktop, Property N: <property text>
// Validates: Requirements X.Y
```

Test sub-tasks marked with `*` are optional and can be skipped for a faster MVP.

## Tasks

- [x] 1. Scaffold the `packages/desktop-app` workspace package
  - Create `packages/desktop-app/` with `package.json` (electron, electron-builder, electron-updater, react, react-dom; `type` deps on `@health-checkup/services`), `tsconfig.json`, and the `src/{main,preload,renderer,shared-ipc}` directory skeleton
  - Register the package in the root `package.json` `workspaces` array so it participates in `build --workspaces`, `npm test`, and `npm run lint`
  - Add `electron-builder.yml` with Windows, macOS, and Linux targets and a package-local `dist` script
  - _Requirements: 19.1_

- [x] 2. Define core types and the typed IPC contract
  - [x] 2.1 Define shared types and IPC channel contract
    - In `src/renderer/app-client/types.ts` define `RequestDescriptor`, `SanitizedResponse`, `BackendErrorBody`, `UiOutcome<T>`, and the client-side form inputs (`SignUpInput`, `SignInInput`, `UploadFile`, `CredentialInput`, `ParamValues`, `ConsoleRunInput`, `AppConfig`)
    - In `src/shared-ipc/contract.ts` define the typed IPC channel names and payloads for `secureRequest`, base-URL get/set, sign-out, window-state persist, and `onUpdateAvailable`
    - Import `apiCopilotShared` payload types from `@health-checkup/services` so the request/response contract is compile-checked
    - _Requirements: 4.2, 16.3_

- [x] 3. Implement client-side validation and selection gating
  - [x] 3.1 Implement validators and gating predicates
    - In `src/renderer/app-client/validation.ts` implement pure validators: sign-up (email contains `@`, password length 8..128, required fields non-empty), sign-in (email/password non-empty), workspace name 1..100, upload (≤25 MB and YAML/JSON only), question/query length 1..1000; each returns the offending field on failure and no descriptor is produced
    - Implement gating predicates: upload requires `activeWorkspaceId`; ask/search/code-gen require `activeApiVersion`
    - _Requirements: 2.3, 3.3, 5.3, 6.2, 6.3, 7.5, 8.2, 8.3, 9.4, 13.4_

  - [ ]* 3.2 Write property test for pre-send validation
    - **Property 3: Invalid form input is rejected before any request is sent**
    - **Validates: Requirements 2.3, 3.3, 5.3, 6.3, 8.2, 9.4**

  - [x] 3.3 Write property test for API-version/workspace gating
    - **Property 12: Operations requiring an API version are gated when none is selected**
    - **Validates: Requirements 6.2, 7.5, 8.3, 13.4**

- [x] 4. Implement the API client builders and response mapper
  - [x] 4.1 Implement per-domain request-descriptor builders
    - In `src/renderer/app-client/builders.ts` implement the `CopilotApiClient` builder object: account (sign-up/sign-in), workspaces (list/create), planQuota, knowledgeEngine (upload/listApis/selectVersion), queryEngine (ask/search), executionEngine (plan/execute), authAssistant (schemes/setCredential), codeGenerator (languages/generate), testingConsole (run/history/replay), conversations (list), usageAnalytics (dashboard)
    - Each builder emits a relative `/api/copilot/*` path, correct HTTP method, body from inputs, `requiresAuth` for protected endpoints, and `timeoutMs = 30000` for Q&A (15s default otherwise); never sets an `Authorization` header
    - _Requirements: 2.1, 3.1, 5.1, 5.2, 6.1, 7.1, 7.2, 8.1, 9.1, 10.1, 10.2, 11.1, 11.3, 12.1, 12.3, 12.4, 13.1, 13.2, 14.1, 15.1_

  - [ ]* 4.2 Write property test for request-descriptor construction
    - **Property 4: Request descriptors are constructed correctly for every endpoint**
    - **Validates: Requirements 2.1, 3.1, 5.2, 6.1, 8.1, 9.1, 11.1, 11.3, 12.1, 13.2, 14.1, 15.1**

  - [x] 4.3 Implement the response→UiOutcome mapper
    - In `src/renderer/app-client/mapper.ts` implement `mapResponse<T>`: 2xx→`success` carrying `data`; authenticated expired/invalid→`session_expired`; 429→`rate_limited` with `retryAfterMs` when `Retry-After` present; other 4xx/5xx→`backend_error` with `code`+`message`; transport `unreachable`/`timeout`/`tls_failed`→`unreachable`/`tls_error`; never include token/credential values
    - _Requirements: 2.5, 4.4, 8.6, 15.5, 16.3, 16.4_

  - [ ]* 4.4 Write property test for response mapping
    - **Property 14: Backend responses map deterministically to UI outcomes**
    - **Validates: Requirements 2.5, 8.6, 15.5, 16.3, 16.4**

- [x] 5. Implement main-process app config and HTTPS base-URL handling
  - [x] 5.1 Implement `AppConfig` persistence and base-URL validation
    - In `src/main/app-config.ts` accept and store a base URL only when it is a non-empty HTTPS URL; reject empty/non-HTTPS candidates, leave the previously stored base URL unchanged, and transmit nothing against a rejected value
    - Expose base-URL join used to resolve relative descriptor paths; persist only non-secret config
    - _Requirements: 1.2, 1.3, 4.5_

  - [ ]* 5.2 Write property test for base-URL acceptance/storage
    - **Property 2: Base URL is accepted, stored, and used iff it is HTTPS**
    - **Validates: Requirements 1.2, 1.3, 4.5**

- [x] 6. Implement the Secure Store (main process)
  - [x] 6.1 Implement `SecureStore` with encrypted token persistence
    - In `src/main/secure-store.ts` implement `saveToken`/`loadToken`/`clearToken`/`hasToken` using `safeStorage.encryptString` with a `keytar` fallback when `safeStorage.isEncryptionAvailable()` is false; persist only ciphertext, never plaintext token in logs or config
    - _Requirements: 1.4, 1.5, 3.2, 4.1, 4.3_

  - [ ]* 6.2 Write property test for token storage round-trip
    - **Property 5: Session_Token storage round-trips**
    - **Validates: Requirements 3.2, 4.3**

- [x] 7. Implement the Request Broker (main process)
  - [x] 7.1 Implement the outbound request broker
    - In `src/main/ipc-handlers.ts` implement `secureRequest(descriptor)`: reject non-HTTPS base URL (send nothing, return `transport: 'tls_failed'`); attach `Authorization: Bearer <token>` iff `requiresAuth` and a token exists; classify failures into `unreachable`/`timeout`/`tls_failed`; enforce the Q&A 30s timeout; sanitize responses to strip any echoed `Authorization` value and guarantee no token/credential string is returned
    - _Requirements: 4.2, 4.5, 4.6, 8.7, 16.5, 17.1_

  - [ ]* 7.2 Write property test for token attachment via the broker
    - **Property 6: Protected requests carry the token only via the broker**
    - **Validates: Requirements 4.2**

  - [ ]* 7.3 Write property test for HTTPS-failure handling
    - **Property 8: HTTPS failure transmits nothing and maps to a TLS error**
    - **Validates: Requirements 4.6**

  - [ ]* 7.4 Write property test for no-secret-leak across the pipeline
    - **Property 7: No secret ever appears in descriptors, logs, UI, or errors**
    - Run arbitrary secrets and error bodies through builder → broker-sanitizer → mapper → serializer and assert absence
    - **Validates: Requirements 4.1, 10.3, 10.4, 16.5**

- [x] 8. Checkpoint - core client and main services
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 9. Implement the app state store and reducers
  - [ ] 9.1 Implement the reducer-driven store and startup router
    - In `src/renderer/state/store.ts` implement `AppState` and pure reducers for: startup routing (base-URL prompt vs authenticated home vs sign-in), session (including `session_expired` clearing token, flagging expiry notice, routing to sign-in), active workspace/version persistence across navigation, failed version-select retaining the prior version, per-operation loading lifecycle, connectivity state machine, and input retention/clearing
    - _Requirements: 1.1, 1.4, 1.5, 4.4, 5.4, 7.2, 7.4, 16.1, 16.2, 17.1, 17.2, 17.3, 17.4, 17.5, 18.1_

  - [ ]* 9.2 Write property test for startup routing
    - **Property 1: Startup routing is a total function of stored state**
    - **Validates: Requirements 1.1, 1.4, 1.5**

  - [ ]* 9.3 Write property test for session-expiry handling
    - **Property 9: Session-expiry outcome clears the token and routes to sign-in**
    - **Validates: Requirements 4.4**

  - [ ]* 9.4 Write property test for selection persistence across navigation
    - **Property 10: Active workspace and API version persist across navigation**
    - **Validates: Requirements 5.4, 7.2, 18.1**

  - [ ]* 9.5 Write property test for failed version selection
    - **Property 11: A failed version selection retains the prior selection**
    - **Validates: Requirements 7.4**

  - [ ]* 9.6 Write property test for the loading lifecycle
    - **Property 13: The loading indicator is set on dispatch and always cleared on completion**
    - **Validates: Requirements 16.1, 16.2**

  - [ ]* 9.7 Write property test for the connectivity state machine
    - **Property 19: Connectivity is a state machine that preserves session and gates actions**
    - **Validates: Requirements 17.1, 17.2, 17.3, 17.4**

  - [ ]* 9.8 Write property test for input retention on transient failure
    - **Property 20: Failed operations retain their input for retry**
    - **Validates: Requirements 8.7, 11.5, 17.5**

- [ ] 10. Implement the preload bridge
  - [ ] 10.1 Implement the typed contextBridge preload
    - In `src/preload/preload.ts` expose a single frozen `window.copilot` object with `getBaseUrl`, `setBaseUrl`, `secureRequest`, `signOut`, `onUpdateAvailable`, `persistWindowState`; no raw `ipcRenderer`, no Node globals; renderer never receives the token
    - _Requirements: 4.1, 4.2_

- [x] 11. Implement window state and lifecycle (main process)
  - [x] 11.1 Implement window-bounds persistence and close confirmation
    - In `src/main/window-state.ts` persist window bounds (x, y, width, height, maximized) on move/resize and restore on launch; on `close` with any request `loading`, `preventDefault` and request a confirm dialog before quitting; single-instance lock
    - _Requirements: 18.2, 18.4_

  - [x] 11.2 Write property test for window-bounds round-trip
    - **Property 21: Window bounds round-trip**
    - **Validates: Requirements 18.2**

  - [ ]* 11.3 Write unit test for close confirmation while a request is in progress
    - Assert close is deferred and a confirm dialog is requested when a request is loading
    - _Requirements: 18.4_

- [x] 12. Implement the updater and version surface (main process)
  - [x] 12.1 Implement updater and installed-version reporting
    - In `src/main/updater.ts` expose the build version via `app.getVersion()` and, on `electron-updater`'s `update-available`, notify the renderer through the bridge to show a non-blocking banner (notify only, no forced install)
    - _Requirements: 19.3, 19.4_

  - [x] 12.2 Write integration test for update-available notification
    - Mock `electron-updater` emitting `update-available` and assert the renderer is notified
    - _Requirements: 19.4_

- [ ] 13. Implement the renderer views
  - [ ] 13.1 Implement the navigation shell and routing controls
    - In `src/renderer/views/` build the signed-in navigation shell providing controls to reach workspaces, API browser, Q&A, testing console, code-gen, history, and dashboard; route changes preserve active workspace/version
    - _Requirements: 18.1, 18.3_

  - [ ] 13.2 Implement sign-up and sign-in views
    - Wire forms to validators and builders, show loading indicators, on success store token/route home; render email-already-registered, credential-mismatch, and account-locked errors; retain fields except password
    - _Requirements: 2.1, 2.2, 2.4, 2.5, 3.1, 3.2, 3.4, 3.5_

  - [ ]* 13.3 Write unit tests for auth error screens
    - Test email-already-registered, credential-mismatch, and account-locked rendering and field retention
    - _Requirements: 2.4, 2.5, 3.4, 3.5_

  - [ ] 13.4 Implement workspace and specification-upload views
    - List workspaces by name, create workspace, set active workspace; upload with content-type and size gating, success confirmation identifying API + version, parse-failure detail pass-through with retained selection, plan-limit error
    - _Requirements: 5.1, 5.2, 5.5, 6.1, 6.4, 6.5, 6.6_

  - [ ] 13.5 Write unit tests for workspace/upload error screens
    - Test authorization error, parse-failure detail retention, and plan-limit messaging
    - _Requirements: 5.5, 6.4, 6.5, 6.6_

  - [ ] 13.6 Implement API browser and version selection view
    - Display APIs with versions, send version-select, display endpoints (path, method, parameters) for the active version, and indicate when a version must be selected
    - _Requirements: 7.1, 7.3, 7.5_

  - [ ] 13.7 Implement Q&A and semantic search views
    - Submit question/query with loading, render answer text with citations, "no grounded answer" state, quota-reached message, 30s timeout with retained question; render search results in backend order with the zero-results message
    - _Requirements: 8.1, 8.4, 8.5, 9.1, 9.2, 9.3_

  - [ ]* 13.8 Write property test for list-order preservation
    - **Property 16: List rendering preserves backend ordering**
    - **Validates: Requirements 9.2, 12.3, 14.1**

  - [ ] 13.9 Implement credential configuration view
    - List supported schemes, submit credential values over HTTPS, display credentials masked, and show credential errors with no secret value
    - _Requirements: 10.1, 10.2, 10.3, 10.4_

  - [ ] 13.10 Implement endpoint-execution and testing-console views
    - Request execution plan, prompt for reported missing values and block execute until supplied, run execute/console/replay with loading, display status/headers/body and elapsed ms unaltered, retain values on target timeout/network failure, display history most-recent-first, replay entries, and show replay-auth errors while retaining the history entry
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 12.1, 12.2, 12.3, 12.4, 12.5_

  - [ ]* 13.11 Write property test for response payload preservation
    - **Property 15: Displayed responses preserve the backend payload exactly**
    - **Validates: Requirements 11.4, 11.6, 12.2**

  - [ ]* 13.12 Write property test for execution gating on missing values
    - **Property 18: Execution is blocked until every required value is supplied**
    - **Validates: Requirements 11.2**

  - [ ] 13.13 Implement code-generation view with clipboard copy
    - Offer returned languages, generate snippet for the active version with loading, display snippet with a copy-to-clipboard action, and show unavailable-endpoint/unsupported-language errors while leaving a prior snippet unchanged
    - _Requirements: 13.1, 13.2, 13.3, 13.5_

  - [ ] 13.14 Implement conversation-history and usage-dashboard views
    - Display history entries most-recent-first with question, answer, submitting user, and timestamp; empty-history and authorization messages; dashboard counts (AI queries, executions, code-gen), quota consumed vs plan limit, no-usage state, and 3s-timeout/error with retry
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 15.1, 15.2, 15.3, 15.4, 15.5_

  - [ ]* 13.15 Write property test for required-field rendering
    - **Property 17: Rendered views contain every required field from their data**
    - **Validates: Requirements 14.3, 15.2, 15.3**

  - [ ]* 13.16 Write unit tests for remaining error/version screens
    - Test no-grounded-answer, quota-reached, replay-auth error, code-gen error, empty/unauthorized history, dashboard load-failure retry, and the version identifier surface
    - _Requirements: 8.4, 8.5, 12.5, 13.5, 14.2, 14.4, 15.4, 19.3_

- [ ] 14. Integration and wiring
  - [ ] 14.1 Wire the Electron main process
    - In `src/main/main.ts` create the window with `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, `webSecurity: true`; register ipc handlers for the broker, config, secure store, window state, and updater; enforce single instance
    - _Requirements: 1.1, 4.1, 4.2, 18.2, 18.4, 19.4_

  - [ ] 14.2 Wire the renderer entry point
    - In `src/renderer/index.tsx` mount the React app, connect the store to the client (via `window.copilot.secureRequest`), perform startup routing from stored config/token, and register the update-available banner
    - _Requirements: 1.4, 1.5, 16.1_

  - [ ]* 14.3 Write integration test for secure-store backends
    - Exercise `safeStorage` and the `keytar` fallback with a mocked/real backend and assert no plaintext token is written
    - _Requirements: 4.1_

  - [ ]* 14.4 Write smoke test for packaging targets and launch
    - Assert `electron-builder` config produces Windows/macOS/Linux targets and the app boots to sign-in or restored home
    - _Requirements: 19.1, 19.2_

- [ ] 15. Final checkpoint - ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional test sub-tasks and can be skipped for a faster MVP.
- Each task references specific requirement sub-clauses for traceability; each of the 21 correctness properties maps to exactly one property-based test sub-task.
- Property tests use `fast-check` with inline `{ numRuns: 100 }` and the repo's `// Feature: ... Property N` / `// Validates: Requirements X.Y` tagging.
- Property tests exercise pure logic (validators, builders, mapper, reducers) and round-trips (secure store, window bounds) with in-memory fakes; example/integration/smoke tests cover concrete error screens, updater, secure-store backends, and packaging.
- Checkpoints ensure incremental validation between the core layer and the UI layer.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["2.1"] },
    { "id": 2, "tasks": ["3.1", "4.1", "4.3", "5.1", "6.1", "11.1", "12.1"] },
    { "id": 3, "tasks": ["3.2", "3.3", "4.2", "4.4", "5.2", "6.2", "11.2", "11.3", "12.2", "7.1"] },
    { "id": 4, "tasks": ["7.2", "7.3", "7.4", "9.1", "10.1"] },
    { "id": 5, "tasks": ["9.2", "9.3", "9.4", "9.5", "9.6", "9.7", "9.8", "13.1"] },
    { "id": 6, "tasks": ["13.2", "13.4", "13.6", "13.7", "13.9", "13.10", "13.13", "13.14"] },
    { "id": 7, "tasks": ["13.3", "13.5", "13.8", "13.11", "13.12", "13.15", "13.16"] },
    { "id": 8, "tasks": ["14.1", "14.2"] },
    { "id": 9, "tasks": ["14.3", "14.4"] }
  ]
}
```
