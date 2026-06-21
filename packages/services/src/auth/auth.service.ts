/**
 * Auth & Access Control Service Implementation
 * Validates: Requirements 18.1, 18.2, 18.3, 18.5, 18.6, 18.7
 *
 * Responsibilities:
 * - Authentication with JWT token validation
 * - Role-based access control enforcement
 * - Account lockout after 5 consecutive failures (30-minute lock)
 * - Session timeout after 15 minutes of inactivity
 * - Audit logging for all data access/modification events
 */

import type {
  AuthToken,
  AuthServiceConfig,
  Credentials,
  Session,
  UserAccount,
  AuditEntry,
  AuditFilters,
  TokenValidator,
  PasswordVerifier,
  Role,
} from './auth.types';
import { DEFAULT_AUTH_CONFIG } from './auth.types';
import { hasPermission } from './rbac';
import { AuditService } from './audit.service';

/** Token generator function - injectable for testing */
export type TokenGenerator = (userId: string, role: Role, sessionId: string) => string;

/** Session ID generator - injectable for testing */
export type SessionIdGenerator = () => string;

/** Default token generator (produces a pseudo-JWT for development) */
const defaultTokenGenerator: TokenGenerator = (userId, role, sessionId) => {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64');
  const payload = Buffer.from(
    JSON.stringify({ sub: userId, role, sid: sessionId, iat: Date.now() })
  ).toString('base64');
  const signature = Buffer.from(`sig_${userId}_${Date.now()}`).toString('base64');
  return `${header}.${payload}.${signature}`;
};

/** Default session ID generator */
const defaultSessionIdGenerator: SessionIdGenerator = () => {
  return `session_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
};

/** Dependencies that can be injected for testing */
export interface AuthServiceDependencies {
  tokenGenerator?: TokenGenerator;
  tokenValidator?: TokenValidator;
  passwordVerifier?: PasswordVerifier;
  sessionIdGenerator?: SessionIdGenerator;
  auditService?: AuditService;
  config?: Partial<AuthServiceConfig>;
}

export class AuthService {
  private readonly config: AuthServiceConfig;
  private readonly tokenGenerator: TokenGenerator;
  private readonly tokenValidator: TokenValidator;
  private readonly passwordVerifier: PasswordVerifier;
  private readonly sessionIdGenerator: SessionIdGenerator;
  private readonly auditService: AuditService;

  // In-memory stores (will be replaced by database later)
  private users: Map<string, UserAccount> = new Map();
  private sessions: Map<string, Session> = new Map();
  private tokenToSession: Map<string, string> = new Map();

  constructor(deps?: AuthServiceDependencies) {
    this.config = { ...DEFAULT_AUTH_CONFIG, ...deps?.config };
    this.tokenGenerator = deps?.tokenGenerator || defaultTokenGenerator;
    this.tokenValidator = deps?.tokenValidator || this.defaultTokenValidator.bind(this);
    this.passwordVerifier = deps?.passwordVerifier || ((password, hash) => password === hash);
    this.sessionIdGenerator = deps?.sessionIdGenerator || defaultSessionIdGenerator;
    this.auditService = deps?.auditService || new AuditService();
  }

  /**
   * Register a user account (for setup/testing purposes).
   */
  registerUser(account: UserAccount): void {
    this.users.set(account.userId, { ...account });
  }

  /**
   * Authenticate user with credentials.
   * Implements account lockout after maxFailedAttempts consecutive failures.
   * Validates: Requirement 18.2
   */
  async authenticate(credentials: Credentials): Promise<AuthToken> {
    const user = this.findUserByUsername(credentials.username);

    if (!user) {
      await this.auditService.recordLoginFailure(credentials.username, 'user_not_found');
      throw new AuthenticationError('Invalid credentials');
    }

    // Check if account is locked
    if (user.isLocked) {
      if (user.lockExpiresAt && new Date() < user.lockExpiresAt) {
        await this.auditService.recordLoginFailure(
          credentials.username,
          'account_locked',
          { lockExpiresAt: user.lockExpiresAt }
        );
        throw new AccountLockedError(
          'Account is locked due to too many failed attempts. Please try again later.',
          user.lockExpiresAt
        );
      }
      // Lock has expired, reset lockout
      user.isLocked = false;
      user.lockExpiresAt = null;
      user.consecutiveFailures = 0;
    }

    // Verify password
    if (!this.passwordVerifier(credentials.password, user.passwordHash)) {
      user.consecutiveFailures += 1;
      user.lastFailedAt = new Date();

      // Check if we should lock the account
      if (user.consecutiveFailures >= this.config.maxFailedAttempts) {
        user.isLocked = true;
        user.lockExpiresAt = new Date(Date.now() + this.config.lockoutDurationMs);
        await this.auditService.recordAccountLockout(
          user.userId,
          `Locked after ${user.consecutiveFailures} consecutive failed login attempts`
        );
        throw new AccountLockedError(
          'Account has been locked due to too many failed login attempts. Please try again after 30 minutes.',
          user.lockExpiresAt
        );
      }

      await this.auditService.recordLoginFailure(
        credentials.username,
        'invalid_password',
        { attemptNumber: user.consecutiveFailures }
      );
      throw new AuthenticationError('Invalid credentials');
    }

    // Successful authentication - reset failure count
    user.consecutiveFailures = 0;
    user.lastFailedAt = null;

    // Create session
    const sessionId = this.sessionIdGenerator();
    const now = new Date();
    const session: Session = {
      sessionId,
      userId: user.userId,
      role: user.role,
      createdAt: now,
      lastActivityAt: now,
      isActive: true,
    };
    this.sessions.set(sessionId, session);

    // Generate token
    const token = this.tokenGenerator(user.userId, user.role, sessionId);
    const authToken: AuthToken = {
      token,
      userId: user.userId,
      role: user.role,
      sessionId,
      issuedAt: now,
      expiresAt: new Date(now.getTime() + this.config.tokenExpiryMs),
    };

    this.tokenToSession.set(token, sessionId);

    await this.auditService.recordEntry({
      userId: user.userId,
      action: 'login_success',
      resourceType: 'authentication',
      resourceId: sessionId,
    });

    return authToken;
  }

  /**
   * Authorize a user action against a resource.
   * Validates: Requirements 18.1, 18.7
   */
  async authorize(token: AuthToken, resource: string, action: string): Promise<boolean> {
    // Validate session is still active
    const session = this.sessions.get(token.sessionId);
    if (!session || !session.isActive) {
      return false;
    }

    // Check session timeout
    if (this.isSessionExpired(session)) {
      await this.terminateSession(session.sessionId, 'inactivity_timeout');
      return false;
    }

    // Update last activity
    session.lastActivityAt = new Date();

    // Check role-based permission
    const permitted = hasPermission(token.role, resource, action);

    if (!permitted) {
      await this.auditService.recordUnauthorizedAccess(
        token.userId,
        resource,
        action
      );
    }

    return permitted;
  }

  /**
   * Validate a token string and return the AuthToken if valid.
   * Uses the injected tokenValidator for testability.
   */
  validateToken(tokenString: string): AuthToken | null {
    const authToken = this.tokenValidator(tokenString);
    if (!authToken) {
      return null;
    }

    // Check session is still valid
    const session = this.sessions.get(authToken.sessionId);
    if (!session || !session.isActive) {
      return null;
    }

    // Check session timeout
    if (this.isSessionExpired(session)) {
      // Terminate expired session (fire and forget)
      this.terminateSession(session.sessionId, 'inactivity_timeout');
      return null;
    }

    // Check token expiry
    if (new Date() > authToken.expiresAt) {
      return null;
    }

    // Update session activity
    session.lastActivityAt = new Date();

    return authToken;
  }

  /**
   * Lock an account manually (e.g., by administrator).
   * Validates: Requirement 18.2
   */
  async lockAccount(userId: string, reason: string): Promise<void> {
    const user = this.users.get(userId);
    if (!user) {
      throw new Error(`User not found: ${userId}`);
    }

    user.isLocked = true;
    user.lockExpiresAt = new Date(Date.now() + this.config.lockoutDurationMs);

    await this.auditService.recordAccountLockout(userId, reason);

    // Terminate all active sessions for this user
    for (const [, session] of this.sessions) {
      if (session.userId === userId && session.isActive) {
        await this.terminateSession(session.sessionId, 'account_locked');
      }
    }
  }

  /**
   * Terminate a session.
   * Validates: Requirement 18.5
   */
  async terminateSession(sessionId: string, reason?: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    session.isActive = false;

    await this.auditService.recordSessionTermination(
      session.userId,
      sessionId,
      reason || 'manual_termination'
    );

    // Remove token mappings for this session
    for (const [token, sid] of this.tokenToSession) {
      if (sid === sessionId) {
        this.tokenToSession.delete(token);
      }
    }
  }

  /**
   * Record an audit entry for data access/modification.
   * Validates: Requirement 18.3
   */
  async recordAuditEntry(entry: Omit<AuditEntry, 'id' | 'timestamp'>): Promise<void> {
    await this.auditService.recordEntry(entry);
  }

  /**
   * Get audit log entries with filters.
   * Validates: Requirement 18.3
   */
  async getAuditLog(filters: AuditFilters): Promise<AuditEntry[]> {
    return this.auditService.getAuditLog(filters);
  }

  /**
   * Check if a session has expired due to inactivity.
   * Validates: Requirement 18.5
   */
  isSessionExpired(session: Session): boolean {
    const elapsed = Date.now() - session.lastActivityAt.getTime();
    return elapsed > this.config.sessionTimeoutMs;
  }

  /**
   * Get session by ID (for middleware use).
   */
  getSession(sessionId: string): Session | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Get user account by userId.
   */
  getUser(userId: string): UserAccount | undefined {
    return this.users.get(userId);
  }

  /**
   * Refresh session activity timestamp (called on each authenticated request).
   * Validates: Requirement 18.5
   */
  refreshSession(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session || !session.isActive) {
      return false;
    }

    if (this.isSessionExpired(session)) {
      this.terminateSession(sessionId, 'inactivity_timeout');
      return false;
    }

    session.lastActivityAt = new Date();
    return true;
  }

  /**
   * Get the audit service instance (for direct use by other services).
   */
  getAuditService(): AuditService {
    return this.auditService;
  }

  // --- Private Helpers ---

  private findUserByUsername(username: string): UserAccount | undefined {
    for (const [, user] of this.users) {
      if (user.username === username) {
        return user;
      }
    }
    return undefined;
  }

  private defaultTokenValidator(tokenString: string): AuthToken | null {
    // Look up the token in our token-to-session map
    const sessionId = this.tokenToSession.get(tokenString);
    if (!sessionId) {
      return null;
    }

    const session = this.sessions.get(sessionId);
    if (!session) {
      return null;
    }

    return {
      token: tokenString,
      userId: session.userId,
      role: session.role,
      sessionId: session.sessionId,
      issuedAt: session.createdAt,
      expiresAt: new Date(session.createdAt.getTime() + this.config.tokenExpiryMs),
    };
  }
}

/** Error thrown when authentication fails */
export class AuthenticationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthenticationError';
  }
}

/** Error thrown when an account is locked */
export class AccountLockedError extends Error {
  public readonly lockExpiresAt: Date;

  constructor(message: string, lockExpiresAt: Date) {
    super(message);
    this.name = 'AccountLockedError';
    this.lockExpiresAt = lockExpiresAt;
  }
}
