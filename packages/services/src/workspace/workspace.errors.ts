/**
 * Workspace — Errors
 *
 * Custom error types for the Workspace service.
 *
 * Validates: Requirements 14.2, 14.4, 14.6, 18.5
 */

import {
  WORKSPACE_NAME_MAX_LENGTH,
  WORKSPACE_NAME_MIN_LENGTH,
} from './workspace.types';
import type { PlanTier } from '../api-copilot-shared';

/**
 * Thrown when a Workspace name is empty or exceeds the allowed length.
 *
 * Requirement 14.2: Reject creation with an empty name or a name longer than
 * 100 characters, creating no Workspace and returning a name-length error.
 */
export class WorkspaceNameError extends Error {
  /** The length of the offending name. */
  public readonly length: number;

  constructor(length: number) {
    super(
      `Invalid workspace name: length ${length} is outside the allowed range of ` +
        `${WORKSPACE_NAME_MIN_LENGTH}..${WORKSPACE_NAME_MAX_LENGTH} characters.`
    );
    this.name = 'WorkspaceNameError';
    this.length = length;
  }
}

/**
 * Thrown when a user who is neither the owner nor an authorized member attempts
 * a Workspace action, or when a non-owner attempts an owner-only operation.
 *
 * Requirement 14.4 / 18.5: Deny access, make no change to the Workspace data,
 * and return an authorization error.
 */
export class AuthorizationError extends Error {
  public readonly workspaceId: string;
  public readonly userId: string;

  constructor(workspaceId: string, userId: string) {
    super(
      `Access denied: user "${userId}" is not authorized for workspace "${workspaceId}".`
    );
    this.name = 'AuthorizationError';
    this.workspaceId = workspaceId;
    this.userId = userId;
  }
}

/**
 * Thrown when adding a member would exceed the maximum member count permitted
 * by the owning account's Plan_Tier.
 *
 * Requirement 14.6: Reject the request, add no member, and return an error
 * indicating the tier member limit has been reached.
 */
export class TierMemberLimitError extends Error {
  public readonly workspaceId: string;
  public readonly tier: PlanTier;
  public readonly limit: number;

  constructor(workspaceId: string, tier: PlanTier, limit: number) {
    super(
      `Tier member limit reached: the "${tier}" plan allows at most ${limit} ` +
        `additional member(s) for workspace "${workspaceId}".`
    );
    this.name = 'TierMemberLimitError';
    this.workspaceId = workspaceId;
    this.tier = tier;
    this.limit = limit;
  }
}

/**
 * Thrown when an operation references a Workspace that does not exist.
 */
export class WorkspaceNotFoundError extends Error {
  public readonly workspaceId: string;

  constructor(workspaceId: string) {
    super(`Workspace not found: ${workspaceId}`);
    this.name = 'WorkspaceNotFoundError';
    this.workspaceId = workspaceId;
  }
}
