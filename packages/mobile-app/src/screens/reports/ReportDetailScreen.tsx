/**
 * ReportDetailScreen — Displays full report details including test results,
 * physician notes, and follow-up actions with color-coded status.
 *
 * Accessibility: All elements have accessibilityLabel, accessibilityRole, and
 * support dynamic text scaling to 200% without truncating critical health data.
 *
 * Requirements: 7.2, 7.3, 7.4, 7.5, 10.4, 10.5
 */
import React from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useAccessibility } from '../../hooks/useAccessibility';
import { useReportStore } from '../../stores/reportStore';
import type { FollowUpAction } from '../../stores/reportStore';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(isoDate: string): string {
  const date = new Date(isoDate);
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function getFollowUpStatusLabel(status: string): string {
  switch (status) {
    case 'pending':
      return 'Pending';
    case 'in-progress':
      return 'In Progress';
    case 'completed':
      return 'Completed';
    default:
      return status;
  }
}

function getFollowUpStatusColor(status: string): string {
  switch (status) {
    case 'pending':
      return '#E65100'; // Amber
    case 'in-progress':
      return '#1565C0'; // Blue
    case 'completed':
      return '#1B5E20'; // Green
    default:
      return '#424242';
  }
}

function getFollowUpStatusBgColor(status: string): string {
  switch (status) {
    case 'pending':
      return '#FFF3E0';
    case 'in-progress':
      return '#E3F2FD';
    case 'completed':
      return '#E8F5E9';
    default:
      return '#F5F5F5';
  }
}

function isOverdue(dueDate: string | undefined): boolean {
  if (!dueDate) return false;
  return new Date(dueDate) < new Date();
}

// ─── ReportDetailScreen ──────────────────────────────────────────────────────

export function ReportDetailScreen(): React.ReactElement {
  const { theme, getTextSize, minTouchTarget } = useAccessibility();
  const { selectedReport } = useReportStore();

  const bodySize = getTextSize('body');
  const headingSize = getTextSize('heading');

  if (!selectedReport) {
    return (
      <View
        style={[styles.emptyContainer, { backgroundColor: theme.colors.background }]}
        accessibilityRole="text"
        accessibilityLabel="No report selected"
      >
        <Text
          style={[styles.emptyText, { fontSize: bodySize, color: theme.colors.textSecondary }]}
          allowFontScaling={true}
          maxFontSizeMultiplier={2}
        >
          No report selected
        </Text>
      </View>
    );
  }

  const overallStatusLabel = selectedReport.overallStatus === 'normal'
    ? 'Normal'
    : selectedReport.overallStatus === 'borderline'
      ? 'Borderline'
      : 'Critical';

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: theme.colors.background }]}
      contentContainerStyle={styles.contentContainer}
      accessibilityLabel={`Health report details from ${formatDate(selectedReport.reportDate)}`}
    >
      {/* Report header */}
      <Text
        style={[styles.heading, { fontSize: headingSize, color: theme.colors.text }]}
        accessibilityRole="header"
        allowFontScaling={true}
        maxFontSizeMultiplier={2}
      >
        Report Details
      </Text>

      {/* Report metadata */}
      <View style={[styles.metaCard, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
        <DetailRow
          label="Date"
          value={formatDate(selectedReport.reportDate)}
          bodySize={bodySize}
          theme={theme}
        />
        <DetailRow
          label="Package"
          value={selectedReport.packageName}
          bodySize={bodySize}
          theme={theme}
        />
        <DetailRow
          label="Overall Status"
          value={overallStatusLabel}
          bodySize={bodySize}
          theme={theme}
        />
      </View>

      {/* Test Results */}
      {selectedReport.testResults && selectedReport.testResults.length > 0 && (
        <View style={styles.section}>
          <Text
            style={[styles.sectionHeading, { fontSize: bodySize, color: theme.colors.text }]}
            accessibilityRole="header"
            allowFontScaling={true}
            maxFontSizeMultiplier={2}
          >
            Test Results
          </Text>
          {selectedReport.testResults.map((result, index) => (
            <View
              key={index}
              style={[styles.testResultCard, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}
              accessible
              accessibilityLabel={`${result.testType}: ${result.measuredValue} ${result.unit}, status ${result.category}`}
              accessibilityRole="text"
            >
              <Text
                style={[styles.testName, { fontSize: bodySize, color: theme.colors.text }]}
                allowFontScaling={true}
                maxFontSizeMultiplier={2}
              >
                {result.testType}
              </Text>
              <Text
                style={[styles.testValue, { fontSize: bodySize, color: theme.colors.text }]}
                allowFontScaling={true}
                maxFontSizeMultiplier={2}
              >
                {result.measuredValue} {result.unit}
              </Text>
            </View>
          ))}
        </View>
      )}

      {/* Physician Notes */}
      {selectedReport.physicianNotes && selectedReport.physicianNotes.length > 0 && (
        <View style={styles.section}>
          <Text
            style={[styles.sectionHeading, { fontSize: bodySize, color: theme.colors.text }]}
            accessibilityRole="header"
            allowFontScaling={true}
            maxFontSizeMultiplier={2}
          >
            Physician Notes
          </Text>
          {selectedReport.physicianNotes.map((note, index) => (
            <Text
              key={index}
              style={[styles.notesText, { fontSize: bodySize, color: theme.colors.text }]}
              accessibilityRole="text"
              accessibilityLabel={`Note ${index + 1}: ${note}`}
              allowFontScaling={true}
              maxFontSizeMultiplier={2}
            >
              {note}
            </Text>
          ))}
        </View>
      )}

      {/* Follow-up Actions */}
      {selectedReport.followUpActions && selectedReport.followUpActions.length > 0 && (
        <View style={styles.section}>
          <Text
            style={[styles.sectionHeading, { fontSize: bodySize, color: theme.colors.text }]}
            accessibilityRole="header"
            allowFontScaling={true}
            maxFontSizeMultiplier={2}
          >
            Follow-up Actions ({selectedReport.followUpActions.length})
          </Text>
          {selectedReport.followUpActions.map((action, index) => (
            <FollowUpActionCard
              key={index}
              action={action}
              bodySize={bodySize}
              theme={theme}
            />
          ))}
        </View>
      )}
    </ScrollView>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

interface DetailRowProps {
  label: string;
  value: string;
  bodySize: number;
  theme: ReturnType<typeof import('../../hooks/useAccessibility').useAccessibility>['theme'];
}

function DetailRow({ label, value, bodySize, theme }: DetailRowProps) {
  return (
    <View
      style={styles.detailRow}
      accessible
      accessibilityLabel={`${label}: ${value}`}
      accessibilityRole="text"
    >
      <Text
        style={[styles.detailLabel, { fontSize: bodySize - 2, color: theme.colors.textSecondary }]}
        allowFontScaling={true}
        maxFontSizeMultiplier={2}
      >
        {label}
      </Text>
      <Text
        style={[styles.detailValue, { fontSize: bodySize, color: theme.colors.text }]}
        allowFontScaling={true}
        maxFontSizeMultiplier={2}
      >
        {value}
      </Text>
    </View>
  );
}

interface FollowUpActionCardProps {
  action: FollowUpAction;
  bodySize: number;
  theme: ReturnType<typeof import('../../hooks/useAccessibility').useAccessibility>['theme'];
}

function FollowUpActionCard({ action, bodySize, theme }: FollowUpActionCardProps) {
  const statusLabel = getFollowUpStatusLabel(action.status);
  const statusColor = getFollowUpStatusColor(action.status);
  const statusBgColor = getFollowUpStatusBgColor(action.status);
  const overdue = action.status !== 'completed' && isOverdue(action.dueDate);

  const accessibilityLabel = `Follow-up action: ${action.description}, status ${statusLabel}${action.dueDate ? `, due ${formatDate(action.dueDate)}` : ''}${overdue ? ', overdue' : ''}`;

  return (
    <View
      style={[
        styles.followUpCard,
        { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
        overdue && { borderColor: theme.colors.error, borderWidth: 2 },
      ]}
      accessible
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="text"
    >
      <View style={styles.followUpHeader}>
        <Text
          style={[styles.followUpDescription, { fontSize: bodySize, color: theme.colors.text }]}
          allowFontScaling={true}
          maxFontSizeMultiplier={2}
        >
          {action.description}
        </Text>
        <View style={[styles.followUpBadge, { backgroundColor: statusBgColor }]}>
          <Text
            style={[styles.followUpBadgeText, { fontSize: bodySize - 4, color: statusColor }]}
            allowFontScaling={true}
            maxFontSizeMultiplier={2}
          >
            {statusLabel}
          </Text>
        </View>
      </View>
      {action.dueDate && (
        <Text
          style={[
            styles.dueDate,
            { fontSize: bodySize - 2, color: overdue ? theme.colors.error : theme.colors.textSecondary },
          ]}
          allowFontScaling={true}
          maxFontSizeMultiplier={2}
        >
          {overdue ? '⚠ Overdue — ' : ''}Due: {formatDate(action.dueDate)}
        </Text>
      )}
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  contentContainer: {
    padding: 24,
    paddingBottom: 48,
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  emptyText: {
    textAlign: 'center',
  },
  heading: {
    fontWeight: '700',
    marginBottom: 20,
  },
  metaCard: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 16,
    marginBottom: 24,
  },
  detailRow: {
    marginBottom: 12,
  },
  detailLabel: {
    fontWeight: '500',
    marginBottom: 2,
  },
  detailValue: {
    fontWeight: '400',
  },
  section: {
    marginBottom: 24,
  },
  sectionHeading: {
    fontWeight: '700',
    marginBottom: 12,
  },
  testResultCard: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  testName: {
    fontWeight: '500',
    flex: 1,
  },
  testValue: {
    fontWeight: '600',
  },
  notesText: {
    lineHeight: 26,
  },
  followUpCard: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    marginBottom: 10,
  },
  followUpHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 6,
  },
  followUpDescription: {
    flex: 1,
    marginRight: 8,
  },
  followUpBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  followUpBadgeText: {
    fontWeight: '600',
  },
  dueDate: {
    fontWeight: '500',
  },
});
