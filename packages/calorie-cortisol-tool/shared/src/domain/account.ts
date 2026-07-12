/**
 * Account / compliance domain types — language-neutral core model
 * (design: Data Models).
 */

/** Per-category consent state (Req 17 / 30.4). */
export interface ConsentState {
  userId: string;
  /** Per-category opt-in (Req 17). */
  categories: Record<string, boolean>;
  /** Affirmative health-data consent (Req 30.4). */
  healthDataConsent: boolean;
  updatedAt: string;
}

/** Role of a member within a family account (Req 19). */
export type FamilyRole = 'admin' | 'member';

/** A single member profile within a family account. */
export interface MemberProfile {
  id: string;
  role: FamilyRole;
}

/** A family account holding ≤5 member profiles (Req 19.1). */
export interface FamilyAccount {
  id: string;
  adminUserId: string;
  /** ≤ 5 members (Req 19.1). */
  members: MemberProfile[];
}

/** Audit action type (Req 25.6). */
export type AuditAction = 'read' | 'create' | 'modify' | 'delete';

/** An append-only audit entry, retained ≥6 years (Req 25.6). */
export interface AuditEntry {
  actorId: string;
  action: AuditAction;
  recordId: string;
  timestamp: string;
}

/** Data-residency descriptor for a user (Req 30.6/30.7). */
export interface Residency {
  userId: string;
  region: string;
  euResident: boolean;
}
