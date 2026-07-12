import React from 'react';
import { StyleSheet } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { DashboardStackNavigator } from './DashboardStackNavigator';
import { ReportsStackNavigator } from './ReportsStackNavigator';
import { ProfileStackNavigator } from './ProfileStackNavigator';
import { AppointmentScreen } from '../screens/appointments/AppointmentScreen';
import type { MainTabParamList } from './types';

const Tab = createBottomTabNavigator<MainTabParamList>();

/**
 * Minimum touch target size: 48x48dp (accessibility requirement 10.1).
 * Minimum label font size: 18sp (accessibility requirement 10.2).
 */
const MIN_TOUCH_TARGET = 48;
const TAB_LABEL_FONT_SIZE = 18;

export function TabNavigator() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: styles.tabBar,
        tabBarLabelStyle: styles.tabBarLabel,
        tabBarItemStyle: styles.tabBarItem,
        tabBarAccessibilityLabel: undefined,
        tabBarHideOnKeyboard: true,
      }}
    >
      <Tab.Screen
        name="DashboardTab"
        component={DashboardStackNavigator}
        options={{
          tabBarLabel: 'Dashboard',
          tabBarAccessibilityLabel: 'Dashboard tab - view your health readings',
        }}
      />
      <Tab.Screen
        name="AppointmentsTab"
        component={AppointmentScreen}
        options={{
          headerShown: true,
          headerTitle: 'Appointments',
          tabBarLabel: 'Appointments',
          tabBarAccessibilityLabel: 'Appointments tab - view your scheduled appointments',
        }}
      />
      <Tab.Screen
        name="ReportsTab"
        component={ReportsStackNavigator}
        options={{
          tabBarLabel: 'Reports',
          tabBarAccessibilityLabel: 'Reports tab - view your health reports',
        }}
      />
      <Tab.Screen
        name="ProfileTab"
        component={ProfileStackNavigator}
        options={{
          tabBarLabel: 'Profile',
          tabBarAccessibilityLabel: 'Profile tab - manage your profile and settings',
        }}
      />
    </Tab.Navigator>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    height: 64,
    paddingBottom: 8,
    paddingTop: 4,
  },
  tabBarLabel: {
    fontSize: TAB_LABEL_FONT_SIZE,
    fontWeight: '500',
  },
  tabBarItem: {
    minWidth: MIN_TOUCH_TARGET,
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
