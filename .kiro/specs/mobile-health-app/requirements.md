# Requirements Document

## Introduction

The Mobile Health App extends the Senior Citizen Health Checkup System with a cross-platform mobile application built using React Native and Expo. The app enables senior citizens and their caregivers to monitor health readings, view device sync status, track vital sign trends, receive push notifications for critical health alerts, manage appointments, and access health reports — all from their mobile phones. The app connects to the existing backend API at https://bsmd-health-checkup-production.up.railway.app and reuses the @health-checkup/shared package for shared type definitions. Accessibility is a primary concern, with large text, high contrast, and voice assistance features tailored for elderly users.

## Glossary

- **Mobile_App**: The React Native / Expo cross-platform mobile application that runs on iOS and Android devices.
- **Senior**: A registered senior citizen patient in the system, identified by a unique ID from the existing HealthProfile.
- **Caregiver**: A family member or assigned individual who monitors a Senior's health on their behalf.
- **Auth_Module**: The authentication component within the Mobile_App responsible for login, token management, and session persistence using JWT tokens from the existing backend API.
- **Health_Dashboard_Screen**: The main screen of the Mobile_App that displays vital sign cards, device sync status, and recent alerts.
- **Vital_Sign_Card**: A visual component displaying the latest reading value, unit, trend direction indicator, and color-coded range status for a single vital sign type.
- **Trend_Chart_Screen**: The screen that renders line chart visualizations of historical health readings over selectable time periods.
- **Device_Status_Panel**: The component that displays connected device information including sync status and stale device alerts.
- **Notification_Handler**: The component responsible for registering push notification tokens with the backend and displaying incoming critical health alert notifications.
- **Appointment_Screen**: The screen that displays upcoming scheduled appointments and past appointment history.
- **Report_Screen**: The screen that displays health reports and follow-up action items for a Senior.
- **Offline_Cache**: The local persistent storage layer (AsyncStorage or SQLite) that caches health readings, appointments, and profile data for offline viewing.
- **Accessibility_Engine**: The set of configurations and utilities that enforce large text sizes, high contrast themes, screen reader compatibility, and optional voice assistance throughout the Mobile_App.
- **API_Client**: The HTTP client layer that communicates with the existing backend API, handles JWT token refresh, request retries, and offline detection.
- **Backend_API**: The existing deployed backend at https://bsmd-health-checkup-production.up.railway.app providing RESTful endpoints for all health checkup operations.

## Requirements

### Requirement 1: User Authentication and Session Management

**User Story:** As a senior citizen or caregiver, I want to log in to the mobile app with my existing credentials, so that I can securely access my health data on my phone.

#### Acceptance Criteria

1. WHEN a user submits valid login credentials (email and password), THE Auth_Module SHALL authenticate against the Backend_API and store the returned JWT access token and refresh token securely in encrypted device storage.
2. WHEN a user opens the Mobile_App with a valid stored access token that has not expired, THE Auth_Module SHALL restore the session without requiring re-authentication.
3. WHEN the stored access token has expired but a valid refresh token exists, THE Auth_Module SHALL request a new access token from the Backend_API using the refresh token before any API call proceeds.
4. IF the refresh token is expired or invalid, THEN THE Auth_Module SHALL clear all stored tokens and navigate the user to the login screen.
5. WHEN a user taps the logout button, THE Auth_Module SHALL clear all stored tokens, clear the Offline_Cache, and navigate the user to the login screen.
6. THE Auth_Module SHALL include the JWT access token in the Authorization header of every API request sent by the API_Client.

### Requirement 2: Health Readings Dashboard

**User Story:** As a senior citizen, I want to see my latest health readings on a single screen, so that I can quickly check my current health status.

#### Acceptance Criteria

1. WHEN the user navigates to the Health_Dashboard_Screen, THE Mobile_App SHALL fetch the latest daily health record from the Backend_API and display one Vital_Sign_Card for each reading type (blood pressure, heart rate, blood glucose, SpO2, temperature, weight).
2. THE Vital_Sign_Card SHALL display the latest measured value, unit of measurement, timestamp of the reading, trend direction indicator (improving, stable, or declining), and color-coded background (green for normal, amber for borderline, red for critical).
3. WHEN a blood pressure Vital_Sign_Card is displayed, THE Mobile_App SHALL show both systolic and diastolic values formatted as "systolic/diastolic mmHg".
4. WHEN the user performs a pull-to-refresh gesture on the Health_Dashboard_Screen, THE Mobile_App SHALL fetch the latest data from the Backend_API and update all displayed Vital_Sign_Cards.
5. IF the Backend_API returns no readings for the current date, THEN THE Health_Dashboard_Screen SHALL display a message indicating no readings are available for today.

### Requirement 3: Device Sync Status Display

**User Story:** As a caregiver, I want to see the connection status of each health monitoring device, so that I can identify devices that need attention.

#### Acceptance Criteria

1. WHEN the user views the Device_Status_Panel, THE Mobile_App SHALL display each registered device with its device type, serial number, connection protocol, active status, and last sync timestamp.
2. WHILE a device has a sync status of "stale" (no reading for more than 4 hours during daytime), THE Device_Status_Panel SHALL display a prominent visual warning indicator with an amber icon and descriptive text.
3. WHILE a device has a sync status of "inactive", THE Device_Status_Panel SHALL display the device as greyed out with an "Inactive" label.
4. WHEN the user taps on a stale device entry, THE Mobile_App SHALL display a troubleshooting message suggesting the user check the device connection and battery.

### Requirement 4: Trend Chart Visualization

**User Story:** As a senior citizen, I want to view charts showing how my health readings have changed over time, so that I can understand my health trends.

#### Acceptance Criteria

1. WHEN the user taps on a Vital_Sign_Card, THE Mobile_App SHALL navigate to the Trend_Chart_Screen displaying a line chart of historical readings for that reading type.
2. THE Trend_Chart_Screen SHALL provide selectable time period options: 24 hours, 7 days, and 30 days.
3. WHEN the user selects a time period, THE Mobile_App SHALL fetch trend data from the Backend_API for the selected period and render an updated line chart.
4. THE Trend_Chart_Screen SHALL display statistical summary values (mean, minimum, maximum, and reading count) for the selected time period below the chart.
5. THE Trend_Chart_Screen SHALL apply color-coded reference bands on the chart indicating normal (green), borderline (amber), and critical (red) threshold zones.
6. WHEN fewer than two data points exist for the selected period, THE Trend_Chart_Screen SHALL display a message indicating insufficient data for trend visualization.

### Requirement 5: Push Notifications for Critical Alerts

**User Story:** As a senior citizen, I want to receive push notifications on my phone when a health reading is critically abnormal, so that I can seek immediate assistance.

#### Acceptance Criteria

1. WHEN the user logs in successfully, THE Notification_Handler SHALL register the device push notification token with the Backend_API for the authenticated user.
2. WHEN the Backend_API dispatches a critical health alert notification, THE Notification_Handler SHALL display a push notification on the device with the alert severity, reading type, measured value, and threshold breached.
3. WHEN the user taps on a push notification, THE Mobile_App SHALL open and navigate to the Health_Dashboard_Screen with the relevant Vital_Sign_Card highlighted.
4. THE Notification_Handler SHALL request notification permissions from the operating system on first login and handle the case where permissions are denied by displaying an in-app banner explaining the importance of notifications.
5. WHEN the user navigates to notification settings within the Mobile_App, THE Mobile_App SHALL allow the user to enable or disable notifications per alert severity level (critical and warning).

### Requirement 6: Appointment Viewing and Scheduling

**User Story:** As a senior citizen, I want to view my upcoming appointments on my phone, so that I can keep track of my health checkup schedule.

#### Acceptance Criteria

1. WHEN the user navigates to the Appointment_Screen, THE Mobile_App SHALL fetch and display all upcoming appointments from the Backend_API sorted by date in ascending order.
2. THE Appointment_Screen SHALL display for each appointment: the appointment date and time, physician name, checkup package name, and appointment status (scheduled, completed, cancelled).
3. WHEN the user taps on an appointment entry, THE Mobile_App SHALL display the full appointment details including location, preparation instructions, and associated tests.
4. THE Appointment_Screen SHALL display a visual timeline separating upcoming appointments from past appointments.
5. IF no upcoming appointments exist, THEN THE Appointment_Screen SHALL display a message indicating no scheduled appointments and provide a prompt to contact the healthcare provider.

### Requirement 7: Health Reports and Follow-Up Actions

**User Story:** As a senior citizen, I want to view my health reports and follow-up actions on my phone, so that I can stay informed about my care plan.

#### Acceptance Criteria

1. WHEN the user navigates to the Report_Screen, THE Mobile_App SHALL fetch and display a list of completed health reports from the Backend_API sorted by date in descending order.
2. THE Report_Screen SHALL display for each report: the report date, checkup package name, overall status, and count of follow-up actions.
3. WHEN the user taps on a report entry, THE Mobile_App SHALL display the full report details including individual test results, physician notes, and associated follow-up actions.
4. THE Report_Screen SHALL visually distinguish follow-up actions by status: pending (amber), in-progress (blue), and completed (green).
5. WHEN a follow-up action has a due date, THE Report_Screen SHALL display the due date and highlight overdue actions with a red indicator.

### Requirement 8: Registration and Profile Management

**User Story:** As a senior citizen, I want to view and update my profile information on my phone, so that my health records remain accurate.

#### Acceptance Criteria

1. WHEN the user navigates to the profile screen, THE Mobile_App SHALL fetch and display the user's registration information including name, date of birth, contact details, emergency contact, and medical history summary.
2. WHEN the user edits an allowed profile field (contact number, email, emergency contact, address) and submits the form, THE Mobile_App SHALL send the update to the Backend_API and display a success confirmation upon completion.
3. IF the profile update request fails due to validation errors, THEN THE Mobile_App SHALL display field-level error messages indicating which fields need correction.
4. THE Mobile_App SHALL display the user's assigned physician name, next scheduled appointment, and current checkup package on the profile screen.

### Requirement 9: Cross-Platform Compatibility

**User Story:** As a product owner, I want the app to work on both iOS and Android devices, so that all senior citizens can use it regardless of their phone type.

#### Acceptance Criteria

1. THE Mobile_App SHALL be built using React Native with the Expo managed workflow to produce a single codebase that runs on both iOS and Android.
2. THE Mobile_App SHALL support iOS version 15.0 and above and Android API level 26 (Android 8.0) and above.
3. THE Mobile_App SHALL reuse type definitions from the existing @health-checkup/shared package by configuring it as a workspace dependency.
4. THE Mobile_App SHALL use platform-specific navigation patterns (bottom tab navigation) consistent with iOS Human Interface Guidelines and Android Material Design guidelines.
5. THE Mobile_App SHALL render correctly on screen sizes ranging from 4.7 inches to 6.9 inches diagonal with proper scaling.

### Requirement 10: Accessibility for Elderly Users

**User Story:** As a senior citizen with potential vision or dexterity impairments, I want the app to use large text, high contrast colors, and voice assistance, so that I can use it comfortably.

#### Acceptance Criteria

1. THE Accessibility_Engine SHALL enforce a minimum touch target size of 48x48 density-independent pixels for all interactive elements.
2. THE Accessibility_Engine SHALL use a minimum body text size of 18sp (scaled pixels) and a minimum heading size of 24sp throughout the Mobile_App.
3. THE Accessibility_Engine SHALL maintain a color contrast ratio of at least 4.5:1 for normal text and 3:1 for large text as defined by WCAG 2.1 AA standards.
4. THE Mobile_App SHALL provide all interactive elements with descriptive accessibility labels compatible with iOS VoiceOver and Android TalkBack screen readers.
5. THE Mobile_App SHALL support dynamic text scaling up to 200% of the default size without content overflow or truncation of critical health values.
6. WHERE voice assistance is enabled in accessibility settings, THE Mobile_App SHALL provide audio announcements for critical alert notifications and reading value changes on the Health_Dashboard_Screen.
7. THE Mobile_App SHALL provide a high-contrast theme option that uses black backgrounds with white text and increased border widths for visual boundaries.

### Requirement 11: Backend API Integration

**User Story:** As a developer, I want the mobile app to connect to the existing backend API using JWT authentication, so that the app leverages the existing infrastructure.

#### Acceptance Criteria

1. THE API_Client SHALL communicate with the Backend_API at the configured base URL using HTTPS for all requests.
2. THE API_Client SHALL attach the JWT access token from the Auth_Module to the Authorization header of every authenticated request in the format "Bearer {token}".
3. WHEN the API_Client receives a 401 Unauthorized response, THE API_Client SHALL attempt to refresh the access token using the stored refresh token and retry the original request exactly once.
4. IF the token refresh attempt also fails, THEN THE API_Client SHALL trigger the Auth_Module logout flow and navigate the user to the login screen.
5. THE API_Client SHALL set a request timeout of 15 seconds for all API calls and display a user-friendly error message when a timeout occurs.
6. WHEN the API_Client detects no network connectivity, THE API_Client SHALL queue the request context and serve cached data from the Offline_Cache where available.
7. THE API_Client SHALL include standard request headers: Content-Type as "application/json", Accept as "application/json", and a custom X-Client-Platform header indicating "ios" or "android".

### Requirement 12: Offline Capability

**User Story:** As a senior citizen, I want to view my most recent health readings even when I have no internet connection, so that I can always check my health status.

#### Acceptance Criteria

1. WHEN the API_Client successfully fetches health readings from the Backend_API, THE Offline_Cache SHALL persist the response data to local device storage.
2. WHEN the Mobile_App detects no network connectivity and the user navigates to the Health_Dashboard_Screen, THE Mobile_App SHALL display the most recently cached health readings from the Offline_Cache with a visible "Offline - showing cached data" indicator.
3. THE Offline_Cache SHALL persist the following data types: daily health readings, device status, upcoming appointments, user profile, and health reports.
4. WHEN network connectivity is restored, THE Mobile_App SHALL automatically refresh displayed data from the Backend_API and update the Offline_Cache.
5. THE Offline_Cache SHALL retain cached data for a maximum of 7 days, after which stale entries are purged on the next successful API fetch.
6. IF no cached data exists and the device is offline, THEN THE Mobile_App SHALL display a message indicating that an internet connection is required to load data for the first time.
