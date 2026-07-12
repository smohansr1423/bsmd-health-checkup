/**
 * Device Store — Zustand store for device status management.
 * Fetches device list from GET /device-readings/devices/senior/:seniorId
 * and caches results for offline access.
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4, 12.3
 */
import { create } from 'zustand';
import { apiClient } from '../api/client';
import { offlineCache, CacheKey } from '../cache/offlineCache';

// ---------- Types ----------

export interface DeviceStatus {
  deviceId: string;
  deviceType: string;
  serialNumber: string;
  connectionProtocol: 'bluetooth' | 'wifi' | 'usb';
  isActive: boolean;
  lastSyncAt: string | null;
  syncStatus: 'synced' | 'stale' | 'inactive';
}

export interface DeviceState {
  devices: DeviceStatus[];
  isLoading: boolean;
  isOffline: boolean;
  lastFetchedAt: Date | null;
  error: string | null;
  fetchDevices(seniorId: string): Promise<void>;
  refreshFromCache(seniorId: string): Promise<void>;
}

// ---------- Store Implementation ----------

export const useDeviceStore = create<DeviceState>()((set, get) => ({
  devices: [],
  isLoading: false,
  isOffline: false,
  lastFetchedAt: null,
  error: null,

  /**
   * Fetch device list from the Backend API and cache the response.
   * Falls back to offline cache if the request fails due to network issues.
   * Requirement 3.1, 12.3
   */
  async fetchDevices(seniorId: string): Promise<void> {
    set({ isLoading: true, error: null });

    try {
      const response = await apiClient.get<DeviceStatus[]>(
        `/device-readings/devices/senior/${seniorId}`,
      );

      const devices = response.data;

      // Cache for offline access
      const cacheKey: CacheKey = `devices:${seniorId}`;
      await offlineCache.set(cacheKey, devices);

      set({
        devices,
        isLoading: false,
        isOffline: false,
        lastFetchedAt: new Date(),
        error: null,
      });
    } catch (error: unknown) {
      // Attempt to serve from cache on failure
      const cacheKey: CacheKey = `devices:${seniorId}`;
      const cached = await offlineCache.get<DeviceStatus[]>(cacheKey);

      if (cached && !offlineCache.isExpired(cached)) {
        set({
          devices: cached.data,
          isLoading: false,
          isOffline: true,
          error: null,
        });
      } else {
        set({
          devices: [],
          isLoading: false,
          isOffline: true,
          error: 'Unable to load device data. Please check your connection.',
        });
      }
    }
  },

  /**
   * Load device data from the offline cache directly.
   * Used when the app is known to be offline.
   * Requirement 12.3
   */
  async refreshFromCache(seniorId: string): Promise<void> {
    const cacheKey: CacheKey = `devices:${seniorId}`;
    const cached = await offlineCache.get<DeviceStatus[]>(cacheKey);

    if (cached && !offlineCache.isExpired(cached)) {
      set({
        devices: cached.data,
        isOffline: true,
        error: null,
      });
    } else {
      set({
        devices: [],
        isOffline: true,
        error: 'No cached device data available. Internet connection required.',
      });
    }
  },
}));
