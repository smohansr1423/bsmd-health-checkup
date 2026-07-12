/**
 * Workspace Service
 *
 * Workspace creation, isolation, membership management, and the central
 * access-control decision reused by conversation-history and usage-analytics
 * reads.
 *
 * Business rules:
 * - Name length 1..100 (Req 14.1, 14.2).
 * - Isolation: only the owner and authorized members may access a Workspace's
 *   APIs, conversations, and settings (Req 14.3). Unauthorized access is denied
 *   with no data change (Req 14.4, 18.5).
 * - Membership additions are capped by the owning account's tier member limit
 *   (Req 14.5, 14.6).
 * - Member removal revokes access but retains all Workspace data (Req 14.7).
 *
 * Validates: Requirements 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.7, 18.4, 18.5
 */

import {
  InMemoryWorkspaceRepository,
  defaultDateProvider,
  defaultIdGenerator,
} from '../api-copilot-shared';
import type {
  DateProvider,
  IdGenerator,
  PlanTier,
  UserRef,
  Workspace,
  WorkspaceRepository,
} from '../api-copilot-shared';
import {
  DEFAULT_TIER_MEMBER_LIMITS,
  type AccessDecision,
  type TierProvider,
  type WorkspaceDependencies,
} from './workspace.types';
import { validateWorkspaceName } from './workspace.validators';
import {
  AuthorizationError,
  TierMemberLimitError,
  WorkspaceNameError,
  WorkspaceNotFoundError,
} from './workspace.errors';

/**
 * In-memory {@link TierProvider}. Seedable per account; returns a configurable
 * default tier for accounts that have not been assigned one. Suitable for
 * development and tests until an authoritative Plan & Quota provider is wired.
 */
export class InMemoryTierProvider implements TierProvider {
  private readonly tiers: Map<string, PlanTier> = new Map();

  constructor(private readonly defaultTier: PlanTier = 'starter') {}

  setTier(accountId: string, tier: PlanTier): void {
    this.tiers.set(accountId, tier);
  }

  tierOf(accountId: string): PlanTier {
    return this.tiers.get(accountId) ?? this.defaultTier;
  }

  clear(): void {
    this.tiers.clear();
  }
}

/**
 * The central, dependency-free access-control decision for a Workspace.
 *
 * A user is granted access when their account owns the Workspace or their user
 * id is an authorized member. This pure helper lets other services (conversation
 * history, usage analytics) reuse the exact same isolation rule when they
 * already hold the Workspace record (Req 14.3, 15.4, 16.5, 18.4, 18.5).
 */
export function decideAccess(
  workspace: Workspace,
  requester: UserRef
): AccessDecision {
  if (workspace.ownerAccountId === requester.accountId) {
    return {
      allowed: true,
      workspaceId: workspace.workspaceId,
      userId: requester.userId,
      role: 'owner',
    };
  }

  if (workspace.memberUserIds.includes(requester.userId)) {
    return {
      allowed: true,
      workspaceId: workspace.workspaceId,
      userId: requester.userId,
      role: 'member',
    };
  }

  return {
    allowed: false,
    workspaceId: workspace.workspaceId,
    userId: requester.userId,
    role: null,
    reason: 'not_authorized',
  };
}

/**
 * WorkspaceService implementation.
 *
 * Uses dependency injection for id generation, clock, the workspace repository,
 * the tier provider, and the per-tier member-limit map, matching the repo's
 * `Partial<{Domain}Dependencies>` convention with in-memory defaults.
 */
export class WorkspaceService {
  private readonly idGenerator: IdGenerator;
  private readonly dateProvider: DateProvider;
  private readonly workspaceRepository: WorkspaceRepository;
  private readonly tierProvider: TierProvider;
  private readonly memberLimits: Record<PlanTier, number>;

  constructor(deps?: Partial<WorkspaceDependencies>) {
    this.idGenerator = deps?.idGenerator ?? defaultIdGenerator;
    this.dateProvider = deps?.dateProvider ?? defaultDateProvider;
    this.workspaceRepository =
      deps?.workspaceRepository ?? new InMemoryWorkspaceRepository();
    this.tierProvider = deps?.tierProvider ?? new InMemoryTierProvider();
    this.memberLimits = deps?.memberLimits ?? DEFAULT_TIER_MEMBER_LIMITS;
  }

  /**
   * Create a Workspace owned by the requesting account.
   *
   * Requirement 14.1: Create the Workspace and assign ownership when the name is
   * 1..100 characters.
   * Requirement 14.2: Reject an empty or over-long name, creating no Workspace.
   *
   * @throws WorkspaceNameError when the name is outside 1..100 characters.
   */
  async create(ownerAccountId: string, name: string): Promise<Workspace> {
    const { valid, length } = validateWorkspaceName(name);
    if (!valid) {
      throw new WorkspaceNameError(length);
    }

    const workspace: Workspace = {
      workspaceId: this.idGenerator(),
      ownerAccountId,
      name,
      memberUserIds: [],
    };

    return this.workspaceRepository.save(workspace);
  }

  /**
   * The central access-control decision used by conversation and analytics
   * reads. Loads the Workspace and evaluates the isolation rule; returns a
   * non-throwing {@link AccessDecision} so callers can branch on `allowed`.
   *
   * Requirement 14.3: Access is limited to the owner and authorized members.
   * Requirement 14.4 / 18.4 / 18.5: Access outside that set is denied.
   */
  async authorize(
    requester: UserRef,
    workspaceId: string
  ): Promise<AccessDecision> {
    const workspace = await this.workspaceRepository.findById(workspaceId);
    if (!workspace) {
      return {
        allowed: false,
        workspaceId,
        userId: requester.userId,
        role: null,
        reason: 'workspace_not_found',
      };
    }
    return decideAccess(workspace, requester);
  }

  /**
   * Assert that a requester may access a Workspace, throwing when denied. A
   * convenience wrapper over {@link authorize} for callers that prefer an
   * exception path (Req 14.4, 18.5).
   *
   * @throws AuthorizationError when access is denied.
   */
  async requireAccess(
    requester: UserRef,
    workspaceId: string
  ): Promise<AccessDecision> {
    const decision = await this.authorize(requester, workspaceId);
    if (!decision.allowed) {
      throw new AuthorizationError(workspaceId, requester.userId);
    }
    return decision;
  }

  /**
   * Add a user as a member of a Workspace.
   *
   * Requirement 14.5: Only the owner may add members, and only up to the tier's
   * maximum member count.
   * Requirement 14.6: Reject and add no member when the addition would exceed
   * the tier member limit.
   *
   * Adding a user who is already a member is idempotent and does not consume
   * additional capacity.
   *
   * @throws WorkspaceNotFoundError when the Workspace does not exist.
   * @throws AuthorizationError when the requester is not the owner.
   * @throws TierMemberLimitError when the tier member limit would be exceeded.
   */
  async addMember(
    ownerAccountId: string,
    workspaceId: string,
    userId: string
  ): Promise<Workspace> {
    const workspace = await this.getWorkspaceOrThrow(workspaceId);

    if (workspace.ownerAccountId !== ownerAccountId) {
      throw new AuthorizationError(workspaceId, ownerAccountId);
    }

    // Idempotent: existing members do not consume additional capacity.
    if (workspace.memberUserIds.includes(userId)) {
      return workspace;
    }

    const tier = await this.tierProvider.tierOf(ownerAccountId);
    const limit = this.memberLimits[tier];

    if (workspace.memberUserIds.length + 1 > limit) {
      throw new TierMemberLimitError(workspaceId, tier, limit);
    }

    const updated: Workspace = {
      ...workspace,
      memberUserIds: [...workspace.memberUserIds, userId],
    };

    return this.workspaceRepository.update(updated);
  }

  /**
   * Remove an authorized member from a Workspace.
   *
   * Requirement 14.7: Revoke the member's access while retaining all Workspace
   * data, and return the updated Workspace as confirmation. Workspace-owned data
   * (APIs, conversations, settings) is keyed by workspace id in other stores and
   * is therefore untouched by member removal.
   *
   * Removing a user who is not a member is idempotent.
   *
   * @throws WorkspaceNotFoundError when the Workspace does not exist.
   * @throws AuthorizationError when the requester is not the owner.
   */
  async removeMember(
    ownerAccountId: string,
    workspaceId: string,
    userId: string
  ): Promise<Workspace> {
    const workspace = await this.getWorkspaceOrThrow(workspaceId);

    if (workspace.ownerAccountId !== ownerAccountId) {
      throw new AuthorizationError(workspaceId, ownerAccountId);
    }

    if (!workspace.memberUserIds.includes(userId)) {
      return workspace;
    }

    const updated: Workspace = {
      ...workspace,
      memberUserIds: workspace.memberUserIds.filter((id) => id !== userId),
    };

    return this.workspaceRepository.update(updated);
  }

  /**
   * Retrieve a Workspace by id or throw {@link WorkspaceNotFoundError}.
   */
  private async getWorkspaceOrThrow(workspaceId: string): Promise<Workspace> {
    const workspace = await this.workspaceRepository.findById(workspaceId);
    if (!workspace) {
      throw new WorkspaceNotFoundError(workspaceId);
    }
    return workspace;
  }
}
