/**
 * Audit Entry interface
 */

export interface AuditEntry {
  id: string;
  userId: string;
  action: string;
  resourceType: string;
  resourceId: string;
  timestamp: Date;
  details?: Record<string, unknown>;
}
