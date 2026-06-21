/**
 * Checkup Session interfaces
 */
import { TestCategory } from '../enums';

export interface SpecialistAssignment {
  specialistId: string;
  specialization: string;
  testCategories: TestCategory[];
}

export interface CheckupSession {
  id: string;
  appointmentId: string;
  seniorId: string;
  packageId: string;
  assignedPhysicianId: string;
  assignedSpecialists: SpecialistAssignment[];
  status: 'in_progress' | 'complete' | 'pending_results';
  startedAt: Date;
  completedAt?: Date;
}
