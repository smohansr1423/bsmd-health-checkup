import type { LinkingOptions } from '@react-navigation/native';
import type { RootStackParamList } from './types';

/**
 * Deep linking configuration for push notification navigation.
 * Scheme: "healthcheckup" (as defined in app.config.ts).
 *
 * Examples:
 *   healthcheckup://dashboard
 *   healthcheckup://dashboard/trend/blood_pressure
 *   healthcheckup://dashboard/devices
 *   healthcheckup://appointments
 *   healthcheckup://reports
 *   healthcheckup://reports/detail/report-123
 *   healthcheckup://profile
 *   healthcheckup://profile/notifications
 */
export const linking: LinkingOptions<RootStackParamList> = {
  prefixes: ['healthcheckup://'],
  config: {
    screens: {
      Login: 'login',
      Main: {
        screens: {
          DashboardTab: {
            screens: {
              Dashboard: 'dashboard',
              TrendChart: 'dashboard/trend/:readingType',
              DeviceStatus: 'dashboard/devices',
            },
          },
          AppointmentsTab: 'appointments',
          ReportsTab: {
            screens: {
              ReportList: 'reports',
              ReportDetail: 'reports/detail/:reportId',
            },
          },
          ProfileTab: {
            screens: {
              Profile: 'profile',
              NotificationSettings: 'profile/notifications',
            },
          },
        },
      },
    },
  },
};
