import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { ReportListScreen } from '../screens/reports/ReportListScreen';
import { ReportDetailScreen } from '../screens/reports/ReportDetailScreen';
import type { ReportsStackParamList } from './types';

const Stack = createNativeStackNavigator<ReportsStackParamList>();

export function ReportsStackNavigator() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerTitleStyle: {
          fontSize: 20,
        },
      }}
    >
      <Stack.Screen
        name="ReportList"
        component={ReportListScreen}
        options={{ title: 'Health Reports' }}
      />
      <Stack.Screen
        name="ReportDetail"
        component={ReportDetailScreen}
        options={{ title: 'Report Details' }}
      />
    </Stack.Navigator>
  );
}
