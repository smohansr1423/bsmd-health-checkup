import type { NavigatorScreenParams } from '@react-navigation/native';

/**
 * Root stack parameter list — auth gate (login vs main app).
 */
export type RootStackParamList = {
  Login: undefined;
  Main: NavigatorScreenParams<MainTabParamList>;
};

/**
 * Main bottom tab parameter list.
 */
export type MainTabParamList = {
  DashboardTab: NavigatorScreenParams<DashboardStackParamList>;
  AppointmentsTab: undefined;
  ReportsTab: NavigatorScreenParams<ReportsStackParamList>;
  ProfileTab: NavigatorScreenParams<ProfileStackParamList>;
};

/**
 * Dashboard stack — nested screens accessible from the Dashboard tab.
 */
export type DashboardStackParamList = {
  Dashboard: undefined;
  TrendChart: { readingType: string };
  DeviceStatus: undefined;
};

/**
 * Reports stack — nested screens accessible from the Reports tab.
 */
export type ReportsStackParamList = {
  ReportList: undefined;
  ReportDetail: { reportId: string };
};

/**
 * Profile stack — nested screens accessible from the Profile tab.
 */
export type ProfileStackParamList = {
  Profile: undefined;
  NotificationSettings: undefined;
};

declare global {
  namespace ReactNavigation {
    interface RootParamList extends RootStackParamList {}
  }
}
