/**
 * Physician interface
 */

export interface WeeklySchedule {
  monday: DaySchedule;
  tuesday: DaySchedule;
  wednesday: DaySchedule;
  thursday: DaySchedule;
  friday: DaySchedule;
  saturday: DaySchedule;
  sunday: DaySchedule;
}

export interface DaySchedule {
  isAvailable: boolean;
  startTime?: string; // HH:mm
  endTime?: string; // HH:mm
}

export interface Physician {
  id: string;
  name: string;
  specialization: string;
  qualifications: string[];
  department: string;
  availabilitySchedule: WeeklySchedule;
  isActive: boolean;
}
