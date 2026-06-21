# Implementation Plan: Daily Health Device Readings

## Overview

This implementation plan breaks the Daily Health Device Readings feature into incremental coding tasks that build on each other. The feature adds a new `device-integration` bounded context within the existing services layer, new API routes in the gateway, and a Reading Dashboard in the frontend. Each task references specific requirements for traceability.

## Tasks

- [x] 1. Define domain types and shared interfaces
  - [x] 1.1 Create device-integration type definitions
    - Create `packages/services/src/device-integration/device-integration.types.ts` with all domain types: `DeviceType`, `ReadingType`, `ReadingUnit`, `AgeGroup`, `DeviceRegistryEntry`, `HealthReading`, `HealthReadingRequest`, `DailyHealthRecord`, `LatestReadingSummary`, `ReadingAlert`, `NormalRange`, `NormalRangeRequest`, `AlertResult`, `TrendSummary`, `ValidationError`, `DeviceRegistrationRequest`, `AlertFilters`, `PLAUSIBLE_RANGES` constant, and pagination types
    - Create `packages/services/src/device-integration/device-integration.errors.ts` with typed error classes: `DeviceConflictError`, `UnauthorizedDeviceError`, `TimestampOutOfRangeError`, `ImplausibleValueError`, `RangeOrderInvalidError`, `ValidationError`
    - Create `packages/services/src/device-integration/index.ts` barrel export
    - _Requirements: 1.5, 2.1, 2.5, 4.4, 5.1, 10.1_

  - [x] 1.2 Define event types for device reading domain
    - Add `DeviceReadingStoredEvent`, `DeviceReadingAlertRaisedEvent`, and `DeviceSyncStaleEvent` type definitions to `packages/shared/src/events/event-types.ts`
    - Export new event types from the shared events barrel
    - _Requirements: 4.5, 7.1_

  - [x] 1.3 Create Prisma schema migrations for device reading tables
    - Add `DeviceRegistry`, `HealthReading`, `DailyHealthRecord`, `ReadingAlert`, and `NormalRange` models to the Prisma schema
    - Include all columns, indexes (senior_id + date composite on DailyHealthRecord, serial_number unique on DeviceRegistry), and foreign key relationships
    - Create migration file for the new tables
    - _Requirements: 1.5, 2.2, 3.1, 4.4, 5.1, 9.5_

- [x] 2. Implement Device Registration Service
  - [x] 2.1 Implement device registration and deregistration logic
    - Create `packages/services/src/device-integration/device-registration.service.ts`
    - Implement `registerDevice()`: validate inputs, check serial number uniqueness across seniors, create DeviceRegistry entry with active=true and lastSyncTimestamp=null
    - Implement `deregisterDevice()`: mark device as inactive
    - Implement `getDevice()` and `getDevicesBySenior()` query methods
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_

  - [ ]* 2.2 Write property tests for device registration
    - **Property 1: Device registration produces a complete registry entry**
    - **Property 2: Device serial number uniqueness across seniors**
    - **Property 3: Deregistered devices reject subsequent readings**
    - **Validates: Requirements 1.1, 1.3, 1.4, 1.5**

  - [ ]* 2.3 Write unit tests for device registration edge cases
    - Test all 5 device types register successfully
    - Test both connection protocols (bluetooth, wifi)
    - Test conflict error on duplicate serial number to different senior
    - Test deregistration sets isActive=false
    - _Requirements: 1.1, 1.2, 1.3, 1.4_

- [x] 3. Implement Device Gateway and Reading Validation
  - [x] 3.1 Implement payload schema validation and Device Gateway
    - Create `packages/services/src/device-integration/device-gateway.ts`
    - Implement JSON schema validation using a schema validator (e.g., Zod or manual validation) that checks required fields: deviceId, timestamp, readingType, measuredValue, unit
    - Return structured field-level validation errors on failure
    - Implement plausible range checking per reading type using `PLAUSIBLE_RANGES`
    - Implement timestamp boundary validation (reject >24h past or future)
    - Implement blood pressure dual-value handling (systolic + diastolic)
    - _Requirements: 2.1, 2.4, 2.5, 2.6, 10.1, 10.2, 10.4_

  - [x] 3.2 Implement Health Reading serialization/deserialization (round-trip)
    - Create `packages/services/src/device-integration/reading-serializer.ts`
    - Implement `formatReading()` to convert HealthReading to canonical JSON schema
    - Implement `parseReading()` to parse JSON into typed HealthReading object
    - Ensure parse(format(reading)) produces an equivalent object
    - _Requirements: 10.1, 10.3_

  - [ ]* 3.3 Write property tests for reading validation and serialization
    - **Property 4: Health Reading parse-format round trip**
    - **Property 5: Invalid payload produces field-level validation errors**
    - **Property 8: Timestamp boundary enforcement**
    - **Property 9: Plausible range enforcement**
    - **Validates: Requirements 2.1, 2.6, 10.1, 10.2, 10.3, 10.4**

  - [ ]* 3.4 Write unit tests for Device Gateway
    - Test each of the 6 valid reading type + unit pairs accepted
    - Test blood pressure with systolic=120, diastolic=80 stored correctly
    - Test boundary timestamp values (exactly 24h ago accepted, 24h+1ms rejected)
    - Test boundary plausible values (min, max, min-1, max+1 for each type)
    - _Requirements: 2.1, 2.4, 2.5, 2.6, 10.4_

- [x] 4. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Implement Reading Ingestion and Daily Record Aggregation
  - [x] 5.1 Implement core reading ingestion logic in Device Integration Service
    - Create `packages/services/src/device-integration/device-integration.service.ts`
    - Implement `ingestReading()`: verify device registered + active, delegate to gateway for validation, store HealthReading, create/append to DailyHealthRecord, update latest-reading summary, update device lastSyncTimestamp
    - Use database transactions for atomic daily record creation + reading storage
    - Implement `getDailyRecord()` and `getDailyRecords()` with readings grouped by type
    - _Requirements: 2.2, 2.3, 3.1, 3.2, 3.3, 3.4, 7.1_

  - [ ]* 5.2 Write property tests for reading ingestion and daily records
    - **Property 6: Valid reading storage with daily record association**
    - **Property 7: Blood pressure readings store both values**
    - **Property 10: Daily record query returns all readings grouped by type**
    - **Property 11: Latest reading summary reflects most recent per type**
    - **Property 17: Device sync timestamp updates on ingestion**
    - **Validates: Requirements 2.2, 2.4, 3.1, 3.2, 3.3, 3.4, 7.1**

- [x] 6. Implement Reading Alert Engine
  - [x] 6.1 Implement alert classification and persistence
    - Create `packages/services/src/device-integration/reading-alert-engine.ts`
    - Implement `evaluateReading()`: lookup NormalRange by readingType + ageGroup, classify value against thresholds (critical/warning/normal), return AlertResult
    - Implement alert persistence with all required fields (alertId, seniorId, readingId, readingType, measuredValue, thresholdBreached, severity, direction, timestamp)
    - Publish `DeviceReadingAlertRaisedEvent` to event bus for critical alerts
    - Wire alert evaluation into the ingestion flow in DeviceIntegrationService
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

  - [ ]* 6.2 Write property tests for alert classification
    - **Property 12: Alert classification correctness**
    - **Validates: Requirements 4.2, 4.3, 4.4**

  - [ ]* 6.3 Write unit tests for alert engine edge cases
    - Test critical alert generated for value below critical low
    - Test critical alert generated for value above critical high
    - Test warning alert for borderline values
    - Test no alert for normal range values
    - Test alert contains all required fields
    - _Requirements: 4.1, 4.2, 4.3, 4.4_

- [x] 7. Implement Normal Range Configuration Service
  - [x] 7.1 Implement Normal Range CRUD with ordering validation
    - Create `packages/services/src/device-integration/normal-range.service.ts`
    - Implement `configure()`: validate ordering constraint (critical_low ≤ borderline_low ≤ normal_low ≤ normal_high ≤ borderline_high ≤ critical_high), store NormalRange
    - Implement `update()`: validate ordering, apply to subsequent readings only (non-retroactive)
    - Implement `getRange()` and `getAllRanges()` query methods
    - Implement default Normal Range seeding for all supported reading types
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

  - [ ]* 7.2 Write property tests for normal range configuration
    - **Property 13: Normal range ordering validation**
    - **Property 14: Normal range updates are non-retroactive**
    - **Validates: Requirements 5.1, 5.2, 5.4**

- [x] 8. Implement Trend Analyzer
  - [x] 8.1 Implement trend computation and direction analysis
    - Create `packages/services/src/device-integration/trend-analyzer.ts`
    - Implement `computeTrend()`: query readings for Senior + readingType within period (daily/7day/30day), compute mean, min, max, count
    - Implement `getTrendDirection()`: compare recent readings against previous period to determine improving/stable/declining
    - _Requirements: 6.1_

  - [ ]* 8.2 Write property tests for trend computation
    - **Property 15: Trend computation mathematical correctness**
    - **Validates: Requirements 6.1**

- [x] 9. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 10. Implement Device Sync Status Monitoring
  - [x] 10.1 Implement stale device detection logic
    - Add sync status classification logic to device registration service or a separate utility
    - Implement 4-hour stale threshold check during daytime hours (06:00–22:00 local time)
    - Return `syncStatus` field ('synced' | 'stale' | 'inactive') in device queries
    - _Requirements: 7.1, 7.2, 7.3_

  - [ ]* 10.2 Write property tests for stale device detection
    - **Property 18: Stale device detection during daytime hours**
    - **Validates: Requirements 7.3**

- [x] 11. Implement API Routes and Gateway Integration
  - [x] 11.1 Create device-readings route file with all endpoints
    - Create `packages/api-gateway/src/routes/device-readings.routes.ts`
    - Implement POST `/devices` — register a device
    - Implement DELETE `/devices/:deviceId` — deregister a device
    - Implement GET `/devices/senior/:seniorId` — list devices for a senior
    - Implement POST `/ingest` — submit a device reading
    - Implement GET `/seniors/:seniorId/daily/:date` — get daily health record
    - Implement GET `/seniors/:seniorId/readings` — list readings by date range with pagination
    - Implement GET `/seniors/:seniorId/alerts` — list alerts with pagination
    - Implement GET `/seniors/:seniorId/trends/:readingType` — get trend summary
    - Implement GET `/normal-ranges` — list all normal ranges
    - Implement POST `/normal-ranges` — create/update a normal range
    - Apply role-based access control per endpoint as defined in design
    - _Requirements: 8.1, 8.2, 8.3, 8.5_

  - [x] 11.2 Implement pagination support for list endpoints
    - Add pagination middleware/helper supporting `page` and `pageSize` query params
    - Default pageSize=20, maximum pageSize=100
    - Return pagination metadata in response: `{ meta: { page, pageSize, total } }`
    - _Requirements: 8.4_

  - [x] 11.3 Register device-readings routes in API Gateway
    - Add `deviceReadingsRoutes` export to `packages/api-gateway/src/routes/index.ts`
    - Mount routes at `/api/device-readings` in `packages/api-gateway/src/index.ts` (protected)
    - Wire DeviceIntegrationService into the service registry
    - _Requirements: 8.1, 8.2, 8.3_

  - [ ]* 11.4 Write property tests for pagination
    - **Property 19: Pagination enforcement**
    - **Validates: Requirements 8.4**

  - [ ]* 11.5 Write integration tests for API routes
    - Test auth middleware rejects unauthenticated requests with 401
    - Test role guard rejects unauthorized roles with 403
    - Test full ingestion flow: register device → submit reading → verify storage
    - Test JSON response format with ISO 8601 timestamps
    - _Requirements: 8.1, 8.2, 8.3, 8.5_

- [x] 12. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 13. Implement Reading Dashboard Frontend
  - [x] 13.1 Create VitalSignCard component
    - Create `packages/frontend/src/pages/device-readings/VitalSignCard.tsx`
    - Render card showing latest value, unit, timestamp, and trend direction indicator
    - Apply color coding: green for normal, amber for borderline, red for critical
    - Ensure WCAG 2.1 AA compliance (ARIA labels, color contrast, keyboard navigation)
    - Use existing theme system for consistent styling
    - _Requirements: 6.2, 6.4, 6.6_

  - [x] 13.2 Create DeviceStatusPanel component
    - Create `packages/frontend/src/pages/device-readings/DeviceStatusPanel.tsx`
    - Display each device's type, serial number, connection protocol, active status, and last-sync timestamp
    - Show visual indicator for stale sync status
    - _Requirements: 7.2, 7.3_

  - [x] 13.3 Create TrendChart component with line chart visualizations
    - Create `packages/frontend/src/pages/device-readings/TrendChart.tsx`
    - Render line chart for each reading type over selectable time ranges (24h, 7 days, 30 days)
    - Use a charting library compatible with the existing frontend stack
    - _Requirements: 6.3_

  - [x] 13.4 Create ReadingDashboard page with auto-refresh
    - Create `packages/frontend/src/pages/device-readings/index.ts` barrel export
    - Create `packages/frontend/src/pages/device-readings.page.tsx` page component
    - Compose VitalSignCard grid, DeviceStatusPanel, TrendChart, and alerts list
    - Implement 60-second polling interval for data refresh
    - Responsive card-based layout
    - _Requirements: 6.2, 6.5, 6.6_

  - [ ]* 13.5 Write property tests for color coding logic
    - **Property 16: Color coding maps correctly to range classification**
    - **Validates: Requirements 6.4**

  - [ ]* 13.6 Write component tests for dashboard
    - Test VitalSignCard renders correctly with all reading types
    - Test DeviceStatusPanel shows stale indicator
    - Test polling interval configured at 60 seconds
    - Test ARIA labels and keyboard navigation
    - _Requirements: 6.2, 6.4, 6.5, 6.6, 7.2_

- [x] 14. Implement Cloud Deployment Readiness
  - [x] 14.1 Create Dockerfile and health check endpoint for Device Integration Service
    - Create a Dockerfile for the service producing a production-ready image
    - Implement GET `/health` endpoint returning service status and database connectivity status
    - Ensure all configuration reads from environment variables (database URL, API keys, port)
    - Verify no hardcoded secrets in source code
    - _Requirements: 9.1, 9.2, 9.3_

  - [x] 14.2 Configure database auto-migration on service start
    - Wire Prisma migration execution into the service startup sequence
    - Ensure pending migrations run automatically before accepting requests
    - Seed default Normal Range values on initial deployment
    - _Requirements: 5.3, 9.5_

- [x] 15. Integration Wiring and Event Bus Setup
  - [x] 15.1 Wire alert events to existing Notification Service
    - Subscribe to `DeviceReadingAlertRaised` events in the event wiring module
    - Dispatch notification to assigned healthcare provider via existing Notification Service for critical alerts
    - Add event subscription in `packages/api-gateway/src/event-wiring.ts`
    - _Requirements: 4.5_

  - [x] 15.2 Export device-integration service from services barrel
    - Update `packages/services/src/index.ts` to export all device-integration modules
    - Ensure all types, services, and errors are accessible from consuming packages
    - _Requirements: 1.1, 2.2, 8.1_

- [x] 16. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document using `fast-check`
- Unit tests validate specific examples and edge cases
- The implementation uses TypeScript throughout, matching the existing project stack
- All new services follow the existing patterns (service class + types + errors + tests + barrel export)
- The API Gateway integration reuses existing middleware (auth, rate limiting, error handling)

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["1.3"] },
    { "id": 2, "tasks": ["2.1", "3.1", "3.2"] },
    { "id": 3, "tasks": ["2.2", "2.3", "3.3", "3.4"] },
    { "id": 4, "tasks": ["5.1", "7.1"] },
    { "id": 5, "tasks": ["5.2", "6.1", "7.2", "8.1"] },
    { "id": 6, "tasks": ["6.2", "6.3", "8.2", "10.1"] },
    { "id": 7, "tasks": ["10.2", "11.1", "11.2"] },
    { "id": 8, "tasks": ["11.3", "11.4", "11.5"] },
    { "id": 9, "tasks": ["13.1", "13.2", "13.3", "14.1", "14.2", "15.1", "15.2"] },
    { "id": 10, "tasks": ["13.4", "13.5", "13.6"] }
  ]
}
```
