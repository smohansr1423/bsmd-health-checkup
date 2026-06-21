/**
 * Auth & Access Control Service - Type Definitions
 * Validates: Requirements 18.1, 18.2, 18.3, 18.5, 18.6, 18.7
 */

/** System roles with defined access levels */
export type Role =
  | 'Administrator'
  | 'Physician'
  | 'Lab_Technician'
  | 'Senior_Citizen'
  | 'Caregiver';

/** Actions that can be performed on resources */
export type Action = 'read' | 'write' | 'delete' | 'manage';

/** Resources protected by RBAC */
export type Resource =
  | 'health_profile'
  | 'health_report'
  | 'test_result'
  | 'appointment'
  | 'follow_up'
  | 'invoice'
  | 'payment'
  | 'insurance_claim'
  | 'checkup_package'
  | 'physician_registry'
  | 'user_management'
  | 'analytics'
  | 'notification'
  | 'system_config';

/** User credentials for authentication */
export interface Credentials {
  username: string;
  password: string;
}

/** Authentication token returned after successful login */
export interface AuthToken {
  token: string;
  userId: string;
  role: Role;
  sessionId: string;
  issuedAt: Date;
  expiresAt: Date;
}

/** Session tracking for timeout enforcement */
export interface Session {
  sessionId: string;
  userId: string;
  role: Role;
  createdAt: Date;
  lastActivityAt: Date;
  isActive: boolean;
}

/** User account record for authentication */
export interface UserAccount {
  userId: string;
  username: string;
  passwordHash: string;
  role: Role;
  isLocked: boolean;
  lockExpiresAt: Date | null;
  consecutiveFailures: number;
  lastFailedAt: Date | null;
  /** For Caregiver: linked senior citizen IDs */
  linkedSeniorIds?: string[];
}

/** Audit log entry for data access/modification tracking */
export interface AuditEntry {
  id: string;
  userId: string;
  action: string;
  resourceType: string;
  resourceId: string;
  timestamp: Date;
  details?: Record<string, unknown>;
}

/** Filters for querying audit logs */
export interface AuditFilters {
  userId?: string;
  resourceType?: string;
  resourceId?: string;
  action?: string;
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  offset?: number;
}

/** Token validator function - injectable for testing */
export type TokenValidator = (token: string) => AuthToken | null;

/** Password hasher function - injectable for testing */
export type PasswordHasher = (password: string) => string;

/** Password verifier function - injectable for testing */
export type PasswordVerifier = (password: string, hash: string) => boolean;

/** Configuration for the auth service */
export interface AuthServiceConfig {
  /** Max consecutive failed attempts before lockout (default: 5) */
  maxFailedAttempts: number;
  /** Account lockout duration in milliseconds (default: 30 minutes) */
  lockoutDurationMs: number;
  /** Session inactivity timeout in milliseconds (default: 15 minutes) */
  sessionTimeoutMs: number;
  /** Token expiry duration in milliseconds (default: 1 hour) */
  tokenExpiryMs: number;
}

/** Default auth configuration */
export const DEFAULT_AUTH_CONFIG: AuthServiceConfig = {
  maxFailedAttempts: 5,
  lockoutDurationMs: 30 * 60 * 1000, // 30 minutes
  sessionTimeoutMs: 15 * 60 * 1000, // 15 minutes
  tokenExpiryMs: 60 * 60 * 1000, // 1 hour
};
