# Implementation Plan: Mobile Health App

## Overview

This plan implements a React Native / Expo cross-platform mobile application for senior citizen health monitoring. The app connects to the existing backend API and provides health readings dashboard, device sync status, trend charts, push notifications, appointments, reports, profile management, offline caching, and accessibility features for elderly users. Implementation uses TypeScript throughout and leverages the existing `@health-checkup/shared` package.

## Tasks

- [x] 1. Set up Expo project structure and core configuration
  - [x] 1.1 Initialize Expo managed workflow project with TypeScript template
    - Create the mobile app package at `packages/mobile-app` using `npx create-expo-app`
    - Configure `app.json` / `app.config.ts` with app name, bundle identifiers, minimum iOS 15.0 and Android API 26
    - Add workspace dependency on `@health-checkup/shared` in `package.json`
    - Configure `tsconfig.json` to reference shared types
    - Install core dependencies: react-navigation, zustand, axios, async-storage, react-native-mmkv, expo-notifications, react-native-chart-kit
    - _Requirements: 9.1, 9.2, 9.3_

  - [x] 1.2 Configure React Navigation with bottom tab and stack navigators
    - Create `navigation/TabNavigator.tsx` with bottom tabs: Dashboard, Appointments, Reports, Profile
    - Create `navigation/RootStackNavigator.tsx` with auth gate (login vs main app)
    - Create stack navigators for nested screens (TrendChart, ReportDetail, DeviceStatus, NotificationSettings)
    - Configure deep linking scheme for push notification navigation
    - Ensure tab bar uses 48x48dp touch targets and 18sp labels
    - _Requirements: 9.4, 10.1, 10.2_

  - [x] 1.3 Set up accessibility engine and theme configuration
    - Create `utils/accessibility.ts` implementing the `AccessibilityEngine` interface
    - Enforce minimum touch target of 48x48dp, body text 18sp, heading 24sp
    - Create default theme and high-contrast theme with WCAG 2.1 AA compliant color tokens
    - Implement `getScaleFactor()` supporting dynamic text scaling up to 200%
    - Create `hooks/useAccessibility.ts` hook for consuming accessibility settings
    - _Requirements: 10.1, 10.2, 10.3, 10.5, 10.7_

- [x] 2. Implement API client and authentication
  - [x] 2.1 Create API client with Axios interceptors
    - Create `api/client.ts` implementing the `APIClient` interface
    - Configure base URL to `https://bsmd-health-checkup-production.up.railway.app`
    - Set 15-second request timeout
    - Add request interceptor to attach JWT Bearer token from auth store
    - Add request interceptor to set Content-Type, Accept, and X-Client-Platform headers
    - Add response interceptor to handle 401 with token refresh and single retry
    - Add network connectivity detection to queue requests and serve cached data when offline
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7_

  - [x] 2.2 Implement auth store with secure token storage
    - Create `stores/authStore.ts` implementing `AuthState` interface using Zustand
    - Implement `login()` calling POST `/auth/login`, storing tokens in MMKV encrypted storage
    - Implement `logout()` clearing tokens from MMKV, clearing offline cache, navigating to login
    - Implement `refreshAccessToken()` calling POST `/auth/refresh` with stored refresh token
    - Implement `restoreSession()` to check stored token validity on app launch
    - Handle expired refresh token by clearing tokens and redirecting to login
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6_

  - [x] 2.3 Create LoginScreen with form and error handling
    - Create `screens/auth/LoginScreen.tsx` with email and password fields
    - Apply accessibility: 48x48dp submit button, 18sp input labels, screen reader labels
    - Display validation errors and backend auth errors with accessible announcements
    - On success, navigate to main tab navigator
    - _Requirements: 1.1, 10.1, 10.2, 10.4_

  - [ ]* 2.4 Write unit tests for auth store and API client
    - Test login flow stores tokens correctly
    - Test 401 interceptor triggers token refresh and retries
    - Test failed refresh triggers logout
    - Test restoreSession with valid/expired tokens
    - Test request timeout handling
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 11.3, 11.4, 11.5_

- [x] 3. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Implement offline cache layer
  - [x] 4.1 Create offline cache module with AsyncStorage
    - Create `cache/offlineCache.ts` implementing the `OfflineCache` interface
    - Implement `get()` and `set()` with typed cache keys (readings, devices, appointments, profile, reports)
    - Implement TTL logic: entries expire after 7 days (`cachedAt + 7 days`)
    - Implement `isExpired()` check and `purgeStale()` to remove entries older than max age
    - Implement `clear()` for logout cleanup
    - _Requirements: 12.1, 12.3, 12.5_

  - [x] 4.2 Integrate offline detection and cached data serving
    - Create `hooks/useNetworkStatus.ts` using `@react-native-community/netinfo`
    - Update API client to detect offline state and serve from cache
    - Display "Offline - showing cached data" indicator when serving cached content
    - Auto-refresh data when connectivity is restored
    - Show "internet connection required" message when offline with no cached data
    - _Requirements: 12.2, 12.4, 12.6_

  - [ ]* 4.3 Write unit tests for offline cache
    - Test cache set/get roundtrip
    - Test TTL expiration logic
    - Test purgeStale removes old entries but keeps fresh ones
    - Test clear removes all entries
    - _Requirements: 12.1, 12.3, 12.5_

- [x] 5. Implement health readings dashboard
  - [x] 5.1 Create health readings Zustand store
    - Create `stores/healthReadingsStore.ts` implementing `HealthReadingsState` interface
    - Implement `fetchDailyRecord()` calling GET `/device-readings/seniors/:seniorId/daily/:date`
    - On successful fetch, persist to offline cache
    - Implement `refreshFromCache()` to load cached readings when offline
    - Track `isLoading`, `isOffline`, and `lastFetchedAt` state
    - _Requirements: 2.1, 12.1, 12.2_

  - [x] 5.2 Create VitalSignCard component
    - Create `components/VitalSignCard.tsx` displaying reading value, unit, timestamp, trend indicator, and status color
    - Apply color-coded backgrounds: green (normal), amber (borderline), red (critical)
    - Format blood pressure as "systolic/diastolic mmHg" when reading type is blood_pressure
    - Add accessibility labels describing the reading value, trend, and status for screen readers
    - Ensure touch target of 48x48dp and text minimum 18sp
    - _Requirements: 2.2, 2.3, 10.1, 10.2, 10.4_

  - [x] 5.3 Create HealthDashboardScreen with pull-to-refresh
    - Create `screens/dashboard/HealthDashboardScreen.tsx` rendering a list of VitalSignCards
    - Implement pull-to-refresh gesture to re-fetch daily record from API
    - Display "No readings available for today" when API returns empty readings
    - Display offline indicator banner when serving cached data
    - Each card is tappable, navigating to TrendChartScreen for that reading type
    - _Requirements: 2.1, 2.4, 2.5, 4.1, 12.2_

  - [ ]* 5.4 Write unit tests for health readings store and VitalSignCard
    - Test fetchDailyRecord updates state correctly
    - Test VitalSignCard renders correct colors for normal/borderline/critical
    - Test blood pressure formatting
    - Test empty readings state message
    - _Requirements: 2.1, 2.2, 2.3, 2.5_

- [x] 6. Implement device status and trend charts
  - [x] 6.1 Create device status store and DeviceStatusPanel
    - Create `stores/deviceStore.ts` with state for device list fetched from GET `/device-readings/devices/senior/:seniorId`
    - Create `screens/devices/DeviceStatusScreen.tsx` displaying each device's type, serial number, protocol, status, and last sync time
    - Apply stale device visual warning (amber icon + descriptive text) for "stale" status
    - Grey out inactive devices with "Inactive" label
    - On tap of stale device, show troubleshooting message about checking connection and battery
    - Cache device data to offline cache
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 12.3_

  - [x] 6.2 Create TrendChartScreen with period selection
    - Create `stores/trendStore.ts` to fetch trend data from GET `/device-readings/seniors/:seniorId/trends/:readingType`
    - Create `screens/trends/TrendChartScreen.tsx` with react-native-chart-kit line chart
    - Implement period selector buttons: 24h, 7d, 30d
    - On period change, fetch new trend data and re-render chart
    - Display statistics summary (mean, min, max, count) below chart
    - Apply color-coded reference bands (green/amber/red) for threshold zones
    - Show "Insufficient data" message when fewer than 2 data points exist
    - Add accessible chart description for screen readers
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 10.4_

  - [ ]* 6.3 Write unit tests for device status and trend chart logic
    - Test stale device detection and warning display
    - Test inactive device rendering
    - Test trend statistics calculation display
    - Test insufficient data message for < 2 data points
    - _Requirements: 3.2, 3.3, 4.4, 4.6_

- [x] 7. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Implement push notifications
  - [x] 8.1 Create notification handler with expo-notifications
    - Create `services/notificationHandler.ts` implementing `NotificationHandler` interface
    - Implement `registerPushToken()` calling POST `/notifications/push-token` after login
    - Implement `requestPermissions()` to request OS notification permissions on first login
    - Implement `handleForegroundNotification()` to display in-app alert with severity, reading type, value, and threshold
    - Implement `handleNotificationTap()` to deep-link to HealthDashboardScreen with highlighted card
    - If permissions denied, display in-app banner explaining importance of notifications
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

  - [x] 8.2 Create notification settings screen
    - Create `screens/settings/NotificationSettingsScreen.tsx`
    - Fetch current notification preferences from GET `/notifications/preferences`
    - Allow toggling critical and warning notification levels
    - Save preferences via PUT `/notifications/preferences`
    - Apply accessibility: 48x48dp toggles, descriptive labels for screen readers
    - _Requirements: 5.5, 10.1, 10.4_

  - [ ]* 8.3 Write unit tests for notification handler
    - Test push token registration on login
    - Test foreground notification display
    - Test notification tap navigation
    - Test permission denial handling
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

- [x] 9. Implement appointments and reports screens
  - [x] 9.1 Create appointment store and AppointmentScreen
    - Create `stores/appointmentStore.ts` fetching from GET `/scheduling/seniors/:seniorId/appointments`
    - Create `screens/appointments/AppointmentScreen.tsx` displaying appointments sorted by date ascending
    - Show date/time, physician name, package name, status for each appointment
    - Implement visual timeline separating upcoming from past appointments
    - On tap, display full details: location, preparation instructions, associated tests
    - Show "No scheduled appointments" message with prompt to contact provider when empty
    - Cache appointments to offline cache
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 12.3_

  - [x] 9.2 Create report store and ReportScreen
    - Create `stores/reportStore.ts` fetching from GET `/reports/seniors/:seniorId`
    - Create `screens/reports/ReportListScreen.tsx` displaying reports sorted by date descending
    - Show report date, package name, overall status, and follow-up action count
    - Create `screens/reports/ReportDetailScreen.tsx` showing test results, physician notes, follow-up actions
    - Color-code follow-up actions: pending (amber), in-progress (blue), completed (green)
    - Display due dates and highlight overdue actions with red indicator
    - Cache reports to offline cache
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 12.3_

  - [ ]* 9.3 Write unit tests for appointment and report screens
    - Test appointments sorted ascending by date
    - Test reports sorted descending by date
    - Test follow-up action color coding
    - Test overdue action highlighting
    - Test empty states
    - _Requirements: 6.1, 6.5, 7.1, 7.4, 7.5_

- [x] 10. Implement profile management
  - [x] 10.1 Create profile store and ProfileScreen
    - Create `stores/profileStore.ts` fetching from GET `/registration/seniors/:seniorId`
    - Create `screens/profile/ProfileScreen.tsx` displaying name, DOB, contact, emergency contact, medical history
    - Display assigned physician, next appointment, and current checkup package
    - Implement editable fields: contact number, email, emergency contact, address
    - On submit, send PUT `/registration/seniors/:seniorId` and display success confirmation
    - Display field-level validation errors from backend response
    - Cache profile to offline cache
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 12.3_

  - [ ]* 10.2 Write unit tests for profile store and screen
    - Test profile fetch and display
    - Test successful profile update
    - Test validation error display
    - Test offline cache persistence
    - _Requirements: 8.1, 8.2, 8.3_

- [x] 11. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 12. Implement accessibility features and voice assistance
  - [x] 12.1 Add screen reader labels and dynamic text scaling to all screens
    - Audit all screens and add `accessibilityLabel`, `accessibilityHint`, `accessibilityRole` to interactive elements
    - Ensure all VitalSignCards announce reading value, trend, and status
    - Verify dynamic text scaling to 200% does not truncate critical health values
    - Test with iOS VoiceOver and Android TalkBack compatibility
    - _Requirements: 10.4, 10.5_

  - [x] 12.2 Implement voice assistance mode
    - Create `services/voiceAssistance.ts` using accessibility announcements
    - When voice assistance is enabled, announce critical alert notifications audibly
    - Announce reading value changes on the Health Dashboard when data refreshes
    - Use `assertive` priority for critical alerts and `polite` for informational updates
    - _Requirements: 10.6_

  - [x] 12.3 Implement high-contrast theme
    - Create high-contrast theme variant: black background, white text, increased border widths
    - Add theme toggle in settings/profile
    - Ensure all color-coded elements (vital sign cards, follow-up statuses) remain distinguishable in high-contrast mode
    - _Requirements: 10.7, 10.3_

  - [ ]* 12.4 Write unit tests for accessibility features
    - Test minimum touch target enforcement
    - Test text size minimum enforcement
    - Test high-contrast theme color values meet WCAG AA ratios
    - Test voice announcement triggers for critical alerts
    - _Requirements: 10.1, 10.2, 10.3, 10.6_

- [x] 13. Integration wiring and cross-platform validation
  - [x] 13.1 Wire all screens into navigation and verify end-to-end flows
    - Connect all stores, screens, and services into the navigation graph
    - Verify auth gate properly routes unauthenticated users to login
    - Verify deep linking from push notifications navigates to correct screen
    - Verify offline/online transitions display correct indicators and refresh data
    - Verify platform-specific rendering on iOS and Android screen sizes (4.7" to 6.9")
    - _Requirements: 9.4, 9.5, 5.3, 12.4_

  - [ ]* 13.2 Write integration tests for critical user flows
    - Test login → dashboard → vital card tap → trend chart flow
    - Test offline mode → cached data display → reconnect → auto-refresh flow
    - Test push notification → tap → navigation to dashboard flow
    - Test profile edit → submit → success confirmation flow
    - _Requirements: 1.1, 2.1, 4.1, 5.3, 8.2, 12.2, 12.4_

- [x] 14. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirement acceptance criteria for traceability
- The app uses TypeScript throughout, matching the existing monorepo conventions
- Shared types from `@health-checkup/shared` are reused where applicable (HealthProfile, Appointment, HealthReport, etc.)
- Checkpoints ensure incremental validation of working functionality
- Unit tests validate specific component behavior and edge cases
- Integration tests validate end-to-end user flows across multiple screens

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.3"] },
    { "id": 2, "tasks": ["2.1", "4.1"] },
    { "id": 3, "tasks": ["2.2", "4.2"] },
    { "id": 4, "tasks": ["2.3", "2.4", "4.3"] },
    { "id": 5, "tasks": ["5.1", "6.1"] },
    { "id": 6, "tasks": ["5.2", "6.2"] },
    { "id": 7, "tasks": ["5.3", "5.4", "6.3"] },
    { "id": 8, "tasks": ["8.1", "9.1", "9.2", "10.1"] },
    { "id": 9, "tasks": ["8.2", "8.3", "9.3", "10.2"] },
    { "id": 10, "tasks": ["12.1", "12.2", "12.3"] },
    { "id": 11, "tasks": ["12.4", "13.1"] },
    { "id": 12, "tasks": ["13.2"] }
  ]
}
```
