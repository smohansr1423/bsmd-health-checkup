/**
 * Appointment and Time Slot interfaces
 */

export interface TimeSlot {
  id: string;
  startTime: Date;
  endTime: Date;
  physicianId: string;
  isAvailable: boolean;
}

export interface Appointment {
  id: string;
  seniorId: string;
  physicianId: string;
  packageId: string;
  scheduledDate: Date;
  timeSlot: TimeSlot;
  status: 'scheduled' | 'checked_in' | 'in_progress' | 'completed' | 'missed' | 'cancelled';
  createdAt: Date;
  updatedAt: Date;
}
