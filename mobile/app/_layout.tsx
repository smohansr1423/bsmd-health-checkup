import { Tabs } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';

const COLORS = {
  bg: '#0f172a',
  card: '#1e293b',
  active: '#38bdf8',
  inactive: '#64748b',
  text: '#f8fafc',
};

export default function RootLayout() {
  return (
    <>
      <StatusBar style="light" />
      <Tabs
        screenOptions={{
          headerStyle: { backgroundColor: COLORS.bg },
          headerTintColor: COLORS.text,
          headerTitleStyle: { fontWeight: '600' },
          tabBarStyle: {
            backgroundColor: COLORS.card,
            borderTopColor: '#334155',
          },
          tabBarActiveTintColor: COLORS.active,
          tabBarInactiveTintColor: COLORS.inactive,
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: 'Health Checkup',
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="heart" size={size} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="cortisol"
          options={{
            title: 'Calorie & Cortisol',
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="flame" size={size} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="copilot"
          options={{
            title: 'API Copilot',
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="sparkles" size={size} color={color} />
            ),
          }}
        />
      </Tabs>
    </>
  );
}
