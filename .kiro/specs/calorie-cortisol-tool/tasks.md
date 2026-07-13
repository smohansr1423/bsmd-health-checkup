# Implementation Plan: Calorie & Cortisol Tool

## Overview

This plan converts the design into incremental, test-driven coding tasks across the six microservices (Food Vision, Nutrition Lookup, Cortisol Data, Insights & ML, User & Profile, Notification), the API gateway, the three clients (iOS/Android/PWA) with their shared local-first Data Vault, on-device inference, and consent-aware sync, plus the data stores, AI/ML integration points, and cross-cutting security/consent/compliance controls.

Language & test-library assignment follows the design's testing strategy:
- **Python services** (Food Vision, Nutrition Lookup, Insights & ML) → **Hypothesis**
- **Node/TypeScript services and clients** (Cortisol Data, Notification, API Gateway, PWA/shared client logic) → **fast-check**
- **Go service** (User & Profile) → **gopter**

Property-based tests (marked optional with `*`) each implement exactly one of the 61 design correctness properties, run a **minimum of 100 generated iterations**, and are tagged in the format `Feature: calorie-cortisol-tool, Property {number}`. Per the design's classification, latency/scalability/uptime SLOs and one-time config posture are covered by integration/smoke/perf tests, not PBT.

## Tasks

- [x] 1. Scaffold monorepo, shared contracts, and tooling
  - [x] 1.1 Create workspace layout and per-service packages
    - Add `services/{food-vision,nutrition-lookup,cortisol-data,insights-ml,user-profile,notification}`, `gateway/`, `clients/{ios,android,pwa,shared}`, and `shared/` package roots
    - Configure Python (Poetry + Hypothesis), Node/TS (fast-check + Jest/Vitest), and Go (gopter) test toolchains and lint/format for each package
    - Add CI wiring stubs to run each package's test suite
    - _Requirements: 21.1, 23.1_

  - [x] 1.2 Define shared domain types and API contracts
    - Implement the language-neutral core types (FoodItem, PortionEstimate, NutrientValue, Meal, MealItem, NutritionTotals, CortisolReading, QuestionnaireResult, CARMeasurement, AlignedPair, CorrelationResult, Insight, ConsentState, FamilyAccount, AuditEntry, Residency) as a shared TS package and generate equivalents/DTOs for Python and Go services
    - Define the GraphQL schema (`Meal`, `NutritionResult`, `CortisolReading`, `DiurnalProfile`, `Insight`, `Profile`, `FamilyMember`, `ConsentState`) and REST webhook contracts
    - _Requirements: 4.1, 4.2, 4.5, 2.2, 8.5, 10.1, 11.1, 15.1, 17.1_

  - [x] 1.3 Implement the structured error/degraded-outcome result contract
    - Implement the `{ code, message, retryable, retainedState }` error shape and shared result helpers for atomic-failure, validation-rejection, retain-and-retry, and timeout outcomes
    - _Requirements: 1.2, 3.5, 21.6, 23.3_

- [x] 2. Provision data stores and persistence layers
  - [x] 2.1 Define PostgreSQL schema and migrations
    - Create tables/migrations for profiles, consent state, family accounts/members, billing, plate calibration, and audit metadata
    - _Requirements: 3.6, 16.6, 17.1, 19.1, 25.6_

  - [x] 2.2 Define TimescaleDB hypertables and read replicas
    - Create time-partitioned hypertables for cortisol readings, wearable proxy series, and diurnal samples; configure read-replica routing for trend queries
    - _Requirements: 8.4, 9.3, 11.1, 12.1_

  - [x] 2.3 Configure S3 (encrypted/WORM), Redis, and Elasticsearch as code
    - Implement per-user-prefixed encrypted S3 photo store config, Redis session/rate-limit/cache namespaces, and the 2M+ item Elasticsearch index mapping
    - _Requirements: 7.7, 25.1, 25.6_

  - [x] 2.4 Implement the on-device Data Vault storage layer (shared client)
    - Implement encrypted local record store (SQLite/Core Data / Room / IndexedDB abstraction) with `vault.put/get/list/delete`, sync-status fields, and a 50 MB free-space precheck
    - _Requirements: 17.1, 27.1, 27.3_

- [x] 3. Implement cross-cutting encryption and key management
  - [x] 3.1 Implement AES-256 per-user encryption with separated key store
    - Implement encrypt/decrypt over health-data records using per-user keys, storing key material separately from ciphertext
    - _Requirements: 25.1_

  - [x] 3.2 Write property test for encryption round-trip
    - **Property 53: Encryption round-trip with separated keys**
    - **Validates: Requirements 25.1**
    - gopter, ≥100 iterations, tag `Feature: calorie-cortisol-tool, Property 53`

- [x] 4. Implement User & Profile Service (Go)
  - [x] 4.1 Implement 5-step adaptive onboarding with validation and resume
    - Implement `POST /onboarding/step` / `GET /onboarding/resume`: ordered 5-step flow, goal-driven conditional fields, required-field + wake-time (00:00–23:59) validation, back-navigation state retention, resume at first incomplete step, and post-step-5 profile creation with retry-on-failure
    - _Requirements: 16.1, 16.2, 16.3, 16.4, 16.5, 16.6, 16.7, 16.8_

  - [x] 4.2 Write property test for onboarding step validation gate
    - **Property 42: Onboarding step validation gate**
    - **Validates: Requirements 16.4, 16.5**
    - gopter, ≥100 iterations, tag `Feature: calorie-cortisol-tool, Property 42`

  - [x] 4.3 Write property test for onboarding state preservation and resume
    - **Property 43: Onboarding preserves and resumes state**
    - **Validates: Requirements 16.2, 16.7, 16.8**
    - gopter, ≥100 iterations, tag `Feature: calorie-cortisol-tool, Property 43`

  - [x] 4.4 Implement per-category consent state and master consent gate
    - Implement `PUT /consent` and the consent-check used before any egress/cloud persistence: category opt-in recording, disable-stops-egress while retaining local copy, first-submission affirmative health-data consent, and block-with-consent-required on missing consent
    - _Requirements: 17.1, 17.2, 17.3, 17.4, 17.6, 30.4, 30.5_

  - [x] 4.5 Write property test for master consent gate
    - **Property 44: Master consent gate on egress and persistence**
    - **Validates: Requirements 17.1, 17.2, 17.3, 17.4, 17.6, 30.4, 30.5**
    - gopter, ≥100 iterations, tag `Feature: calorie-cortisol-tool, Property 44`

  - [x] 4.6 Implement family accounts with capacity and role isolation
    - Implement `POST /family/members` with ≤5 capacity enforcement, cross-profile read/modify isolation, and admin-only add/edit/remove
    - _Requirements: 19.1, 19.2, 19.3, 19.4, 19.5, 19.6_

  - [x] 4.7 Write property test for family capacity and isolation
    - **Property 46: Family capacity and isolation**
    - **Validates: Requirements 19.1, 19.2, 19.3, 19.4, 19.5, 19.6**
    - gopter, ≥100 iterations, tag `Feature: calorie-cortisol-tool, Property 46`

  - [x] 4.8 Implement data export and account deletion
    - Implement `POST /export` (authenticated-only, JSON+CSV, all personal data) and `POST /account/delete` (explicit confirmation, 30-day deletion with legal-retention carve-out and basis reporting, failure preserves pre-deletion state), all as atomic operations
    - _Requirements: 20.1, 20.2, 20.3, 20.4, 20.5, 20.6, 20.7_

  - [x] 4.9 Write property test for export authorization and completeness
    - **Property 47: Export authorization and completeness**
    - **Validates: Requirements 20.1, 20.2**
    - gopter, ≥100 iterations, tag `Feature: calorie-cortisol-tool, Property 47`

  - [x] 4.10 Write property test for atomic failure state preservation
    - **Property 48: Atomic failure preserves prior state (import/report/export/deletion)**
    - **Validates: Requirements 14.2, 14.3, 14.5, 14.7, 20.3, 20.7**
    - gopter, ≥100 iterations, tag `Feature: calorie-cortisol-tool, Property 48`

  - [x] 4.11 Write property test for deletion completeness with retention carve-out
    - **Property 49: Deletion completeness with legal-retention carve-out**
    - **Validates: Requirements 20.5, 20.6**
    - gopter, ≥100 iterations, tag `Feature: calorie-cortisol-tool, Property 49`

  - [x] 4.12 Implement biometric token exchange and fallback endpoint
    - Implement `POST /auth/biometric` token exchange and fallback authentication issuance backing the client biometric gate
    - _Requirements: 18.2, 18.4, 18.5_

- [x] 5. Checkpoint - account foundation
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Implement Food Vision Service (Python)
  - [x] 6.1 Implement recognition endpoint with confidence gating
    - Implement `POST /recognize`: multi-instance detection (≤20 items) with per-item 0–100 confidence, <70% → top-3 candidate prompt, no item ≥70% → "no food recognized" with image retained; restaurant menu-OCR/POS path with fallback to standard classification
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7_

  - [x] 6.2 Write property test for detection output bounds
    - **Property 6: Detection output bounds**
    - **Validates: Requirements 2.2**
    - Hypothesis, ≥100 iterations, tag `Feature: calorie-cortisol-tool, Property 6`

  - [x] 6.3 Write property test for confidence-threshold branching
    - **Property 7: Confidence-threshold branching**
    - **Validates: Requirements 2.3, 2.7**
    - Hypothesis, ≥100 iterations, tag `Feature: calorie-cortisol-tool, Property 7`

  - [x] 6.4 Implement portion estimation with reference-object scaling and calibration
    - Implement `POST /portion`: single-angle (±15%) and multi-angle (±8%) volume, reference-object detection (plate/hand/utensil) → scaled flag, unscaled-but-retained when absent, atomic rejection when no food region or resolution <640×480, and plate-calibration persistence/override with failure fallback to prior calibration
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_

  - [x] 6.5 Write property test for reference-object scaling
    - **Property 8: Scaling reflects reference-object presence**
    - **Validates: Requirements 3.3, 3.4**
    - Hypothesis, ≥100 iterations, tag `Feature: calorie-cortisol-tool, Property 8`

  - [x] 6.6 Write property test for atomic rejection of unprocessable images
    - **Property 9: Unprocessable images are rejected atomically**
    - **Validates: Requirements 3.5**
    - Hypothesis, ≥100 iterations, tag `Feature: calorie-cortisol-tool, Property 9`

  - [x] 6.7 Write property test for plate calibration persistence and application
    - **Property 10: Plate calibration persistence and application**
    - **Validates: Requirements 3.6, 3.7**
    - Hypothesis, ≥100 iterations, tag `Feature: calorie-cortisol-tool, Property 10`

  - [x] 6.8 Implement calorie accuracy evaluation harness
    - Implement the offline MAPE benchmark against a dietitian-verified dataset (≥500 items): compute MAPE per capture mode, record MAPE + mode + item count, flag runs at/above threshold (15% single, 5% multi) as failed while retaining results, and enforce non-negative calorie estimates
    - _Requirements: 22.3, 22.4, 22.5_

  - [x] 6.9 Write property test for calorie non-negativity and accuracy-run classification
    - **Property 60: Calorie estimate non-negativity and accuracy-run classification**
    - **Validates: Requirements 22.3, 22.4, 22.5**
    - Hypothesis, ≥100 iterations, tag `Feature: calorie-cortisol-tool, Property 60`

- [x] 7. Implement Nutrition Lookup Service (Python)
  - [x] 7.1 Implement nutrition calculation with confidence ranges and partial availability
    - Implement `POST /nutrition`: primary macros + secondary nutrients + optional micronutrient overlay, per-value confidence ranges (lower ≤ value ≤ upper, same unit), and per-nutrient "unavailable" flagging while returning all calculable values; density lookup for volume→mass
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_

  - [x] 7.2 Write property test for nutrient confidence ranges
    - **Property 11: Nutrient confidence ranges bracket the value**
    - **Validates: Requirements 4.5**
    - Hypothesis, ≥100 iterations, tag `Feature: calorie-cortisol-tool, Property 11`

  - [x] 7.3 Write property test for partial nutrition availability
    - **Property 12: Partial nutrition availability**
    - **Validates: Requirements 4.1, 4.2, 4.6**
    - Hypothesis, ≥100 iterations, tag `Feature: calorie-cortisol-tool, Property 12`

  - [x] 7.4 Implement food search, barcode, and menu-OCR lookup endpoints
    - Implement `GET /search?q=` fuzzy search (1–100 chars) over Elasticsearch, `GET /barcode/{code}` lookup, and menu-OCR extraction; return no-match indications that leave prior state unchanged and offer text-search fallback
    - _Requirements: 7.1, 7.2, 7.5, 7.6, 7.7, 7.8_

- [x] 8. Checkpoint - food estimation pipeline
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Implement Cortisol Data Service (Node/TypeScript)
  - [x] 9.1 Implement lab-kit order and QR sample linkage
    - Implement `POST /kits/order` (CLIA/CAP order, payment authorize, order confirmation + id, lab-unavailable → pending/no-charge/error) and `POST /kits/link` (link valid unused QR, reject invalid/unrecognized/already-linked while leaving existing association unchanged)
    - _Requirements: 8.1, 8.2, 8.6, 8.7_

  - [x] 9.2 Write property test for QR linkage safety
    - **Property 19: QR linkage never overwrites an existing association**
    - **Validates: Requirements 8.2, 8.7**
    - fast-check, ≥100 iterations, tag `Feature: calorie-cortisol-tool, Property 19`

  - [x] 9.3 Write property test for lab-failure order preservation
    - **Property 22: Lab failure preserves order without charge**
    - **Validates: Requirements 8.6, 8.8**
    - fast-check, ≥100 iterations, tag `Feature: calorie-cortisol-tool, Property 22`

  - [x] 9.4 Implement lab result ingestion, diurnal windows, and contextualization
    - Implement `POST /webhooks/lab-results` (HL7/JSON, HMAC-verified, structural validation, results-pending on missing/invalid within 72h), diurnal 4-sample window acceptance (morning CAR, noon 11–13, afternoon 15–17, evening 22–00 local), and age/sex/time-of-day reference-range classification (below/normal/above)
    - _Requirements: 8.3, 8.4, 8.5, 8.8_

  - [x] 9.5 Write property test for diurnal sample window acceptance
    - **Property 20: Diurnal sample window acceptance**
    - **Validates: Requirements 8.3**
    - fast-check, ≥100 iterations, tag `Feature: calorie-cortisol-tool, Property 20`

  - [x] 9.6 Write property test for reference-range contextualization
    - **Property 21: Reference-range contextualization**
    - **Validates: Requirements 8.5**
    - fast-check, ≥100 iterations, tag `Feature: calorie-cortisol-tool, Property 21`

  - [x] 9.7 Implement wearable/patch sync with per-reading validation
    - Implement `POST /wearable/sync`: authorized-category-only import, per-reading validation (value ∈ [0.01,100] ∧ has timestamp) rejecting/recording invalid readings while retaining valid ones, source-id/device-type + capture-timestamp tagging, and reauthorization/inactive handling
    - _Requirements: 9.2, 9.3, 9.4, 9.5, 9.8_

  - [x] 9.8 Write property test for imported-reading tagging
    - **Property 23: Imported readings are tagged with source and timestamp**
    - **Validates: Requirements 9.3, 9.5**
    - fast-check, ≥100 iterations, tag `Feature: calorie-cortisol-tool, Property 23`

  - [x] 9.9 Write property test for invalid-measurement isolation
    - **Property 24: Reading validation isolates invalid measurements**
    - **Validates: Requirements 9.4**
    - fast-check, ≥100 iterations, tag `Feature: calorie-cortisol-tool, Property 24`

  - [x] 9.10 Write property test for authorization-scoped import
    - **Property 25: Authorization scoping on import**
    - **Validates: Requirements 9.2, 9.8**
    - fast-check, ≥100 iterations, tag `Feature: calorie-cortisol-tool, Property 25`

  - [x] 9.11 Implement questionnaire scoring, tier mapping, and framing
    - Implement `POST /questionnaire`: PSS-10/GAD-7/PSQI scoring within valid ranges, reject incomplete submissions retaining answers, deterministic total-and-single tier mapping via fixed bands, and non-clinical framing text presented before the tier value; plus 30-day/first-access re-prompt scheduling
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6_

  - [x] 9.12 Write property test for questionnaire scoring bounds and completeness gate
    - **Property 26: Questionnaire scoring is bounded and complete-input gated**
    - **Validates: Requirements 10.1, 10.2**
    - fast-check, ≥100 iterations, tag `Feature: calorie-cortisol-tool, Property 26`

  - [x] 9.13 Write property test for total, deterministic tier mapping
    - **Property 27: Tier mapping is total and deterministic**
    - **Validates: Requirements 10.3**
    - fast-check, ≥100 iterations, tag `Feature: calorie-cortisol-tool, Property 27`

  - [x] 9.14 Write property test for non-clinical framing ordering
    - **Property 28: Non-clinical framing precedes the tier value**
    - **Validates: Requirements 10.4**
    - fast-check, ≥100 iterations, tag `Feature: calorie-cortisol-tool, Property 28`

  - [x] 9.15 Implement CAR window validation and diurnal deviation classification
    - Implement `POST /car`: sample-1 within 30 min (±5) of wake, sample-2 25–35 min after sample-1, reject out-of-window while retaining accepted samples, withhold evaluation with <2 valid samples, classify flattened CAR (<50% increase) and elevated-evening alerts
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6_

  - [x] 9.16 Write property test for CAR window validation and completeness
    - **Property 29: CAR sample window validation and completeness**
    - **Validates: Requirements 11.1, 11.2, 11.3**
    - fast-check, ≥100 iterations, tag `Feature: calorie-cortisol-tool, Property 29`

  - [x] 9.17 Write property test for diurnal deviation classification
    - **Property 30: Diurnal deviation classification**
    - **Validates: Requirements 11.5, 11.6**
    - fast-check, ≥100 iterations, tag `Feature: calorie-cortisol-tool, Property 30`

  - [x] 9.18 Implement trend query with range filtering, bands, overlays, and annotations
    - Implement `GET /trend?range=`: 7/30/90-day readings within range plus reference bands, empty-state with retained range, single-metric overlay (calories/sleep/HRV) with no-overlay-data indication, and life-event annotation only for in-range dates
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6_

  - [x] 9.19 Write property test for trend range filtering
    - **Property 31: Trend range filtering**
    - **Validates: Requirements 12.1**
    - fast-check, ≥100 iterations, tag `Feature: calorie-cortisol-tool, Property 31`

  - [x] 9.20 Write property test for life-event annotation range membership
    - **Property 32: Life-event annotation matches range membership**
    - **Validates: Requirements 12.3, 12.4**
    - fast-check, ≥100 iterations, tag `Feature: calorie-cortisol-tool, Property 32`

  - [x] 9.21 Implement lab PDF OCR import and Epic MyChart FHIR import
    - Implement `POST /lab-import` (PDF ≤20 MB, OCR, atomic reject on oversize/wrong-format or OCR failure with prior results retained) and `GET /fhir/import` (Epic MyChart FHIR R4 with failure retaining prior results); physician-ready PDF report generation as an atomic operation
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.7_

  - [x] 9.22 Implement CLIA lab-partner gating
    - Implement partner onboarding gate: enable ingestion iff a CLIA certification with future expiry is verified; otherwise keep disabled and record a compliance indicator
    - _Requirements: 30.1, 30.2_

  - [x] 9.23 Write property test for CLIA lab-partner gating
    - **Property 57: CLIA lab-partner gating**
    - **Validates: Requirements 30.1, 30.2**
    - fast-check, ≥100 iterations, tag `Feature: calorie-cortisol-tool, Property 57`

- [x] 10. Checkpoint - cortisol ingestion and tracking
  - Ensure all tests pass, ask the user if questions arise.

- [x] 11. Implement Insights & ML Service (Python)
  - [x] 11.1 Implement food/cortisol alignment and significance gating
    - Implement `POST /correlate`: align pairs within ±180 min (excluding unpartnered entries without error), and classify significant iff ≥20 aligned pairs ∧ |r| ≥ 0.5 ∧ p < 0.05 in a rolling 30-day window with smart alert, else withhold with "more data required"
    - _Requirements: 15.1, 15.2, 15.3, 15.4_

  - [x] 11.2 Write property test for alignment window correctness
    - **Property 33: Alignment window correctness**
    - **Validates: Requirements 15.1, 15.2**
    - Hypothesis, ≥100 iterations, tag `Feature: calorie-cortisol-tool, Property 33`

  - [x] 11.3 Write property test for significance gating and classification
    - **Property 34: Significance gating and classification**
    - **Validates: Requirements 15.3, 15.4**
    - Hypothesis, ≥100 iterations, tag `Feature: calorie-cortisol-tool, Property 34`

  - [x] 11.4 Implement recurring-pattern surfacing and milestone ranking
    - Implement recurring-pattern detection (same-direction significant relationship on ≥3 separate days in 30-day window) and milestone (30/90/180-day) insight ranking by descending correlation strength
    - _Requirements: 15.5, 15.8_

  - [x] 11.5 Write property test for recurring-pattern threshold
    - **Property 35: Recurring-pattern surfacing threshold**
    - **Validates: Requirements 15.5**
    - Hypothesis, ≥100 iterations, tag `Feature: calorie-cortisol-tool, Property 35`

  - [x] 11.6 Write property test for insight ranking order
    - **Property 36: Insight ranking is sorted by descending correlation strength**
    - **Validates: Requirements 15.8**
    - Hypothesis, ≥100 iterations, tag `Feature: calorie-cortisol-tool, Property 36`

  - [x] 11.7 Implement guidance engine with readiness gate and referral precedence
    - Implement `POST /guidance`: 1–5 approved recommendation cards when ≥7 days of readings, withhold with "more readings required" (retaining readings) below 7 days, and place a professional-referral card above all others when cortisol stays above the referral threshold ≥3 consecutive weeks
    - _Requirements: 13.1, 13.2, 13.4_

  - [x] 11.8 Write property test for guidance card count and readiness gate
    - **Property 37: Guidance card count and readiness gate**
    - **Validates: Requirements 13.1, 13.4**
    - Hypothesis, ≥100 iterations, tag `Feature: calorie-cortisol-tool, Property 37`

  - [x] 11.9 Write property test for referral card precedence
    - **Property 38: Referral card precedence**
    - **Validates: Requirements 13.2**
    - Hypothesis, ≥100 iterations, tag `Feature: calorie-cortisol-tool, Property 38`

  - [x] 11.10 Implement approval filtering, disclaimer injection, and diagnostic-term exclusion
    - Implement the template-constrained LLM layer grounded on user data only: display only "approved" content (exclude draft/pending/revoked, "no guidance available" when none match), mandatory wellness-disclaimer rendering (withhold + unavailable indication if it cannot render), and disallowed diagnostic/condition/treatment term exclusion
    - _Requirements: 13.3, 13.5, 29.1, 29.2, 29.3, 29.4, 29.5_

  - [x] 11.11 Write property test for approved-content-only display
    - **Property 39: Only clinically approved content is ever displayed**
    - **Validates: Requirements 13.3, 13.5, 29.3, 29.4**
    - Hypothesis, ≥100 iterations, tag `Feature: calorie-cortisol-tool, Property 39`

  - [x] 11.12 Write property test for rendered-disclaimer guarantee
    - **Property 40: Displayed insights always carry a rendered disclaimer**
    - **Validates: Requirements 29.2, 29.5**
    - Hypothesis, ≥100 iterations, tag `Feature: calorie-cortisol-tool, Property 40`

  - [x] 11.13 Write property test for diagnostic-language exclusion
    - **Property 41: Insight content excludes diagnostic language**
    - **Validates: Requirements 29.1**
    - Hypothesis, ≥100 iterations, tag `Feature: calorie-cortisol-tool, Property 41`

  - [x] 11.14 Implement weekly digest generation
    - Implement `GET /digest` weekly generation scheduled for Sunday 08:00 local time, emitting a delivery event to the Notification Service
    - _Requirements: 15.6_

- [x] 12. Checkpoint - correlation and insights
  - Ensure all tests pass, ask the user if questions arise.

- [x] 13. Implement Notification Service (Node/TypeScript)
  - [x] 13.1 Implement event-driven notifications and bounded-retry scheduler
    - Implement SQS-consuming push/email/alert delivery (deviation alerts, sync-failure notices, digest delivery, referral prompts) and a shared bounded-retry scheduler that retains the affected data/artifact, retries on the defined schedule (sync 3× at 1/5/15 min; consent-sync 3×; digest 3× at 30 min), and presents a notification/in-app fallback after the final failure
    - _Requirements: 9.7, 15.6, 15.7, 17.5, 27.5_

  - [x] 13.2 Write property test for bounded retry with data retention
    - **Property 50: Bounded retry with data retention**
    - **Validates: Requirements 9.7, 15.7, 17.5, 27.5**
    - fast-check, ≥100 iterations, tag `Feature: calorie-cortisol-tool, Property 50`

- [x] 14. Implement shared client logic (capture, correction, history, offline, sync)
  - [x] 14.1 Implement Camera_Capture media handling
    - Implement single/multi-angle (3 shots at 0/45/90° ±10°) capture, partial-session discard, gallery format/size (≤20 MB) acceptance, ≤60s video sharpest-frame extraction, <50 lux enhancement, and failed/timed-out recognition retaining the input for retry
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 21.6_

  - [x] 14.2 Write property test for failed-recognition input retention
    - **Property 1: Failed recognition retains the captured input**
    - **Validates: Requirements 1.2, 21.6**
    - fast-check, ≥100 iterations, tag `Feature: calorie-cortisol-tool, Property 1`

  - [x] 14.3 Write property test for partial multi-angle discard
    - **Property 2: Partial multi-angle capture is never submitted**
    - **Validates: Requirements 1.5**
    - fast-check, ≥100 iterations, tag `Feature: calorie-cortisol-tool, Property 2`

  - [x] 14.4 Write property test for media acceptance rule
    - **Property 3: Media acceptance matches the format/size rule**
    - **Validates: Requirements 1.6, 1.7**
    - fast-check, ≥100 iterations, tag `Feature: calorie-cortisol-tool, Property 3`

  - [x] 14.5 Write property test for video frame sharpness selection
    - **Property 4: Video frame selection picks maximum sharpness**
    - **Validates: Requirements 1.8**
    - fast-check, ≥100 iterations, tag `Feature: calorie-cortisol-tool, Property 4`

  - [x] 14.6 Write property test for low-light enhancement threshold
    - **Property 5: Low-light enhancement threshold**
    - **Validates: Requirements 1.9**
    - fast-check, ≥100 iterations, tag `Feature: calorie-cortisol-tool, Property 5`

  - [x] 14.7 Implement meal correction and totals recomputation
    - Implement `applyCorrection(mealId, op)`: portion multiplier 0.25×–3× (step 0.25), swap/add(text or barcode)/delete with totals recomputed within 1s, no-match leaves meal unchanged, delete-last-item → zero totals
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.6, 5.7_

  - [x] 14.8 Write property test for meal totals equal item sum
    - **Property 13: Meal totals always equal the sum of current items**
    - **Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.7**
    - fast-check, ≥100 iterations, tag `Feature: calorie-cortisol-tool, Property 13`

  - [x] 14.9 Write property test for failed corrections leaving meal unchanged
    - **Property 14: Failed corrections leave the meal unchanged**
    - **Validates: Requirements 5.6, 7.2, 7.6, 7.8**
    - fast-check, ≥100 iterations, tag `Feature: calorie-cortisol-tool, Property 14`

  - [x] 14.10 Implement personalization training-record queue
    - Record every applied correction as a training input; on enqueue failure retain the applied correction in the food log and queue it for retry
    - _Requirements: 5.5, 5.8_

  - [x] 14.11 Write property test for durable training records
    - **Property 15: Every correction produces a durable training record**
    - **Validates: Requirements 5.5, 5.8**
    - fast-check, ≥100 iterations, tag `Feature: calorie-cortisol-tool, Property 15`

  - [x] 14.12 Implement meal history aggregation, streaks, and insights gating
    - Implement daily/weekly aggregation (empty days as zero), consecutive-day streak (0–3650, reset on gap), and meal-pattern insights gating on ≥7 distinct logged days within the preceding 30 days with an exact-additional-days message otherwise
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7_

  - [x] 14.13 Write property test for range aggregation
    - **Property 16: Range aggregation equals the sum over the range**
    - **Validates: Requirements 6.1, 6.2, 6.3**
    - fast-check, ≥100 iterations, tag `Feature: calorie-cortisol-tool, Property 16`

  - [x] 14.14 Write property test for logging streak definition
    - **Property 17: Logging streak definition**
    - **Validates: Requirements 6.4, 6.5**
    - fast-check, ≥100 iterations, tag `Feature: calorie-cortisol-tool, Property 17`

  - [x] 14.15 Write property test for insights gating on distinct logged days
    - **Property 18: Insights gating on distinct logged days**
    - **Validates: Requirements 6.6, 6.7**
    - fast-check, ≥100 iterations, tag `Feature: calorie-cortisol-tool, Property 18`

  - [x] 14.16 Implement offline inference, pending status, and consent-aware sync engine
    - Implement `inferLocal` with 10s pending fallback, Data Vault record storage with 50 MB free-space rejection, and `syncEngine.push` that on reconnect syncs exactly the consent-permitted records within 60s, bounds retries to 3 (unsynced-marker on exhaustion), and retains both versions on conflict with settings-defined deterministic resolution
    - _Requirements: 27.1, 27.2, 27.3, 27.4, 27.5, 27.6, 17.2_

  - [x] 14.17 Write property test for offline capture storage and pending status
    - **Property 51: Offline capture storage and pending status**
    - **Validates: Requirements 27.1, 27.2, 27.3**
    - fast-check, ≥100 iterations, tag `Feature: calorie-cortisol-tool, Property 51`

  - [x] 14.18 Write property test for reconnect sync completeness and conflict handling
    - **Property 52: Reconnect sync completeness and conflict handling**
    - **Validates: Requirements 27.4, 27.6**
    - fast-check, ≥100 iterations, tag `Feature: calorie-cortisol-tool, Property 52`

  - [x] 14.19 Implement biometric access gate and fallback (client)
    - Implement app-open/resume-after-≥60s gating that hides health data until a successful match, keeps data hidden and allows retry on single failure, denies biometrics after 3 consecutive failures presenting the fallback, and presents the fallback on cancel or unavailable hardware
    - _Requirements: 18.1, 18.3, 18.4, 18.5, 18.6_

  - [x] 14.20 Write property test for biometric access gate and fallback
    - **Property 45: Biometric access gate and fallback**
    - **Validates: Requirements 18.1, 18.3, 18.4, 18.6**
    - fast-check, ≥100 iterations, tag `Feature: calorie-cortisol-tool, Property 45`

  - [x] 14.21 Implement voice food logging and accessibility semantics
    - Implement voice-guided logging (≤60s transcription → meal entry, per-field audible prompt, re-prompt max 3 attempts then alternative input) and WCAG 2.1 AA semantics (accessible name/role/state, ≥4.5:1 / 3:1 contrast, ≥44×44 CSS px targets, focus order, ≤1s screen-reader announcements)
    - _Requirements: 7.3, 7.4, 26.1, 26.2, 26.3, 26.4, 26.5, 26.6_

  - [x] 14.22 Write property test for accessibility semantics completeness
    - **Property 61: Accessibility semantics completeness**
    - **Validates: Requirements 26.1, 26.2, 26.5**
    - fast-check, ≥100 iterations, tag `Feature: calorie-cortisol-tool, Property 61`

- [x] 15. Checkpoint - client core features
  - Ensure all tests pass, ask the user if questions arise.

- [x] 16. Implement API Gateway and cross-cutting enforcement (Node/TypeScript)
  - [x] 16.1 Implement gateway middleware chain and routing
    - Implement TLS termination → JWT auth → rate limiter → consent/residency guard → request validation → route, wiring GraphQL and REST webhook endpoints to the six services, including capacity-shedding responses beyond configured limits
    - _Requirements: 18.1, 23.3, 25.2_

  - [x] 16.2 Implement audit logging middleware
    - Record a complete audit entry (actor, action, record id, timestamp, ≥6-year retention) on every read/create/modify/delete of health data, including denied unauthenticated/unauthorized attempts
    - _Requirements: 25.6, 25.7_

  - [x] 16.3 Write property test for audit entry on every health-data access
    - **Property 54: Audit entry on every health-data access**
    - **Validates: Requirements 25.6, 25.7**
    - fast-check, ≥100 iterations, tag `Feature: calorie-cortisol-tool, Property 54`

  - [x] 16.4 Implement TLS 1.3 / cert-pinning egress guard
    - Implement the transport guard that rejects connections when TLS 1.3 cannot be established or cert-pinning validation fails, transmits zero health-data bytes, and records the failed attempt
    - _Requirements: 25.3_

  - [x] 16.5 Write property test for TLS/cert-pinning egress block
    - **Property 55: TLS/cert-pinning failure blocks all health-data egress**
    - **Validates: Requirements 25.3**
    - fast-check, ≥100 iterations, tag `Feature: calorie-cortisol-tool, Property 55`

  - [x] 16.6 Implement BAA and EU data-residency guards
    - Implement the PHI-exchange BAA gate (block + compliance indicator when no executed BAA) and the EU-residency invariant (EU-resident data stored only in EU regions; block processing + record residency-violation indicator otherwise)
    - _Requirements: 30.3, 30.6, 30.7_

  - [x] 16.7 Write property test for BAA gate on PHI exchange
    - **Property 58: BAA gate on PHI exchange**
    - **Validates: Requirements 30.3**
    - fast-check, ≥100 iterations, tag `Feature: calorie-cortisol-tool, Property 58`

  - [x] 16.8 Write property test for EU data-residency invariant
    - **Property 59: EU data-residency invariant**
    - **Validates: Requirements 30.6, 30.7**
    - fast-check, ≥100 iterations, tag `Feature: calorie-cortisol-tool, Property 59`

  - [x] 16.9 Implement health-check downtime state machine and availability accounting
    - Implement the monitoring subsystem: mark unavailable after 3 consecutive failed 60s checks (record downtime start), available after 3 consecutive successes (record end), retain intervals, and raise availability-breach alerts beyond monthly downtime budgets
    - _Requirements: 24.3, 24.4, 24.5_

  - [x] 16.10 Write property test for health-check downtime state machine
    - **Property 56: Health-check downtime state machine**
    - **Validates: Requirements 24.3, 24.4, 24.5**
    - fast-check, ≥100 iterations, tag `Feature: calorie-cortisol-tool, Property 56`

- [x] 17. Integrate AI/ML model runtime
  - [x] 17.1 Wire Food Vision inference runtimes and model registry
    - Integrate Triton (cloud full-precision) and on-device INT8 Core ML / TFLite variants, DPT/MiDaS depth and multi-angle photogrammetry, YOLOv9 reference detection, MLflow registry, and LaunchDarkly-flagged rollout into the recognition/portion endpoints
    - _Requirements: 2.1, 3.1, 3.2, 3.3_

  - [x] 17.2 Wire cortisol trend prediction model
    - Integrate the Temporal Fusion Transformer (LSTM-Attention fallback) activating after 30 days of data, with demographic-slice bias monitoring, into the Insights & ML correlation/trend outputs
    - _Requirements: 15.8, 11.4_

- [x] 18. Final integration wiring and end-to-end flows
  - [x] 18.1 Wire food-photo → calorie-estimate flow end to end
    - Connect client capture → gateway → Food Vision recognize/portion → Nutrition Lookup → client Data Vault + consent-aware sync + async insights enqueue, honoring the 10s timeout guard
    - _Requirements: 1.1, 2.6, 3.1, 4.1, 21.6, 27.1_

  - [x] 18.2 Wire lab-kit and wearable → cortisol flows end to end
    - Connect kit order/link, lab webhook ingestion, wearable sync, and questionnaire/CAR inputs → TimescaleDB → Notification events → dashboard/insights updates
    - _Requirements: 8.1, 8.4, 9.1, 10.1, 11.1_

  - [x] 18.3 Write integration tests for external ingestion and payment paths
    - Cover lab webhook HL7/FHIR ingestion, Epic MyChart FHIR R4, HealthKit/Health Connect import, Stripe order, and barcode/voice/menu-OCR pipelines (1–3 representative cases each)
    - _Requirements: 8.1, 8.4, 9.1, 14.1, 14.4, 7.1, 7.3, 7.5_

  - [x] 18.4 Write smoke tests for one-time configuration posture
    - Verify ≥2000-category model load, on-device model ≤80 MB, install size ≤150 MB, TLS 1.3/cert-pinning config, and SOC 2 control presence
    - _Requirements: 2.1, 28.2, 28.3, 25.2, 25.4_

  - [x] 18.5 Write performance/load tests for latency and scalability SLOs
    - Cover p95 latency budgets (4G ≤3s / WiFi ≤1.5s / dashboards / cold launch), 10M concurrent users, 10k img/s, ≤0.1% error rate, and autoscale within 300s
    - _Requirements: 21.1, 21.2, 21.3, 21.4, 21.5, 23.1, 23.2, 23.4, 24.1, 24.2_

- [x] 19. Final checkpoint - full system
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP. All property-based tests and the integration/smoke/perf test tasks are optional sub-tasks; core implementation tasks are never optional.
- Each property-based test implements exactly one of the 61 design correctness properties, runs a minimum of 100 generated iterations, and is tagged `Feature: calorie-cortisol-tool, Property {number}`.
- PBT library per language: Hypothesis (Python services), fast-check (Node/TS services and clients), gopter (Go User & Profile service). Do not hand-roll generators/shrinkers.
- Generators must cover the prework edge cases: empty meals, whitespace-only search, confidence exactly at 70%, exactly 20 items, readings at 0.01/100.00, wake-time boundaries 00:00/23:59, streak gaps, EU/non-EU residency, expired vs valid CLIA dates.
- Latency, scalability, uptime-percentage, and one-time configuration requirements (21, 23, 28, and the SLO/config portions of 2, 24, 25) are validated via integration/smoke/perf tests rather than PBT, per the design's testing strategy. Operational-only obligations (signing BAAs, SOC 2 audits, EU region procurement) are exercised through code-level gates and smoke tests, not manual tasks.
- Each task references specific requirements and/or design properties for traceability; checkpoints ensure incremental validation.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.3"] },
    { "id": 2, "tasks": ["2.1", "2.2", "2.3", "2.4", "3.1"] },
    { "id": 3, "tasks": ["3.2", "4.1", "4.4", "4.6", "4.8", "4.12", "6.1", "6.4", "6.8", "7.1", "7.4", "9.1", "9.4", "9.7", "9.11", "9.15", "9.18", "9.21", "9.22", "11.1", "11.4", "11.7", "11.10", "11.14", "13.1", "14.1", "14.7", "14.10", "14.12", "14.16", "14.19", "14.21", "16.1", "16.2", "16.4", "16.6", "16.9"] },
    { "id": 4, "tasks": ["4.2", "4.3", "4.5", "4.7", "4.9", "4.10", "4.11", "6.2", "6.3", "6.5", "6.6", "6.7", "6.9", "7.2", "7.3", "9.2", "9.3", "9.5", "9.6", "9.8", "9.9", "9.10", "9.12", "9.13", "9.14", "9.16", "9.17", "9.19", "9.20", "9.23", "11.2", "11.3", "11.5", "11.6", "11.8", "11.9", "11.11", "11.12", "11.13", "13.2", "14.2", "14.3", "14.4", "14.5", "14.6", "14.8", "14.9", "14.11", "14.13", "14.14", "14.15", "14.17", "14.18", "14.20", "14.22", "16.3", "16.5", "16.7", "16.8", "16.10", "17.1", "17.2"] },
    { "id": 5, "tasks": ["18.1", "18.2"] },
    { "id": 6, "tasks": ["18.3", "18.4", "18.5"] }
  ]
}
```
