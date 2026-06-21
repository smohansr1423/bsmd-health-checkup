/**
 * Device Sync Status Classification
 * Implements stale device detection logic with configurable thresholds.
 * Validates: Requirements 7.1, 7.2, 7.3
 */

import type { DeviceRegistryEntry, DeviceType } from './device-integration.types';

// ─── Configuration Constants ───────────────────────────────────────────────────

/** Number of milliseconds after which a device is considered stale (4 hours) */
export const STALE_THRESHOLD_MS = 4 * 60 * 60 * 1000;

/** Start of daytime window (hour, inclusive) */
export const DAYTIME_START_HOUR = 6;

/** End of daytime window (hour, exclusive) */
export const DAYTIME_END_HOUR = 22;

// ─── Types ─────────────────────────────────────────────────────────────────────

/** Sync status classification for a device */
export type SyncStatus = 'synced' | 'stale' | 'inactive';

/**
 * Extended device status entry including sync status classification.
 * Used for device list queries on the Reading Dashboard.
 */
export interface DeviceStatusEntry {
  deviceId: string;
  deviceType: DeviceType;
  serialNumber: string;
  connectionProtocol: 'bluetooth' | 'wifi';
  isActive: boolean;
  lastSyncTimestamp: Date | null;
  syncStatus: SyncStatus;
}

// ─── Classification Logic ──────────────────────────────────────────────────────

/**
 * Determines whether the given time falls within daytime hours (06:00–22:00).
 * Uses the local time of the provided Date object.
 *
 * @param date - The date/time to check
 * @returns true if the hour is >= DAYTIME_START_HOUR and < DAYTIME_END_HOUR
 */
export function isDaytime(date: Date): boolean {
  const hour = date.getHours();
  return hour >= DAYTIME_START_HOUR && hour < DAYTIME_END_HOUR;
}

/**
 * Classifies the sync status of a device based on its active state,
 * last sync timestamp, and the current time.
 *
 * Classification rules:
 * - 'inactive': device.isActive is false
 * - 'stale': current time is daytime (06:00–22:00) AND device.lastSyncTimestamp
 *   is null or more than 4 hours old
 * - 'synced': nighttime, or last sync within 4 hours during daytime
 *
 * @param device - The device registry entry to classify
 * @param now - Optional current date/time (defaults to system time)
 * @returns The sync status classification
 */
export function classifySyncStatus(
  device: DeviceRegistryEntry,
  now: Date = new Date()
): SyncStatus {
  // Inactive devices always return 'inactive'
  if (!device.isActive) {
    return 'inactive';
  }

  // During daytime hours, check stale threshold
  if (isDaytime(now)) {
    // No sync timestamp means never synced — stale during daytime
    if (device.lastSyncTimestamp === null) {
      return 'stale';
    }

    const elapsed = now.getTime() - device.lastSyncTimestamp.getTime();
    if (elapsed > STALE_THRESHOLD_MS) {
      return 'stale';
    }
  }

  // Nighttime or synced within threshold
  return 'synced';
}

// ─── Batch Processing ──────────────────────────────────────────────────────────

/**
 * Maps an array of device registry entries to device status entries
 * with sync status classification.
 *
 * @param devices - Array of device registry entries
 * @param now - Optional current date/time (defaults to system time)
 * @returns Array of DeviceStatusEntry objects with syncStatus populated
 */
export function getDeviceStatusEntries(
  devices: DeviceRegistryEntry[],
  now: Date = new Date()
): DeviceStatusEntry[] {
  return devices.map((device) => ({
    deviceId: device.id,
    deviceType: device.deviceType,
    serialNumber: device.serialNumber,
    connectionProtocol: device.connectionProtocol,
    isActive: device.isActive,
    lastSyncTimestamp: device.lastSyncTimestamp,
    syncStatus: classifySyncStatus(device, now),
  }));
}
