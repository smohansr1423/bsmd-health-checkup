/**
 * Report Store — Zustand store for health reports state management.
 * Fetches reports from the Backend API and persists to offline cache.
 *
 * Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 12.3
 */
import { create } from 'zustand';
import { apiClient, OfflineError } from '../api/client';
import { offlineCache, CacheKey } from '../cache/offlineCache';

// ---------- Types ----------

export interface TestResultEntry {
  testType: string;
  measuredValue: number;
  unit: string;
  category: 'normal' | 'borderline' | 'critical';
  interpretation: string;
}

export interface FollowUpAction {
  id: string;
  reportId: string;
  seniorId: string;
  description: string;
  actionType:
    | 'specialist_referral'
    | 'medication_change'
    | 'lifestyle_recommendation'
    | 'next_checkup_date';
  dueDate: string; // ISO date string (serialized from API)
  status: 'pending' | 'in-progress' | 'completed';
  assignedDate: string;
  completionDate?: string;
  completionNotes?: string;
  assignedPhysicianId: string;
}

export interface HealthReport {
  id: string;
  seniorId: string;
  reportDate: string; // ISO date string
  packageName: string;
  overallStatus: 'normal' | 'borderline' | 'critical';
  testResults: TestResultEntry[];
  physicianNotes: string[];
  followUpActions: FollowUpAction[];
  generatedAt: string; // ISO datetime
}

export interface ReportState {
  reports: HealthReport[];
  selectedReport: HealthReport | null;
  isLoading: boolean;
  isOffline: boolean;
  lastFetchedAt: Date | null;
  fetchReports(seniorId: string): Promise<void>;
  selectReport(reportId: string): void;
  refreshFromCache(seniorId: string): Promise<void>;
}

// ---------- Helpers ----------

/**
 * Build the cache key for a given senior's reports.
 */
function buildCacheKey(seniorId: string): CacheKey {
  return `reports:${seniorId}`;
}

/**
 * Sort reports by date in descending order (newest first).
 */
function sortReportsDescending(reports: HealthReport[]): HealthReport[] {
  return [...reports].sort(
    (a, b) => new Date(b.reportDate).getTime() - new Date(a.reportDate).getTime(),
  );
}

// ---------- Store Implementation ----------

export const useReportStore = create<ReportState>()((set, get) => ({
  reports: [],
  selectedReport: null,
  isLoading: false,
  isOffline: false,
  lastFetchedAt: null,

  /**
   * Fetch all reports for a senior from the Backend API.
   * On success, persists results to offline cache.
   * On network failure (OfflineError), falls back to cached data.
   * Requirement 7.1, 12.3
   */
  async fetchReports(seniorId: string): Promise<void> {
    set({ isLoading: true });

    try {
      const response = await apiClient.get<HealthReport[]>(
        `/reports/seniors/${seniorId}`,
      );

      const reports = sortReportsDescending(response.data);

      // Persist to offline cache
      const cacheKey = buildCacheKey(seniorId);
      await offlineCache.set(cacheKey, reports);

      set({
        reports,
        isLoading: false,
        isOffline: false,
        lastFetchedAt: new Date(),
      });
    } catch (error) {
      if (error instanceof OfflineError) {
        // Device is offline — serve from cache
        const cacheKey = buildCacheKey(seniorId);
        const cached = await offlineCache.get<HealthReport[]>(cacheKey);

        if (cached && !offlineCache.isExpired(cached)) {
          set({
            reports: sortReportsDescending(cached.data),
            isLoading: false,
            isOffline: true,
            lastFetchedAt: new Date(cached.cachedAt),
          });
        } else {
          // No valid cache available
          set({
            reports: [],
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
   * Select a report by ID for detailed viewing.
   * Requirement 7.3
   */
  selectReport(reportId: string): void {
    const { reports } = get();
    const found = reports.find((r) => r.id === reportId) ?? null;
    set({ selectedReport: found });
  },

  /**
   * Load cached reports when offline.
   * Requirement 12.3
   */
  async refreshFromCache(seniorId: string): Promise<void> {
    const cacheKey = buildCacheKey(seniorId);
    const cached = await offlineCache.get<HealthReport[]>(cacheKey);

    if (cached && !offlineCache.isExpired(cached)) {
      set({
        reports: sortReportsDescending(cached.data),
        isOffline: true,
        lastFetchedAt: new Date(cached.cachedAt),
      });
    }
  },
}));
