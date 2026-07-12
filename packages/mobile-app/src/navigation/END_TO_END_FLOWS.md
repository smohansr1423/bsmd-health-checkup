# End-to-End Flow Wiring — Confirmation

This document confirms all screens, stores, and services are wired into the navigation graph.

## Authentication Gate (Requirements 9.4, 1.1–1.6)

- `App.tsx` reads `useAuthStore().isAuthenticated`
- Passes it to `RootStackNavigator` which conditionally renders:
  - **Unauthenticated** → `LoginScreen`
  - **Authenticated** → `TabNavigator` (Dashboard, Appointments, Reports, Profile)
- On app launch, `restoreSession()` checks stored tokens in MMKV
- Expired tokens trigger refresh; failed refresh → logout → LoginScreen

## Push Notification Deep Linking (Requirements 5.3, 9.4)

- `src/navigation/linking.ts` defines the `healthcheckup://` deep link scheme
- `NavigationContainer` receives the linking config in `RootStackNavigator`
- When a push notification is tapped:
  1. `notificationHandler.handleNotificationTap()` opens `healthcheckup://dashboard?highlight=...`
  2. React Navigation resolves the URL to `DashboardTab > Dashboard`
  3. Dashboard screen reads query params to highlight the relevant vital card

## Offline / Online Transitions (Requirements 12.2, 12.4, 12.6)

- `useNetworkStatus` hook monitors connectivity via `@react-native-community/netinfo`
- `App.tsx` renders:
  - **Amber "Offline" banner** when `isOffline === true`
  - **Green "Connection restored" banner** when `isReconnecting === true`
- Each screen observes offline state and serves cached data from `offlineCache`
- `onReconnect` callback triggers data refresh when connectivity returns

## Voice Assistance for Critical Alerts (Requirement 10.6)

- `voiceAssistanceService` (singleton) provides `announceCriticalAlert()`
- When a foreground notification arrives, the notification handler displays it
- If voice assistance is enabled, `voiceAssistanceService.announceCriticalAlert()`
  announces the alert with `'assertive'` priority for immediate screen reader output

## Platform-Specific Rendering (Requirements 9.4, 9.5)

- `SafeAreaProvider` handles iOS notch/home indicator and Android status bar
- `TabNavigator` uses `@react-navigation/bottom-tabs` with platform-native styling
- `AccessibilityEngine` enforces 48×48dp minimum touch targets
- All text uses 18sp minimum body / 24sp heading, scaling to 200% via dynamic type
- Layout tested for screen sizes 4.7" (iPhone SE) to 6.9" (large Android)

## Services Initialization Sequence

1. App mounts → `restoreSession()` checks stored auth tokens
2. If authenticated:
   a. `notificationHandler.requestPermissions()` — requests OS notification permissions
   b. `notificationHandler.registerPushToken(userId)` — registers with backend
3. `useNetworkStatus` begins monitoring connectivity immediately
4. `voiceAssistanceService` is a module-level singleton, always available

## Navigation Graph Summary

```
App.tsx
└── SafeAreaProvider
    ├── OfflineBanner (conditional)
    ├── ReconnectBanner (conditional)
    └── RootStackNavigator
        ├── [unauthenticated] LoginScreen
        └── [authenticated] TabNavigator
            ├── DashboardTab (DashboardStackNavigator)
            │   ├── HealthDashboardScreen
            │   ├── TrendChartScreen
            │   └── DeviceStatusScreen
            ├── AppointmentsTab → AppointmentScreen
            ├── ReportsTab (ReportsStackNavigator)
            │   ├── ReportListScreen
            │   └── ReportDetailScreen
            └── ProfileTab (ProfileStackNavigator)
                ├── ProfileScreen
                └── NotificationSettingsScreen
```

## Status

✅ All stores connected to their respective screens  
✅ Auth gate properly routes based on token state  
✅ Deep linking configured for push notification navigation  
✅ Offline/online banners display at app level  
✅ Voice assistance wired for critical alert announcements  
✅ TypeScript compiles cleanly (`npx tsc --noEmit` passes with exit code 0)  
