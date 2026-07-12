import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { HealthDashboardScreen } from '../screens/dashboard/HealthDashboardScreen';
import { TrendChartScreen } from '../screens/trends/TrendChartScreen';
import { DeviceStatusScreen } from '../screens/devices/DeviceStatusScreen';
import type { DashboardStackParamList } from './types';

const Stack = createNativeStackNavigator<DashboardStackParamList>();

export function DashboardStackNavigator() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerTitleStyle: {
          fontSize: 20,
        },
      }}
    >
      <Stack.Screen
        name="Dashboard"
        component={HealthDashboardScreen}
        options={{ title: 'Health Dashboard' }}
      />
      <Stack.Screen
        name="TrendChart"
        component={TrendChartScreen}
        options={{ title: 'Trend Chart' }}
      />
      <Stack.Screen
        name="DeviceStatus"
        component={DeviceStatusScreen}
        options={{ title: 'Device Status' }}
      />
    </Stack.Navigator>
  );
}
