/**
 * Unit tests for Device Sync Status Classification
 * Validates: Requirements 7.1, 7.2, 7.3
 */

import {
  classifySyncStatus,
  getDeviceStatusEntries,
  isDaytime,
  STALE_THRESHOLD_MS,
  DAYTIME_START_HOUR,
  DAYTIME_END_HOUR,
} from './device-sync-status';
import type { DeviceRegistryEntry } from './device-integration.types';

// ─── Test Helpers ──────────────────────────────────────────────────────────────

function createDevice(overrides: Partial<DeviceRegistryEntry> = {}): DeviceRegistryEntry {
  return {
    id: 'device-1',
    serialNumber: 'SN-001',
    deviceType: 'blood_pressure_monitor',
    seniorId: 'senior-1',
    registrationDate: new Date('2024-01-01T09:00:00'),
    connectionProtocol: 'bluetooth',
    isActive: true,
    lastSyncTimestamp: null,
    ...overrides,
  };
}

/** Create a date at a specific hour on a fixed day */
function dateAtHour(hour: number, minuteOffset = 0): Date {
  const d = new Date('2024-06-15T00:00:00');
  d.setHours(hour, minuteOffset, 0, 0);
  return d;
}

// ─── isDaytime ─────────────────────────────────────────────────────────────────

describe('isDaytime', () => {
  it('returns true at 06:00 (start of daytime)', () => {
    expect(isDaytime(dateAtHour(6))).toBe(true);
  });

  it('returns true at 12:00 (midday)', () => {
    expect(isDaytime(dateAtHour(12))).toBe(true);
  });

  it('returns true at 21:59 (just before end)', () => {
    expect(isDaytime(dateAtHour(21, 59))).toBe(true);
  });

  it('returns false at 22:00 (end of daytime, exclusive)', () => {
    expect(isDaytime(dateAtHour(22))).toBe(false);
  });

  it('returns false at 05:59 (just before start)', () => {
    expect(isDaytime(dateAtHour(5, 59))).toBe(false);
  });

  it('returns false at 00:00 (midnight)', () => {
    expect(isDaytime(dateAtHour(0))).toBe(false);
  });

  it('returns false at 23:00 (nighttime)', () => {
    expect(isDaytime(dateAtHour(23))).toBe(false);
  });
});

// ─── classifySyncStatus ────────────────────────────────────────────────────────

describe('classifySyncStatus', () => {
  describe('inactive devices', () => {
    it('returns inactive when device.isActive is false regardless of time', () => {
      const device = createDevice({ isActive: false, lastSyncTimestamp: new Date() });
      // Test during daytime
      expect(classifySyncStatus(device, dateAtHour(12))).toBe('inactive');
      // Test during nighttime
      expect(classifySyncStatus(device, dateAtHour(23))).toBe('inactive');
    });

    it('returns inactive even if lastSyncTimestamp is null', () => {
      const device = createDevice({ isActive: false, lastSyncTimestamp: null });
      expect(classifySyncStatus(device, dateAtHour(10))).toBe('inactive');
    });
  });

  describe('stale detection during daytime', () => {
    it('returns stale when lastSyncTimestamp is null during daytime', () => {
      const device = createDevice({ isActive: true, lastSyncTimestamp: null });
      expect(classifySyncStatus(device, dateAtHour(10))).toBe('stale');
    });

    it('returns stale when last sync was more than 4 hours ago during daytime', () => {
      const now = dateAtHour(14); // 14:00
      const lastSync = new Date(now.getTime() - STALE_THRESHOLD_MS - 1); // 4h + 1ms ago
      const device = createDevice({ isActive: true, lastSyncTimestamp: lastSync });
      expect(classifySyncStatus(device, now)).toBe('stale');
    });

    it('returns stale when last sync was exactly 4 hours and 1ms ago during daytime', () => {
      const now = dateAtHour(12);
      const lastSync = new Date(now.getTime() - STALE_THRESHOLD_MS - 1);
      const device = createDevice({ isActive: true, lastSyncTimestamp: lastSync });
      expect(classifySyncStatus(device, now)).toBe('stale');
    });
  });

  describe('synced during daytime', () => {
    it('returns synced when last sync was less than 4 hours ago during daytime', () => {
      const now = dateAtHour(10);
      const lastSync = new Date(now.getTime() - (STALE_THRESHOLD_MS - 60000)); // 3h59m ago
      const device = createDevice({ isActive: true, lastSyncTimestamp: lastSync });
      expect(classifySyncStatus(device, now)).toBe('synced');
    });

    it('returns synced when last sync was exactly 4 hours ago (boundary)', () => {
      const now = dateAtHour(14);
      const lastSync = new Date(now.getTime() - STALE_THRESHOLD_MS); // exactly 4h
      const device = createDevice({ isActive: true, lastSyncTimestamp: lastSync });
      // Exactly 4h is NOT > 4h, so synced
      expect(classifySyncStatus(device, now)).toBe('synced');
    });

    it('returns synced when last sync was just now during daytime', () => {
      const now = dateAtHour(8);
      const device = createDevice({ isActive: true, lastSyncTimestamp: now });
      expect(classifySyncStatus(device, now)).toBe('synced');
    });
  });

  describe('nighttime behavior', () => {
    it('returns synced during nighttime even if lastSyncTimestamp is null', () => {
      const device = createDevice({ isActive: true, lastSyncTimestamp: null });
      expect(classifySyncStatus(device, dateAtHour(23))).toBe('synced');
    });

    it('returns synced during nighttime even if last sync was very old', () => {
      const now = dateAtHour(3); // 03:00
      const lastSync = new Date(now.getTime() - 24 * 60 * 60 * 1000); // 24h ago
      const device = createDevice({ isActive: true, lastSyncTimestamp: lastSync });
      expect(classifySyncStatus(device, now)).toBe('synced');
    });

    it('returns synced at 22:00 (nighttime starts) even with stale timestamp', () => {
      const now = dateAtHour(22);
      const lastSync = new Date(now.getTime() - STALE_THRESHOLD_MS - 60000); // >4h ago
      const device = createDevice({ isActive: true, lastSyncTimestamp: lastSync });
      expect(classifySyncStatus(device, now)).toBe('synced');
    });

    it('returns synced at 05:59 (just before daytime) even with stale timestamp', () => {
      const now = dateAtHour(5, 59);
      const lastSync = new Date(now.getTime() - STALE_THRESHOLD_MS - 60000);
      const device = createDevice({ isActive: true, lastSyncTimestamp: lastSync });
      expect(classifySyncStatus(device, now)).toBe('synced');
    });
  });
});

// ─── getDeviceStatusEntries ────────────────────────────────────────────────────

describe('getDeviceStatusEntries', () => {
  it('maps device registry entries to status entries with sync status', () => {
    const now = dateAtHour(10);
    const recentSync = new Date(now.getTime() - 60000); // 1 minute ago
    const devices: DeviceRegistryEntry[] = [
      createDevice({ id: 'dev-1', isActive: true, lastSyncTimestamp: recentSync }),
      createDevice({ id: 'dev-2', isActive: false }),
      createDevice({ id: 'dev-3', isActive: true, lastSyncTimestamp: null }),
    ];

    const entries = getDeviceStatusEntries(devices, now);

    expect(entries).toHaveLength(3);
    expect(entries[0].syncStatus).toBe('synced');
    expect(entries[1].syncStatus).toBe('inactive');
    expect(entries[2].syncStatus).toBe('stale');
  });

  it('includes all device fields in the status entry', () => {
    const now = dateAtHour(10);
    const device = createDevice({
      id: 'dev-x',
      deviceType: 'glucometer',
      serialNumber: 'SN-X',
      connectionProtocol: 'wifi',
      isActive: true,
      lastSyncTimestamp: now,
    });

    const [entry] = getDeviceStatusEntries([device], now);

    expect(entry.deviceId).toBe('dev-x');
    expect(entry.deviceType).toBe('glucometer');
    expect(entry.serialNumber).toBe('SN-X');
    expect(entry.connectionProtocol).toBe('wifi');
    expect(entry.isActive).toBe(true);
    expect(entry.lastSyncTimestamp).toEqual(now);
    expect(entry.syncStatus).toBe('synced');
  });

  it('returns empty array for empty input', () => {
    const entries = getDeviceStatusEntries([], dateAtHour(12));
    expect(entries).toEqual([]);
  });
});

// ─── Constants ─────────────────────────────────────────────────────────────────

describe('configuration constants', () => {
  it('STALE_THRESHOLD_MS equals 4 hours in milliseconds', () => {
    expect(STALE_THRESHOLD_MS).toBe(4 * 60 * 60 * 1000);
  });

  it('DAYTIME_START_HOUR is 6', () => {
    expect(DAYTIME_START_HOUR).toBe(6);
  });

  it('DAYTIME_END_HOUR is 22', () => {
    expect(DAYTIME_END_HOUR).toBe(22);
  });
});
