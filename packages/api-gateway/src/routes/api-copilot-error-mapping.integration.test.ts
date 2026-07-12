/**
 * API Copilot AI — Route Error Mapping & Role Guard Integration Tests
 *
 * Drives the real gateway app end-to-end over HTTP and asserts that:
 *  (a) each representative domain error class surfaces with the HTTP status the
 *      design's Error Categories and Mapping table prescribes, via the shared
 *      `mapApiCopilotError` mapper; and
 *  (b) unauthorized / forbidden access is denied (401 / 403) disclosing nothing
 *      (no `data` payload) and changing no data (a denied escalation attempt
 *      leaves the requester exactly as unauthorized as before).
 *
 * Validates: Requirements 18.4, 18.5
 */

import {
  buildTestGateway,
  startServer,
  httpRequest,
  TEST_TOKEN,
  type RunningServer,
} from './api-copilot-integration.harness';
import { clearRateLimitStore, stopRateLimitCleanup } from '../middleware';
import type { ServiceRegistry } from '../service-registry';

describe('API Copilot AI — route error mapping and role guards (integration)', () => {
  let running: RunningServer;
  let services: ServiceRegistry;
  let port: number;

  beforeAll(async () => {
    const gateway = buildTestGateway();
    services = gateway.services;
    running = await startServer(gateway.app);
    port = running.port;
  });

  afterAll(async () => {
    await running.close();
    stopRateLimitCleanup();
  });

  beforeEach(() => {
    clearRateLimitStore();
  });

  // -------------------------------------------------------------------------
  // (a) Domain-error → HTTP-status mapping (design's error table)
  // -------------------------------------------------------------------------

  describe('domain error → HTTP status mapping', () => {
    it('maps a workspace name that is too long to 400 (WorkspaceNameError)', async () => {
      const res = await httpRequest(port, 'POST', '/api/copilot/workspaces', {
        token: TEST_TOKEN,
        accountId: 'acct-name-test',
        body: { name: 'a'.repeat(101) },
      });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('WORKSPACE_NAME_ERROR');
      // The rejection produces no workspace (no data payload).
      expect(res.body.data).toBeUndefined();
    });

    it('maps unauthorized workspace access to 403 (ConversationAccessError)', async () => {
      // A workspace owned by one account…
      const create = await httpRequest(port, 'POST', '/api/copilot/workspaces', {
        token: TEST_TOKEN,
        accountId: 'owner-acct',
        body: { name: 'Owner Workspace' },
      });
      expect(create.status).toBe(201);
      const workspaceId = create.body.data.workspaceId as string;

      // …read by a different, non-member account is denied with 403.
      const res = await httpRequest(
        port,
        'GET',
        `/api/copilot/conversations/${workspaceId}`,
        { token: TEST_TOKEN, accountId: 'intruder-acct' }
      );

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('CONVERSATION_ACCESS_ERROR');
      // Disclose nothing: no conversation entries are leaked.
      expect(res.body.data).toBeUndefined();
    });

    it('maps an unsupported code-generation language to 400 (UnsupportedLanguageError)', async () => {
      const res = await httpRequest(
        port,
        'POST',
        '/api/copilot/code-generator/generate',
        {
          token: TEST_TOKEN,
          accountId: 'acct-codegen',
          body: {
            apiSelection: { workspaceId: 'w1', apiId: 'a1', version: 1 },
            endpointId: 'GET /x',
            language: 'ruby',
          },
        }
      );

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('UNSUPPORTED_LANGUAGE_ERROR');
      // The error lists supported languages without producing a snippet.
      expect(res.body.error.message).toContain('python');
    });

    it('maps quota exhaustion to 429 (QuotaExceededError)', async () => {
      // Seed an account whose applicable Query_Quota is zero, so the very first
      // reservation is rejected.
      const account = await services.accountAuthService.signUp({
        email: 'quota@example.com',
        password: 'password123',
      });
      await services.planQuotaService.applyTierChange(account.accountId, 'enterprise', {
        maxApis: 5,
        maxQueries: 0,
      });

      const res = await httpRequest(
        port,
        'POST',
        '/api/copilot/plan-quota/queries/reserve',
        { token: TEST_TOKEN, accountId: account.accountId }
      );

      expect(res.status).toBe(429);
      expect(res.body.error.code).toBe('QUOTA_EXCEEDED_ERROR');
      expect(res.body.data).toBeUndefined();
    });

    it('maps an unknown endpoint to 404', async () => {
      const res = await httpRequest(
        port,
        'GET',
        '/api/copilot/this-domain-does-not-exist',
        { token: TEST_TOKEN, accountId: 'acct-404' }
      );

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });
  });

  // -------------------------------------------------------------------------
  // (b) Unauthorized / forbidden access: deny, disclose nothing, change nothing
  // -------------------------------------------------------------------------

  describe('unauthorized / forbidden access control', () => {
    it('rejects a protected route with 401 when no token is supplied, disclosing nothing', async () => {
      const res = await httpRequest(
        port,
        'GET',
        '/api/copilot/workspaces/some-workspace/access',
        { accountId: 'anyone' } // no token
      );

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('AUTHENTICATION_REQUIRED');
      // No workspace state or access decision is disclosed to an unauthenticated caller.
      expect(res.body.data).toBeUndefined();
    });

    it('denies a forbidden escalation attempt and changes no data', async () => {
      // Owner creates a workspace.
      const create = await httpRequest(port, 'POST', '/api/copilot/workspaces', {
        token: TEST_TOKEN,
        accountId: 'owner-acct-2',
        body: { name: 'Guarded Workspace' },
      });
      expect(create.status).toBe(201);
      const workspaceId = create.body.data.workspaceId as string;

      // An intruder is denied reading the workspace's conversation history.
      const before = await httpRequest(
        port,
        'GET',
        `/api/copilot/conversations/${workspaceId}`,
        { token: TEST_TOKEN, accountId: 'intruder-acct-2' }
      );
      expect(before.status).toBe(403);

      // The intruder attempts to add themselves as a member (privilege
      // escalation). Only the owner may add members, so this is denied 403 and
      // adds no member (Req 14.4, 18.5).
      const escalate = await httpRequest(
        port,
        'POST',
        `/api/copilot/workspaces/${workspaceId}/members`,
        {
          token: TEST_TOKEN,
          accountId: 'intruder-acct-2',
          body: { userId: 'test-user' },
        }
      );
      expect(escalate.status).toBe(403);
      expect(escalate.body.error.code).toBe('AUTHORIZATION_ERROR');
      expect(escalate.body.data).toBeUndefined();

      // Nothing changed: the intruder is still denied, exactly as before.
      const after = await httpRequest(
        port,
        'GET',
        `/api/copilot/conversations/${workspaceId}`,
        { token: TEST_TOKEN, accountId: 'intruder-acct-2' }
      );
      expect(after.status).toBe(403);

      // The owner still has full access — the workspace is intact.
      const ownerAccess = await httpRequest(
        port,
        'GET',
        `/api/copilot/workspaces/${workspaceId}/access`,
        { token: TEST_TOKEN, accountId: 'owner-acct-2' }
      );
      expect(ownerAccess.status).toBe(200);
      expect(ownerAccess.body.data.allowed).toBe(true);
      expect(ownerAccess.body.data.role).toBe('owner');
    });
  });
});
