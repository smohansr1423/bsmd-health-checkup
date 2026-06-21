import React, { useState, useMemo } from 'react';

/**
 * TrendChart component for displaying health reading trends as line chart visualizations.
 * Uses SVG polyline for lightweight rendering without external charting library dependencies.
 *
 * Requirements: 6.3
 */

export type TimePeriod = 'daily' | '7day' | '30day';

export interface TrendDataPoint {
  timestamp: string;
  value: number;
}

export interface TrendChartProps {
  /** Array of data points with timestamp and value */
  data: TrendDataPoint[];
  /** The type of health reading being displayed */
  readingType: string;
  /** Unit label for the Y axis */
  unit: string;
  /** Optional chart title */
  title?: string;
  /** Callback when time period selection changes */
  onPeriodChange?: (period: TimePeriod) => void;
}

/** Reading type to line color mapping */
const READING_COLORS: Record<string, string> = {
  blood_pressure: '#e74c3c',
  blood_glucose: '#8e44ad',
  heart_rate: '#e84393',
  spo2: '#0984e3',
  temperature: '#d35400',
  weight: '#2d3436',
};

const DEFAULT_LINE_COLOR = '#0056b3';

const PERIOD_LABELS: Record<TimePeriod, string> = {
  daily: '24 Hours',
  '7day': '7 Days',
  '30day': '30 Days',
};

/** Chart layout constants */
const CHART_PADDING = { top: 20, right: 20, bottom: 40, left: 50 };
const VIEWBOX_WIDTH = 600;
const VIEWBOX_HEIGHT = 300;

const PLOT_WIDTH = VIEWBOX_WIDTH - CHART_PADDING.left - CHART_PADDING.right;
const PLOT_HEIGHT = VIEWBOX_HEIGHT - CHART_PADDING.top - CHART_PADDING.bottom;

function formatTimestamp(timestamp: string, period: TimePeriod): string {
  const date = new Date(timestamp);
  if (period === 'daily') {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function computeNiceScale(min: number, max: number, tickCount: number): { min: number; max: number; ticks: number[] } {
  if (min === max) {
    const offset = Math.abs(min) * 0.1 || 1;
    min = min - offset;
    max = max + offset;
  }

  const range = max - min;
  const roughStep = range / (tickCount - 1);
  const magnitude = Math.pow(10, Math.floor(Math.log10(roughStep)));
  const residual = roughStep / magnitude;

  let niceStep: number;
  if (residual <= 1.5) niceStep = magnitude;
  else if (residual <= 3) niceStep = 2 * magnitude;
  else if (residual <= 7) niceStep = 5 * magnitude;
  else niceStep = 10 * magnitude;

  const niceMin = Math.floor(min / niceStep) * niceStep;
  const niceMax = Math.ceil(max / niceStep) * niceStep;

  const ticks: number[] = [];
  for (let val = niceMin; val <= niceMax + niceStep * 0.5; val += niceStep) {
    ticks.push(Math.round(val * 1000) / 1000);
  }

  return { min: niceMin, max: niceMax, ticks };
}

export function TrendChart({ data, readingType, unit, title, onPeriodChange }: TrendChartProps) {
  const [selectedPeriod, setSelectedPeriod] = useState<TimePeriod>('daily');

  const handlePeriodChange = (period: TimePeriod) => {
    setSelectedPeriod(period);
    onPeriodChange?.(period);
  };

  const lineColor = READING_COLORS[readingType] ?? DEFAULT_LINE_COLOR;

  const chartTitle = title ?? `${readingType.replace(/_/g, ' ')} trend`;

  const sortedData = useMemo(() => {
    return [...data].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
  }, [data]);

  const { yScale, polylinePoints, xLabels, yTicks } = useMemo(() => {
    if (sortedData.length === 0) {
      return { yScale: { min: 0, max: 100, ticks: [0, 50, 100] }, polylinePoints: '', xLabels: [], yTicks: [] };
    }

    const values = sortedData.map((d) => d.value);
    const minVal = Math.min(...values);
    const maxVal = Math.max(...values);

    const scale = computeNiceScale(minVal, maxVal, 5);

    const points = sortedData.map((d, i) => {
      const x = CHART_PADDING.left + (sortedData.length === 1 ? PLOT_WIDTH / 2 : (i / (sortedData.length - 1)) * PLOT_WIDTH);
      const yNorm = (d.value - scale.min) / (scale.max - scale.min);
      const y = CHART_PADDING.top + PLOT_HEIGHT - yNorm * PLOT_HEIGHT;
      return `${x},${y}`;
    });

    // Generate X axis labels (show max 6 labels to avoid clutter)
    const maxXLabels = 6;
    const step = Math.max(1, Math.floor(sortedData.length / maxXLabels));
    const labels = sortedData
      .filter((_, i) => i % step === 0 || i === sortedData.length - 1)
      .map((d, _, arr) => {
        const idx = sortedData.indexOf(d);
        const x = CHART_PADDING.left + (sortedData.length === 1 ? PLOT_WIDTH / 2 : (idx / (sortedData.length - 1)) * PLOT_WIDTH);
        return { x, label: formatTimestamp(d.timestamp, selectedPeriod) };
      });

    return {
      yScale: scale,
      polylinePoints: points.join(' '),
      xLabels: labels,
      yTicks: scale.ticks,
    };
  }, [sortedData, selectedPeriod]);

  const ariaDescription = sortedData.length > 0
    ? `Line chart showing ${chartTitle} over ${PERIOD_LABELS[selectedPeriod]}. ${sortedData.length} data points ranging from ${yScale.min} to ${yScale.max} ${unit}.`
    : `Line chart for ${chartTitle}. No data available for the selected period.`;

  return (
    <div style={containerStyle}>
      {/* Header with title and period selector */}
      <div style={headerStyle}>
        <h3 style={titleStyle}>{chartTitle}</h3>
        <div role="group" aria-label="Time range selection" style={periodGroupStyle}>
          {(Object.keys(PERIOD_LABELS) as TimePeriod[]).map((period) => (
            <button
              key={period}
              onClick={() => handlePeriodChange(period)}
              aria-pressed={selectedPeriod === period}
              style={{
                ...periodButtonStyle,
                ...(selectedPeriod === period ? periodButtonActiveStyle : {}),
              }}
            >
              {PERIOD_LABELS[period]}
            </button>
          ))}
        </div>
      </div>

      {/* Current period label */}
      <p style={periodLabelStyle} aria-live="polite">
        Showing: {PERIOD_LABELS[selectedPeriod]}
      </p>

      {/* SVG Chart */}
      {sortedData.length === 0 ? (
        <div style={emptyStateStyle} role="status">
          No data available for the selected time range.
        </div>
      ) : (
        <svg
          viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
          style={svgStyle}
          role="img"
          aria-label={ariaDescription}
        >
          <desc>{ariaDescription}</desc>

          {/* Y axis grid lines and labels */}
          {yTicks.map((tick) => {
            const yNorm = (tick - yScale.min) / (yScale.max - yScale.min);
            const y = CHART_PADDING.top + PLOT_HEIGHT - yNorm * PLOT_HEIGHT;
            return (
              <g key={`y-${tick}`}>
                <line
                  x1={CHART_PADDING.left}
                  y1={y}
                  x2={CHART_PADDING.left + PLOT_WIDTH}
                  y2={y}
                  stroke="#e0e0e0"
                  strokeWidth="0.5"
                />
                <text
                  x={CHART_PADDING.left - 8}
                  y={y + 4}
                  textAnchor="end"
                  fontSize="10"
                  fill="#666"
                >
                  {tick}
                </text>
              </g>
            );
          })}

          {/* X axis labels */}
          {xLabels.map((label, i) => (
            <text
              key={`x-${i}`}
              x={label.x}
              y={VIEWBOX_HEIGHT - 8}
              textAnchor="middle"
              fontSize="9"
              fill="#666"
            >
              {label.label}
            </text>
          ))}

          {/* Axes */}
          <line
            x1={CHART_PADDING.left}
            y1={CHART_PADDING.top}
            x2={CHART_PADDING.left}
            y2={CHART_PADDING.top + PLOT_HEIGHT}
            stroke="#999"
            strokeWidth="1"
          />
          <line
            x1={CHART_PADDING.left}
            y1={CHART_PADDING.top + PLOT_HEIGHT}
            x2={CHART_PADDING.left + PLOT_WIDTH}
            y2={CHART_PADDING.top + PLOT_HEIGHT}
            stroke="#999"
            strokeWidth="1"
          />

          {/* Y axis unit label */}
          <text
            x={12}
            y={CHART_PADDING.top + PLOT_HEIGHT / 2}
            textAnchor="middle"
            fontSize="10"
            fill="#666"
            transform={`rotate(-90, 12, ${CHART_PADDING.top + PLOT_HEIGHT / 2})`}
          >
            {unit}
          </text>

          {/* Data line */}
          <polyline
            points={polylinePoints}
            fill="none"
            stroke={lineColor}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* Data points */}
          {sortedData.map((d, i) => {
            const x = CHART_PADDING.left + (sortedData.length === 1 ? PLOT_WIDTH / 2 : (i / (sortedData.length - 1)) * PLOT_WIDTH);
            const yNorm = (d.value - yScale.min) / (yScale.max - yScale.min);
            const y = CHART_PADDING.top + PLOT_HEIGHT - yNorm * PLOT_HEIGHT;
            return (
              <circle
                key={`point-${i}`}
                cx={x}
                cy={y}
                r="3"
                fill={lineColor}
                stroke="#fff"
                strokeWidth="1"
              >
                <title>{`${d.value} ${unit} at ${formatTimestamp(d.timestamp, selectedPeriod)}`}</title>
              </circle>
            );
          })}
        </svg>
      )}
    </div>
  );
}

export default TrendChart;

/* Styles */
const containerStyle: React.CSSProperties = {
  border: '1px solid #e0e0e0',
  borderRadius: '8px',
  padding: '16px',
  backgroundColor: '#ffffff',
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: '8px',
  marginBottom: '8px',
};

const titleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '16px',
  fontWeight: 600,
  color: '#1a1a2e',
  textTransform: 'capitalize',
};

const periodGroupStyle: React.CSSProperties = {
  display: 'flex',
  gap: '4px',
};

const periodButtonStyle: React.CSSProperties = {
  padding: '6px 12px',
  fontSize: '12px',
  border: '1px solid #cbd5e0',
  borderRadius: '4px',
  background: '#f7fafc',
  color: '#4a5568',
  cursor: 'pointer',
  transition: 'all 0.15s ease',
};

const periodButtonActiveStyle: React.CSSProperties = {
  background: '#0056b3',
  color: '#ffffff',
  borderColor: '#0056b3',
};

const periodLabelStyle: React.CSSProperties = {
  margin: '0 0 12px 0',
  fontSize: '12px',
  color: '#666',
};

const svgStyle: React.CSSProperties = {
  width: '100%',
  height: 'auto',
  maxHeight: '300px',
};

const emptyStateStyle: React.CSSProperties = {
  padding: '48px 16px',
  textAlign: 'center',
  color: '#888',
  fontSize: '14px',
  background: '#f8f9fa',
  borderRadius: '4px',
};
