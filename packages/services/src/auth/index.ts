/**
 * Auth & Access Control Service
 * Public API for authentication, authorization, and audit logging.
 */

export { AuthService, AuthenticationError, AccountLockedError } from './auth.service';
export type { TokenGenerator, SessionIdGenerator, AuthServiceDependencies } from './auth.service';

export { AuditService } from './audit.service';
export type { IdGenerator } from './audit.service';

export { hasPermission, getPermissionsForRole, getRolesWithPermission } from './rbac';
export type { Permission } from './rbac';

export {
  createAuthMiddleware,
  requireRole,
  requirePermission,
} from './auth.middleware';
export type {
  AuthenticatedRequest,
  MiddlewareResponse,
  NextFunction,
} from './auth.middleware';

export type {
  Role,
  Action,
  Resource,
  Credentials,
  AuthToken,
  Session,
  UserAccount,
  AuditEntry,
  AuditFilters,
  TokenValidator,
  PasswordHasher,
  PasswordVerifier,
  AuthServiceConfig,
} from './auth.types';

export { DEFAULT_AUTH_CONFIG } from './auth.types';
