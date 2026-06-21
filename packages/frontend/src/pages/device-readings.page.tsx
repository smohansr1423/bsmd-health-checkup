/**
 * ReadingDashboard page component for the Daily Health Device Readings feature.
 * Composes VitalSignCard grid, DeviceStatusPanel, TrendChart, and alerts list
 * with a 60-second auto-refresh polling interval.
 *
 * Validates: Requirements 6.2, 6.5, 6.6
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { VitalSignCard } from './device-readings/VitalSignCard';
import { DeviceStatusPanel } from './device-readings/DeviceStatusPanel';
import { TrendChart } from './device-readings/TrendChart';
import type { VitalSignCardProps, ReadingType, RangeStatus, TrendDirection } from './device-readings/VitalSignCard';
import type { DeviceStatusEntry } from './device-readings/DeviceStatusPanel';
import type { TrendDataPoint, TimePeriod } from './device-readings/TrendChart';

// ─── Types ─────────────────────────────────────────────────────────────────────

interface ReadingAlert {
  id: string;
  readingType: ReadingType;
  measuredValue: number;
  thresholdBreached: number;
  severity: 'warning' | 'critical';
  direction: 'above' | 'below';
  createdAt: string;
}

interface TrendData {
  readingType: ReadingType;
  unit: string;
  data: TrendDataPoint[];
}

interface DashboardData {
  vitalSigns: Omit<VitalSignCardProps, 'theme'>[];
  devices: DeviceStatusEntry[];
  trends: TrendData[];
  alerts: ReadingAlert[];
}

export interface ReadingDashboardProps {
  seniorId?: string;
}

// ─── Constants ─────────────────────────────────────────────────────────────────

/** Polling interval in milliseconds (60 seconds per Requirement 6.5) */
const POLLING_INTERVAL_MS = 60_000;

// ─── Mock Data (to be replaced with real API calls) ────────────────────────────

function generateMockData(): DashboardData {
  const now = new Date().toISOString();
  const oneHourAgo = new Date(Date.now() - 3_600_000).toISOString();
  const twoHoursAgo = new Date(Date.now() - 7_200_000).toISOString();

  const vitalSigns: Omit<VitalSignCardProps, 'theme'>[] = [
    {
      readingType: 'blood_pressure',
      latestValue: 128,
      secondaryValue: 82,
      unit: 'mmHg',
      timestamp: now,
      trendDirection: 'stable',
      rangeStatus: 'normal',
    },
    {
      readingType: 'heart_rate',
      latestValue: 74,
      unit: 'bpm',
      timestamp: now,
      trendDirection: 'improving',
      rangeStatus: 'normal',
    },
    {
      readingType: 'blood_glucose',
      latestValue: 142,
      unit: 'mg/dL',
      timestamp: oneHourAgo,
      trendDirection: 'declining',
      rangeStatus: 'borderline',
    },
    {
      readingType: 'spo2',
      latestValue: 97,
      unit: '%',
      timestamp: now,
      trendDirection: 'stable',
      rangeStatus: 'normal',
    },
    {
      readingType: 'temperature',
      latestValue: 36.8,
      unit: '°C',
      timestamp: twoHoursAgo,
      trendDirection: 'stable',
      rangeStatus: 'normal',
    },
    {
      readingType: 'weight',
      latestValue: 72.5,
      unit: 'kg',
      timestamp: oneHourAgo,
      trendDirection: 'stable',
      rangeStatus: 'normal',
    },
  ];

  const devices: DeviceStatusEntry[] = [
    {
      deviceId: 'dev-001',
      deviceType: 'blood_pressure_monitor',
      serialNumber: 'BP-2024-001',
      connectionProtocol: 'bluetooth',
      isActive: true,
      lastSyncTimestamp: now,
      syncStatus: 'synced',
    },
    {
      deviceId: 'dev-002',
      deviceType: 'glucometer',
      serialNumber: 'GL-2024-042',
      connectionProtocol: 'bluetooth',
      isActive: true,
      lastSyncTimestamp: oneHourAgo,
      syncStatus: 'synced',
    },
    {
      deviceId: 'dev-003',
      deviceType: 'pulse_oximeter',
      serialNumber: 'PO-2024-018',
      connectionProtocol: 'wifi',
      isActive: true,
      lastSyncTimestamp: now,
      syncStatus: 'synced',
    },
    {
      deviceId: 'dev-004',
      deviceType: 'thermometer',
      serialNumber: 'TH-2024-007',
      connectionProtocol: 'bluetooth',
      isActive: true,
      lastSyncTimestamp: new Date(Date.now() - 5 * 3_600_000).toISOString(),
      syncStatus: 'stale',
    },
  ];

  // Generate trend data points for heart rate over the past 24 hours
  const trendPoints: TrendDataPoint[] = Array.from({ length: 12 }, (_, i) => ({
    timestamp: new Date(Date.now() - (11 - i) * 2 * 3_600_000).toISOString(),
    value: 70 + Math.round(Math.random() * 10),
  }));

  const trends: TrendData[] = [
    { readingType: 'heart_rate', unit: 'bpm', data: trendPoints },
    {
      readingType: 'blood_pressure',
      unit: 'mmHg',
      data: Array.from({ length: 12 }, (_, i) => ({
        timestamp: new Date(Date.now() - (11 - i) * 2 * 3_600_000).toISOString(),
        value: 120 + Math.round(Math.random() * 15),
      })),
    },
  ];

  const alerts: ReadingAlert[] = [
    {
      id: 'alert-001',
      readingType: 'blood_glucose',
      measuredValue: 142,
      thresholdBreached: 140,
      severity: 'warning',
      direction: 'above',
      createdAt: oneHourAgo,
    },
  ];

  return { vitalSigns, devices, trends, alerts };
}

// ─── Mock Fetch (to be wired to real API later) ────────────────────────────────

async function fetchDashboardData(_seniorId: string): Promise<DashboardData> {
  // Simulate network delay
  await new Promise((resolve) => setTimeout(resolve, 300));
  return generateMockData();
}

// ─── Styles ────────────────────────────────────────────────────────────────────

const pageStyle: React.CSSProperties = {
  maxWidth: '1200px',
  margin: '0 auto',
  padding: '24px 16px',
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: '12px',
  marginBottom: '24px',
};

const titleStyle: React.CSSProperties = {
  fontSize: '24px',
  fontWeight: 700,
  color: '#1a1a2e',
  margin: 0,
};

const lastUpdatedStyle: React.CSSProperties = {
  fontSize: '13px',
  color: '#4a5568',
};

const vitalSignsGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
  gap: '16px',
  marginBottom: '32px',
};

const sectionHeadingStyle: React.CSSProperties = {
  fontSize: '18px',
  fontWeight: 600,
  color: '#1a1a2e',
  marginBottom: '12px',
};

const trendSectionStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(480px, 1fr))',
  gap: '16px',
  marginBottom: '32px',
};

const alertListStyle: React.CSSProperties = {
  marginBottom: '32px',
};

const alertItemStyle = (severity: 'warning' | 'critical'): React.CSSProperties => ({
  display: 'flex',
  alignItems: 'center',
  gap: '12px',
  padding: '12px 16px',
  borderRadius: '8px',
  border: `1px solid ${severity === 'critical' ? '#c53030' : '#b7791f'}`,
  backgroundColor: severity === 'critical' ? '#fff5f5' : '#fffff0',
  marginBottom: '8px',
});

const alertSeverityBadge = (severity: 'warning' | 'critical'): React.CSSProperties => ({
  padding: '2px 8px',
  borderRadius: '4px',
  fontSize: '11px',
  fontWeight: 600,
  textTransform: 'uppercase',
  backgroundColor: severity === 'critical' ? '#c53030' : '#b7791f',
  color: '#ffffff',
});

const loadingStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'center',
  alignItems: 'center',
  padding: '64px 16px',
  fontSize: '16px',
  color: '#4a5568',
};

const errorStyle: React.CSSProperties = {
  padding: '24px',
  borderRadius: '8px',
  border: '1px solid #c53030',
  backgroundColor: '#fff5f5',
  color: '#742a2a',
  textAlign: 'center',
};

// ─── Helper ────────────────────────────────────────────────────────────────────

const READING_TYPE_LABELS: Record<string, string> = {
  blood_pressure: 'Blood Pressure',
  blood_glucose: 'Blood Glucose',
  heart_rate: 'Heart Rate',
  spo2: 'SpO₂',
  temperature: 'Temperature',
  weight: 'Weight',
};

function formatAlertTime(isoString: string): string {
  try {
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return 'Unknown time';
    return date.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return 'Unknown time';
  }
}

// ─── Component ─────────────────────────────────────────────────────────────────

/**
 * ReadingDashboard page displays a comprehensive view of a senior's daily
 * device readings, including vital sign cards, device status, trend charts,
 * and alerts. Data is refreshed automatically every 60 seconds.
 */
export default function ReadingDashboardPage({ seniorId: propSeniorId }: ReadingDashboardProps) {
  // Accept seniorId from props or fall back to a default for development
  const seniorId = propSeniorId || 'senior-001';

  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadData = useCallback(async () => {
    try {
      const result = await fetchDashboardData(seniorId);
      setData(result);
      setLastUpdated(new Date());
      setError(null);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to load dashboard data';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [seniorId]);

  // Initial fetch and 60-second polling
  useEffect(() => {
    setLoading(true);
    loadData();

    intervalRef.current = setInterval(() => {
      loadData();
    }, POLLING_INTERVAL_MS);

    return () => {
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [loadData]);

  // ─── Loading State ─────────────────────────────────────────────────────────

  if (loading && !data) {
    return (
      <main style={pageStyle} aria-label="Device readings dashboard">
        <div style={loadingStyle} role="status" aria-live="polite">
          <span>Loading dashboard data…</span>
        </div>
      </main>
    );
  }

  // ─── Error State ───────────────────────────────────────────────────────────

  if (error && !data) {
    return (
      <main style={pageStyle} aria-label="Device readings dashboard">
        <div style={errorStyle} role="alert">
          <p style={{ margin: 0, fontWeight: 600 }}>Unable to load dashboard</p>
          <p style={{ margin: '8px 0 0', fontSize: '14px' }}>{error}</p>
        </div>
      </main>
    );
  }

  if (!data) return null;

  // ─── Main Dashboard ────────────────────────────────────────────────────────

  return (
    <main style={pageStyle} aria-label="Device readings dashboard">
      {/* Header */}
      <header style={headerStyle}>
        <h1 style={titleStyle}>Health Readings Dashboard</h1>
        <span style={lastUpdatedStyle} aria-live="polite">
          {lastUpdated
            ? `Last updated: ${lastUpdated.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`
            : 'Updating…'}
        </span>
      </header>

      {/* Vital Signs Card Grid */}
      <section aria-label="Vital signs overview">
        <h2 style={sectionHeadingStyle}>Vital Signs</h2>
        <div style={vitalSignsGridStyle}>
          {data.vitalSigns.map((vital) => (
            <VitalSignCard
              key={vital.readingType}
              readingType={vital.readingType}
              latestValue={vital.latestValue}
              secondaryValue={vital.secondaryValue}
              unit={vital.unit}
              timestamp={vital.timestamp}
              trendDirection={vital.trendDirection}
              rangeStatus={vital.rangeStatus}
            />
          ))}
        </div>
      </section>

      {/* Device Status Panel */}
      <DeviceStatusPanel devices={data.devices} />

      {/* Trend Charts */}
      <section aria-label="Health trends">
        <h2 style={sectionHeadingStyle}>Trends</h2>
        <div style={trendSectionStyle}>
          {data.trends.map((trend) => (
            <TrendChart
              key={trend.readingType}
              readingType={trend.readingType}
              unit={trend.unit}
              data={trend.data}
            />
          ))}
        </div>
      </section>

      {/* Alerts List */}
      <section aria-label="Reading alerts" style={alertListStyle}>
        <h2 style={sectionHeadingStyle}>Recent Alerts</h2>
        {data.alerts.length === 0 ? (
          <p style={{ color: '#4a5568', fontSize: '14px' }}>No recent alerts.</p>
        ) : (
          <div role="list" aria-label="Alert notifications">
            {data.alerts.map((alert) => (
              <div
                key={alert.id}
                style={alertItemStyle(alert.severity)}
                role="listitem"
                aria-label={`${alert.severity} alert for ${READING_TYPE_LABELS[alert.readingType] || alert.readingType}`}
              >
                <span style={alertSeverityBadge(alert.severity)}>
                  {alert.severity}
                </span>
                <span style={{ flex: 1, fontSize: '14px', color: '#2d3748' }}>
                  {READING_TYPE_LABELS[alert.readingType] || alert.readingType}:{' '}
                  {alert.measuredValue} ({alert.direction} threshold {alert.thresholdBreached})
                </span>
                <time
                  dateTime={alert.createdAt}
                  style={{ fontSize: '12px', color: '#4a5568' }}
                >
                  {formatAlertTime(alert.createdAt)}
                </time>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
