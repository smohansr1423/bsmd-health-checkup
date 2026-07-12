/**
 * DeviceStatusScreen — Displays each registered device's status information.
 * Shows type, serial number, protocol, status, and last sync time.
 * Applies visual warnings for stale/inactive devices.
 * On tap of stale device, shows troubleshooting message.
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4, 12.3
 */
import React, { useEffect, useCallback, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useDeviceStore, DeviceStatus } from '../../stores/deviceStore';
import { useAuthStore } from '../../stores/authStore';
import { getDefaultAccessibilityEngine } from '../../utils/accessibility';

// ---------- Constants ----------

const TROUBLESHOOTING_MESSAGE =
  'This device has not synced recently. Please check the device connection and ensure the battery is charged. ' +
  'Try restarting the device or moving it closer to the phone.';

// ---------- Component ----------

export function DeviceStatusScreen() {
  const { devices, isLoading, isOffline, error, fetchDevices } =
    useDeviceStore();
  const user = useAuthStore((state) => state.user);
  const [refreshing, setRefreshing] = useState(false);

  const engine = getDefaultAccessibilityEngine();
  const theme = engine.getTheme();
  const bodySize = engine.getTextSize('body');
  const headingSize = engine.getTextSize('heading');
  const touchTarget = engine.getMinTouchTarget();

  const seniorId = user?.seniorId;

  useEffect(() => {
    if (seniorId) {
      fetchDevices(seniorId);
    }
  }, [seniorId, fetchDevices]);

  const handleRefresh = useCallback(async () => {
    if (!seniorId) return;
    setRefreshing(true);
    await fetchDevices(seniorId);
    setRefreshing(false);
  }, [seniorId, fetchDevices]);

  const handleStaleDeviceTap = useCallback((device: DeviceStatus) => {
    Alert.alert(
      `${device.deviceType} - Troubleshooting`,
      TROUBLESHOOTING_MESSAGE,
      [{ text: 'OK' }],
    );
  }, []);

  const formatLastSync = (lastSyncAt: string | null): string => {
    if (!lastSyncAt) return 'Never synced';
    const date = new Date(lastSyncAt);
    return date.toLocaleString();
  };

  const formatProtocol = (protocol: string): string => {
    switch (protocol) {
      case 'bluetooth':
        return 'Bluetooth';
      case 'wifi':
        return 'Wi-Fi';
      case 'usb':
        return 'USB';
      default:
        return protocol;
    }
  };

  const getStatusIcon = (syncStatus: DeviceStatus['syncStatus']): string => {
    switch (syncStatus) {
      case 'synced':
        return '✓';
      case 'stale':
        return '⚠';
      case 'inactive':
        return '○';
      default:
        return '•';
    }
  };

  const getStatusLabel = (syncStatus: DeviceStatus['syncStatus']): string => {
    switch (syncStatus) {
      case 'synced':
        return 'Synced';
      case 'stale':
        return 'Stale - needs attention';
      case 'inactive':
        return 'Inactive';
      default:
        return 'Unknown';
    }
  };

  const renderDeviceItem = ({ item }: { item: DeviceStatus }) => {
    const isStale = item.syncStatus === 'stale';
    const isInactive = item.syncStatus === 'inactive';

    const cardStyle = [
      styles.deviceCard,
      {
        backgroundColor: theme.colors.surface,
        borderColor: theme.colors.border,
        borderWidth: theme.borderWidth.thin,
        borderRadius: theme.borderRadius.md,
        minHeight: touchTarget.height,
      },
      isStale && {
        borderColor: theme.colors.warning,
        borderWidth: theme.borderWidth.medium,
      },
      isInactive && { opacity: 0.5 },
    ];

    const statusIconStyle = [
      styles.statusIcon,
      { fontSize: headingSize },
      isStale && { color: theme.colors.warning },
      isInactive && { color: theme.colors.textSecondary },
      !isStale && !isInactive && { color: theme.colors.success },
    ];

    const accessibilityLabel = `${item.deviceType}, serial number ${item.serialNumber}, ` +
      `connection ${formatProtocol(item.connectionProtocol)}, ` +
      `status ${getStatusLabel(item.syncStatus)}, ` +
      `last synced ${formatLastSync(item.lastSyncAt)}`;

    const accessibilityHint = isStale
      ? 'Double tap for troubleshooting suggestions'
      : undefined;

    const onPress = isStale ? () => handleStaleDeviceTap(item) : undefined;

    return (
      <TouchableOpacity
        style={cardStyle}
        onPress={onPress}
        disabled={!isStale}
        accessibilityLabel={accessibilityLabel}
        accessibilityHint={accessibilityHint}
        accessibilityRole="button"
        activeOpacity={isStale ? 0.7 : 1}
      >
        <View style={styles.deviceHeader}>
          <Text style={[statusIconStyle]} accessibilityElementsHidden>
            {getStatusIcon(item.syncStatus)}
          </Text>
          <View style={styles.deviceInfo}>
            <Text
              style={[
                styles.deviceType,
                { fontSize: bodySize, color: theme.colors.text },
                isInactive && { color: theme.colors.textSecondary },
              ]}
              allowFontScaling={true}
              maxFontSizeMultiplier={2}
            >
              {item.deviceType}
            </Text>
            <Text
              style={[
                styles.serialNumber,
                { fontSize: bodySize, color: theme.colors.textSecondary },
              ]}
              allowFontScaling={true}
              maxFontSizeMultiplier={2}
            >
              S/N: {item.serialNumber}
            </Text>
          </View>
          {isInactive && (
            <View
              style={[
                styles.inactiveBadge,
                {
                  backgroundColor: theme.colors.border,
                  borderRadius: theme.borderRadius.sm,
                },
              ]}
            >
              <Text
                style={[
                  styles.inactiveBadgeText,
                  { fontSize: bodySize, color: theme.colors.textSecondary },
                ]}
                allowFontScaling={true}
                maxFontSizeMultiplier={2}
              >
                Inactive
              </Text>
            </View>
          )}
        </View>

        <View style={styles.deviceDetails}>
          <Text
            style={[
              styles.detailText,
              { fontSize: bodySize, color: theme.colors.text },
              isInactive && { color: theme.colors.textSecondary },
            ]}
            allowFontScaling={true}
            maxFontSizeMultiplier={2}
          >
            Protocol: {formatProtocol(item.connectionProtocol)}
          </Text>
          <Text
            style={[
              styles.detailText,
              { fontSize: bodySize, color: theme.colors.text },
              isInactive && { color: theme.colors.textSecondary },
            ]}
            allowFontScaling={true}
            maxFontSizeMultiplier={2}
          >
            Last sync: {formatLastSync(item.lastSyncAt)}
          </Text>
        </View>

        {isStale && (
          <View
            style={[
              styles.staleWarning,
              {
                backgroundColor: theme.colors.statusBorderlineBg,
                borderRadius: theme.borderRadius.sm,
              },
            ]}
          >
            <Text
              style={[
                styles.staleWarningIcon,
                { fontSize: bodySize, color: theme.colors.warning },
              ]}
              accessibilityElementsHidden
            >
              ⚠
            </Text>
            <Text
              style={[
                styles.staleWarningText,
                { fontSize: bodySize, color: theme.colors.statusBorderlineText },
              ]}
              allowFontScaling={true}
              maxFontSizeMultiplier={2}
            >
              Device has not synced recently. Tap for troubleshooting.
            </Text>
          </View>
        )}
      </TouchableOpacity>
    );
  };

  if (isLoading && devices.length === 0) {
    return (
      <View
        style={[styles.centerContainer, { backgroundColor: theme.colors.background }]}
        accessibilityLabel="Loading device status"
      >
        <ActivityIndicator size="large" color={theme.colors.primary} />
        <Text style={[styles.loadingText, { fontSize: bodySize, color: theme.colors.text }]}>
          Loading devices...
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <Text
        style={[styles.heading, { fontSize: headingSize, color: theme.colors.text }]}
        accessibilityRole="header"
        allowFontScaling={true}
        maxFontSizeMultiplier={2}
      >
        Device Status
      </Text>

      {isOffline && (
        <View
          style={[
            styles.offlineBanner,
            {
              backgroundColor: theme.colors.statusBorderlineBg,
              borderRadius: theme.borderRadius.sm,
            },
          ]}
          accessibilityLabel="Offline - showing cached data"
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
        >
          <Text
            style={[
              styles.offlineBannerText,
              { fontSize: bodySize, color: theme.colors.statusBorderlineText },
            ]}
            allowFontScaling={true}
            maxFontSizeMultiplier={2}
          >
            Offline - showing cached data
          </Text>
        </View>
      )}

      {error && devices.length === 0 && (
        <View
          style={[styles.centerContainer, { backgroundColor: theme.colors.background }]}
          accessibilityLabel={error}
          accessibilityRole="alert"
        >
          <Text style={[styles.errorText, { fontSize: bodySize, color: theme.colors.error }]}>
            {error}
          </Text>
        </View>
      )}

      {!error && devices.length === 0 && !isLoading && (
        <View
          style={[styles.centerContainer, { backgroundColor: theme.colors.background }]}
          accessibilityLabel="No devices registered"
        >
          <Text style={[styles.emptyText, { fontSize: bodySize, color: theme.colors.textSecondary }]}>
            No devices registered.
          </Text>
        </View>
      )}

      {devices.length > 0 && (
        <FlatList
          data={devices}
          keyExtractor={(item) => item.deviceId}
          renderItem={renderDeviceItem}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              colors={[theme.colors.primary]}
              tintColor={theme.colors.primary}
            />
          }
          accessibilityLabel="Device list"
        />
      )}
    </View>
  );
}

// ---------- Styles ----------

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: 16,
  },
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  heading: {
    fontWeight: '700',
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  offlineBanner: {
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 12,
    alignItems: 'center',
  },
  offlineBannerText: {
    fontWeight: '600',
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  deviceCard: {
    padding: 16,
    marginBottom: 12,
  },
  deviceHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  statusIcon: {
    marginRight: 12,
    fontWeight: '700',
  },
  deviceInfo: {
    flex: 1,
  },
  deviceType: {
    fontWeight: '600',
  },
  serialNumber: {
    marginTop: 2,
  },
  inactiveBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  inactiveBadgeText: {
    fontWeight: '600',
  },
  deviceDetails: {
    marginLeft: 36,
    marginTop: 4,
  },
  detailText: {
    marginBottom: 4,
  },
  staleWarning: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
    padding: 10,
  },
  staleWarningIcon: {
    marginRight: 8,
  },
  staleWarningText: {
    flex: 1,
    fontWeight: '500',
  },
  loadingText: {
    marginTop: 12,
  },
  errorText: {
    textAlign: 'center',
    fontWeight: '500',
  },
  emptyText: {
    textAlign: 'center',
  },
});
