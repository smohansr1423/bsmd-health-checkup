/**
 * Unit tests for Auth & Access Control Service
 * Validates: Requirements 18.1, 18.2, 18.3, 18.5, 18.6, 18.7
 */

import { AuthService, AuthenticationError, AccountLockedError } from './auth.service';
import { AuditService } from './audit.service';
import type { UserAccount, Credentials } from './auth.types';
import { hasPermission } from './rbac';

describe('AuthService', () => {
  let authService: AuthService;
  let auditService: AuditService;

  const testUser: UserAccount = {
    userId: 'user-1',
    username: 'doctor@hospital.com',
    passwordHash: 'correct-password',
    role: 'Physician',
    isLocked: false,
    lockExpiresAt: null,
    consecutiveFailures: 0,
    lastFailedAt: null,
  };

  const adminUser: UserAccount = {
    userId: 'admin-1',
    username: 'admin@hospital.com',
    passwordHash: 'admin-pass',
    role: 'Administrator',
    isLocked: false,
    lockExpiresAt: null,
    consecutiveFailures: 0,
    lastFailedAt: null,
  };

  const labTechUser: UserAccount = {
    userId: 'tech-1',
    username: 'tech@hospital.com',
    passwordHash: 'tech-pass',
    role: 'Lab_Technician',
    isLocked: false,
    lockExpiresAt: null,
    consecutiveFailures: 0,
    lastFailedAt: null,
  };

  beforeEach(() => {
    auditService = new AuditService(() => `audit_${Date.now()}`);
    authService = new AuthService({
      auditService,
      passwordVerifier: (password, hash) => password === hash,
      sessionIdGenerator: (() => {
        let counter = 0;
        return () => `session_${++counter}`;
      })(),
    });

    authService.registerUser({ ...testUser });
    authService.registerUser({ ...adminUser });
    authService.registerUser({ ...labTechUser });
  });

  describe('authenticate', () => {
    it('should authenticate with valid credentials', async () => {
      const credentials: Credentials = {
        username: 'doctor@hospital.com',
        password: 'correct-password',
      };

      const token = await authService.authenticate(credentials);

      expect(token).toBeDefined();
      expect(token.userId).toBe('user-1');
      expect(token.role).toBe('Physician');
      expect(token.sessionId).toBeDefined();
      expect(token.token).toBeDefined();
      expect(token.issuedAt).toBeInstanceOf(Date);
      expect(token.expiresAt).toBeInstanceOf(Date);
      expect(token.expiresAt.getTime()).toBeGreaterThan(token.issuedAt.getTime());
    });

    it('should reject invalid username', async () => {
      const credentials: Credentials = {
        username: 'nonexistent@hospital.com',
        password: 'some-password',
      };

      await expect(authService.authenticate(credentials)).rejects.toThrow(AuthenticationError);
    });

    it('should reject invalid password', async () => {
      const credentials: Credentials = {
        username: 'doctor@hospital.com',
        password: 'wrong-password',
      };

      await expect(authService.authenticate(credentials)).rejects.toThrow(AuthenticationError);
    });

    it('should record login failure in audit log', async () => {
      const credentials: Credentials = {
        username: 'doctor@hospital.com',
        password: 'wrong-password',
      };

      await expect(authService.authenticate(credentials)).rejects.toThrow();

      const logs = await auditService.getAuditLog({ action: 'login_failure' });
      expect(logs.length).toBe(1);
      expect(logs[0].userId).toBe('doctor@hospital.com');
    });
  });

  describe('account lockout (Requirement 18.2)', () => {
    it('should lock account after 5 consecutive failed attempts', async () => {
      const credentials: Credentials = {
        username: 'doctor@hospital.com',
        password: 'wrong-password',
      };

      // First 4 attempts should throw AuthenticationError
      for (let i = 0; i < 4; i++) {
        await expect(authService.authenticate(credentials)).rejects.toThrow(AuthenticationError);
      }

      // 5th attempt should throw AccountLockedError
      await expect(authService.authenticate(credentials)).rejects.toThrow(AccountLockedError);

      // Subsequent attempts should also throw AccountLockedError
      await expect(authService.authenticate(credentials)).rejects.toThrow(AccountLockedError);
    });

    it('should record account lockout in audit log', async () => {
      const credentials: Credentials = {
        username: 'doctor@hospital.com',
        password: 'wrong-password',
      };

      for (let i = 0; i < 5; i++) {
        try {
          await authService.authenticate(credentials);
        } catch {
          // expected
        }
      }

      const logs = await auditService.getAuditLog({ action: 'account_locked' });
      expect(logs.length).toBe(1);
      expect(logs[0].userId).toBe('user-1');
    });

    it('should unlock account after lockout duration expires', async () => {
      // Use a short lockout for testing
      const shortLockService = new AuthService({
        auditService,
        passwordVerifier: (password, hash) => password === hash,
        config: { lockoutDurationMs: 100 }, // 100ms lock
      });
      shortLockService.registerUser({ ...testUser });

      const badCreds: Credentials = { username: 'doctor@hospital.com', password: 'wrong' };
      for (let i = 0; i < 5; i++) {
        try { await shortLockService.authenticate(badCreds); } catch { /* expected */ }
      }

      // Wait for lockout to expire
      await new Promise((resolve) => setTimeout(resolve, 150));

      const goodCreds: Credentials = { username: 'doctor@hospital.com', password: 'correct-password' };
      const token = await shortLockService.authenticate(goodCreds);
      expect(token.userId).toBe('user-1');
    });

    it('should reset consecutive failures on successful login', async () => {
      const badCreds: Credentials = { username: 'doctor@hospital.com', password: 'wrong' };
      const goodCreds: Credentials = { username: 'doctor@hospital.com', password: 'correct-password' };

      // Fail 3 times
      for (let i = 0; i < 3; i++) {
        try { await authService.authenticate(badCreds); } catch { /* expected */ }
      }

      // Succeed
      await authService.authenticate(goodCreds);

      // Fail 4 more times - should not lock (counter was reset)
      for (let i = 0; i < 4; i++) {
        await expect(authService.authenticate(badCreds)).rejects.toThrow(AuthenticationError);
      }

      // 5th fail after reset should lock
      await expect(authService.authenticate(badCreds)).rejects.toThrow(AccountLockedError);
    });
  });

  describe('session timeout (Requirement 18.5)', () => {
    it('should expire session after inactivity timeout', async () => {
      const shortTimeoutService = new AuthService({
        auditService,
        passwordVerifier: (password, hash) => password === hash,
        config: { sessionTimeoutMs: 100 }, // 100ms timeout
      });
      shortTimeoutService.registerUser({ ...testUser });

      const token = await shortTimeoutService.authenticate({
        username: 'doctor@hospital.com',
        password: 'correct-password',
      });

      // Wait for session to expire
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Token validation should fail
      const result = shortTimeoutService.validateToken(token.token);
      expect(result).toBeNull();
    });

    it('should keep session alive with activity', async () => {
      const token = await authService.authenticate({
        username: 'doctor@hospital.com',
        password: 'correct-password',
      });

      // Refresh session
      const refreshed = authService.refreshSession(token.sessionId);
      expect(refreshed).toBe(true);

      // Token should still be valid
      const result = authService.validateToken(token.token);
      expect(result).not.toBeNull();
    });

    it('should terminate session and record in audit log', async () => {
      const token = await authService.authenticate({
        username: 'doctor@hospital.com',
        password: 'correct-password',
      });

      await authService.terminateSession(token.sessionId, 'user_logout');

      const result = authService.validateToken(token.token);
      expect(result).toBeNull();

      const logs = await auditService.getAuditLog({ action: 'session_terminated' });
      expect(logs.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('authorize (Requirements 18.1, 18.7)', () => {
    it('should allow Physician to read health_profile', async () => {
      const token = await authService.authenticate({
        username: 'doctor@hospital.com',
        password: 'correct-password',
      });

      const result = await authService.authorize(token, 'health_profile', 'read');
      expect(result).toBe(true);
    });

    it('should deny Lab_Technician access to health_profile', async () => {
      const token = await authService.authenticate({
        username: 'tech@hospital.com',
        password: 'tech-pass',
      });

      const result = await authService.authorize(token, 'health_profile', 'read');
      expect(result).toBe(false);
    });

    it('should allow Administrator full access', async () => {
      const token = await authService.authenticate({
        username: 'admin@hospital.com',
        password: 'admin-pass',
      });

      const result = await authService.authorize(token, 'user_management', 'manage');
      expect(result).toBe(true);
    });

    it('should record unauthorized access attempt in audit log', async () => {
      const token = await authService.authenticate({
        username: 'tech@hospital.com',
        password: 'tech-pass',
      });

      await authService.authorize(token, 'health_profile', 'write');

      const logs = await auditService.getAuditLog({ action: 'unauthorized_access_attempt' });
      expect(logs.length).toBe(1);
      expect(logs[0].userId).toBe('tech-1');
    });
  });

  describe('lockAccount (manual)', () => {
    it('should lock account and terminate active sessions', async () => {
      const token = await authService.authenticate({
        username: 'doctor@hospital.com',
        password: 'correct-password',
      });

      await authService.lockAccount('user-1', 'suspicious_activity');

      // Token should no longer be valid
      const result = authService.validateToken(token.token);
      expect(result).toBeNull();

      // User account should be locked
      const user = authService.getUser('user-1');
      expect(user?.isLocked).toBe(true);
    });
  });
});

describe('RBAC - hasPermission', () => {
  it('Administrator has full access to all resources', () => {
    expect(hasPermission('Administrator', 'health_profile', 'manage')).toBe(true);
    expect(hasPermission('Administrator', 'user_management', 'write')).toBe(true);
    expect(hasPermission('Administrator', 'system_config', 'delete')).toBe(true);
  });

  it('Physician can read and write patient data', () => {
    expect(hasPermission('Physician', 'health_profile', 'read')).toBe(true);
    expect(hasPermission('Physician', 'health_profile', 'write')).toBe(true);
    expect(hasPermission('Physician', 'health_report', 'read')).toBe(true);
    expect(hasPermission('Physician', 'test_result', 'write')).toBe(true);
  });

  it('Physician cannot access user management', () => {
    expect(hasPermission('Physician', 'user_management', 'read')).toBe(false);
    expect(hasPermission('Physician', 'system_config', 'write')).toBe(false);
  });

  it('Lab_Technician can only access test results', () => {
    expect(hasPermission('Lab_Technician', 'test_result', 'read')).toBe(true);
    expect(hasPermission('Lab_Technician', 'test_result', 'write')).toBe(true);
    expect(hasPermission('Lab_Technician', 'health_profile', 'read')).toBe(false);
    expect(hasPermission('Lab_Technician', 'health_report', 'read')).toBe(false);
  });

  it('Senior_Citizen has read-only access to own data', () => {
    expect(hasPermission('Senior_Citizen', 'health_profile', 'read')).toBe(true);
    expect(hasPermission('Senior_Citizen', 'health_report', 'read')).toBe(true);
    expect(hasPermission('Senior_Citizen', 'test_result', 'read')).toBe(true);
    expect(hasPermission('Senior_Citizen', 'health_profile', 'write')).toBe(false);
  });

  it('Caregiver has read-only access to linked senior data', () => {
    expect(hasPermission('Caregiver', 'health_profile', 'read')).toBe(true);
    expect(hasPermission('Caregiver', 'health_report', 'read')).toBe(true);
    expect(hasPermission('Caregiver', 'test_result', 'read')).toBe(true);
    expect(hasPermission('Caregiver', 'health_profile', 'write')).toBe(false);
    expect(hasPermission('Caregiver', 'user_management', 'read')).toBe(false);
  });
});

describe('AuditService', () => {
  let auditService: AuditService;

  beforeEach(() => {
    auditService = new AuditService(() => `audit_${Date.now()}`);
  });

  it('should record audit entries with timestamp', async () => {
    const entry = await auditService.recordEntry({
      userId: 'user-1',
      action: 'read',
      resourceType: 'health_profile',
      resourceId: 'profile-123',
    });

    expect(entry.id).toBeDefined();
    expect(entry.timestamp).toBeInstanceOf(Date);
    expect(entry.userId).toBe('user-1');
    expect(entry.action).toBe('read');
  });

  it('should filter audit logs by userId', async () => {
    await auditService.recordEntry({
      userId: 'user-1',
      action: 'read',
      resourceType: 'health_profile',
      resourceId: 'p-1',
    });
    await auditService.recordEntry({
      userId: 'user-2',
      action: 'write',
      resourceType: 'health_profile',
      resourceId: 'p-2',
    });

    const logs = await auditService.getAuditLog({ userId: 'user-1' });
    expect(logs.length).toBe(1);
    expect(logs[0].userId).toBe('user-1');
  });

  it('should filter audit logs by action', async () => {
    await auditService.recordEntry({
      userId: 'user-1',
      action: 'read',
      resourceType: 'health_profile',
      resourceId: 'p-1',
    });
    await auditService.recordEntry({
      userId: 'user-1',
      action: 'unauthorized_access_attempt',
      resourceType: 'health_profile',
      resourceId: 'p-2',
    });

    const logs = await auditService.getAuditLog({ action: 'unauthorized_access_attempt' });
    expect(logs.length).toBe(1);
  });

  it('should paginate results', async () => {
    for (let i = 0; i < 10; i++) {
      await auditService.recordEntry({
        userId: 'user-1',
        action: 'read',
        resourceType: 'health_profile',
        resourceId: `p-${i}`,
      });
    }

    const page1 = await auditService.getAuditLog({ limit: 5, offset: 0 });
    const page2 = await auditService.getAuditLog({ limit: 5, offset: 5 });

    expect(page1.length).toBe(5);
    expect(page2.length).toBe(5);
  });
});
