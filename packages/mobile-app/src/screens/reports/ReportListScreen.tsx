import React, { useCallback, useEffect } from 'react';
import {
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { ReportsStackParamList } from '../../navigation/types';
import { useReportStore } from '../../stores/reportStore';
import type { HealthReport } from '../../stores/reportStore';
import { useAuthStore } from '../../stores/authStore';
import { useNetworkStatus } from '../../hooks/useNetworkStatus';
import { useAccessibility } from '../../hooks/useAccessibility';
import { OfflineBanner } from '../../components/OfflineBanner';

// ─── Types ───────────────────────────────────────────────────────────────────

type ReportListNavProp = NativeStackNavigationProp<ReportsStackParamList, 'ReportList'>;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Format an ISO date string for display (e.g., "Jan 15, 2024").
 */
function formatDate(isoDate: string): string {
  const date = new Date(isoDate);
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Get human-readable status label.
 */
function getStatusLabel(status: string): string {
  switch (status) {
    case 'normal':
      return 'Normal';
    case 'borderline':
      return 'Borderline';
    case 'critical':
      return 'Critical';
    default:
      return status;
  }
}

/**
 * Get the status color based on overall report status.
 */
function getStatusColor(status: string): string {
  switch (status) {
    case 'normal':
      return '#1B5E20';
    case 'borderline':
      return '#E65100';
    case 'critical':
      return '#B71C1C';
    default:
      return '#424242';
  }
}

/**
 * Get the status background color.
 */
function getStatusBgColor(status: string): string {
  switch (status) {
    case 'normal':
      return '#E8F5E9';
    case 'borderline':
      return '#FFF3E0';
    case 'critical':
      return '#FFEBEE';
    default:
      return '#F5F5F5';
  }
}

// ─── ReportListScreen ────────────────────────────────────────────────────────

/**
 * Screen displaying a list of health reports sorted by date descending.
 * Each report shows date, package name, overall status, and follow-up action count.
 *
 * Validates: Requirements 7.1, 7.2, 12.3
 */
export function ReportListScreen(): React.ReactElement {
  const navigation = useNavigation<ReportListNavProp>();
  const { getTextSize, theme, minTouchTarget } = useAccessibility();
  const { isOffline, onReconnect } = useNetworkStatus();

  const user = useAuthStore((state) => state.user);
  const seniorId = user?.seniorId ?? '';

  const {
    reports,
    isLoading,
    isOffline: isServingCached,
    fetchReports,
    selectReport,
  } = useReportStore();

  // ─── Data Fetching ─────────────────────────────────────────────────────────

  const fetchData = useCallback(() => {
    if (!seniorId) return;
    fetchReports(seniorId).catch(() => {
      // Errors handled by store (sets isOffline or throws)
    });
  }, [seniorId, fetchReports]);

  // Initial fetch on mount
  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Auto-refresh when network reconnects
  useEffect(() => {
    onReconnect(() => {
      fetchData();
    });
  }, [onReconnect, fetchData]);

  // ─── Handlers ──────────────────────────────────────────────────────────────

  const handleReportPress = useCallback(
    (reportId: string) => {
      selectReport(reportId);
      navigation.navigate('ReportDetail', { reportId });
    },
    [navigation, selectReport],
  );

  // ─── Render Item ──────────────────────────────────────────────────────────

  const renderItem = useCallback(
    ({ item }: { item: HealthReport }) => {
      const followUpCount = item.followUpActions.length;
      const statusLabel = getStatusLabel(item.overallStatus);
      const accessibilityLabel = `Report from ${formatDate(item.reportDate)}, package ${item.packageName}, status ${statusLabel}, ${followUpCount} follow-up action${followUpCount !== 1 ? 's' : ''}`;

      return (
        <Pressable
          style={[
            styles.reportCard,
            {
              borderColor: theme.colors.border,
              backgroundColor: theme.colors.surface,
              minHeight: minTouchTarget.height,
            },
          ]}
          onPress={() => handleReportPress(item.id)}
          accessibilityRole="button"
          accessibilityLabel={accessibilityLabel}
          accessibilityHint="Double tap to view report details"
        >
          <View style={styles.reportHeader}>
            <Text
              style={[styles.reportDate, { fontSize: getTextSize('body'), color: theme.colors.text }]}
              allowFontScaling={true}
              maxFontSizeMultiplier={2}
            >
              {formatDate(item.reportDate)}
            </Text>
            <View
              style={[
                styles.statusBadge,
                { backgroundColor: getStatusBgColor(item.overallStatus) },
              ]}
            >
              <Text
                style={[
                  styles.statusText,
                  {
                    fontSize: getTextSize('caption'),
                    color: getStatusColor(item.overallStatus),
                  },
                ]}
                allowFontScaling={true}
                maxFontSizeMultiplier={2}
              >
                {statusLabel}
              </Text>
            </View>
          </View>

          <Text
            style={[
              styles.packageName,
              { fontSize: getTextSize('body'), color: theme.colors.textSecondary },
            ]}
            allowFontScaling={true}
            maxFontSizeMultiplier={2}
          >
            {item.packageName}
          </Text>

          <View style={styles.followUpRow}>
            <Text
              style={[
                styles.followUpText,
                { fontSize: getTextSize('caption'), color: theme.colors.textSecondary },
              ]}
              allowFontScaling={true}
              maxFontSizeMultiplier={2}
            >
              {followUpCount} follow-up action{followUpCount !== 1 ? 's' : ''}
            </Text>
          </View>
        </Pressable>
      );
    },
    [handleReportPress, getTextSize, theme, minTouchTarget],
  );

  const keyExtractor = useCallback(
    (item: HealthReport) => item.id,
    [],
  );

  // ─── Empty State ──────────────────────────────────────────────────────────

  const renderEmptyState = useCallback(() => {
    if (isLoading) return null;
    return (
      <View style={styles.emptyContainer} accessibilityRole="text">
        <Text
          style={[styles.emptyText, { fontSize: getTextSize('body'), color: theme.colors.textSecondary }]}
          accessibilityLabel="No health reports available"
        >
          No health reports available
        </Text>
      </View>
    );
  }, [isLoading, getTextSize, theme]);

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <OfflineBanner
        isOffline={isOffline || isServingCached}
        hasCachedData={reports.length > 0}
      />
      <FlatList
        data={reports}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={renderEmptyState}
        refreshControl={
          <RefreshControl
            refreshing={isLoading}
            onRefresh={fetchData}
            accessibilityLabel="Pull to refresh reports"
          />
        }
        accessibilityRole="list"
        accessibilityLabel="Health reports list"
      />
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    flexGrow: 1,
  },
  reportCard: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 16,
    marginBottom: 12,
  },
  reportHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  reportDate: {
    fontWeight: '600',
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusText: {
    fontWeight: '600',
  },
  packageName: {
    marginBottom: 8,
  },
  followUpRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  followUpText: {
    fontWeight: '500',
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 48,
  },
  emptyText: {
    textAlign: 'center',
  },
});

export default ReportListScreen;
