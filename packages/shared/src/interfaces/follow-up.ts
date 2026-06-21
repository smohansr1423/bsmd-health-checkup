/**
 * Follow-Up Action interfaces
 */

export interface FollowUpAction {
  id: string;
  reportId: string;
  seniorId: string;
  description: string; // 1-500 chars
  actionType: 'specialist_referral' | 'medication_change' | 'lifestyle_recommendation' | 'next_checkup_date';
  dueDate: Date;
  assigneeNote?: string; // up to 300 chars
  status: 'pending' | 'completed' | 'overdue' | 'expired';
  assignedDate: Date;
  completionDate?: Date;
  completionNotes?: string; // up to 1000 chars
  assignedPhysicianId: string;
}
