/**
 * Workspace — Types
 *
 * Domain types for the API Copilot AI Workspace service: workspace creation,
 * isolation, membership management, and the central access-control decision
 * reused by conversation-history and usage-analytics reads.
 *
 * Validates: Requirements 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.7, 18.4, 18.5
 */

import type {
  BaseServiceDependencies,
  PlanTier,
  UserRef,
  Workspace,
  WorkspaceRepository,
} from '../api-copilot-shared';

// ---------------------------------------------------------------------------
// Name-length bounds (Req 14.1, 14.2)
// ---------------------------------------------------------------------------

export const WORKSPACE_NAME_MIN_LENGTH = 1;
export const WORKSPACE_NAME_MAX_LENGTH = 100;

// ---------------------------------------------------------------------------
// Tier member limits (Req 14.5, 14.6)
// ---------------------------------------------------------------------------

/**
 * Maximum number of additional members (beyond the owner) a Workspace may have,
 * keyed by the owning account's Plan_Tier.
 *
 * - `starter` has no team collaboration, so no additional members are allowed
 *   (Req 14.5 scopes collaboration to Pro-tier and above).
 * - `pro` allows team collaboration up to a fixed cap.
 * - `enterprise` limits are configuration-record driven; the default is a high
 *   cap that deployments can override by supplying their own limit map.
 *
 * These limits are expressed as injectable data so the same access-control
 * service can be reused by other services (e.g., a future Plan & Quota service
 * can supply authoritative limits without changing this domain).
 */
export const DEFAULT_TIER_MEMBER_LIMITS: Record<PlanTier, number> = {
  starter: 0,
  pro: 10,
  enterprise: 100,
};

// ---------------------------------------------------------------------------
// Access control (Req 14.3, 14.4, 18.4, 18.5)
// ---------------------------------------------------------------------------

/** The relationship a user has to a Workspace when access is granted. */
export type WorkspaceRole = 'owner' | 'member';

/** Reason an access decision was denied. */
export type AccessDenialReason = 'workspace_not_found' | 'not_authorized';

/**
 * The central access-control decision for a Workspace. Returned by
 * {@link WorkspaceService.authorize} and produced by the pure `decideAccess`
 * helper so conversation-history and usage-analytics reads can share one
 * isolation rule (Req 14.3, 14.4, 15.4, 16.5, 18.4, 18.5).
 */
export interface AccessDecision {
  allowed: boolean;
  workspaceId: string;
  userId: string;
  /** The role that granted access, or `null` when access is denied. */
  role: WorkspaceRole | null;
  /** Populated only when `allowed` is false. */
  reason?: AccessDenialReason;
}

// ---------------------------------------------------------------------------
// Plan-tier lookup dependency
// ---------------------------------------------------------------------------

/**
 * Resolves the Plan_Tier for an owning account. Kept as an injectable seam so
 * the Workspace service does not hard-depend on the Plan & Quota service; a
 * production deployment can supply a provider backed by the authoritative
 * plan-quota concepts.
 */
export interface TierProvider {
  tierOf(accountId: string): PlanTier | Promise<PlanTier>;
}

// ---------------------------------------------------------------------------
// Dependency injection
// ---------------------------------------------------------------------------

export interface WorkspaceDependencies extends BaseServiceDependencies {
  workspaceRepository: WorkspaceRepository;
  /** Resolves the owning account's Plan_Tier for member-limit checks. */
  tierProvider: TierProvider;
  /** Maximum additional members per tier (Req 14.5, 14.6). */
  memberLimits: Record<PlanTier, number>;
}

export type { UserRef, Workspace };
