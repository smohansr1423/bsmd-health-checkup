/**
 * Follow-Up Tracker Service Types
 * Request/response types for follow-up action management.
 */

import type { FollowUpAction } from '@health-checkup/shared';

export type FollowUpActionType =
  | 'specialist_referral'
  | 'medication_change'
  | 'lifestyle_recommendation'
  | 'next_checkup_date';

export type FollowUpStatus = 'pending' | 'completed' | 'overdue' | 'expired';

/**
 * Request payload for assigning a follow-up action.
 */
export interface FollowUpAssignmentRequest {
  reportId: string;
  description: string; // 1-500 chars
  actionType: FollowUpActionType;
  dueDate: Date; // must be in the future
  assigneeNote?: string; // up to 300 chars
}

/**
 * Dashboard view of follow-up actions for a senior citizen.
 */
export interface FollowUpDashboard {
  seniorId: string;
  actions: FollowUpAction[];
  summary: {
    pending: number;
    completed: number;
    overdue: number;
    expired: number;
    total: number;
  };
}

/**
 * Dependencies injected into the FollowUpTrackerService for testability.
 */
export interface FollowUpTrackerDependencies {
  idGenerator: () => string;
  dateProvider: () => Date;
  repository: FollowUpActionRepository;
}

/**
 * Repository interface for FollowUpAction persistence.
 */
export interface FollowUpActionRepository {
  save(action: FollowUpAction): Promise<FollowUpAction>;
  findById(id: string): Promise<FollowUpAction | null>;
  findByReportId(reportId: string): Promise<FollowUpAction[]>;
  findBySeniorId(seniorId: string): Promise<FollowUpAction[]>;
  findByPhysicianId(physicianId: string): Promise<FollowUpAction[]>;
  update(action: FollowUpAction): Promise<FollowUpAction>;
}

/**
 * Context needed to assign a follow-up (links to report metadata).
 */
export interface ReportContext {
  reportId: string;
  seniorId: string;
  physicianId: string;
}

export type { FollowUpAction };
