/**
 * Trend Store — Zustand store for trend chart data management.
 * Fetches trend data from GET /device-readings/seniors/:seniorId/trends/:readingType
 * and manages period selection state.
 *
 * Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6
 */
import { create } from 'zustand';
import { apiClient } from '../api/client';
import type { ReadingType } from './healthReadingsStore';

// ---------- Types ----------

export type TrendPeriod = '24h' | '7d' | '30d';

export interface TrendPoint {
  timestamp: string;
  value: number;
  secondaryValue?: number;
}

export interface TrendStatistics {
  mean: number;
  min: number;
  max: number;
  count: number;
}

export interface TrendThresholds {
  normalMin: number;
  normalMax: number;
  borderlineMin: number;
  borderlineMax: number;
}

export interface TrendData {
  readingType: ReadingType;
  period: TrendPeriod;
  dataPoints: TrendPoint[];
  statistics: TrendStatistics;
  thresholds: TrendThresholds;
}

export interface TrendState {
  trendData: TrendData | null;
  selectedPeriod: TrendPeriod;
  isLoading: boolean;
  error: string | null;
  fetchTrendData(seniorId: string, readingType: string, period: TrendPeriod): Promise<void>;
  setSelectedPeriod(period: TrendPeriod): void;
  reset(): void;
}

// ---------- Store Implementation ----------

export const useTrendStore = create<TrendState>()((set) => ({
  trendData: null,
  selectedPeriod: '7d',
  isLoading: false,
  error: null,

  /**
   * Fetch trend data from the Backend API for a given senior, reading type, and period.
   * Requirements: 4.1, 4.3
   */
  async fetchTrendData(
    seniorId: string,
    readingType: string,
    period: TrendPeriod,
  ): Promise<void> {
    set({ isLoading: true, error: null });

    try {
      const response = await apiClient.get<TrendData>(
        `/device-readings/seniors/${seniorId}/trends/${readingType}`,
        { period },
      );

      set({
        trendData: response.data,
        selectedPeriod: period,
        isLoading: false,
        error: null,
      });
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : 'Unable to load trend data. Please try again.';

      set({
        isLoading: false,
        error: message,
      });
    }
  },

  /**
   * Update the selected period (UI state only — caller should also trigger fetchTrendData).
   * Requirement: 4.2
   */
  setSelectedPeriod(period: TrendPeriod): void {
    set({ selectedPeriod: period });
  },

  /**
   * Reset store state when leaving the trend screen.
   */
  reset(): void {
    set({
      trendData: null,
      selectedPeriod: '7d',
      isLoading: false,
      error: null,
    });
  },
}));
