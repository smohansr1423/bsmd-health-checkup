/**
 * Health Readings Store — Zustand store for daily health readings state management.
 * Fetches daily readings from the Backend API and persists to offline cache.
 *
 * Requirements: 2.1, 12.1, 12.2
 */
import { create } from 'zustand';
import { apiClient, OfflineError } from '../api/client';
import { offlineCache, CacheKey } from '../cache/offlineCache';

// ---------- Types ----------

export type ReadingType =
  | 'blood_pressure'
  | 'heart_rate'
  | 'blood_glucose'
  | 'spo2'
  | 'temperature'
  | 'weight';

export interface VitalReading {
  type: ReadingType;
  value: number;
  secondaryValue?: number; // diastolic for blood pressure
  unit: string;
  timestamp: string; // ISO datetime
  trend: 'improving' | 'stable' | 'declining';
  status: 'normal' | 'borderline' | 'critical';
}

export interface HealthAlert {
  id: string;
  severity: 'warning' | 'critical';
  readingType: ReadingType;
  message: string;
  createdAt: string;
}

export interface DailyHealthRecord {
  seniorId: string;
  date: string; // ISO date
  readings: VitalReading[];
  alerts: HealthAlert[];
}

export interface HealthReadingsState {
  dailyRecord: DailyHealthRecord | null;
  isLoading: boolean;
  isOffline: boolean;
  lastFetchedAt: Date | null;
  fetchDailyRecord(seniorId: string, date: string): Promise<void>;
  refreshFromCache(): Promise<void>;
}

// ---------- Helpers ----------

/**
 * Build the cache key for a given senior + date combination.
 */
function buildCacheKey(seniorId: string, date: string): CacheKey {
  return `readings:${seniorId}:${date}`;
}

// ---------- Store Implementation ----------

export const useHealthReadingsStore = create<HealthReadingsState>()(
  (set, get) => ({
    dailyRecord: null,
    isLoading: false,
    isOffline: false,
    lastFetchedAt: null,

    /**
     * Fetch the daily health record from the Backend API.
     * On success, persists the result to offline cache.
     * On network failure (OfflineError), falls back to cached data.
     * Requirement 2.1, 12.1
     */
    async fetchDailyRecord(seniorId: string, date: string): Promise<void> {
      set({ isLoading: true });

      try {
        const response = await apiClient.get<DailyHealthRecord>(
          `/device-readings/seniors/${seniorId}/daily/${date}`,
        );

        const record = response.data;

        // Persist to offline cache for later use
        const cacheKey = buildCacheKey(seniorId, date);
        await offlineCache.set(cacheKey, record);

        set({
          dailyRecord: record,
          isLoading: false,
          isOffline: false,
          lastFetchedAt: new Date(),
        });
      } catch (error) {
        if (error instanceof OfflineError) {
          // Device is offline — attempt to serve from cache
          const cacheKey = buildCacheKey(seniorId, date);
          const cached = await offlineCache.get<DailyHealthRecord>(cacheKey);

          if (cached && !offlineCache.isExpired(cached)) {
            set({
              dailyRecord: cached.data,
              isLoading: false,
              isOffline: true,
              lastFetchedAt: new Date(cached.cachedAt),
            });
          } else {
            // No valid cache available
            set({
              dailyRecord: null,
              isLoading: false,
              isOffline: true,
              lastFetchedAt: null,
            });
          }
        } else {
          // Other API errors (4xx, 5xx, timeout, etc.)
          set({ isLoading: false });
          throw error;
        }
      }
    },

    /**
     * Load cached readings when offline.
     * Uses the current dailyRecord's seniorId and date to look up the cache.
     * If no current record exists, this is a no-op.
     * Requirement 12.2
     */
    async refreshFromCache(): Promise<void> {
      const { dailyRecord } = get();

      if (!dailyRecord) {
        return;
      }

      const cacheKey = buildCacheKey(dailyRecord.seniorId, dailyRecord.date);
      const cached = await offlineCache.get<DailyHealthRecord>(cacheKey);

      if (cached && !offlineCache.isExpired(cached)) {
        set({
          dailyRecord: cached.data,
          isOffline: true,
          lastFetchedAt: new Date(cached.cachedAt),
        });
      }
    },
  }),
);
