import React from 'react';
import { StyleSheet, Text, View, AccessibilityInfo } from 'react-native';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface OfflineBannerProps {
  /** Whether the device is currently offline */
  isOffline: boolean;
  /** Whether cached data is available to display */
  hasCachedData: boolean;
}

// ─── OfflineBanner Component ─────────────────────────────────────────────────

/**
 * Displays contextual offline messaging:
 * - "Offline - showing cached data" when offline with cached content available
 * - "Internet connection required" when offline with no cached data
 *
 * Hidden when online. Accessible to screen readers with live region announcements.
 *
 * Validates: Requirements 12.2, 12.6
 */
export function OfflineBanner({
  isOffline,
  hasCachedData,
}: OfflineBannerProps): React.ReactElement | null {
  if (!isOffline) {
    return null;
  }

  const message = hasCachedData
    ? 'Offline - showing cached data'
    : 'Internet connection required to load data';

  const bannerStyle = hasCachedData
    ? styles.cachedBanner
    : styles.noDataBanner;

  const textStyle = hasCachedData
    ? styles.cachedText
    : styles.noDataText;

  return (
    <View
      style={[styles.container, bannerStyle]}
      accessibilityRole="alert"
      accessibilityLabel={message}
      accessibilityLiveRegion="polite"
    >
      <Text
        style={[styles.text, textStyle]}
        allowFontScaling={true}
        maxFontSizeMultiplier={2}
      >
        {message}
      </Text>
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  cachedBanner: {
    backgroundColor: '#FFF3CD', // Amber/warning background
  },
  noDataBanner: {
    backgroundColor: '#F8D7DA', // Red/error background
  },
  text: {
    fontSize: 18, // Minimum 18sp per accessibility requirements
    fontWeight: '600',
    textAlign: 'center',
  },
  cachedText: {
    color: '#856404', // Dark amber text — contrast ratio > 4.5:1 on #FFF3CD
  },
  noDataText: {
    color: '#721C24', // Dark red text — contrast ratio > 4.5:1 on #F8D7DA
  },
});

export default OfflineBanner;
