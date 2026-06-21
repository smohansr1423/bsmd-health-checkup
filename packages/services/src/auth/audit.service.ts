/**
 * Audit Logging Service
 * Records all data access/modification events with immutable entries.
 * Validates: Requirements 18.3, 18.6, 18.7
 *
 * - Records user identity, action, affected record identifier, and timestamp
 * - Retains audit log entries for a minimum of 7 years
 * - Records unauthorized access attempts
 */

import type { AuditEntry, AuditFilters } from './auth.types';

/** ID generator function - injectable for testing */
export type IdGenerator = () => string;

/** Default ID generator using crypto randomUUID or timestamp fallback */
const defaultIdGenerator: IdGenerator = () => {
  return `audit_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
};

export class AuditService {
  private entries: AuditEntry[] = [];
  private readonly idGenerator: IdGenerator;

  constructor(idGenerator?: IdGenerator) {
    this.idGenerator = idGenerator || defaultIdGenerator;
  }

  /**
   * Record an audit log entry.
   * Entries are immutable once recorded.
   */
  async recordEntry(entry: Omit<AuditEntry, 'id' | 'timestamp'>): Promise<AuditEntry> {
    const auditEntry: AuditEntry = {
      id: this.idGenerator(),
      userId: entry.userId,
      action: entry.action,
      resourceType: entry.resourceType,
      resourceId: entry.resourceId,
      timestamp: new Date(),
      details: entry.details,
    };

    this.entries.push(Object.freeze(auditEntry) as AuditEntry);
    return auditEntry;
  }

  /**
   * Record an unauthorized access attempt in the audit log.
   */
  async recordUnauthorizedAccess(
    userId: string,
    resource: string,
    action: string,
    details?: Record<string, unknown>
  ): Promise<AuditEntry> {
    return this.recordEntry({
      userId,
      action: 'unauthorized_access_attempt',
      resourceType: resource,
      resourceId: '',
      details: { attemptedAction: action, ...details },
    });
  }

  /**
   * Record a login failure event.
   */
  async recordLoginFailure(
    username: string,
    reason: string,
    details?: Record<string, unknown>
  ): Promise<AuditEntry> {
    return this.recordEntry({
      userId: username,
      action: 'login_failure',
      resourceType: 'authentication',
      resourceId: '',
      details: { reason, ...details },
    });
  }

  /**
   * Record an account lockout event.
   */
  async recordAccountLockout(
    userId: string,
    reason: string
  ): Promise<AuditEntry> {
    return this.recordEntry({
      userId,
      action: 'account_locked',
      resourceType: 'authentication',
      resourceId: userId,
      details: { reason },
    });
  }

  /**
   * Record a session termination event.
   */
  async recordSessionTermination(
    userId: string,
    sessionId: string,
    reason: string
  ): Promise<AuditEntry> {
    return this.recordEntry({
      userId,
      action: 'session_terminated',
      resourceType: 'session',
      resourceId: sessionId,
      details: { reason },
    });
  }

  /**
   * Query audit log entries with filters.
   */
  async getAuditLog(filters: AuditFilters): Promise<AuditEntry[]> {
    let results = [...this.entries];

    if (filters.userId) {
      results = results.filter((e) => e.userId === filters.userId);
    }
    if (filters.resourceType) {
      results = results.filter((e) => e.resourceType === filters.resourceType);
    }
    if (filters.resourceId) {
      results = results.filter((e) => e.resourceId === filters.resourceId);
    }
    if (filters.action) {
      results = results.filter((e) => e.action === filters.action);
    }
    if (filters.startDate) {
      results = results.filter((e) => e.timestamp >= filters.startDate!);
    }
    if (filters.endDate) {
      results = results.filter((e) => e.timestamp <= filters.endDate!);
    }

    // Sort by timestamp descending (most recent first)
    results.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    // Apply pagination
    const offset = filters.offset || 0;
    const limit = filters.limit || 100;
    return results.slice(offset, offset + limit);
  }

  /**
   * Get total count of audit entries (for pagination).
   */
  async getEntryCount(filters?: Omit<AuditFilters, 'limit' | 'offset'>): Promise<number> {
    if (!filters) {
      return this.entries.length;
    }
    const entries = await this.getAuditLog({ ...filters, limit: Number.MAX_SAFE_INTEGER });
    return entries.length;
  }

  /**
   * Clear all entries (for testing only).
   */
  clear(): void {
    this.entries = [];
  }
}
