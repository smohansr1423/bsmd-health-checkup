# Requirements Document

## Introduction

API Copilot Desktop is a cross-platform desktop application that serves as a graphical client for the existing API Copilot AI backend. The backend is an intelligent AI support engineer that ingests a REST API's OpenAPI/Swagger specification, builds a searchable knowledge base, and then answers natural-language questions, executes authenticated calls, generates client code, and records usage. The backend exposes its capabilities as HTTP endpoints under the `/api/copilot/*` namespace of the Express API gateway in `packages/api-gateway`.

This document specifies the behavior of the desktop client only. It defines what the application must do for the user: authenticate, manage workspaces, upload specifications, browse extracted metadata, ask grounded questions, execute endpoints, run an interactive testing console, generate code snippets, review conversation history, and view a usage-analytics dashboard. It also covers desktop-specific concerns: local session and credential storage, degraded behavior when the backend is unreachable, window and navigation experience, and packaging for Windows, macOS, and Linux.

The requirements are deliberately implementation-agnostic: they describe the observable behavior of the application, not the technology used to build it.

### Alignment with the Backend Specification

The backend requirements and design live at `.kiro/specs/api-copilot-ai/`. The desktop client consumes the MVP surface of that backend and mirrors its capability boundaries. Where the backend enforces a rule (for example question length limits, quota enforcement, or workspace isolation), the desktop client's responsibility is to present, request, and correctly interpret those interactions rather than to re-implement the rule. Backend endpoints referenced by this document (all under `/api/copilot/*`) include: `account/sign-up`, `account/sign-in`, `workspaces`, `plan-quota`, `knowledge-engine`, `query-engine`, `execution-engine`, `auth-assistant`, `code-generator`, `testing-console`, `conversations`, and `usage-analytics`.

### Scope Note: MVP vs Deferred

Each requirement is tagged with a scope marker so the delivery boundary is unambiguous.

- **[MVP]** — Included in the initial release: sign-up/sign-in with session handling, secure local session/credential storage, workspace management, specification upload, metadata browsing and version selection, natural-language Q&A with citations, semantic search, endpoint execution, interactive testing console with history and replay, code-snippet generation (Python, JavaScript, cURL), conversation history, usage-analytics dashboard, loading/progress and error handling, degraded behavior when the backend is unreachable, window/navigation experience, and packaging/distribution for Windows, macOS, and Linux.
- **[POST-MVP]** — Recorded for traceability but not scheduled for the first release: additional code-generation languages surfaced when the backend supports them, Postman-collection export from the testing console, and SSO sign-in for Enterprise-tier accounts.

### Open Design Decision: Technology Stack

The technology stack has not been chosen. A recommended candidate is Electron with a TypeScript/React renderer, because it provides a single codebase across Windows, macOS, and Linux, native OS integration (secure credential storage, window management, auto-update, packaging), and reuse of the backend's TypeScript type definitions. The final decision — including whether to use Electron, Tauri, or another framework — is deferred to the design phase. No requirement in this document assumes a specific stack; each states what the application must do rather than how.

## Glossary

- **Desktop_App**: The cross-platform desktop application specified by this document. It is the client that runs on the user's computer.
- **Backend_Gateway**: The existing API Copilot AI HTTP service that exposes endpoints under `/api/copilot/*`. The Desktop_App communicates with the Backend_Gateway over HTTP.
- **Backend_Endpoint**: A single HTTP route under the `/api/copilot/*` namespace of the Backend_Gateway.
- **User**: A person operating the Desktop_App.
- **Account**: The identity a User authenticates as, managed by the Backend_Gateway. An Account owns one or more Workspaces.
- **Session_Token**: The authentication credential returned by the Backend_Gateway upon successful sign-in, sent by the Desktop_App on subsequent authenticated requests.
- **Session**: The authenticated state established after sign-in, associated with a Session_Token, that permits the Desktop_App to make authenticated requests on behalf of the Account.
- **Secure_Store**: The operating-system-provided protected storage facility used by the Desktop_App to hold sensitive values such as the Session_Token (for example an OS keychain or credential vault).
- **Workspace**: An isolated container owned by an Account that groups uploaded APIs, conversations, and settings, managed by the Backend_Gateway.
- **Active_Workspace**: The single Workspace the User has selected as the current context for uploads, questions, execution, and history in the Desktop_App.
- **API_Specification**: An OpenAPI 3.x or Swagger 2.0 description of a REST API, in YAML or JSON, that the User uploads through the Desktop_App.
- **API_Metadata**: The structured data (endpoints, HTTP methods, parameters, request/response schemas, authentication schemes, examples, error codes, rate limits) extracted by the Backend_Gateway from an uploaded API_Specification.
- **API_Version**: A distinct stored version of an uploaded API, identified by a version number, managed by the Backend_Gateway.
- **Active_API_Version**: The API_Version the User has selected as the current scope for questions, execution, and code generation in the Desktop_App.
- **Answer**: A response to a natural-language question returned by the Backend_Gateway, grounded in indexed API_Metadata and accompanied by citations.
- **Citation**: A reference to a source endpoint or documentation section that a grounded Answer used.
- **Execution_Request**: A request assembled in the Desktop_App to run a specific endpoint against a target API through the Backend_Gateway's execution engine.
- **Testing_Console**: The interactive feature of the Desktop_App that runs requests, displays results, records a history of runs, and replays saved runs through the Backend_Gateway.
- **Code_Snippet**: Generated client code for a selected endpoint in a chosen programming language, produced by the Backend_Gateway.
- **Conversation_History**: The stored record of questions and Answers within a Workspace, retrieved from the Backend_Gateway.
- **Usage_Dashboard**: The view in the Desktop_App that presents usage counts and quota consumption retrieved from the Backend_Gateway for a Workspace.
- **Backend_Error**: An error or non-success status response returned by the Backend_Gateway, including a status code and error detail.
- **Loading_Indicator**: A visual cue displayed by the Desktop_App while an operation is in progress.
- **Connectivity_State**: The Desktop_App's determination of whether the Backend_Gateway is currently reachable.
- **SSO (Single Sign-On)**: An authentication method that lets a User sign in through a central identity provider.

## Requirements

### Requirement 1: Application Startup and Backend Configuration [MVP]

**User Story:** As a User, I want the application to start and connect to my API Copilot backend, so that I can begin working with my APIs.

#### Acceptance Criteria

1. WHEN the User launches the Desktop_App and no configured Backend_Gateway base URL is present, THE Desktop_App SHALL prompt the User to enter a Backend_Gateway base URL before allowing sign-in.
2. WHEN the User submits a Backend_Gateway base URL that uses the HTTPS scheme, THE Desktop_App SHALL store the base URL and use the base URL as the target for all subsequent Backend_Endpoint requests.
3. IF the User submits a Backend_Gateway base URL that is empty or does not use the HTTPS scheme, THEN THE Desktop_App SHALL reject the entry, retain any previously stored base URL, and display an error indicating that a valid HTTPS URL is required.
4. WHEN the Desktop_App starts and a valid Session_Token is present in the Secure_Store, THE Desktop_App SHALL restore the Session and present the authenticated home view without requiring the User to re-enter credentials.
5. WHEN the Desktop_App starts and no valid Session_Token is present in the Secure_Store, THE Desktop_App SHALL present the sign-in view.

### Requirement 2: User Sign-Up [MVP]

**User Story:** As a new User, I want to create an account from the desktop application, so that I can access my APIs and workspaces.

#### Acceptance Criteria

1. WHEN the User submits sign-up with an email address, a password, and all required registration fields, THE Desktop_App SHALL send the sign-up request to the `account/sign-up` Backend_Endpoint and display a Loading_Indicator until a response is received.
2. WHEN the Backend_Gateway confirms that an Account was created, THE Desktop_App SHALL display a confirmation and present the sign-in view.
3. IF the User submits sign-up with an empty required field, an email address that does not contain an "@" character, or a password shorter than 8 or longer than 128 characters, THEN THE Desktop_App SHALL reject the submission before sending the request, send no sign-up request, and display an error identifying the invalid field.
4. IF the Backend_Gateway returns a Backend_Error indicating the email is already registered, THEN THE Desktop_App SHALL display an error indicating the email is already registered and retain the entered field values except the password.
5. IF the Backend_Gateway returns any other Backend_Error for the sign-up request, THEN THE Desktop_App SHALL display an error describing the failure and retain the entered field values except the password.

### Requirement 3: User Sign-In and Session Establishment [MVP]

**User Story:** As a registered User, I want to sign in, so that I can access my workspaces and APIs.

#### Acceptance Criteria

1. WHEN the User submits sign-in with an email address and a password, THE Desktop_App SHALL send the sign-in request to the `account/sign-in` Backend_Endpoint and display a Loading_Indicator until a response is received.
2. WHEN the Backend_Gateway returns a successful sign-in response containing a Session_Token, THE Desktop_App SHALL store the Session_Token in the Secure_Store, establish the Session, and present the authenticated home view.
3. IF the User submits sign-in with an empty email address or an empty password, THEN THE Desktop_App SHALL reject the submission before sending the request and display an error indicating that email and password are required.
4. IF the Backend_Gateway returns a Backend_Error indicating that the credentials do not match an existing account, THEN THE Desktop_App SHALL display an authentication error, establish no Session, and retain the entered email address.
5. IF the Backend_Gateway returns a Backend_Error indicating the Account is temporarily locked, THEN THE Desktop_App SHALL display an error indicating the Account is temporarily locked and establish no Session.
6. WHERE the Account's plan tier includes SSO, THE Desktop_App SHALL present a single sign-on option that authenticates the User through the configured identity provider. *([POST-MVP].)*

### Requirement 4: Session and Credential Storage and Security [MVP]

**User Story:** As a security-conscious User, I want my session and credentials stored safely on my device, so that they are not exposed to other applications or stored in plaintext.

#### Acceptance Criteria

1. WHEN the Desktop_App persists a Session_Token, THE Desktop_App SHALL store the Session_Token in the Secure_Store and SHALL NOT write the Session_Token to application logs or plaintext configuration files.
2. WHEN the Desktop_App sends a request to a protected Backend_Endpoint, THE Desktop_App SHALL attach the stored Session_Token as the request's authentication credential.
3. WHEN the User signs out, THE Desktop_App SHALL delete the Session_Token from the Secure_Store and present the sign-in view.
4. IF the Backend_Gateway returns a Backend_Error indicating the Session_Token is expired or invalid, THEN THE Desktop_App SHALL delete the stored Session_Token from the Secure_Store, end the Session, and present the sign-in view with a message indicating the Session has expired.
5. WHEN the Desktop_App transmits credentials or a Session_Token to the Backend_Gateway, THE Desktop_App SHALL use an HTTPS connection for the transmission.
6. IF an HTTPS connection to the Backend_Gateway cannot be established, THEN THE Desktop_App SHALL not transmit credentials or the Session_Token and SHALL display an error indicating a secure connection could not be established.

### Requirement 5: Workspace Management [MVP]

**User Story:** As a User, I want to create, view, and select workspaces, so that I can organize and switch between my APIs and conversations.

#### Acceptance Criteria

1. WHEN the User opens the workspace view while signed in, THE Desktop_App SHALL request the Workspaces accessible to the Account from the Backend_Gateway and display each accessible Workspace by name.
2. WHEN the User submits a request to create a Workspace with a name between 1 and 100 characters, THE Desktop_App SHALL send the create request to the `workspaces` Backend_Endpoint and, on success, display the created Workspace in the workspace list.
3. IF the User submits a Workspace name that is empty or exceeds 100 characters, THEN THE Desktop_App SHALL reject the submission before sending the request and display an error indicating the 1-to-100-character name constraint.
4. WHEN the User selects a Workspace, THE Desktop_App SHALL set that Workspace as the Active_Workspace and scope subsequent uploads, questions, execution, code generation, history, and analytics to the Active_Workspace.
5. IF the Backend_Gateway returns a Backend_Error indicating the User is not authorized for a requested Workspace, THEN THE Desktop_App SHALL display an authorization error and SHALL NOT display that Workspace's APIs, conversations, or settings.
6. WHERE the Account's plan tier includes team collaboration, THE Desktop_App SHALL allow the Workspace owner to add a User as a member of the Active_Workspace through the `workspaces` members Backend_Endpoint.

### Requirement 6: API Specification Upload [MVP]

**User Story:** As a User, I want to upload an API specification, so that the backend can understand my API and answer questions about it.

#### Acceptance Criteria

1. WHEN the User selects an API_Specification file and requests upload while an Active_Workspace is selected, THE Desktop_App SHALL send the file contents and its declared content type (YAML or JSON) to the `knowledge-engine` uploads Backend_Endpoint and display a Loading_Indicator until a response is received.
2. IF the User requests an upload when no Active_Workspace is selected, THEN THE Desktop_App SHALL reject the request, send no upload, and display a message indicating that a Workspace must be selected first.
3. IF the selected file exceeds 25 megabytes or does not have a YAML or JSON content type, THEN THE Desktop_App SHALL reject the upload before sending the request and display an error indicating the size limit or the supported formats.
4. WHEN the Backend_Gateway confirms that API_Metadata was extracted and stored, THE Desktop_App SHALL display a success confirmation identifying the uploaded API and its API_Version.
5. IF the Backend_Gateway returns a Backend_Error indicating the specification could not be parsed, THEN THE Desktop_App SHALL display the parse-failure detail returned by the Backend_Gateway and retain the User's file selection for retry.
6. IF the Backend_Gateway returns a Backend_Error indicating the plan-tier API limit was reached, THEN THE Desktop_App SHALL display an error indicating the plan-tier API limit and SHALL NOT indicate that an API was added.

### Requirement 7: API Metadata Browsing and Version Selection [MVP]

**User Story:** As a User, I want to browse extracted API metadata and choose an API version, so that I can explore endpoints and set the scope for my work.

#### Acceptance Criteria

1. WHEN the User opens the API browser for the Active_Workspace, THE Desktop_App SHALL request the APIs and their API_Versions from the Backend_Gateway and display each API with its available API_Versions.
2. WHEN the User selects an API and an API_Version, THE Desktop_App SHALL send the selection to the `knowledge-engine` version-select Backend_Endpoint and set the returned selection as the Active_API_Version.
3. WHEN an Active_API_Version is set, THE Desktop_App SHALL display the endpoints of that API_Version, including each endpoint's path, HTTP method, and parameters, as returned in the API_Metadata.
4. IF the Backend_Gateway returns a Backend_Error indicating the selected API_Version is unavailable, THEN THE Desktop_App SHALL retain the previously Active_API_Version and display an error indicating the requested version is unavailable.
5. WHILE no Active_API_Version is set, THE Desktop_App SHALL indicate that an API version must be selected before asking questions, executing endpoints, or generating code.

### Requirement 8: Natural-Language Q&A with Citations [MVP]

**User Story:** As a User, I want to ask questions about my API in natural language and see grounded answers with citations, so that I can understand the API without reading the whole specification.

#### Acceptance Criteria

1. WHEN the User submits a question between 1 and 1000 characters while an Active_API_Version is set, THE Desktop_App SHALL send the question to the `query-engine` questions Backend_Endpoint and display a Loading_Indicator until a response is received.
2. IF the User submits a question that is empty or exceeds 1000 characters, THEN THE Desktop_App SHALL reject the submission before sending the request and display an error indicating the accepted question length range.
3. IF the User submits a question when no Active_API_Version is set, THEN THE Desktop_App SHALL reject the submission, send no request, and display a message indicating that an API version must be selected first.
4. WHEN the Backend_Gateway returns an Answer with Citations, THE Desktop_App SHALL display the Answer text and display each Citation associated with the Answer.
5. WHEN the Backend_Gateway returns a response indicating that no grounded answer is available in the uploaded API knowledge, THE Desktop_App SHALL display that no answer was found in the uploaded API knowledge and SHALL NOT present fabricated content as an Answer.
6. IF the Backend_Gateway returns a Backend_Error indicating the query quota has been reached, THEN THE Desktop_App SHALL display a message indicating the query quota has been reached.
7. IF the Backend_Gateway does not return a response within 30 seconds of the question being sent, THEN THE Desktop_App SHALL stop waiting, display an error indicating the Answer could not be generated, and retain the User's question text for retry.

### Requirement 9: Semantic Documentation Search [MVP]

**User Story:** As a User, I want to search my API documentation by meaning, so that I can find relevant endpoints and concepts without exact keywords.

#### Acceptance Criteria

1. WHEN the User submits a search query between 1 and 1000 characters while an Active_API_Version is set, THE Desktop_App SHALL send the query to the `query-engine` search Backend_Endpoint and display a Loading_Indicator until a response is received.
2. WHEN the Backend_Gateway returns search results, THE Desktop_App SHALL display the returned results in the order provided by the Backend_Gateway.
3. WHEN the Backend_Gateway returns zero search results, THE Desktop_App SHALL display a message indicating that no relevant content was found.
4. IF the User submits a search query that is empty or exceeds 1000 characters, THEN THE Desktop_App SHALL reject the submission before sending the request and display an error indicating the accepted query length range.

### Requirement 10: Target-API Credential Configuration [MVP]

**User Story:** As a User, I want to configure credentials for the target API, so that the backend can execute authenticated calls on my behalf.

#### Acceptance Criteria

1. WHEN the User opens the credential configuration view, THE Desktop_App SHALL request the supported authentication schemes from the `auth-assistant` schemes Backend_Endpoint and display each supported scheme.
2. WHEN the User submits credential values for a supported authentication scheme, THE Desktop_App SHALL send the credential values to the `auth-assistant` credentials Backend_Endpoint over an HTTPS connection.
3. WHEN the Desktop_App displays a configured credential, THE Desktop_App SHALL display the credential in a masked form and SHALL NOT display the stored credential secret value in plaintext.
4. IF the Backend_Gateway returns a Backend_Error for the credential submission, THEN THE Desktop_App SHALL display an error describing the failure and SHALL NOT display any credential secret value in that error.

### Requirement 11: API Endpoint Execution [MVP]

**User Story:** As a User, I want to execute an API endpoint from the desktop application, so that I can validate behavior without writing a client.

#### Acceptance Criteria

1. WHEN the User requests execution of an endpoint while an Active_API_Version is set, THE Desktop_App SHALL send an execution-plan request to the `execution-engine` plan Backend_Endpoint to determine the required parameters and authentication values.
2. WHEN the Backend_Gateway reports that one or more required values are missing, THE Desktop_App SHALL prompt the User to supply each reported missing value and SHALL NOT send an execute request until the User provides the reported values.
3. WHEN all required values are provided, THE Desktop_App SHALL send the Execution_Request to the `execution-engine` execute Backend_Endpoint and display a Loading_Indicator until a response is received.
4. WHEN the Backend_Gateway returns an execution response, THE Desktop_App SHALL display the response status code, the response headers, and the response body as returned by the Backend_Gateway.
5. IF the Backend_Gateway returns a response indicating a timeout or a network-connection failure to the target API, THEN THE Desktop_App SHALL display the reported failure type and retain the entered parameter and authentication values for retry.
6. IF the target API returns an error status through the Backend_Gateway, THEN THE Desktop_App SHALL display the returned error status code and error response body without altering the content.

### Requirement 12: Interactive Testing Console with History and Replay [MVP]

**User Story:** As a User, I want an interactive testing console with history and replay, so that I can run requests, review results, and re-run saved requests without a separate tool.

#### Acceptance Criteria

1. WHEN the User runs a request from the Testing_Console, THE Desktop_App SHALL send the run to the `testing-console` runs Backend_Endpoint and display a Loading_Indicator until a response is received.
2. WHEN the Backend_Gateway returns a run result, THE Desktop_App SHALL display the request that was sent, including method, URL, headers, and body, and the response that was received, including status, headers, body, and elapsed time in milliseconds.
3. WHEN the User opens the Testing_Console for the Active_Workspace, THE Desktop_App SHALL request the saved run history from the Backend_Gateway and display the history entries ordered from most recent to oldest.
4. WHEN the User selects a saved history entry and requests replay, THE Desktop_App SHALL send a replay request to the `testing-console` replays Backend_Endpoint for that history entry and display the replayed run result.
5. IF the Backend_Gateway returns a Backend_Error indicating a replay's saved authentication is missing, invalid, or expired, THEN THE Desktop_App SHALL display an error describing the authentication problem and SHALL retain the saved history entry in the displayed history.
6. WHERE export of saved requests is available, THE Desktop_App SHALL allow the User to export selected saved requests as a Postman collection. *([POST-MVP].)*

### Requirement 13: Code Snippet Generation [MVP]

**User Story:** As a User, I want to generate client code for an endpoint, so that I can integrate the API quickly in my language of choice.

#### Acceptance Criteria

1. WHEN the User opens the code-generation view, THE Desktop_App SHALL request the supported languages from the `code-generator` languages Backend_Endpoint and offer each returned language as a selectable option.
2. WHEN the User requests a Code_Snippet for a selected endpoint in a supported language while an Active_API_Version is set, THE Desktop_App SHALL send the request to the `code-generator` generate Backend_Endpoint and display a Loading_Indicator until a response is received.
3. WHEN the Backend_Gateway returns a Code_Snippet, THE Desktop_App SHALL display the Code_Snippet and provide an action to copy the Code_Snippet to the operating-system clipboard.
4. IF the User requests a Code_Snippet when no Active_API_Version is set, THEN THE Desktop_App SHALL reject the request, send no request, and display a message indicating that an API version must be selected first.
5. IF the Backend_Gateway returns a Backend_Error indicating the endpoint definition is unavailable or the language is unsupported, THEN THE Desktop_App SHALL display the returned error and SHALL leave any previously displayed Code_Snippet unchanged.

### Requirement 14: Conversation History [MVP]

**User Story:** As a User, I want to view my past questions and answers, so that I can revisit prior guidance.

#### Acceptance Criteria

1. WHEN the User opens the Conversation_History view for the Active_Workspace, THE Desktop_App SHALL request the Conversation_History from the `conversations` Backend_Endpoint and display the entries ordered from most recent to oldest.
2. WHEN the Backend_Gateway returns an empty Conversation_History, THE Desktop_App SHALL display an indication that no conversation history exists for the Active_Workspace.
3. WHEN the Desktop_App displays a Conversation_History entry, THE Desktop_App SHALL display the question text, the Answer text, the submitting User identity, and the time the Answer was produced.
4. IF the Backend_Gateway returns a Backend_Error indicating the User is not authorized to read the Conversation_History, THEN THE Desktop_App SHALL display an authorization error and SHALL NOT display any Conversation_History content.

### Requirement 15: Usage Analytics Dashboard [MVP]

**User Story:** As a User, I want a usage analytics dashboard, so that I can see how my APIs and the assistant are being used and how much quota remains.

#### Acceptance Criteria

1. WHEN the User opens the Usage_Dashboard for the Active_Workspace, THE Desktop_App SHALL request the dashboard data from the `usage-analytics` dashboard Backend_Endpoint and display a Loading_Indicator until a response is received.
2. WHEN the Backend_Gateway returns dashboard data, THE Desktop_App SHALL display the counts of AI queries, API executions, and code-generation requests for the Active_Workspace.
3. WHEN the Backend_Gateway returns dashboard data, THE Desktop_App SHALL display the current query-quota consumption as both the consumed count and the account's plan-tier limit.
4. WHEN the Backend_Gateway returns dashboard data indicating no recorded usage, THE Desktop_App SHALL display each usage count as zero and a message indicating that no usage data is available.
5. IF the Backend_Gateway returns a Backend_Error or does not respond within 3 seconds for the dashboard request, THEN THE Desktop_App SHALL display an error indicating that usage data could not be loaded and offer a retry action.

### Requirement 16: Loading, Progress, and Error Handling [MVP]

**User Story:** As a User, I want clear loading indicators and error messages, so that I always understand what the application is doing and why an operation failed.

#### Acceptance Criteria

1. WHILE a request to a Backend_Endpoint is in progress, THE Desktop_App SHALL display a Loading_Indicator for the operation that initiated the request.
2. WHEN a request to a Backend_Endpoint completes, whether it succeeded or failed, THE Desktop_App SHALL remove the Loading_Indicator for that operation.
3. IF a Backend_Gateway response has a client-error or server-error status, THEN THE Desktop_App SHALL display an error message that includes the error detail provided in the Backend_Error.
4. IF a Backend_Gateway response has a rate-limit status, THEN THE Desktop_App SHALL display a message indicating the request was rate limited and offer a retry action.
5. WHEN the Desktop_App displays a Backend_Error, THE Desktop_App SHALL NOT display any Session_Token or credential secret value in the error message.

### Requirement 17: Degraded Behavior When the Backend Is Unreachable [MVP]

**User Story:** As a User, I want the application to behave gracefully when the backend is unreachable, so that I understand the state and do not lose my input.

#### Acceptance Criteria

1. IF a request to a Backend_Endpoint fails because the Backend_Gateway cannot be reached, THEN THE Desktop_App SHALL set the Connectivity_State to unreachable and display an indication that the Backend_Gateway is currently unreachable.
2. WHILE the Connectivity_State is unreachable, THE Desktop_App SHALL keep the User signed in using the stored Session_Token and SHALL NOT delete the Session_Token from the Secure_Store.
3. WHILE the Connectivity_State is unreachable, THE Desktop_App SHALL disable actions that require the Backend_Gateway and display an indication that those actions are unavailable until connectivity is restored.
4. WHEN a request to a Backend_Endpoint succeeds after the Connectivity_State was unreachable, THE Desktop_App SHALL set the Connectivity_State to reachable and re-enable the actions that require the Backend_Gateway.
5. IF a Backend_Endpoint request fails because the Backend_Gateway is unreachable, THEN THE Desktop_App SHALL retain the User's unsent input for that operation and offer a retry action.

### Requirement 18: Window and Navigation Experience [MVP]

**User Story:** As a User, I want a coherent window and navigation experience, so that I can move between features and resume where I left off.

#### Acceptance Criteria

1. WHEN the User navigates between features, THE Desktop_App SHALL preserve the Active_Workspace and Active_API_Version across the navigation until the User changes them.
2. WHEN the User resizes or moves the application window, THE Desktop_App SHALL persist the window size and position and restore the window size and position on the next launch.
3. WHILE the User is signed in, THE Desktop_App SHALL provide navigation controls to reach the workspace view, API browser, Q&A view, Testing_Console, code-generation view, Conversation_History view, and Usage_Dashboard.
4. WHEN the User triggers the application-close action while a Backend_Endpoint request is in progress, THE Desktop_App SHALL prompt the User to confirm closing before terminating the in-progress request.

### Requirement 19: Packaging and Cross-Platform Distribution [MVP]

**User Story:** As a User, I want native installers for my operating system, so that I can install and update the application easily.

#### Acceptance Criteria

1. THE Desktop_App SHALL be distributed as an installable package for Windows, macOS, and Linux.
2. WHEN the Desktop_App is installed on Windows, macOS, or Linux, THE Desktop_App SHALL launch and reach the sign-in view or the restored authenticated home view on that operating system.
3. THE Desktop_App SHALL present a version identifier that identifies the installed build.
4. WHERE an application update is available, THE Desktop_App SHALL notify the User that an update is available.
