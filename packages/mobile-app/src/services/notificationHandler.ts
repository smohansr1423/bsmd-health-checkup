import * as Notifications from 'expo-notifications';
import { Alert, Linking, Platform } from 'react-native';

import { apiClient } from '../api/client';

// ---------- Types ----------

export interface PushNotification {
  alertId: string;
  severity: 'critical' | 'warning';
  readingType: string;
  measuredValue: number;
  threshold: number;
  message: string;
}

export interface NotificationHandler {
  registerPushToken(userId: string): Promise<void>;
  handleForegroundNotification(notification: PushNotification): void;
  handleNotificationTap(notification: PushNotification): void;
  requestPermissions(): Promise<'granted' | 'denied'>;
}

// ---------- Constants ----------

const DEEP_LINK_SCHEME = 'healthcheckup://dashboard';

// ---------- Permission Denied Banner ----------

/**
 * Displays an in-app banner (Alert) explaining the importance of notifications
 * when the user has denied permission.
 */
function showPermissionDeniedBanner(): void {
  Alert.alert(
    'Notifications Disabled',
    'Push notifications are important for receiving critical health alerts. ' +
      'Without notifications enabled, you may miss urgent alerts about abnormal health readings. ' +
      'You can enable notifications in your device settings.',
    [
      { text: 'Dismiss', style: 'cancel' },
      {
        text: 'Open Settings',
        onPress: () => {
          if (Platform.OS === 'ios') {
            Linking.openURL('app-settings:');
          } else {
            Linking.openSettings();
          }
        },
      },
    ],
  );
}

// ---------- Implementation ----------

function createNotificationHandler(): NotificationHandler {
  const handler: NotificationHandler = {
    async registerPushToken(userId: string): Promise<void> {
      const token = await Notifications.getExpoPushTokenAsync();

      await apiClient.post('/notifications/push-token', {
        userId,
        token: token.data,
        platform: Platform.OS,
      });
    },

    handleForegroundNotification(notification: PushNotification): void {
      const severityLabel =
        notification.severity === 'critical' ? '🚨 CRITICAL' : '⚠️ Warning';

      Alert.alert(
        `${severityLabel} Health Alert`,
        `${notification.readingType}: ${notification.measuredValue} (threshold: ${notification.threshold})\n\n${notification.message}`,
        [
          { text: 'Dismiss', style: 'cancel' },
          {
            text: 'View Dashboard',
            onPress: () => {
              handler.handleNotificationTap(notification);
            },
          },
        ],
      );
    },

    handleNotificationTap(notification: PushNotification): void {
      const url = `${DEEP_LINK_SCHEME}?highlight=${encodeURIComponent(notification.readingType)}&alertId=${encodeURIComponent(notification.alertId)}`;
      Linking.openURL(url);
    },

    async requestPermissions(): Promise<'granted' | 'denied'> {
      const { status: existingStatus } =
        await Notifications.getPermissionsAsync();

      if (existingStatus === 'granted') {
        return 'granted';
      }

      const { status } = await Notifications.requestPermissionsAsync();

      if (status === 'granted') {
        return 'granted';
      }

      showPermissionDeniedBanner();
      return 'denied';
    },
  };

  return handler;
}

// ---------- Foreground Notification Behavior ----------

/**
 * Configure how notifications are presented when the app is in the foreground.
 * Shows alert + sound for critical notifications.
 */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

// ---------- Singleton Export ----------

export const notificationHandler: NotificationHandler =
  createNotificationHandler();
