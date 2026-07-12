import React, { useCallback, useEffect } from 'react';
import {
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { DashboardStackParamList } from '../../navigation/types';
import { useHealthReadingsStore } from '../../stores/healthReadingsStore';
import type { VitalReading } from '../../stores/healthReadingsStore';
import { useAuthStore } from '../../stores/authStore';
import { useNetworkStatus } from '../../hooks/useNetworkStatus';
import { VitalSignCard } from '../../components/VitalSignCard';
import { OfflineBanner } from '../../components/OfflineBanner';
import { useAccessibility } from '../../hooks/useAccessibility';

// ─── Types ───────────────────────────────────────────────────────────────────

type DashboardNavProp = NativeStackNavigationProp<DashboardStackParamList, 'Dashboard'>;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Get today's date as an ISO date string (YYYY-MM-DD).
 */
function getTodayISO(): string {
  return new Date().toISOString().split('T')[0];
}

// ─── HealthDashboardScreen ───────────────────────────────────────────────────

/**
 * Main health dashboard screen displaying a list of VitalSignCards for today's readings.
 *
 * Features:
 * - Pull-to-refresh to re-fetch daily record from API
 * - Empty state message when no readings are available
 * - Offline banner when serving cached data
 * - Tappable cards navigating to TrendChartScreen for the reading type
 * - Auto-refresh on network reconnection
 *
 * Validates: Requirements 2.1, 2.4, 2.5, 4.1, 12.2
 */
export function HealthDashboardScreen(): React.ReactElement {
  const navigation = useNavigation<DashboardNavProp>();
  const { getTextSize, theme } = useAccessibility();
  const { isOffline, onReconnect } = useNetworkStatus();

  const user = useAuthStore((state) => state.user);
  const seniorId = user?.seniorId ?? '';

  const {
    dailyRecord,
    isLoading,
    isOffline: isServingCached,
    fetchDailyRecord,
  } = useHealthReadingsStore();

  const readings = dailyRecord?.readings ?? [];

  // ─── Data Fetching ─────────────────────────────────────────────────────────

  const fetchToday = useCallback(() => {
    if (!seniorId) return;
    const today = getTodayISO();
    fetchDailyRecord(seniorId, today).catch(() => {
      // Errors handled by store (sets isOffline or throws)
    });
  }, [seniorId, fetchDailyRecord]);

  // Initial fetch on mount
  useEffect(() => {
    fetchToday();
  }, [fetchToday]);

  // Auto-refresh when network reconnects
  useEffect(() => {
    onReconnect(() => {
      fetchToday();
    });
  }, [onReconnect, fetchToday]);

  // ─── Pull-to-Refresh Handler ──────────────────────────────────────────────

  const handleRefresh = useCallback(() => {
    fetchToday();
  }, [fetchToday]);

  // ─── Card Tap Handler ─────────────────────────────────────────────────────

  const handleCardPress = useCallback(
    (readingType: string) => {
      navigation.navigate('TrendChart', { readingType });
    },
    [navigation],
  );

  // ─── Render Item ──────────────────────────────────────────────────────────

  const renderItem = useCallback(
    ({ item }: { item: VitalReading }) => (
      <VitalSignCard
        reading={item}
        onPress={() => handleCardPress(item.type)}
      />
    ),
    [handleCardPress],
  );

  const keyExtractor = useCallback(
    (item: VitalReading, index: number) => `${item.type}-${index}`,
    [],
  );

  // ─── Empty State ──────────────────────────────────────────────────────────

  const renderEmptyState = useCallback(() => {
    if (isLoading) return null;
    return (
      <View style={styles.emptyContainer} accessibilityRole="text">
        <Text
          style={[styles.emptyText, { fontSize: getTextSize('body') }]}
          accessibilityLabel="No readings available for today"
          allowFontScaling={true}
          maxFontSizeMultiplier={2}
        >
          No readings available for today
        </Text>
      </View>
    );
  }, [isLoading, getTextSize]);

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <OfflineBanner
        isOffline={isOffline || isServingCached}
        hasCachedData={readings.length > 0}
      />
      <FlatList
        data={readings}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={renderEmptyState}
        refreshControl={
          <RefreshControl
            refreshing={isLoading}
            onRefresh={handleRefresh}
            accessibilityLabel="Pull to refresh health readings"
          />
        }
        accessibilityRole="list"
        accessibilityLabel="Health readings list"
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
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 48,
  },
  emptyText: {
    color: '#6B7280',
    textAlign: 'center',
  },
});

export default HealthDashboardScreen;
