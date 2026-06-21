import React from 'react';

// ─── Types ─────────────────────────────────────────────────────────────────────

type DeviceType =
  | 'blood_pressure_monitor'
  | 'glucometer'
  | 'pulse_oximeter'
  | 'thermometer'
  | 'weight_scale';

type SyncStatus = 'synced' | 'stale' | 'inactive';

export interface DeviceStatusEntry {
  deviceId: string;
  deviceType: DeviceType;
  serialNumber: string;
  connectionProtocol: 'bluetooth' | 'wifi';
  isActive: boolean;
  lastSyncTimestamp: string | null;
  syncStatus: SyncStatus;
}

export interface DeviceStatusPanelProps {
  devices: DeviceStatusEntry[];
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

const DEVICE_TYPE_LABELS: Record<DeviceType, { label: string; emoji: string }> = {
  blood_pressure_monitor: { label: 'Blood Pressure Monitor', emoji: '🩺' },
  glucometer: { label: 'Glucometer', emoji: '🩸' },
  pulse_oximeter: { label: 'Pulse Oximeter', emoji: '💓' },
  thermometer: { label: 'Thermometer', emoji: '🌡️' },
  weight_scale: { label: 'Weight Scale', emoji: '⚖️' },
};

const PROTOCOL_LABELS: Record<string, string> = {
  bluetooth: 'Bluetooth',
  wifi: 'WiFi',
};

/**
 * Computes a human-readable relative time string from an ISO timestamp.
 */
function getRelativeTime(timestamp: string): string {
  const now = Date.now();
  const then = new Date(timestamp).getTime();
  const diffMs = now - then;

  if (diffMs < 0) return 'just now';

  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;

  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

/**
 * Returns the sync status indicator color.
 */
function getSyncIndicatorColor(syncStatus: SyncStatus): string {
  switch (syncStatus) {
    case 'synced':
      return '#2f855a'; // green
    case 'stale':
      return '#c05621'; // amber/warning
    case 'inactive':
      return '#a0aec0'; // gray
  }
}

/**
 * Returns a human-readable label for the sync status.
 */
function getSyncStatusLabel(syncStatus: SyncStatus): string {
  switch (syncStatus) {
    case 'synced':
      return 'Synced';
    case 'stale':
      return 'Stale';
    case 'inactive':
      return 'Inactive';
  }
}

// ─── Styles ────────────────────────────────────────────────────────────────────

const panelStyle: React.CSSProperties = {
  marginBottom: '24px',
};

const headingStyle: React.CSSProperties = {
  fontSize: '18px',
  fontWeight: 600,
  marginBottom: '12px',
  color: '#1a1a2e',
};

const gridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
  gap: '12px',
};

const cardStyle: React.CSSProperties = {
  padding: '16px',
  borderRadius: '8px',
  border: '1px solid #cbd5e0',
  background: '#ffffff',
};

const cardHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  marginBottom: '8px',
};

const deviceLabelStyle: React.CSSProperties = {
  fontSize: '15px',
  fontWeight: 600,
  color: '#1a1a2e',
};

const detailRowStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  fontSize: '13px',
  color: '#4a5568',
  marginBottom: '4px',
};

const syncDotStyle = (color: string): React.CSSProperties => ({
  display: 'inline-block',
  width: '10px',
  height: '10px',
  borderRadius: '50%',
  backgroundColor: color,
  marginRight: '6px',
});

const badgeStyle = (isActive: boolean): React.CSSProperties => ({
  display: 'inline-block',
  padding: '2px 8px',
  borderRadius: '4px',
  fontSize: '11px',
  fontWeight: 500,
  background: isActive ? '#c6f6d5' : '#e2e8f0',
  color: isActive ? '#22543d' : '#4a5568',
});

const warningTextStyle: React.CSSProperties = {
  fontSize: '12px',
  color: '#c05621',
  marginTop: '6px',
  fontWeight: 500,
};

// ─── Component ─────────────────────────────────────────────────────────────────

/**
 * DeviceStatusPanel displays a responsive grid of device cards showing
 * type, serial number, connection protocol, active status, and sync status.
 * Visual indicators highlight stale or inactive devices.
 *
 * Validates: Requirements 7.2, 7.3
 */
export function DeviceStatusPanel({ devices }: DeviceStatusPanelProps) {
  if (devices.length === 0) {
    return (
      <section aria-label="Device status panel" style={panelStyle}>
        <h3 style={headingStyle}>Device Status</h3>
        <p style={{ color: '#4a5568', fontSize: '14px' }}>No devices registered.</p>
      </section>
    );
  }

  return (
    <section aria-label="Device status panel" style={panelStyle}>
      <h3 style={headingStyle}>Device Status</h3>
      <div style={gridStyle} role="list" aria-label="Registered devices">
        {devices.map((device) => {
          const typeInfo = DEVICE_TYPE_LABELS[device.deviceType];
          const indicatorColor = getSyncIndicatorColor(device.syncStatus);
          const syncLabel = getSyncStatusLabel(device.syncStatus);

          return (
            <div
              key={device.deviceId}
              style={cardStyle}
              role="listitem"
              aria-label={`${typeInfo.label} - ${syncLabel}`}
            >
              {/* Header: device type + active badge */}
              <div style={cardHeaderStyle}>
                <span style={deviceLabelStyle}>
                  <span aria-hidden="true">{typeInfo.emoji} </span>
                  {typeInfo.label}
                </span>
                <span
                  style={badgeStyle(device.isActive)}
                  aria-label={device.isActive ? 'Active' : 'Inactive'}
                >
                  {device.isActive ? 'Active' : 'Inactive'}
                </span>
              </div>

              {/* Serial Number */}
              <div style={detailRowStyle}>
                <span>Serial</span>
                <span style={{ fontFamily: 'monospace' }}>{device.serialNumber}</span>
              </div>

              {/* Protocol */}
              <div style={detailRowStyle}>
                <span>Protocol</span>
                <span>{PROTOCOL_LABELS[device.connectionProtocol] || device.connectionProtocol}</span>
              </div>

              {/* Last Sync */}
              <div style={detailRowStyle}>
                <span>Last Sync</span>
                <span>
                  <span
                    style={syncDotStyle(indicatorColor)}
                    aria-label={`Sync status: ${syncLabel}`}
                    role="img"
                  />
                  {device.lastSyncTimestamp
                    ? getRelativeTime(device.lastSyncTimestamp)
                    : 'Never'}
                </span>
              </div>

              {/* Stale warning */}
              {device.syncStatus === 'stale' && (
                <div style={warningTextStyle} role="alert" aria-live="polite">
                  ⚠️ No sync for 4+ hours
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

export default DeviceStatusPanel;
