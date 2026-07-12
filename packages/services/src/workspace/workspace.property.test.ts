/**
 * Workspace Service — Property-Based Tests
 * Uses fast-check to validate universal correctness properties from the design document.
 *
 * These property tests complement the example-based unit tests in
 * `workspace.service.test.ts`: they exercise the same public API
 * (`create`, `authorize`, `requireAccess`, `addMember`, `removeMember`,
 * `decideAccess`) across a broad, generated input space.
 *
 * Feature: api-copilot-ai
 * Validates: Requirements 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.7, 15.4, 16.5, 18.4, 18.5
 */

import * as fc from 'fast-check';

import {
  WorkspaceService,
  InMemoryTierProvider,
  decideAccess,
  WorkspaceNameError,
  AuthorizationError,
  TierMemberLimitError,
} from './index';
import type { WorkspaceDependencies } from './index';
import { InMemoryWorkspaceRepository } from '../api-copilot-shared';
import type { PlanTier, UserRef, Workspace } from '../api-copilot-shared';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Deterministic, monotonically increasing id generator for stable ids. */
function makeIdGenerator(): () => string {
  let counter = 0;
  return () => {
    counter += 1;
    return `ws_${counter}`;
  };
}

/**
 * Build a fresh WorkspaceService with an isolated in-memory repository, a
 * deterministic id generator and clock, and an injectable tier provider plus
 * per-tier member-limit map.
 */
function makeService(overrides?: Partial<WorkspaceDependencies>): {
  service: WorkspaceService;
  repo: InMemoryWorkspaceRepository;
  tierProvider: InMemoryTierProvider;
} {
  const repo = new InMemoryWorkspaceRepository();
  const tierProvider = new InMemoryTierProvider('pro');
  const service = new WorkspaceService({
    idGenerator: makeIdGenerator(),
    dateProvider: () => new Date('2024-01-01T00:00:00.000Z'),
    workspaceRepository: repo,
    tierProvider,
    ...overrides,
  });
  return { service, repo, tierProvider };
}

/** A uniform member-limit map that assigns the same limit to every tier. */
function uniformLimits(limit: number): Record<PlanTier, number> {
  return { starter: limit, pro: limit, enterprise: limit };
}

// ─── Arbitraries ───────────────────────────────────────────────────────────────

/** Prefixed, disjoint id pools so owner/member/stranger categories never collide. */
const memberIdArb: fc.Arbitrary<string> = fc
  .string({ minLength: 1, maxLength: 10 })
  .map((s) => `m:${s}`);
const strangerUserIdArb: fc.Arbitrary<string> = fc
  .string({ minLength: 1, maxLength: 10 })
  .map((s) => `u:${s}`);
const ownerAccountIdArb: fc.Arbitrary<string> = fc
  .string({ minLength: 1, maxLength: 10 })
  .map((s) => `o:${s}`);
const strangerAccountIdArb: fc.Arbitrary<string> = fc
  .string({ minLength: 1, maxLength: 10 })
  .map((s) => `a:${s}`);

const uniqueMembersArb = (maxLength: number): fc.Arbitrary<string[]> =>
  fc.uniqueArray(memberIdArb, { maxLength });

// ─── Property 39: Workspace name length bounds ──────────────────────────────────
// Feature: api-copilot-ai, Property 39: For any workspace-creation request, a
// name of length 1..100 creates a workspace owned by the requesting account, and
// a name that is empty or longer than 100 characters is rejected with a
// name-length error and creates no workspace.
// Validates: Requirements 14.1, 14.2

describe('Property 39: Workspace name length bounds', () => {
  it('creates an owned workspace for any name of length 1..100', async () => {
    // Default fc.string yields single-code-unit ASCII characters, so the
    // generated character count equals name.length (the bound the validator
    // checks).
    const validNameArb = fc.string({ minLength: 1, maxLength: 100 });

    await fc.assert(
      fc.asyncProperty(
        ownerAccountIdArb,
        validNameArb,
        async (ownerAccountId, name) => {
          const { service, repo } = makeService();

          const ws = await service.create(ownerAccountId, name);

          expect(ws.name).toBe(name);
          expect(ws.name.length).toBeGreaterThanOrEqual(1);
          expect(ws.name.length).toBeLessThanOrEqual(100);
          expect(ws.ownerAccountId).toBe(ownerAccountId);
          expect(ws.memberUserIds).toEqual([]);
          expect(await repo.findById(ws.workspaceId)).not.toBeNull();
        }
      )
    );
  });

  it('rejects empty or over-100 names and creates no workspace', async () => {
    // The empty name (length 0) or any name of 101..200 characters.
    const invalidNameArb = fc.oneof(
      fc.constant(''),
      fc.string({ minLength: 101, maxLength: 200 })
    );

    await fc.assert(
      fc.asyncProperty(
        ownerAccountIdArb,
        invalidNameArb,
        async (ownerAccountId, name) => {
          const { service, repo } = makeService();

          await expect(
            service.create(ownerAccountId, name)
          ).rejects.toBeInstanceOf(WorkspaceNameError);
          expect(await repo.listByOwner(ownerAccountId)).toHaveLength(0);
        }
      )
    );
  });
});

// ─── Property 40: Workspace isolation and access control ────────────────────────
// Feature: api-copilot-ai, Property 40: For any user and resource, access is
// granted if and only if the user is the Workspace owner or an authorized member;
// a denied request changes no resource data and discloses no Workspace content,
// including Conversation_History and analytics.
// Validates: Requirements 14.3, 14.4, 15.4, 16.5, 18.4, 18.5

describe('Property 40: Workspace isolation and access control', () => {
  it('grants access iff requester is owner or authorized member', async () => {
    await fc.assert(
      fc.asyncProperty(
        ownerAccountIdArb,
        uniqueMembersArb(6),
        strangerUserIdArb,
        strangerAccountIdArb,
        fc.boolean(),
        fc.boolean(),
        fc.nat(),
        async (
          ownerAccountId,
          members,
          strangerUserId,
          strangerAccountId,
          useOwnerAccount,
          useMemberUserId,
          memberIndex
        ) => {
          const { service } = makeService({ memberLimits: uniformLimits(100) });
          const ws = await service.create(ownerAccountId, 'WS');
          for (const m of members) {
            await service.addMember(ownerAccountId, ws.workspaceId, m);
          }

          // Disjoint id prefixes guarantee: strangerUserId is never a member and
          // strangerAccountId is never the owner account.
          const userId =
            useMemberUserId && members.length > 0
              ? members[memberIndex % members.length]
              : strangerUserId;
          const accountId = useOwnerAccount ? ownerAccountId : strangerAccountId;
          const requester: UserRef = { userId, accountId };

          const isOwner = accountId === ownerAccountId;
          const isMember = members.includes(userId);
          const expectedAllowed = isOwner || isMember;

          const decision = await service.authorize(requester, ws.workspaceId);
          expect(decision.allowed).toBe(expectedAllowed);
          if (expectedAllowed) {
            expect(decision.role).toBe(isOwner ? 'owner' : 'member');
          } else {
            expect(decision.role).toBeNull();
            expect(decision.reason).toBe('not_authorized');
          }
        }
      )
    );
  });

  it('a denied request changes no workspace data and discloses nothing', async () => {
    await fc.assert(
      fc.asyncProperty(
        ownerAccountIdArb,
        uniqueMembersArb(6),
        strangerUserIdArb,
        strangerAccountIdArb,
        async (ownerAccountId, members, strangerUserId, strangerAccountId) => {
          const { service, repo } = makeService({
            memberLimits: uniformLimits(100),
          });
          const ws = await service.create(ownerAccountId, 'WS');
          for (const m of members) {
            await service.addMember(ownerAccountId, ws.workspaceId, m);
          }

          const before = await repo.findById(ws.workspaceId);
          const snapshot: Workspace = {
            ...(before as Workspace),
            memberUserIds: [...(before as Workspace).memberUserIds],
          };

          const stranger: UserRef = {
            userId: strangerUserId,
            accountId: strangerAccountId,
          };

          // Non-throwing decision denies and discloses no role.
          const decision = await service.authorize(stranger, ws.workspaceId);
          expect(decision.allowed).toBe(false);
          expect(decision.role).toBeNull();

          // Throwing path denies with an AuthorizationError.
          await expect(
            service.requireAccess(stranger, ws.workspaceId)
          ).rejects.toBeInstanceOf(AuthorizationError);

          // No resource data changed by the denied access.
          const after = await repo.findById(ws.workspaceId);
          expect(after).toEqual(snapshot);
        }
      )
    );
  });

  it('decideAccess mirrors the service decision without a repository', () => {
    fc.assert(
      fc.property(
        ownerAccountIdArb,
        uniqueMembersArb(6),
        strangerUserIdArb,
        strangerAccountIdArb,
        fc.boolean(),
        fc.boolean(),
        fc.nat(),
        (
          ownerAccountId,
          members,
          strangerUserId,
          strangerAccountId,
          useOwnerAccount,
          useMemberUserId,
          memberIndex
        ) => {
          const workspace: Workspace = {
            workspaceId: 'w1',
            ownerAccountId,
            name: 'WS',
            memberUserIds: members,
          };
          const userId =
            useMemberUserId && members.length > 0
              ? members[memberIndex % members.length]
              : strangerUserId;
          const accountId = useOwnerAccount ? ownerAccountId : strangerAccountId;
          const requester: UserRef = { userId, accountId };

          const expectedAllowed =
            accountId === ownerAccountId || members.includes(userId);
          const decision = decideAccess(workspace, requester);

          expect(decision.allowed).toBe(expectedAllowed);
          if (expectedAllowed) {
            expect(decision.role).not.toBeNull();
          } else {
            expect(decision.role).toBeNull();
          }
        }
      )
    );
  });
});

// ─── Property 41: Member count never exceeds the tier limit ─────────────────────
// Feature: api-copilot-ai, Property 41: For any Workspace at its Plan_Tier member
// limit, adding another member is rejected, the membership is unchanged, and a
// member-limit error is returned.
// Validates: Requirements 14.5, 14.6

describe('Property 41: Member count never exceeds the tier limit', () => {
  it('fills to the tier limit then rejects further members leaving membership unchanged', async () => {
    await fc.assert(
      fc.asyncProperty(
        ownerAccountIdArb,
        fc.integer({ min: 1, max: 8 }),
        // Distinct candidate members: exactly limit + (1..3) so there is always
        // at least one member beyond the limit to attempt.
        fc.integer({ min: 1, max: 3 }),
        async (ownerAccountId, limit, extra) => {
          const { service, repo } = makeService({
            memberLimits: uniformLimits(limit),
          });
          const ws = await service.create(ownerAccountId, 'WS');

          const candidates = Array.from(
            { length: limit + extra },
            (_, i) => `m:cand-${i}`
          );

          // Fill exactly to the limit.
          for (let i = 0; i < limit; i += 1) {
            await service.addMember(ownerAccountId, ws.workspaceId, candidates[i]);
          }

          const atLimit = await repo.findById(ws.workspaceId);
          expect(atLimit?.memberUserIds).toHaveLength(limit);

          // Every further add is rejected and does not change the membership.
          for (let i = limit; i < candidates.length; i += 1) {
            await expect(
              service.addMember(ownerAccountId, ws.workspaceId, candidates[i])
            ).rejects.toBeInstanceOf(TierMemberLimitError);

            const stored = await repo.findById(ws.workspaceId);
            expect(stored?.memberUserIds).toEqual(atLimit?.memberUserIds);
            expect(stored?.memberUserIds).toHaveLength(limit);
          }
        }
      )
    );
  });

  it('membership never exceeds the limit across an arbitrary sequence of adds', async () => {
    await fc.assert(
      fc.asyncProperty(
        ownerAccountIdArb,
        fc.integer({ min: 1, max: 6 }),
        fc.uniqueArray(memberIdArb, { minLength: 1, maxLength: 12 }),
        async (ownerAccountId, limit, candidates) => {
          const { service, repo } = makeService({
            memberLimits: uniformLimits(limit),
          });
          const ws = await service.create(ownerAccountId, 'WS');

          for (const c of candidates) {
            try {
              await service.addMember(ownerAccountId, ws.workspaceId, c);
            } catch (err) {
              expect(err).toBeInstanceOf(TierMemberLimitError);
            }
            const stored = await repo.findById(ws.workspaceId);
            expect(stored!.memberUserIds.length).toBeLessThanOrEqual(limit);
          }
        }
      )
    );
  });
});

// ─── Property 42: Member removal revokes access but retains data ────────────────
// Feature: api-copilot-ai, Property 42: For any authorized member removed by the
// owner, that member is subsequently denied access to the Workspace's APIs,
// conversations, and settings, while all Workspace data is retained and a
// removal confirmation is returned.
// Validates: Requirements 14.7

describe('Property 42: Member removal revokes access but retains data', () => {
  it('revokes the removed member while retaining the workspace and remaining members', async () => {
    await fc.assert(
      fc.asyncProperty(
        ownerAccountIdArb,
        fc.uniqueArray(memberIdArb, { minLength: 1, maxLength: 6 }),
        fc.nat(),
        async (ownerAccountId, members, removeIndex) => {
          const { service, repo } = makeService({
            memberLimits: uniformLimits(100),
          });
          const ws = await service.create(ownerAccountId, 'WS');
          for (const m of members) {
            await service.addMember(ownerAccountId, ws.workspaceId, m);
          }

          const target = members[removeIndex % members.length];
          const remaining = members.filter((m) => m !== target);

          // Removal returns the updated workspace as confirmation.
          const updated = await service.removeMember(
            ownerAccountId,
            ws.workspaceId,
            target
          );
          expect(updated.memberUserIds).not.toContain(target);
          expect([...updated.memberUserIds].sort()).toEqual(
            [...remaining].sort()
          );

          // Workspace data is retained: still stored, same id/owner/name.
          const stored = await repo.findById(ws.workspaceId);
          expect(stored).not.toBeNull();
          expect(stored?.workspaceId).toBe(ws.workspaceId);
          expect(stored?.ownerAccountId).toBe(ownerAccountId);
          expect(stored?.name).toBe('WS');

          // The removed member is denied access.
          const removed: UserRef = { userId: target, accountId: 'a:other' };
          expect(
            (await service.authorize(removed, ws.workspaceId)).allowed
          ).toBe(false);

          // Remaining members and the owner still have access.
          for (const m of remaining) {
            const decision = await service.authorize(
              { userId: m, accountId: 'a:other' },
              ws.workspaceId
            );
            expect(decision.allowed).toBe(true);
          }
          expect(
            (
              await service.authorize(
                { userId: 'o:any', accountId: ownerAccountId },
                ws.workspaceId
              )
            ).allowed
          ).toBe(true);
        }
      )
    );
  });
});
