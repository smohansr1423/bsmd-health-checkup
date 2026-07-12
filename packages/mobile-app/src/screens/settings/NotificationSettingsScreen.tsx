/**
 * NotificationSettingsScreen — Allows the user to manage notification preferences.
 * Fetches current preferences from GET /notifications/preferences and
 * saves changes via PUT /notifications/preferences.
 *
 * Accessibility: 48x48dp toggle targets, descriptive labels for screen readers.
 *
 * Requirements: 5.5, 10.1, 10.4
 */
import React, { useCallback, useEffect } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';

import { useAccessibility } from '../../hooks/useAccessibility';
import { useNotificationSettingsStore } from '../../stores/notificationSettingsStore';

// ---------- Component ----------

export function NotificationSettingsScreen() {
  const { theme, getTextSize, minTouchTarget, announce } = useAccessibility();

  const {
    preferences,
    isLoading,
    isSaving,
    error,
    saveSuccess,
    fetchPreferences,
    updatePreferences,
    clearStatus,
  } = useNotificationSettingsStore();

  // Fetch preferences on mount
  useEffect(() => {
    fetchPreferences();
  }, [fetchPreferences]);

  // Announce save success to screen readers
  useEffect(() => {
    if (saveSuccess) {
      announce('Notification preferences saved successfully', 'polite');
      const timeout = setTimeout(() => clearStatus(), 3000);
      return () => clearTimeout(timeout);
    }
  }, [saveSuccess, announce, clearStatus]);

  // Announce errors to screen readers
  useEffect(() => {
    if (error) {
      announce(`Error: ${error}`, 'assertive');
    }
  }, [error, announce]);

  const handleCriticalToggle = useCallback(
    (value: boolean) => {
      updatePreferences({ criticalEnabled: value });
    },
    [updatePreferences],
  );

  const handleWarningToggle = useCallback(
    (value: boolean) => {
      updatePreferences({ warningEnabled: value });
    },
    [updatePreferences],
  );

  // Dynamic styles based on theme and accessibility settings
  const dynamicStyles = {
    container: {
      backgroundColor: theme.colors.background,
    },
    heading: {
      fontSize: getTextSize('heading'),
      color: theme.colors.text,
    },
    body: {
      fontSize: getTextSize('body'),
      color: theme.colors.text,
    },
    secondaryText: {
      fontSize: getTextSize('body'),
      color: theme.colors.textSecondary,
    },
    errorText: {
      fontSize: getTextSize('body'),
      color: theme.colors.error,
    },
    successText: {
      fontSize: getTextSize('body'),
      color: theme.colors.success,
    },
    card: {
      backgroundColor: theme.colors.surface,
      borderColor: theme.colors.border,
      borderWidth: theme.borderWidth.thin,
      borderRadius: theme.borderRadius.md,
    },
    toggleRow: {
      minHeight: minTouchTarget.height,
    },
  };

  // Loading state
  if (isLoading && !preferences) {
    return (
      <View
        style={[styles.loadingContainer, dynamicStyles.container]}
        accessibilityRole="none"
        accessibilityLabel="Loading notification preferences"
      >
        <ActivityIndicator
          size="large"
          color={theme.colors.primary}
          accessibilityLabel="Loading"
        />
        <Text style={[styles.loadingText, dynamicStyles.body]}>
          Loading preferences…
        </Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={[styles.scrollView, dynamicStyles.container]}
      contentContainerStyle={styles.contentContainer}
      accessibilityRole="none"
      accessibilityLabel="Notification settings"
    >
      {/* Screen heading */}
      <Text
        style={[styles.screenHeading, dynamicStyles.heading]}
        accessibilityRole="header"
      >
        Notification Settings
      </Text>

      <Text style={[styles.description, dynamicStyles.secondaryText]}>
        Choose which health alert notifications you want to receive on this device.
      </Text>

      {/* Error message */}
      {error && (
        <View
          style={styles.statusBanner}
          accessibilityRole="alert"
          accessibilityLiveRegion="assertive"
        >
          <Text style={dynamicStyles.errorText}>{error}</Text>
        </View>
      )}

      {/* Success message */}
      {saveSuccess && (
        <View
          style={styles.statusBanner}
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
        >
          <Text style={dynamicStyles.successText}>
            Preferences saved successfully.
          </Text>
        </View>
      )}

      {/* Toggle cards */}
      <View style={[styles.card, dynamicStyles.card]}>
        {/* Critical notifications toggle */}
        <View
          style={[styles.toggleRow, dynamicStyles.toggleRow]}
          accessibilityRole="none"
        >
          <View style={styles.toggleLabelContainer}>
            <Text
              style={[styles.toggleLabel, dynamicStyles.body]}
              nativeID="critical-label"
            >
              Critical Alerts
            </Text>
            <Text style={[styles.toggleDescription, dynamicStyles.secondaryText]}>
              Receive notifications for critically abnormal health readings that
              require immediate attention.
            </Text>
          </View>
          <View style={styles.switchContainer}>
            <Switch
              value={preferences?.criticalEnabled ?? false}
              onValueChange={handleCriticalToggle}
              disabled={isSaving}
              trackColor={{
                false: theme.colors.border,
                true: theme.colors.error,
              }}
              thumbColor={
                preferences?.criticalEnabled
                  ? theme.colors.background
                  : theme.colors.textSecondary
              }
              style={styles.switch}
              accessibilityLabel="Critical alerts notifications"
              accessibilityHint="Double tap to toggle critical health alert notifications"
              accessibilityRole="switch"
              accessibilityState={{
                checked: preferences?.criticalEnabled ?? false,
                disabled: isSaving,
              }}
              accessibilityLabelledBy="critical-label"
            />
          </View>
        </View>

        {/* Divider */}
        <View
          style={[
            styles.divider,
            { backgroundColor: theme.colors.border },
          ]}
        />

        {/* Warning notifications toggle */}
        <View
          style={[styles.toggleRow, dynamicStyles.toggleRow]}
          accessibilityRole="none"
        >
          <View style={styles.toggleLabelContainer}>
            <Text
              style={[styles.toggleLabel, dynamicStyles.body]}
              nativeID="warning-label"
            >
              Warning Alerts
            </Text>
            <Text style={[styles.toggleDescription, dynamicStyles.secondaryText]}>
              Receive notifications for borderline health readings that may need
              monitoring.
            </Text>
          </View>
          <View style={styles.switchContainer}>
            <Switch
              value={preferences?.warningEnabled ?? false}
              onValueChange={handleWarningToggle}
              disabled={isSaving}
              trackColor={{
                false: theme.colors.border,
                true: theme.colors.warning,
              }}
              thumbColor={
                preferences?.warningEnabled
                  ? theme.colors.background
                  : theme.colors.textSecondary
              }
              style={styles.switch}
              accessibilityLabel="Warning alerts notifications"
              accessibilityHint="Double tap to toggle warning health alert notifications"
              accessibilityRole="switch"
              accessibilityState={{
                checked: preferences?.warningEnabled ?? false,
                disabled: isSaving,
              }}
              accessibilityLabelledBy="warning-label"
            />
          </View>
        </View>
      </View>

      {/* Permission status info */}
      {preferences?.permissionStatus === 'denied' && (
        <View
          style={[styles.infoCard, dynamicStyles.card]}
          accessibilityRole="alert"
        >
          <Text style={[styles.infoTitle, dynamicStyles.body]}>
            Notifications Disabled
          </Text>
          <Text style={[styles.infoDescription, dynamicStyles.secondaryText]}>
            Push notifications are disabled at the system level. To receive health
            alerts, please enable notifications in your device settings.
          </Text>
        </View>
      )}

      {/* Saving indicator */}
      {isSaving && (
        <View style={styles.savingContainer} accessibilityLabel="Saving preferences">
          <ActivityIndicator size="small" color={theme.colors.primary} />
          <Text style={[styles.savingText, dynamicStyles.secondaryText]}>
            Saving…
          </Text>
        </View>
      )}
    </ScrollView>
  );
}

// ---------- Styles ----------

const styles = StyleSheet.create({
  scrollView: {
    flex: 1,
  },
  contentContainer: {
    padding: 24,
    paddingBottom: 48,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  loadingText: {
    marginTop: 16,
  },
  screenHeading: {
    fontWeight: '700',
    marginBottom: 8,
  },
  description: {
    marginBottom: 24,
    lineHeight: 26,
  },
  statusBanner: {
    marginBottom: 16,
    padding: 12,
  },
  card: {
    padding: 16,
    marginBottom: 24,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
  },
  toggleLabelContainer: {
    flex: 1,
    marginRight: 16,
  },
  toggleLabel: {
    fontWeight: '600',
    marginBottom: 4,
  },
  toggleDescription: {
    lineHeight: 22,
  },
  switchContainer: {
    minWidth: 48,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  switch: {
    // Ensure the switch touch target is at least 48x48dp
    transform: [{ scaleX: 1.2 }, { scaleY: 1.2 }],
  },
  divider: {
    height: 1,
    marginVertical: 4,
  },
  infoCard: {
    padding: 16,
    marginBottom: 24,
  },
  infoTitle: {
    fontWeight: '600',
    marginBottom: 8,
  },
  infoDescription: {
    lineHeight: 22,
  },
  savingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  savingText: {
    marginLeft: 8,
  },
});
