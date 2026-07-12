/**
 * Request Descriptor Builders — Property-Based Tests
 *
 * Uses fast-check to validate the design's Correctness Property 4 across a
 * broad, generated input space. Every enumerated endpoint builder is exercised
 * with valid inputs and the produced `RequestDescriptor` is checked for the
 * correct HTTP method, `/api/copilot/*` path, `requiresAuth` flag, request
 * body, and (for Q&A) the 30 000 ms timeout.
 *
 * Feature: api-copilot-desktop
 *
 * Property 4: Request descriptors are constructed correctly for every endpoint
 * Validates: Requirements 2.1, 3.1, 5.2, 6.1, 8.1, 9.1, 11.1, 11.3, 12.1, 13.2, 14.1, 15.1
 */

import * as fc from 'fast-check';

import {
  account,
  workspaces,
  knowledgeEngine,
  queryEngine,
  executionEngine,
  testingConsole,
  codeGenerator,
  conversations,
  usageAnalytics,
  isSelectionRequired,
  API_COPILOT_BASE,
  QA_TIMEOUT_MS,
  DEFAULT_TIMEOUT_MS,
} from './builders';
import type { RequestDescriptor, SignUpInput, SignInInput, UploadFile, ConsoleRunInput } from './types';

const RUNS = {} as const;

// ---- Generators over the valid input space ----

/** A non-empty string usable as an identifier or free-text field. */
const nonEmptyStringArb: fc.Arbitrary<string> = fc
  .string({ minLength: 1, maxLength: 40 })
  .filter((s) => s.length > 0);

/** A valid ApiSelection scope. */
const apiSelectionArb = fc.record({
  workspaceId: nonEmptyStringArb,
  apiId: nonEmptyStringArb,
  version: fc.integer({ min: 1, max: 1000 }),
});

/** A valid sign-up input (values here are already client-side valid). */
const signUpArb: fc.Arbitrary<SignUpInput> = fc.record({
  email: fc.string({ minLength: 1, maxLength: 20 }).map((s) => `${s}@example.com`),
  password: fc.string({ minLength: 8, maxLength: 128 }),
}) as fc.Arbitrary<SignUpInput>;

const signInArb: fc.Arbitrary<SignInInput> = fc.record({
  email: fc.string({ minLength: 1, maxLength: 20 }).map((s) => `${s}@example.com`),
  password: nonEmptyStringArb,
});

/** A valid upload file within limits. */
const uploadFileArb: fc.Arbitrary<UploadFile> = fc.record({
  name: nonEmptyStringArb,
  contentType: fc.constantFrom<'yaml' | 'json'>('yaml', 'json'),
  sizeBytes: fc.integer({ min: 0, max: 25 * 1024 * 1024 }),
  bytes: fc.uint8Array({ maxLength: 32 }).map((a) => a as Uint8Array),
});

/** A valid console run input. */
const consoleRunArb: fc.Arbitrary<ConsoleRunInput> = fc.record({
  selection: apiSelectionArb,
  endpointId: nonEmptyStringArb,
  values: fc.dictionary(nonEmptyStringArb, fc.string()),
});

/** A valid plan-execution request. */
const planRequestArb = fc.record({
  apiSelection: apiSelectionArb,
  endpointId: nonEmptyStringArb,
  baseUrl: fc.constant('https://api.example.com'),
  provided: fc.dictionary(nonEmptyStringArb, fc.string()),
});

/** A minimal, valid-enough execution plan (builder only wraps it in a body). */
const executionPlanArb = fc.record({
  apiSelection: apiSelectionArb,
  endpointId: nonEmptyStringArb,
  requiresAuth: fc.boolean(),
  requiredValues: fc.constant([]),
});

/** Shared assertions for the invariant parts of the property. */
function expectDescriptor(
  d: RequestDescriptor,
  expected: {
    method: RequestDescriptor['method'];
    path: string;
    requiresAuth: boolean;
    timeoutMs: number;
  },
): void {
  expect(d.method).toBe(expected.method);
  expect(d.path).toBe(expected.path);
  // Every backend call targets the /api/copilot/* namespace.
  expect(d.path.startsWith(`${API_COPILOT_BASE}/`)).toBe(true);
  expect(d.requiresAuth).toBe(expected.requiresAuth);
  expect(d.timeoutMs).toBe(expected.timeoutMs);
  // The renderer never sets Authorization; the broker attaches the token.
  expect(d.headers?.Authorization).toBeUndefined();
}

// ---------------------------------------------------------------------------
// Public account endpoints — Req 2.1, 3.1 (requiresAuth = false)
// ---------------------------------------------------------------------------

describe('account builders — Property 4 (Req 2.1, 3.1)', () => {
  it('signUp → POST /account/sign-up, public, body = input', () => {
    fc.assert(
      fc.property(signUpArb, (input) => {
        const d = account.signUp(input);
        expectDescriptor(d, {
          method: 'POST',
          path: `${API_COPILOT_BASE}/account/sign-up`,
          requiresAuth: false,
          timeoutMs: DEFAULT_TIMEOUT_MS,
        });
        expect(d.body).toEqual(input);
      }),
      RUNS,
    );
  });

  it('signIn → POST /account/sign-in, public, body = input', () => {
    fc.assert(
      fc.property(signInArb, (input) => {
        const d = account.signIn(input);
        expectDescriptor(d, {
          method: 'POST',
          path: `${API_COPILOT_BASE}/account/sign-in`,
          requiresAuth: false,
          timeoutMs: DEFAULT_TIMEOUT_MS,
        });
        expect(d.body).toEqual(input);
      }),
      RUNS,
    );
  });
});

// ---------------------------------------------------------------------------
// Protected endpoints — requiresAuth = true
// ---------------------------------------------------------------------------

describe('workspaces.create — Property 4 (Req 5.2)', () => {
  it('POST /workspaces, protected, body carries the name', () => {
    fc.assert(
      fc.property(nonEmptyStringArb, (name) => {
        const d = workspaces.create(name);
        expectDescriptor(d, {
          method: 'POST',
          path: `${API_COPILOT_BASE}/workspaces`,
          requiresAuth: true,
          timeoutMs: DEFAULT_TIMEOUT_MS,
        });
        expect(d.body).toEqual({ name });
      }),
      RUNS,
    );
  });
});

describe('knowledgeEngine.upload — Property 4 (Req 6.1)', () => {
  it('POST /knowledge-engine/uploads, protected, body carries workspace + spec + contentType', () => {
    fc.assert(
      fc.property(nonEmptyStringArb, uploadFileArb, (workspaceId, file) => {
        const result = knowledgeEngine.upload(workspaceId, file);
        // With an active workspace, a descriptor (not a gating result) is produced.
        expect(isSelectionRequired(result)).toBe(false);
        const d = result as RequestDescriptor;
        expectDescriptor(d, {
          method: 'POST',
          path: `${API_COPILOT_BASE}/knowledge-engine/uploads`,
          requiresAuth: true,
          timeoutMs: DEFAULT_TIMEOUT_MS,
        });
        expect(d.body).toEqual({
          workspaceId,
          spec: new TextDecoder().decode(file.bytes),
          contentType: file.contentType,
        });
      }),
      RUNS,
    );
  });
});

describe('queryEngine.ask — Property 4 (Req 8.1, Q&A timeout)', () => {
  it('POST /query-engine/questions, protected, body carries question+selection, 30s timeout', () => {
    fc.assert(
      fc.property(apiSelectionArb, nonEmptyStringArb, (selection, question) => {
        const result = queryEngine.ask(selection, question);
        expect(isSelectionRequired(result)).toBe(false);
        const d = result as RequestDescriptor;
        expectDescriptor(d, {
          method: 'POST',
          path: `${API_COPILOT_BASE}/query-engine/questions`,
          requiresAuth: true,
          timeoutMs: QA_TIMEOUT_MS,
        });
        expect(QA_TIMEOUT_MS).toBe(30_000);
        expect(d.body).toEqual({ question, selection });
      }),
      RUNS,
    );
  });
});

describe('queryEngine.search — Property 4 (Req 9.1)', () => {
  it('POST /query-engine/search, protected, body carries query+selection', () => {
    fc.assert(
      fc.property(apiSelectionArb, nonEmptyStringArb, (selection, query) => {
        const result = queryEngine.search(selection, query);
        expect(isSelectionRequired(result)).toBe(false);
        const d = result as RequestDescriptor;
        expectDescriptor(d, {
          method: 'POST',
          path: `${API_COPILOT_BASE}/query-engine/search`,
          requiresAuth: true,
          timeoutMs: DEFAULT_TIMEOUT_MS,
        });
        expect(d.body).toEqual({ query, selection });
      }),
      RUNS,
    );
  });
});

describe('executionEngine builders — Property 4 (Req 11.1, 11.3)', () => {
  it('plan → POST /execution-engine/plan, protected, body = request', () => {
    fc.assert(
      fc.property(planRequestArb, (request) => {
        const d = executionEngine.plan(request as never);
        expectDescriptor(d, {
          method: 'POST',
          path: `${API_COPILOT_BASE}/execution-engine/plan`,
          requiresAuth: true,
          timeoutMs: DEFAULT_TIMEOUT_MS,
        });
        expect(d.body).toEqual(request);
      }),
      RUNS,
    );
  });

  it('execute → POST /execution-engine/execute, protected, body wraps the plan', () => {
    fc.assert(
      fc.property(executionPlanArb, (plan) => {
        const d = executionEngine.execute(plan as never);
        expectDescriptor(d, {
          method: 'POST',
          path: `${API_COPILOT_BASE}/execution-engine/execute`,
          requiresAuth: true,
          timeoutMs: DEFAULT_TIMEOUT_MS,
        });
        expect(d.body).toEqual({ plan });
      }),
      RUNS,
    );
  });
});

describe('testingConsole.run — Property 4 (Req 12.1)', () => {
  it('POST /testing-console/runs, protected, body = input', () => {
    fc.assert(
      fc.property(consoleRunArb, (input) => {
        const d = testingConsole.run(input);
        expectDescriptor(d, {
          method: 'POST',
          path: `${API_COPILOT_BASE}/testing-console/runs`,
          requiresAuth: true,
          timeoutMs: DEFAULT_TIMEOUT_MS,
        });
        expect(d.body).toEqual(input);
      }),
      RUNS,
    );
  });
});

describe('codeGenerator.generate — Property 4 (Req 13.2)', () => {
  it('POST /code-generator/generate, protected, body carries selection+endpointId+language', () => {
    fc.assert(
      fc.property(apiSelectionArb, nonEmptyStringArb, nonEmptyStringArb, (selection, endpointId, language) => {
        const result = codeGenerator.generate(selection, endpointId, language);
        expect(isSelectionRequired(result)).toBe(false);
        const d = result as RequestDescriptor;
        expectDescriptor(d, {
          method: 'POST',
          path: `${API_COPILOT_BASE}/code-generator/generate`,
          requiresAuth: true,
          timeoutMs: DEFAULT_TIMEOUT_MS,
        });
        expect(d.body).toEqual({ selection, endpointId, language });
      }),
      RUNS,
    );
  });
});

describe('conversations.list — Property 4 (Req 14.1)', () => {
  it('GET /conversations/:workspaceId, protected, encoded path, no body', () => {
    fc.assert(
      fc.property(nonEmptyStringArb, (workspaceId) => {
        const d = conversations.list(workspaceId);
        expectDescriptor(d, {
          method: 'GET',
          path: `${API_COPILOT_BASE}/conversations/${encodeURIComponent(workspaceId)}`,
          requiresAuth: true,
          timeoutMs: DEFAULT_TIMEOUT_MS,
        });
        expect(d.body).toBeUndefined();
      }),
      RUNS,
    );
  });
});

describe('usageAnalytics.dashboard — Property 4 (Req 15.1)', () => {
  it('GET /usage-analytics/:workspaceId/dashboard, protected, encoded path, no body', () => {
    fc.assert(
      fc.property(nonEmptyStringArb, (workspaceId) => {
        const d = usageAnalytics.dashboard(workspaceId);
        expectDescriptor(d, {
          method: 'GET',
          path: `${API_COPILOT_BASE}/usage-analytics/${encodeURIComponent(workspaceId)}/dashboard`,
          requiresAuth: true,
          timeoutMs: DEFAULT_TIMEOUT_MS,
        });
        expect(d.body).toBeUndefined();
      }),
      RUNS,
    );
  });
});
