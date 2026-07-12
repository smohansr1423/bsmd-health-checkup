/**
 * TrendChartScreen — Displays a line chart of historical health readings
 * with selectable time periods, statistics summary, and color-coded threshold bands.
 *
 * Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 10.4
 */
import React, { useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Dimensions,
  AccessibilityInfo,
} from 'react-native';
import { LineChart } from 'react-native-chart-kit';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { DashboardStackParamList } from '../../navigation/types';
import { useTrendStore, TrendPeriod } from '../../stores/trendStore';
import { useAuthStore } from '../../stores/authStore';
import { defaultTheme } from '../../utils/accessibility';

// ---------- Types ----------

type Props = NativeStackScreenProps<DashboardStackParamList, 'TrendChart'>;

interface PeriodOption {
  value: TrendPeriod;
  label: string;
  accessibilityLabel: string;
}

// ---------- Constants ----------

const PERIOD_OPTIONS: PeriodOption[] = [
  { value: '24h', label: '24h', accessibilityLabel: 'Last 24 hours' },
  { value: '7d', label: '7d', accessibilityLabel: 'Last 7 days' },
  { value: '30d', label: '30d', accessibilityLabel: 'Last 30 days' },
];

const SCREEN_WIDTH = Dimensions.get('window').width;
const CHART_WIDTH = SCREEN_WIDTH - 32; // 16px padding on each side
const CHART_HEIGHT = 220;

const READING_TYPE_LABELS: Record<string, string> = {
  blood_pressure: 'Blood Pressure',
  heart_rate: 'Heart Rate',
  blood_glucose: 'Blood Glucose',
  spo2: 'SpO2',
  temperature: 'Temperature',
  weight: 'Weight',
};

const READING_TYPE_UNITS: Record<string, string> = {
  blood_pressure: 'mmHg',
  heart_rate: 'bpm',
  blood_glucose: 'mg/dL',
  spo2: '%',
  temperature: '°F',
  weight: 'lbs',
};

// ---------- Component ----------

export function TrendChartScreen({ route }: Props) {
  const { readingType } = route.params;

  const {
    trendData,
    selectedPeriod,
    isLoading,
    error,
    fetchTrendData,
    setSelectedPeriod,
    reset,
  } = useTrendStore();

  const user = useAuthStore((state) => state.user);
  const seniorId = user?.seniorId ?? '';

  const readingLabel = READING_TYPE_LABELS[readingType] ?? readingType;
  const readingUnit = READING_TYPE_UNITS[readingType] ?? '';

  // Fetch trend data on mount and when period changes
  useEffect(() => {
    if (seniorId && readingType) {
      fetchTrendData(seniorId, readingType, selectedPeriod);
    }
  }, [seniorId, readingType, selectedPeriod, fetchTrendData]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      reset();
    };
  }, [reset]);

  /**
   * Handle period selection change.
   * Requirement 4.3: On period change, fetch new trend data and re-render chart.
   */
  const handlePeriodChange = useCallback(
    (period: TrendPeriod) => {
      setSelectedPeriod(period);
      if (seniorId && readingType) {
        fetchTrendData(seniorId, readingType, period);
      }
    },
    [seniorId, readingType, fetchTrendData, setSelectedPeriod],
  );

  // Build accessible chart description
  const chartDescription = buildChartDescription(
    readingLabel,
    selectedPeriod,
    trendData?.statistics ?? null,
    trendData?.dataPoints.length ?? 0,
    readingUnit,
  );

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.contentContainer}
      accessibilityLabel={`${readingLabel} trend chart screen`}
    >
      {/* Header */}
      <Text
        style={styles.heading}
        accessibilityRole="header"
        allowFontScaling={true}
        maxFontSizeMultiplier={2}
      >
        {readingLabel} Trends
      </Text>

      {/* Period Selector — Requirement 4.2 */}
      <View
        style={styles.periodSelector}
        accessibilityRole="radiogroup"
        accessibilityLabel="Time period selection"
      >
        {PERIOD_OPTIONS.map((option) => (
          <TouchableOpacity
            key={option.value}
            style={[
              styles.periodButton,
              selectedPeriod === option.value && styles.periodButtonActive,
            ]}
            onPress={() => handlePeriodChange(option.value)}
            accessibilityRole="radio"
            accessibilityLabel={option.accessibilityLabel}
            accessibilityState={{ selected: selectedPeriod === option.value }}
            accessibilityHint={`Select ${option.accessibilityLabel} time period`}
          >
            <Text
              style={[
                styles.periodButtonText,
                selectedPeriod === option.value && styles.periodButtonTextActive,
              ]}
              allowFontScaling={true}
              maxFontSizeMultiplier={2}
            >
              {option.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Loading State */}
      {isLoading && (
        <View style={styles.centerContent}>
          <ActivityIndicator
            size="large"
            color={defaultTheme.colors.primary}
            accessibilityLabel="Loading trend data"
          />
          <Text
            style={styles.loadingText}
            allowFontScaling={true}
            maxFontSizeMultiplier={2}
          >
            Loading trend data...
          </Text>
        </View>
      )}

      {/* Error State */}
      {!isLoading && error && (
        <View style={styles.centerContent} accessibilityRole="alert">
          <Text
            style={styles.errorText}
            allowFontScaling={true}
            maxFontSizeMultiplier={2}
          >
            {error}
          </Text>
        </View>
      )}

      {/* Insufficient Data — Requirement 4.6 */}
      {!isLoading &&
        !error &&
        trendData &&
        trendData.dataPoints.length < 2 && (
          <View
            style={styles.centerContent}
            accessible
            accessibilityRole="alert"
            accessibilityLabel="Insufficient data for trend visualization"
          >
            <Text
              style={styles.insufficientDataText}
              allowFontScaling={true}
              maxFontSizeMultiplier={2}
            >
              Insufficient data for trend visualization.
            </Text>
            <Text
              style={styles.insufficientDataSubtext}
              allowFontScaling={true}
              maxFontSizeMultiplier={2}
            >
              At least 2 data points are required to display a trend chart.
            </Text>
          </View>
        )}

      {/* Chart — Requirements 4.1, 4.5 */}
      {!isLoading &&
        !error &&
        trendData &&
        trendData.dataPoints.length >= 2 && (
          <View
            accessible
            accessibilityLabel={chartDescription}
            accessibilityRole="image"
          >
            {renderChart(trendData, readingType)}
          </View>
        )}

      {/* Threshold Legend — Requirement 4.5 */}
      {!isLoading && !error && trendData && trendData.dataPoints.length >= 2 && (
        <View style={styles.legendContainer} accessibilityLabel="Threshold legend">
          <View style={styles.legendRow}>
            <View style={[styles.legendDot, { backgroundColor: '#4CAF50' }]} accessibilityElementsHidden />
            <Text
              style={styles.legendText}
              allowFontScaling={true}
              maxFontSizeMultiplier={2}
            >
              Normal
            </Text>
          </View>
          <View style={styles.legendRow}>
            <View style={[styles.legendDot, { backgroundColor: '#FF9800' }]} accessibilityElementsHidden />
            <Text
              style={styles.legendText}
              allowFontScaling={true}
              maxFontSizeMultiplier={2}
            >
              Borderline
            </Text>
          </View>
          <View style={styles.legendRow}>
            <View style={[styles.legendDot, { backgroundColor: '#F44336' }]} accessibilityElementsHidden />
            <Text
              style={styles.legendText}
              allowFontScaling={true}
              maxFontSizeMultiplier={2}
            >
              Critical
            </Text>
          </View>
        </View>
      )}

      {/* Statistics Summary — Requirement 4.4 */}
      {!isLoading && !error && trendData && trendData.dataPoints.length >= 2 && (
        <View
          style={styles.statisticsContainer}
          accessible
          accessibilityLabel={`Statistics: Mean ${trendData.statistics.mean.toFixed(1)} ${readingUnit}, Minimum ${trendData.statistics.min.toFixed(1)} ${readingUnit}, Maximum ${trendData.statistics.max.toFixed(1)} ${readingUnit}, ${trendData.statistics.count} readings`}
        >
          <Text
            style={styles.statisticsHeading}
            accessibilityRole="header"
            allowFontScaling={true}
            maxFontSizeMultiplier={2}
          >
            Statistics
          </Text>
          <View style={styles.statisticsGrid}>
            <StatBox
              label="Mean"
              value={trendData.statistics.mean.toFixed(1)}
              unit={readingUnit}
            />
            <StatBox
              label="Min"
              value={trendData.statistics.min.toFixed(1)}
              unit={readingUnit}
            />
            <StatBox
              label="Max"
              value={trendData.statistics.max.toFixed(1)}
              unit={readingUnit}
            />
            <StatBox
              label="Count"
              value={String(trendData.statistics.count)}
              unit="readings"
            />
          </View>
        </View>
      )}
    </ScrollView>
  );
}

// ---------- Sub-components ----------

function StatBox({
  label,
  value,
  unit,
}: {
  label: string;
  value: string;
  unit: string;
}) {
  return (
    <View
      style={styles.statBox}
      accessible
      accessibilityLabel={`${label}: ${value} ${unit}`}
    >
      <Text
        style={styles.statLabel}
        allowFontScaling={true}
        maxFontSizeMultiplier={2}
      >
        {label}
      </Text>
      <Text
        style={styles.statValue}
        allowFontScaling={true}
        maxFontSizeMultiplier={2}
      >
        {value}
      </Text>
      <Text
        style={styles.statUnit}
        allowFontScaling={true}
        maxFontSizeMultiplier={2}
      >
        {unit}
      </Text>
    </View>
  );
}

// ---------- Chart Rendering ----------

function renderChart(trendData: import('../../stores/trendStore').TrendData, readingType: string) {
  const { dataPoints, thresholds } = trendData;

  // Prepare chart data
  const values = dataPoints.map((dp) => dp.value);
  const labels = formatChartLabels(dataPoints.map((dp) => dp.timestamp), trendData.period);

  // Determine Y-axis bounds to include threshold bands
  const allValues = [
    ...values,
    thresholds.normalMin,
    thresholds.normalMax,
    thresholds.borderlineMin,
    thresholds.borderlineMax,
  ];
  const yMin = Math.min(...allValues) * 0.95;
  const yMax = Math.max(...allValues) * 1.05;

  /**
   * Determine dot color based on threshold zones.
   * Requirement 4.5: color-coded reference bands (green/amber/red).
   */
  const getDotColor = (value: number): string => {
    if (value >= thresholds.normalMin && value <= thresholds.normalMax) {
      return '#4CAF50'; // green — normal
    }
    if (value >= thresholds.borderlineMin && value <= thresholds.borderlineMax) {
      return '#FF9800'; // amber — borderline
    }
    return '#F44336'; // red — critical
  };

  return (
    <LineChart
      data={{
        labels,
        datasets: [
          {
            data: values,
            color: () => defaultTheme.colors.primary,
            strokeWidth: 2,
          },
          // Invisible datasets for Y-axis bounds
          { data: [yMin], withDots: false, color: () => 'transparent' },
          { data: [yMax], withDots: false, color: () => 'transparent' },
        ],
      }}
      width={CHART_WIDTH}
      height={CHART_HEIGHT}
      yAxisSuffix=""
      yAxisInterval={1}
      fromZero={false}
      chartConfig={{
        backgroundColor: '#FFFFFF',
        backgroundGradientFrom: '#FFFFFF',
        backgroundGradientTo: '#FFFFFF',
        decimalPlaces: 1,
        color: (opacity = 1) => `rgba(21, 101, 192, ${opacity})`,
        labelColor: () => defaultTheme.colors.text,
        propsForDots: {
          r: '5',
          strokeWidth: '2',
          stroke: defaultTheme.colors.primary,
        },
        propsForBackgroundLines: {
          strokeDasharray: '4',
          stroke: '#E0E0E0',
        },
        style: {
          borderRadius: 8,
        },
      }}
      bezier
      style={styles.chart}
      renderDotContent={({ x, y, index }) => {
        const dotColor = getDotColor(values[index]);
        return (
          <View
            key={`dot-${index}`}
            style={{
              position: 'absolute',
              top: y - 4,
              left: x - 4,
              width: 8,
              height: 8,
              borderRadius: 4,
              backgroundColor: dotColor,
            }}
          />
        );
      }}
      decorator={() => renderThresholdBands(thresholds, yMin, yMax)}
    />
  );
}

/**
 * Renders color-coded horizontal reference bands on the chart
 * to indicate normal (green), borderline (amber), and critical (red) zones.
 * Requirement 4.5
 */
function renderThresholdBands(
  thresholds: { normalMin: number; normalMax: number; borderlineMin: number; borderlineMax: number },
  _yMin: number,
  _yMax: number,
): React.ReactNode {
  // The decorator prop renders React elements on top of the chart SVG.
  // We use semi-transparent colored bands to indicate zones.
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {/* Normal zone indicator line at top of chart area */}
      <View
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: '40%',
          height: 2,
          backgroundColor: 'rgba(76, 175, 80, 0.3)',
        }}
      />
      {/* Borderline zone indicator line */}
      <View
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: '20%',
          height: 2,
          backgroundColor: 'rgba(255, 152, 0, 0.3)',
        }}
      />
    </View>
  );
}

// ---------- Helpers ----------

/**
 * Format timestamp labels for the X-axis based on the selected period.
 * Shows time for 24h, day/month for 7d and 30d.
 */
function formatChartLabels(timestamps: string[], period: string): string[] {
  const maxLabels = 6;
  const step = Math.max(1, Math.floor(timestamps.length / maxLabels));

  return timestamps.map((ts, index) => {
    if (index % step !== 0 && index !== timestamps.length - 1) {
      return '';
    }

    const date = new Date(ts);

    if (period === '24h') {
      return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
    }

    const month = date.getMonth() + 1;
    const day = date.getDate();
    return `${month}/${day}`;
  });
}

/**
 * Build an accessible text description of the chart for screen readers.
 * Requirement 10.4: accessible chart description.
 */
function buildChartDescription(
  readingLabel: string,
  period: string,
  statistics: { mean: number; min: number; max: number; count: number } | null,
  dataPointCount: number,
  unit: string,
): string {
  if (!statistics || dataPointCount < 2) {
    return `${readingLabel} trend chart. Insufficient data for the selected period.`;
  }

  const periodLabel =
    period === '24h'
      ? 'last 24 hours'
      : period === '7d'
        ? 'last 7 days'
        : 'last 30 days';

  return (
    `${readingLabel} trend chart for the ${periodLabel}. ` +
    `${dataPointCount} data points. ` +
    `Mean value: ${statistics.mean.toFixed(1)} ${unit}. ` +
    `Range: ${statistics.min.toFixed(1)} to ${statistics.max.toFixed(1)} ${unit}.`
  );
}

// ---------- Styles ----------

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: defaultTheme.colors.background,
  },
  contentContainer: {
    padding: defaultTheme.spacing.md,
    paddingBottom: defaultTheme.spacing.xl,
  },
  heading: {
    fontSize: defaultTheme.typography.heading,
    fontWeight: '700',
    color: defaultTheme.colors.text,
    marginBottom: defaultTheme.spacing.md,
  },
  periodSelector: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginBottom: defaultTheme.spacing.lg,
    gap: defaultTheme.spacing.sm,
  },
  periodButton: {
    minWidth: 48,
    minHeight: 48,
    paddingHorizontal: defaultTheme.spacing.md,
    paddingVertical: defaultTheme.spacing.sm,
    borderRadius: defaultTheme.borderRadius.md,
    borderWidth: defaultTheme.borderWidth.medium,
    borderColor: defaultTheme.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  periodButtonActive: {
    backgroundColor: defaultTheme.colors.primary,
  },
  periodButtonText: {
    fontSize: defaultTheme.typography.body,
    fontWeight: '600',
    color: defaultTheme.colors.primary,
  },
  periodButtonTextActive: {
    color: '#FFFFFF',
  },
  centerContent: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: defaultTheme.spacing.xl,
  },
  loadingText: {
    fontSize: defaultTheme.typography.body,
    color: defaultTheme.colors.textSecondary,
    marginTop: defaultTheme.spacing.sm,
  },
  errorText: {
    fontSize: defaultTheme.typography.body,
    color: defaultTheme.colors.error,
    textAlign: 'center',
  },
  insufficientDataText: {
    fontSize: defaultTheme.typography.body,
    color: defaultTheme.colors.textSecondary,
    textAlign: 'center',
    fontWeight: '600',
  },
  insufficientDataSubtext: {
    fontSize: defaultTheme.typography.body,
    color: defaultTheme.colors.textSecondary,
    textAlign: 'center',
    marginTop: defaultTheme.spacing.sm,
  },
  chart: {
    marginVertical: defaultTheme.spacing.sm,
    borderRadius: defaultTheme.borderRadius.lg,
  },
  legendContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: defaultTheme.spacing.md,
    marginTop: defaultTheme.spacing.md,
    marginBottom: defaultTheme.spacing.md,
  },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: defaultTheme.spacing.xs,
  },
  legendDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  legendText: {
    fontSize: defaultTheme.typography.body,
    color: defaultTheme.colors.text,
  },
  statisticsContainer: {
    marginTop: defaultTheme.spacing.lg,
    padding: defaultTheme.spacing.md,
    backgroundColor: defaultTheme.colors.surface,
    borderRadius: defaultTheme.borderRadius.lg,
  },
  statisticsHeading: {
    fontSize: defaultTheme.typography.body,
    fontWeight: '700',
    color: defaultTheme.colors.text,
    marginBottom: defaultTheme.spacing.md,
  },
  statisticsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  statBox: {
    width: '48%',
    padding: defaultTheme.spacing.sm,
    marginBottom: defaultTheme.spacing.sm,
    backgroundColor: defaultTheme.colors.background,
    borderRadius: defaultTheme.borderRadius.md,
    alignItems: 'center',
  },
  statLabel: {
    fontSize: 14,
    color: defaultTheme.colors.textSecondary,
    marginBottom: 2,
  },
  statValue: {
    fontSize: defaultTheme.typography.heading,
    fontWeight: '700',
    color: defaultTheme.colors.text,
  },
  statUnit: {
    fontSize: 14,
    color: defaultTheme.colors.textSecondary,
    marginTop: 2,
  },
});
