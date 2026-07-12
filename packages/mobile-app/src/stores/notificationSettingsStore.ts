/**
 * Notification Settings Store — Zustand store for notification preferences.
 * Fetches preferences from GET /notifications/preferences
 * and saves via PUT /notifications/preferences.
 *
 * Requirements: 5.5
 */
import { create } from 'zustand';
import { apiClient } from '../api/client';

// ---------- Types ----------

export interface NotificationPreferences {
  criticalEnabled: boolean;
  warningEnabled: boolean;
  pushToken: string | null;
  permissionStatus: 'granted' | 'denied' | 'undetermined';
}

export interface NotificationSettingsState {
  preferences: NotificationPreferences | null;
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;
  saveSuccess: boolean;
  fetchPreferences(): Promise<void>;
  updatePreferences(updates: Partial<Pick<NotificationPreferences, 'criticalEnabled' | 'warningEnabled'>>): Promise<void>;
  clearStatus(): void;
}

// ---------- Store Implementation ----------

export const useNotificationSettingsStore = create<NotificationSettingsState>()(
  (set, get) => ({
    preferences: null,
    isLoading: false,
    isSaving: false,
    error: null,
    saveSuccess: false,

    /**
     * Fetch current notification preferences from the Backend API.
     * Requirement 5.5
     */
    async fetchPreferences(): Promise<void> {
      set({ isLoading: true, error: null });

      try {
        const response = await apiClient.get<NotificationPreferences>(
          '/notifications/preferences',
        );

        set({
          preferences: response.data,
          isLoading: false,
          error: null,
        });
      } catch (error: unknown) {
        const message =
          error instanceof Error
            ? error.message
            : 'Unable to load notification preferences.';

        set({
          isLoading: false,
          error: message,
        });
      }
    },

    /**
     * Save updated notification preferences via PUT to the Backend API.
     * Optimistically updates the local state, reverts on failure.
     * Requirement 5.5
     */
    async updatePreferences(
      updates: Partial<Pick<NotificationPreferences, 'criticalEnabled' | 'warningEnabled'>>,
    ): Promise<void> {
      const { preferences } = get();
      if (!preferences) return;

      const previousPreferences = { ...preferences };
      const updatedPreferences = { ...preferences, ...updates };

      // Optimistic update
      set({ preferences: updatedPreferences, isSaving: true, error: null, saveSuccess: false });

      try {
        const response = await apiClient.put<NotificationPreferences>(
          '/notifications/preferences',
          {
            criticalEnabled: updatedPreferences.criticalEnabled,
            warningEnabled: updatedPreferences.warningEnabled,
          },
        );

        set({
          preferences: response.data,
          isSaving: false,
          saveSuccess: true,
          error: null,
        });
      } catch (error: unknown) {
        // Revert optimistic update on failure
        const message =
          error instanceof Error
            ? error.message
            : 'Unable to save notification preferences.';

        set({
          preferences: previousPreferences,
          isSaving: false,
          saveSuccess: false,
          error: message,
        });
      }
    },

    /**
     * Clear success/error status messages.
     */
    clearStatus(): void {
      set({ saveSuccess: false, error: null });
    },
  }),
);
