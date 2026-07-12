/**
 * Appointment Store — Zustand store for appointment state management.
 * Fetches appointments from GET /scheduling/seniors/:seniorId/appointments
 * and caches results for offline access.
 *
 * Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 12.3
 */
import { create } from 'zustand';
import { apiClient } from '../api/client';
import { offlineCache, CacheKey } from '../cache/offlineCache';

// ---------- Types ----------

export type AppointmentStatus =
  | 'scheduled'
  | 'checked_in'
  | 'in_progress'
  | 'completed'
  | 'missed'
  | 'cancelled';

export interface AppointmentTimeSlot {
  id: string;
  startTime: string; // ISO datetime
  endTime: string; // ISO datetime
  physicianId: string;
  isAvailable: boolean;
}

export interface AppointmentItem {
  id: string;
  seniorId: string;
  physicianId: string;
  physicianName: string;
  packageId: string;
  packageName: string;
  scheduledDate: string; // ISO datetime
  timeSlot: AppointmentTimeSlot;
  status: AppointmentStatus;
  location?: string;
  preparationInstructions?: string;
  associatedTests?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface AppointmentState {
  appointments: AppointmentItem[];
  selectedAppointment: AppointmentItem | null;
  isLoading: boolean;
  isOffline: boolean;
  lastFetchedAt: Date | null;
  error: string | null;
  fetchAppointments(seniorId: string): Promise<void>;
  refreshFromCache(seniorId: string): Promise<void>;
  selectAppointment(appointment: AppointmentItem | null): void;
  getUpcomingAppointments(): AppointmentItem[];
  getPastAppointments(): AppointmentItem[];
}

// ---------- Helpers ----------

/**
 * Sort appointments by scheduled date ascending.
 */
function sortByDateAscending(appointments: AppointmentItem[]): AppointmentItem[] {
  return [...appointments].sort(
    (a, b) => new Date(a.scheduledDate).getTime() - new Date(b.scheduledDate).getTime(),
  );
}

/**
 * Determine whether an appointment is upcoming (scheduled in the future or today).
 */
function isUpcoming(appointment: AppointmentItem): boolean {
  const now = new Date();
  const appointmentDate = new Date(appointment.scheduledDate);
  return (
    appointmentDate >= now &&
    (appointment.status === 'scheduled' ||
      appointment.status === 'checked_in' ||
      appointment.status === 'in_progress')
  );
}

// ---------- Store Implementation ----------

export const useAppointmentStore = create<AppointmentState>()((set, get) => ({
  appointments: [],
  selectedAppointment: null,
  isLoading: false,
  isOffline: false,
  lastFetchedAt: null,
  error: null,

  /**
   * Fetch appointments from the Backend API and cache the response.
   * Falls back to offline cache if the request fails due to network issues.
   * Requirements: 6.1, 12.3
   */
  async fetchAppointments(seniorId: string): Promise<void> {
    set({ isLoading: true, error: null });

    try {
      const response = await apiClient.get<AppointmentItem[]>(
        `/scheduling/seniors/${seniorId}/appointments`,
      );

      const appointments = sortByDateAscending(response.data);

      // Cache for offline access
      const cacheKey: CacheKey = `appointments:${seniorId}`;
      await offlineCache.set(cacheKey, appointments);

      set({
        appointments,
        isLoading: false,
        isOffline: false,
        lastFetchedAt: new Date(),
        error: null,
      });
    } catch (error: unknown) {
      // Attempt to serve from cache on failure
      const cacheKey: CacheKey = `appointments:${seniorId}`;
      const cached = await offlineCache.get<AppointmentItem[]>(cacheKey);

      if (cached && !offlineCache.isExpired(cached)) {
        set({
          appointments: sortByDateAscending(cached.data),
          isLoading: false,
          isOffline: true,
          error: null,
        });
      } else {
        set({
          appointments: [],
          isLoading: false,
          isOffline: true,
          error: 'Unable to load appointments. Please check your connection.',
        });
      }
    }
  },

  /**
   * Load appointment data from the offline cache directly.
   * Used when the app is known to be offline.
   * Requirement: 12.3
   */
  async refreshFromCache(seniorId: string): Promise<void> {
    const cacheKey: CacheKey = `appointments:${seniorId}`;
    const cached = await offlineCache.get<AppointmentItem[]>(cacheKey);

    if (cached && !offlineCache.isExpired(cached)) {
      set({
        appointments: sortByDateAscending(cached.data),
        isOffline: true,
        error: null,
      });
    } else {
      set({
        appointments: [],
        isOffline: true,
        error: 'No cached appointment data available. Internet connection required.',
      });
    }
  },

  /**
   * Select an appointment for detail view display.
   */
  selectAppointment(appointment: AppointmentItem | null): void {
    set({ selectedAppointment: appointment });
  },

  /**
   * Get upcoming appointments (future or today, with active status).
   * Requirement: 6.4
   */
  getUpcomingAppointments(): AppointmentItem[] {
    const { appointments } = get();
    return appointments.filter(isUpcoming);
  },

  /**
   * Get past appointments (past date or completed/missed/cancelled status).
   * Requirement: 6.4
   */
  getPastAppointments(): AppointmentItem[] {
    const { appointments } = get();
    return appointments.filter((a) => !isUpcoming(a));
  },
}));
