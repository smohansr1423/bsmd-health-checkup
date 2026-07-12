import React from 'react';
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useAccessibility } from '../hooks/useAccessibility';
import type { VitalReading } from '../stores/healthReadingsStore';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface VitalSignCardProps {
  /** The vital reading data to display */
  reading: VitalReading;
  /** Callback when the card is pressed (navigates to TrendChartScreen) */
  onPress: () => void;
}

// ─── Trend Labels ────────────────────────────────────────────────────────────

const TREND_LABELS: Record<VitalReading['trend'], string> = {
  improving: '↑ Improving',
  stable: '→ Stable',
  declining: '↓ Declining',
};

const TREND_ICONS: Record<VitalReading['trend'], string> = {
  improving: '↑',
  stable: '→',
  declining: '↓',
};

// ─── Reading Type Display Names ──────────────────────────────────────────────

const READING_TYPE_LABELS: Record<VitalReading['type'], string> = {
  blood_pressure: 'Blood Pressure',
  heart_rate: 'Heart Rate',
  blood_glucose: 'Blood Glucose',
  spo2: 'SpO2',
  temperature: 'Temperature',
  weight: 'Weight',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Format the displayed value. Blood pressure shows "systolic/diastolic mmHg".
 */
function formatValue(reading: VitalReading): string {
  if (reading.type === 'blood_pressure' && reading.secondaryValue != null) {
    return `${reading.value}/${reading.secondaryValue}`;
  }
  return String(reading.value);
}

/**
 * Format the timestamp for display (time only).
 */
function formatTimestamp(timestamp: string): string {
  try {
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return timestamp;
  }
}

/**
 * Build a descriptive accessibility label for the card.
 * Describes the reading value, trend, and status for screen readers.
 */
function buildAccessibilityLabel(reading: VitalReading): string {
  const typeLabel = READING_TYPE_LABELS[reading.type];
  const value = formatValue(reading);
  const trendLabel = reading.trend;
  const statusLabel = reading.status;

  return `${typeLabel}: ${value} ${reading.unit}. Trend: ${trendLabel}. Status: ${statusLabel}. Double tap to view trend chart.`;
}

// ─── VitalSignCard Component ─────────────────────────────────────────────────

/**
 * Displays a single vital sign reading with color-coded status background,
 * trend indicator, value, unit, and timestamp.
 *
 * - Green background for normal status
 * - Amber background for borderline status
 * - Red background for critical status
 *
 * Tappable to navigate to the TrendChartScreen for that reading type.
 *
 * Validates: Requirements 2.2, 2.3, 10.1, 10.2, 10.4
 */
export function VitalSignCard({
  reading,
  onPress,
}: VitalSignCardProps): React.ReactElement {
  const { theme, minTouchTarget, getTextSize } = useAccessibility();

  const statusColors = getStatusColors(reading.status, theme.colors);
  const bodySize = getTextSize('body');
  const headingSize = getTextSize('heading');

  return (
    <TouchableOpacity
      onPress={onPress}
      style={[
        styles.container,
        {
          backgroundColor: statusColors.background,
          borderColor: statusColors.border,
          borderRadius: theme.borderRadius.lg,
          borderWidth: theme.borderWidth.thin,
          minHeight: minTouchTarget.height,
          minWidth: minTouchTarget.width,
          padding: theme.spacing.md,
        },
      ]}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={buildAccessibilityLabel(reading)}
      accessibilityHint="Opens trend chart for this reading"
    >
      {/* Header: Type label and trend */}
      <View style={styles.header}>
        <Text
          style={[
            styles.typeLabel,
            {
              color: statusColors.text,
              fontSize: bodySize,
            },
          ]}
          allowFontScaling={true}
          maxFontSizeMultiplier={2}
          accessibilityRole="text"
        >
          {READING_TYPE_LABELS[reading.type]}
        </Text>
        <Text
          style={[
            styles.trendIndicator,
            {
              color: statusColors.text,
              fontSize: bodySize,
            },
          ]}
          allowFontScaling={true}
          maxFontSizeMultiplier={2}
          accessibilityLabel={`Trend: ${reading.trend}`}
        >
          {TREND_LABELS[reading.trend]}
        </Text>
      </View>

      {/* Value and unit - critical health values must not be truncated */}
      <View style={styles.valueRow}>
        <Text
          style={[
            styles.value,
            {
              color: statusColors.text,
              fontSize: headingSize,
            },
          ]}
          allowFontScaling={true}
          maxFontSizeMultiplier={2}
          accessibilityLabel={`${formatValue(reading)} ${reading.unit}`}
        >
          {formatValue(reading)}
        </Text>
        <Text
          style={[
            styles.unit,
            {
              color: statusColors.text,
              fontSize: bodySize,
            },
          ]}
          allowFontScaling={true}
          maxFontSizeMultiplier={2}
        >
          {reading.unit}
        </Text>
      </View>

      {/* Timestamp */}
      <Text
        style={[
          styles.timestamp,
          {
            color: statusColors.text,
            fontSize: bodySize,
          },
        ]}
        allowFontScaling={true}
        maxFontSizeMultiplier={2}
        accessibilityLabel={`Recorded at ${formatTimestamp(reading.timestamp)}`}
      >
        {formatTimestamp(reading.timestamp)}
      </Text>
    </TouchableOpacity>
  );
}

// ─── Status Color Mapping ────────────────────────────────────────────────────

interface StatusColorSet {
  background: string;
  text: string;
  border: string;
}

function getStatusColors(
  status: VitalReading['status'],
  colors: typeof import('../utils/accessibility').defaultTheme.colors
): StatusColorSet {
  switch (status) {
    case 'normal':
      return {
        background: colors.statusNormalBg,
        text: colors.statusNormalText,
        border: colors.success,
      };
    case 'borderline':
      return {
        background: colors.statusBorderlineBg,
        text: colors.statusBorderlineText,
        border: colors.warning,
      };
    case 'critical':
      return {
        background: colors.statusCriticalBg,
        text: colors.statusCriticalText,
        border: colors.error,
      };
  }
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    marginVertical: 8,
    marginHorizontal: 4,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  typeLabel: {
    fontWeight: '600',
  },
  trendIndicator: {
    fontWeight: '500',
  },
  valueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginBottom: 4,
  },
  value: {
    fontWeight: '700',
    marginRight: 6,
  },
  unit: {
    fontWeight: '400',
  },
  timestamp: {
    fontWeight: '400',
    marginTop: 4,
  },
});

export default VitalSignCard;
