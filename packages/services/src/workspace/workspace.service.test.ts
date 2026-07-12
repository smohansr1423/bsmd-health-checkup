/**
 * Workspace Service — Unit Tests
 *
 * Feature: api-copilot-ai
 * Validates: Requirements 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.7, 18.4, 18.5
 */

import {
  WorkspaceService,
  InMemoryTierProvider,
  decideAccess,
  WorkspaceNameError,
  AuthorizationError,
  TierMemberLimitError,
  WorkspaceNotFoundError,
  DEFAULT_TIER_MEMBER_LIMITS,
} from './index';
import type { WorkspaceDependencies } from './index';
import { InMemoryWorkspaceRepository } from '../api-copilot-shared';
import type { PlanTier, UserRef } from '../api-copilot-shared';

/** Deterministic, monotonically increasing id generator for stable ids. */
function makeIdGenerator(): () => string {
  let counter = 0;
  return () => {
    counter += 1;
    return `ws_${counter}`;
  };
}

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

const owner: UserRef = { userId: 'user-owner', accountId: 'acct-owner' };

describe('WorkspaceService.create', () => {
  it('creates a workspace and assigns ownership for a valid name (Req 14.1)', async () => {
    const { service, repo } = makeService();

    const ws = await service.create(owner.accountId, 'My Workspace');

    expect(ws.workspaceId).toBe('ws_1');
    expect(ws.ownerAccountId).toBe(owner.accountId);
    expect(ws.name).toBe('My Workspace');
    expect(ws.memberUserIds).toEqual([]);
    expect(await repo.findById('ws_1')).not.toBeNull();
  });

  it('accepts names at the 1 and 100 character bounds (Req 14.1)', async () => {
    const { service } = makeService();

    const min = await service.create(owner.accountId, 'a');
    const max = await service.create(owner.accountId, 'x'.repeat(100));

    expect(min.name.length).toBe(1);
    expect(max.name.length).toBe(100);
  });

  it('rejects an empty name and creates no workspace (Req 14.2)', async () => {
    const { service, repo } = makeService();

    await expect(service.create(owner.accountId, '')).rejects.toBeInstanceOf(
      WorkspaceNameError
    );
    expect(await repo.listByOwner(owner.accountId)).toHaveLength(0);
  });

  it('rejects a name over 100 characters and creates no workspace (Req 14.2)', async () => {
    const { service, repo } = makeService();

    await expect(
      service.create(owner.accountId, 'x'.repeat(101))
    ).rejects.toBeInstanceOf(WorkspaceNameError);
    expect(await repo.listByOwner(owner.accountId)).toHaveLength(0);
  });
});

describe('WorkspaceService.authorize (isolation & access control)', () => {
  it('grants the owner access with the owner role (Req 14.3)', async () => {
    const { service } = makeService();
    const ws = await service.create(owner.accountId, 'WS');

    const decision = await service.authorize(owner, ws.workspaceId);

    expect(decision.allowed).toBe(true);
    expect(decision.role).toBe('owner');
  });

  it('grants an added member access with the member role (Req 14.3)', async () => {
    const { service } = makeService();
    const ws = await service.create(owner.accountId, 'WS');
    await service.addMember(owner.accountId, ws.workspaceId, 'member-1');

    const member: UserRef = { userId: 'member-1', accountId: 'acct-other' };
    const decision = await service.authorize(member, ws.workspaceId);

    expect(decision.allowed).toBe(true);
    expect(decision.role).toBe('member');
  });

  it('denies a non-owner, non-member (Req 14.4, 18.5)', async () => {
    const { service } = makeService();
    const ws = await service.create(owner.accountId, 'WS');

    const stranger: UserRef = { userId: 'stranger', accountId: 'acct-x' };
    const decision = await service.authorize(stranger, ws.workspaceId);

    expect(decision.allowed).toBe(false);
    expect(decision.role).toBeNull();
    expect(decision.reason).toBe('not_authorized');
  });

  it('denies access to a non-existent workspace', async () => {
    const { service } = makeService();

    const decision = await service.authorize(owner, 'missing');

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('workspace_not_found');
  });

  it('requireAccess throws AuthorizationError when denied (Req 14.4, 18.5)', async () => {
    const { service } = makeService();
    const ws = await service.create(owner.accountId, 'WS');
    const stranger: UserRef = { userId: 'stranger', accountId: 'acct-x' };

    await expect(
      service.requireAccess(stranger, ws.workspaceId)
    ).rejects.toBeInstanceOf(AuthorizationError);
  });
});

describe('decideAccess (pure reusable decision)', () => {
  it('mirrors owner/member/denied outcomes without a repository', () => {
    const ws = {
      workspaceId: 'w1',
      ownerAccountId: 'acct-owner',
      name: 'WS',
      memberUserIds: ['member-1'],
    };

    expect(decideAccess(ws, owner).role).toBe('owner');
    expect(
      decideAccess(ws, { userId: 'member-1', accountId: 'zzz' }).role
    ).toBe('member');
    expect(
      decideAccess(ws, { userId: 'nobody', accountId: 'zzz' }).allowed
    ).toBe(false);
  });
});

describe('WorkspaceService.addMember (tier limits)', () => {
  it('adds a member for a collaboration-enabled tier (Req 14.5)', async () => {
    const { service } = makeService();
    const ws = await service.create(owner.accountId, 'WS');

    const updated = await service.addMember(
      owner.accountId,
      ws.workspaceId,
      'member-1'
    );

    expect(updated.memberUserIds).toContain('member-1');
  });

  it('is idempotent for an existing member and does not consume capacity (Req 14.6)', async () => {
    const limits: Record<PlanTier, number> = { starter: 0, pro: 1, enterprise: 1 };
    const { service } = makeService({ memberLimits: limits });
    const ws = await service.create(owner.accountId, 'WS');
    await service.addMember(owner.accountId, ws.workspaceId, 'member-1');

    const again = await service.addMember(
      owner.accountId,
      ws.workspaceId,
      'member-1'
    );

    expect(again.memberUserIds).toEqual(['member-1']);
  });

  it('rejects adding a member beyond the tier limit and adds no member (Req 14.6)', async () => {
    const limits: Record<PlanTier, number> = { starter: 0, pro: 1, enterprise: 1 };
    const { service, repo } = makeService({ memberLimits: limits });
    const ws = await service.create(owner.accountId, 'WS');
    await service.addMember(owner.accountId, ws.workspaceId, 'member-1');

    await expect(
      service.addMember(owner.accountId, ws.workspaceId, 'member-2')
    ).rejects.toBeInstanceOf(TierMemberLimitError);

    const stored = await repo.findById(ws.workspaceId);
    expect(stored?.memberUserIds).toEqual(['member-1']);
  });

  it('rejects members on a starter tier that has no team collaboration (Req 14.5, 14.6)', async () => {
    const { service, tierProvider } = makeService();
    tierProvider.setTier(owner.accountId, 'starter');
    const ws = await service.create(owner.accountId, 'WS');

    await expect(
      service.addMember(owner.accountId, ws.workspaceId, 'member-1')
    ).rejects.toBeInstanceOf(TierMemberLimitError);
  });

  it('denies a non-owner attempting to add a member (Req 14.4, 18.5)', async () => {
    const { service } = makeService();
    const ws = await service.create(owner.accountId, 'WS');

    await expect(
      service.addMember('acct-not-owner', ws.workspaceId, 'member-1')
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('throws WorkspaceNotFoundError for a missing workspace', async () => {
    const { service } = makeService();

    await expect(
      service.addMember(owner.accountId, 'missing', 'member-1')
    ).rejects.toBeInstanceOf(WorkspaceNotFoundError);
  });
});

describe('WorkspaceService.removeMember (revoke access, retain data)', () => {
  it('revokes access while retaining the workspace and other data (Req 14.7)', async () => {
    const { service } = makeService();
    const ws = await service.create(owner.accountId, 'WS');
    await service.addMember(owner.accountId, ws.workspaceId, 'member-1');
    await service.addMember(owner.accountId, ws.workspaceId, 'member-2');

    const updated = await service.removeMember(
      owner.accountId,
      ws.workspaceId,
      'member-1'
    );

    expect(updated.memberUserIds).toEqual(['member-2']);
    // Workspace itself (and its id-keyed data) is retained.
    const removed: UserRef = { userId: 'member-1', accountId: 'acct-other' };
    expect((await service.authorize(removed, ws.workspaceId)).allowed).toBe(false);
    expect((await service.authorize(owner, ws.workspaceId)).allowed).toBe(true);
  });

  it('is idempotent when removing a non-member (Req 14.7)', async () => {
    const { service } = makeService();
    const ws = await service.create(owner.accountId, 'WS');

    const updated = await service.removeMember(
      owner.accountId,
      ws.workspaceId,
      'never-added'
    );

    expect(updated.memberUserIds).toEqual([]);
  });

  it('denies a non-owner attempting to remove a member (Req 14.4, 18.5)', async () => {
    const { service } = makeService();
    const ws = await service.create(owner.accountId, 'WS');
    await service.addMember(owner.accountId, ws.workspaceId, 'member-1');

    await expect(
      service.removeMember('acct-not-owner', ws.workspaceId, 'member-1')
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('exposes DEFAULT_TIER_MEMBER_LIMITS with no starter collaboration', () => {
    expect(DEFAULT_TIER_MEMBER_LIMITS.starter).toBe(0);
    expect(DEFAULT_TIER_MEMBER_LIMITS.pro).toBeGreaterThan(0);
  });
});
