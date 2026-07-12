import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { LoginScreen } from '../screens/auth/LoginScreen';
import { TabNavigator } from './TabNavigator';
import { linking } from './linking';
import type { RootStackParamList } from './types';

const Stack = createNativeStackNavigator<RootStackParamList>();

/**
 * Root navigator with auth gate.
 * - Unauthenticated users see the Login screen.
 * - Authenticated users see the Main tab navigator.
 *
 * The `isAuthenticated` prop controls which screens are rendered in the stack.
 * This follows the "auth gate" pattern recommended by React Navigation docs.
 */
export interface RootStackNavigatorProps {
  isAuthenticated: boolean;
}

export function RootStackNavigator({ isAuthenticated }: RootStackNavigatorProps) {
  return (
    <NavigationContainer linking={linking}>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {isAuthenticated ? (
          <Stack.Screen name="Main" component={TabNavigator} />
        ) : (
          <Stack.Screen
            name="Login"
            component={LoginScreen}
            options={{ animationTypeForReplace: 'pop' }}
          />
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
