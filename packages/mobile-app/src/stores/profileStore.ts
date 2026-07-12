/**
 * Profile Store — Zustand store for user profile state management.
 * Fetches profile from the Backend API and persists to offline cache.
 *
 * Requirements: 8.1, 8.2, 8.3, 8.4, 12.3
 */
import { create } from 'zustand';
import { apiClient, OfflineError } from '../api/client';
import { offlineCache, CacheKey } from '../cache/offlineCache';

// ---------- Types ----------

export interface EmergencyContact {
  name: string;
  relationship: string;
  phone: string;
}

export interface MedicalHistory {
  conditions: string[];
  allergies: string[];
  medications: string[];
}

export interface AssignedPhysician {
  id: string;
  name: string;
  specialization?: string;
}

export interface NextAppointment {
  id: string;
  date: string; // ISO datetime
  packageName: string;
}

export interface CheckupPackage {
  id: string;
  name: string;
  description?: string;
}

export interface SeniorProfile {
  seniorId: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string; // ISO date
  gender?: string;
  contactNumber: string;
  email: string;
  address: string;
  emergencyContact: EmergencyContact;
  medicalHistory: MedicalHistory;
  assignedPhysician?: AssignedPhysician;
  nextAppointment?: NextAppointment;
  checkupPackage?: CheckupPackage;
}

export interface ProfileUpdatePayload {
  contactNumber?: string;
  email?: string;
  emergencyContact?: EmergencyContact;
  address?: string;
}

export interface FieldValidationError {
  field: string;
  message: string;
}

export interface ProfileState {
  profile: SeniorProfile | null;
  isLoading: boolean;
  isUpdating: boolean;
  isOffline: boolean;
  updateSuccess: boolean;
  validationErrors: FieldValidationError[];
  fetchProfile(seniorId: string): Promise<void>;
  updateProfile(seniorId: string, payload: ProfileUpdatePayload): Promise<void>;
  clearUpdateStatus(): void;
}

// ---------- Helpers ----------

function buildCacheKey(seniorId: string): CacheKey {
  return `profile:${seniorId}`;
}

/**
 * Parse validation errors from the backend 400/422 response.
 * Supports common backend error formats:
 * - { errors: [{ field, message }] }
 * - { errors: { fieldName: "message" } }
 */
function parseValidationErrors(responseData: unknown): FieldValidationError[] {
  if (!responseData || typeof responseData !== 'object') {
    return [];
  }

  const data = responseData as Record<string, unknown>;

  // Format: { errors: [{ field, message }] }
  if (Array.isArray(data.errors)) {
    return data.errors
      .filter(
        (e: unknown) =>
          typeof e === 'object' && e !== null && 'field' in e && 'message' in e,
      )
      .map((e: { field: string; message: string }) => ({
        field: e.field,
        message: e.message,
      }));
  }

  // Format: { errors: { fieldName: "message" } }
  if (typeof data.errors === 'object' && data.errors !== null) {
    const errorsObj = data.errors as Record<string, string>;
    return Object.entries(errorsObj).map(([field, message]) => ({
      field,
      message: String(message),
    }));
  }

  return [];
}

// ---------- Store Implementation ----------

export const useProfileStore = create<ProfileState>()((set, _get) => ({
  profile: null,
  isLoading: false,
  isUpdating: false,
  isOffline: false,
  updateSuccess: false,
  validationErrors: [],

  /**
   * Fetch the senior's profile from the Backend API.
   * On success, persists the result to offline cache.
   * On network failure, falls back to cached data.
   * Requirements: 8.1, 8.4, 12.3
   */
  async fetchProfile(seniorId: string): Promise<void> {
    set({ isLoading: true, validationErrors: [] });

    try {
      const response = await apiClient.get<SeniorProfile>(
        `/registration/seniors/${seniorId}`,
      );

      const profile = response.data;

      // Persist to offline cache
      const cacheKey = buildCacheKey(seniorId);
      await offlineCache.set(cacheKey, profile);

      set({
        profile,
        isLoading: false,
        isOffline: false,
      });
    } catch (error) {
      if (error instanceof OfflineError) {
        // Device is offline — attempt to serve from cache
        const cacheKey = buildCacheKey(seniorId);
        const cached = await offlineCache.get<SeniorProfile>(cacheKey);

        if (cached && !offlineCache.isExpired(cached)) {
          set({
            profile: cached.data,
            isLoading: false,
            isOffline: true,
          });
        } else {
          set({
            profile: null,
            isLoading: false,
            isOffline: true,
          });
        }
      } else {
        set({ isLoading: false });
        throw error;
      }
    }
  },

  /**
   * Update editable profile fields via PUT request to the Backend API.
   * On success, updates the local profile state and cache.
   * On validation failure, parses and displays field-level errors.
   * Requirements: 8.2, 8.3
   */
  async updateProfile(
    seniorId: string,
    payload: ProfileUpdatePayload,
  ): Promise<void> {
    set({ isUpdating: true, updateSuccess: false, validationErrors: [] });

    try {
      const response = await apiClient.put<SeniorProfile>(
        `/registration/seniors/${seniorId}`,
        payload,
      );

      const updatedProfile = response.data;

      // Update offline cache with new profile data
      const cacheKey = buildCacheKey(seniorId);
      await offlineCache.set(cacheKey, updatedProfile);

      set({
        profile: updatedProfile,
        isUpdating: false,
        updateSuccess: true,
        validationErrors: [],
      });
    } catch (error: unknown) {
      // Check for validation errors (400 or 422 responses)
      if (
        error &&
        typeof error === 'object' &&
        'response' in error
      ) {
        const axiosError = error as {
          response?: { status: number; data: unknown };
        };
        const status = axiosError.response?.status;

        if (status === 400 || status === 422) {
          const errors = parseValidationErrors(axiosError.response?.data);
          set({
            isUpdating: false,
            updateSuccess: false,
            validationErrors:
              errors.length > 0
                ? errors
                : [{ field: '_general', message: 'Validation failed. Please check your input.' }],
          });
          return;
        }
      }

      set({ isUpdating: false, updateSuccess: false });
      throw error;
    }
  },

  /**
   * Clear the update success/error status (e.g., after displaying confirmation).
   */
  clearUpdateStatus(): void {
    set({ updateSuccess: false, validationErrors: [] });
  },
}));
