/**
 * Workspace Service barrel export.
 *
 * Validates: Requirements 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.7, 18.4, 18.5
 */

export {
  WorkspaceService,
  InMemoryTierProvider,
  decideAccess,
} from './workspace.service';

export {
  WorkspaceNameError,
  AuthorizationError,
  TierMemberLimitError,
  WorkspaceNotFoundError,
} from './workspace.errors';

export { validateWorkspaceName } from './workspace.validators';
export type { NameValidationResult } from './workspace.validators';

export {
  WORKSPACE_NAME_MIN_LENGTH,
  WORKSPACE_NAME_MAX_LENGTH,
  DEFAULT_TIER_MEMBER_LIMITS,
} from './workspace.types';

export type {
  WorkspaceRole,
  AccessDenialReason,
  AccessDecision,
  TierProvider,
  WorkspaceDependencies,
  UserRef,
  Workspace,
} from './workspace.types';
