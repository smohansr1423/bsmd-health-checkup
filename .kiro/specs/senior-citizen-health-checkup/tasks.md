# Implementation Plan: Senior Citizen Health Checkup System

## Overview

This implementation plan breaks down the Senior Citizen Health Checkup System into incremental coding tasks. The system is a full-stack TypeScript application with a microservice-oriented architecture, PostgreSQL database, Redis cache, event bus, and an accessible frontend. Each task builds on previous ones and ends with full integration. Property-based tests use fast-check.

## Tasks

- [x] 1. Project setup and shared infrastructure
  - [x] 1.1 Initialize monorepo structure and install dependencies
    - Create monorepo with packages: `shared`, `services`, `api-gateway`, `frontend`
    - Install TypeScript, Node.js, Express, Prisma (or TypeORM), fast-check, Jest, PostgreSQL client, Redis client, event bus library (e.g., bullmq or custom)
    - Configure tsconfig, eslint, prettier for the workspace
    - _Requirements: All (foundational)_

  - [x] 1.2 Define shared TypeScript interfaces, types, and enums
    - Create all core interfaces from the design: `HealthProfile`, `CheckupPackage`, `Appointment`, `CheckupSession`, `TestResult`, `HealthReport`, `FollowUpAction`, `Invoice`, `PaymentRecord`, `InsuranceClaim`, `Notification`, `CriticalAlert`, `AuditEntry`, `Physician`, `AccessibilityPreferences`
    - Create all enums: `Gender`, `SupportedLanguage`, `RiskCategory`, `AgeGroup`, `TestCategory`, `PaymentMethod`, `DeliveryChannel`, `NotificationType`, `EscalationLevel`
    - _Requirements: 1.1, 2.1, 5.1, 6.1, 9.1, 10.1, 12.1, 18.1_

  - [x] 1.3 Set up database schema and migrations
    - Create Prisma schema (or TypeORM entities) for all data models defined in the design
    - Define relations: HealthProfile → CheckupSession → TestResult → HealthReport → FollowUpAction → Invoice → PaymentRecord
    - Add indexes for common queries (seniorId, checkupSessionId, appointmentDate)
    - _Requirements: 1.4, 5.5, 18.3, 18.4_

  - [x] 1.4 Implement event bus infrastructure
    - Create EventBus abstraction with publish/subscribe methods
    - Define event types: `TestResultRecorded`, `CheckupSessionCompleted`, `CriticalAlertRaised`, `InvoiceGenerated`, `PaymentProcessed`, `ReportGenerated`
    - Implement in-memory event bus for development, with interface for production message broker
    - _Requirements: 5.4, 6.2, 7.1, 19.1_

  - [x] 1.5 Implement Auth & Access Control Service
    - Create authentication middleware with JWT token validation
    - Implement role-based access control (Administrator, Physician, Lab_Technician, Senior_Citizen, Caregiver)
    - Implement account lockout after 5 consecutive failures (30-minute lock)
    - Implement session timeout (15-minute inactivity)
    - Create audit logging utility for all data access/modification events
    - _Requirements: 18.1, 18.2, 18.3, 18.5, 18.6, 18.7_

  - [x]* 1.6 Write property tests for Auth & Access Control
    - **Property 37: Role-based access control enforcement**
    - **Validates: Requirements 18.1, 18.7**
    - **Property 38: Account lockout after consecutive failures**
    - **Validates: Requirements 18.2**

- [x] 2. Registration Service
  - [x] 2.1 Implement senior citizen registration with validation
    - Create `RegistrationService` with `registerSeniorCitizen`, `validateAge`, `checkDuplicate` methods
    - Validate age ≥ 60 from date of birth relative to current system date
    - Validate all required fields (full name, date of birth, gender, phone number, emergency contact)
    - Generate unique system identifier for each Health Profile
    - Capture preferred language and accessibility preferences
    - Store medical history, medications, allergies, emergency contacts
    - _Requirements: 1.1, 1.2, 1.4, 1.6, 1.7_

  - [x]* 2.2 Write property tests for registration
    - **Property 1: Registration produces complete Health Profile**
    - **Validates: Requirements 1.1, 1.4, 1.6**
    - **Property 2: Registration rejects invalid inputs**
    - **Validates: Requirements 1.2, 1.7**

  - [x] 2.3 Implement Health Profile update with audit trail
    - Create `updateHealthProfile` method with full audit logging
    - Record modification timestamp and user identity in immutable audit entry
    - _Requirements: 1.3, 18.3_

  - [x]* 2.4 Write property test for profile audit trail
    - **Property 3: Profile updates produce audit entries**
    - **Validates: Requirements 1.3, 18.3**

  - [x] 2.5 Implement duplicate detection
    - Create duplicate check on matching full name + date of birth
    - Return existing profile for review when duplicate detected
    - _Requirements: 1.5_

  - [x]* 2.6 Write property test for duplicate detection
    - **Property 4: Duplicate detection identifies matching registrations**
    - **Validates: Requirements 1.5**

- [x] 3. Checkpoint - Registration
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Checkup Package Configuration Service
  - [x] 4.1 Implement predefined and custom package management
    - Create `CheckupPackageService` with CRUD operations
    - Seed predefined packages: Basic, Standard, Comprehensive with their test compositions
    - Validate custom package test count (1–50)
    - Calculate and display total cost as sum of individual test costs
    - Ensure package modifications don't affect completed checkup sessions
    - _Requirements: 2.1, 2.2, 2.5, 2.6_

  - [x]* 4.2 Write property tests for package configuration
    - **Property 5: Package test count validation**
    - **Validates: Requirements 2.2**
    - **Property 7: Package cost equals sum of test costs**
    - **Validates: Requirements 2.6**
    - **Property 8: Package modifications preserve historical checkup data**
    - **Validates: Requirements 2.5**

  - [x] 4.3 Implement allergy/contraindication conflict detection
    - Check package tests against senior citizen's recorded allergies and contraindications
    - Prevent assignment when conflicts exist, report conflicting tests and corresponding allergies
    - Allow administrator to remove conflicting tests or cancel assignment
    - _Requirements: 2.3, 2.4_

  - [x]* 4.4 Write property test for allergy conflict detection
    - **Property 6: Package allergy conflict detection**
    - **Validates: Requirements 2.3, 2.4**

- [x] 5. Scheduling Service
  - [x] 5.1 Implement appointment scheduling and slot management
    - Create `SchedulingService` with `getAvailableSlots`, `bookAppointment`, `cancelAppointment`, `rescheduleAppointment`
    - Return available slots for next 30 days, max 20 per day, sorted by earliest
    - Allow physician selection from available physicians for the slot
    - Handle no-availability scenario with waiting list
    - Implement alternative physician suggestion when preferred physician unavailable
    - _Requirements: 3.1, 3.4, 3.6, 3.7, 3.8_

  - [x]* 5.2 Write property tests for scheduling
    - **Property 9: Appointment slot display constraints**
    - **Validates: Requirements 3.1**
    - **Property 11: Cancellation offers rescheduling options**
    - **Validates: Requirements 3.4**

  - [x] 5.3 Implement appointment reminders and missed appointment handling
    - Send confirmation notification within 2 minutes of booking (in preferred language)
    - Schedule reminders at 7 days, 2 days, and 1 day before at 9:00 AM local time
    - Mark as missed if no check-in within 30 minutes; notify caregiver; prompt reschedule within 7 days
    - _Requirements: 3.2, 3.3, 3.5_

  - [x]* 5.4 Write property test for reminder calculation
    - **Property 10: Appointment reminder date calculation**
    - **Validates: Requirements 3.3**

- [x] 6. Doctor and Specialist Assignment Service
  - [x] 6.1 Implement physician and specialist assignment logic
    - Create physician registry with qualifications, availability, departments
    - Assign primary physician: prefer most recent preference if available, else next available same specialization
    - Assign specialists by test category: cardiologist (cardiac), ophthalmologist (vision), audiologist (hearing), orthopedist (musculoskeletal)
    - Suggest ≥3 alternatives when preferred physician unavailable (within 30 days)
    - Handle specialist unavailability: notify admin, queue assignment, show earliest date
    - Notify senior citizen of specialist referral assignment within 24 hours
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_

  - [x]* 6.2 Write property tests for assignment logic
    - **Property 12: Physician assignment follows preference with fallback**
    - **Validates: Requirements 4.1**
    - **Property 13: Specialist assignment matches test category**
    - **Validates: Requirements 4.2**

- [x] 7. Checkpoint - Scheduling and Assignment
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Test Execution Service
  - [x] 8.1 Implement test result recording with guards
    - Create `TestExecutionService` with `recordTestResult`, `amendTestResult`, `getTestResults`, `getTestHistory`
    - Only allow recording when session is "in-progress" and test belongs to assigned package
    - Validate plausible range; require explicit confirmation for out-of-range values
    - Display age-adjusted reference range alongside measured value
    - Handle save failures: preserve form data, allow retry
    - _Requirements: 5.1, 5.2, 5.3, 5.6, 5.7_

  - [x]* 8.2 Write property tests for test result recording
    - **Property 14: Test result recording guards**
    - **Validates: Requirements 5.1**
    - **Property 15: Plausible range validation**
    - **Validates: Requirements 5.2, 5.3**
    - **Property 17: Age-adjusted reference range attachment**
    - **Validates: Requirements 5.6**

  - [x] 8.3 Implement session completion and result amendment
    - Mark session "complete" when all package tests have results; trigger report generation within 5 seconds
    - Implement amendment workflow: show existing result, require confirmation, store both original and updated values with timestamps
    - Maintain 10-year retention for all test results
    - _Requirements: 5.4, 5.5, 5.8_

  - [x]* 8.4 Write property tests for session completion and amendments
    - **Property 16: Session completion detection**
    - **Validates: Requirements 5.4**
    - **Property 18: Test result amendment preserves history**
    - **Validates: Requirements 5.8**

- [x] 9. Risk Assessment Engine
  - [x] 9.1 Implement risk categorization and health scoring
    - Create `RiskAssessmentEngine` with `categorizeResult`, `computeHealthScore`, `detectDeterioration`, `getAgeAdjustedRange`
    - Categorize results as Normal/Borderline/Critical based on age-adjusted thresholds
    - Mark as Uncategorized when no reference range defined; notify physician for manual review
    - Compute health score 0–100 (100 = all normal; borderline reduces score; critical reduces more)
    - Generate critical alert to physician within 30 seconds when Critical detected
    - _Requirements: 6.1, 6.2, 6.3, 6.5_

  - [x]* 9.2 Write property tests for risk assessment
    - **Property 19: Risk categorization correctness**
    - **Validates: Requirements 6.1, 6.5**
    - **Property 20: Health score computation invariants**
    - **Validates: Requirements 6.3**

  - [x] 9.3 Implement deterioration detection
    - Compare current results with most recent prior checkup
    - Flag parameters deteriorated >20% relative to age-adjusted normal range
    - Include parameter name, current/previous values, percentage change
    - _Requirements: 6.4_

  - [x]* 9.4 Write property test for deterioration detection
    - **Property 21: Deterioration detection**
    - **Validates: Requirements 6.4**

- [x] 10. Checkpoint - Test Execution and Risk Assessment
  - Ensure all tests pass, ask the user if questions arise.

- [x] 11. Health Report Generation Service
  - [x] 11.1 Implement report generation with dual formats
    - Create `ReportGenerationService` with `generateReport`, `regenerateReport`, `getReport`, `downloadReportPDF`
    - Generate within 24 hours of session completion
    - Produce clinical version (all values, diagnostic notes, reference ranges) and simplified version (health score, risk categories, critical findings, plain language recommendations)
    - Place critical findings in dedicated section at top of report
    - Generate in senior citizen's preferred language (default to system primary)
    - _Requirements: 7.1, 7.2, 7.5, 7.6, 7.7_

  - [x]* 11.2 Write property tests for report generation
    - **Property 23: Critical findings report ordering**
    - **Validates: Requirements 7.6**
    - **Property 24: Partial report generation with pending indicator**
    - **Validates: Requirements 7.8**

  - [x] 11.3 Implement trend charts and partial report handling
    - Omit trend charts if <2 previous sessions; include up to 5 most recent if ≥2 exist
    - Handle pending test results: generate with available results, indicate pending tests, regenerate when results arrive
    - Send notification to senior citizen and caregiver when report available
    - _Requirements: 7.3, 7.4, 7.8, 7.9_

  - [x]* 11.4 Write property test for trend chart rules
    - **Property 22: Report trend chart inclusion rules**
    - **Validates: Requirements 7.3, 7.4**

- [x] 12. Follow-Up Tracker Service
  - [x] 12.1 Implement follow-up action management
    - Create `FollowUpTrackerService` with `assignFollowUp`, `completeFollowUp`, `getDashboard`, `getOverdueActions`
    - Allow up to 20 follow-up actions per report
    - Validate: description 1–500 chars, valid action type, future due date, optional note ≤300 chars
    - Reject past due dates or missing required fields with specific error messages
    - Record completion date and optional notes (≤1000 chars)
    - _Requirements: 8.1, 8.3, 8.6_

  - [x]* 12.2 Write property test for follow-up validation
    - **Property 25: Follow-up action validation**
    - **Validates: Requirements 8.1, 8.6**

  - [x] 12.3 Implement follow-up reminders, escalation, and dashboard
    - Send reminders every 7 days starting 7 days after assignment until complete or expired (>30 days past due)
    - Escalate to physician within 24 hours after due date passes
    - Dashboard showing pending/completed/overdue/expired actions with all required fields
    - _Requirements: 8.2, 8.4, 8.5_

  - [x]* 12.4 Write property test for follow-up status categorization
    - **Property 26: Follow-up action status categorization**
    - **Validates: Requirements 8.5**

- [x] 13. Checkpoint - Reports and Follow-ups
  - Ensure all tests pass, ask the user if questions arise.

- [x] 14. Billing Engine Service
  - [x] 14.1 Implement invoice generation and calculations
    - Create `BillingEngineService` with `generateInvoice`, `finalizeInvoice`, `applyPayment`, `processRefund`, `downloadInvoicePDF`
    - Itemize each test (up to 50 line items) with cost, taxes, discounts
    - Apply configured discount rate (0–100%) per package tier
    - Calculate total: subtotal - discounts - insurance - advance payments (range 0.00–999,999,999.99)
    - All monetary values rounded to 2 decimal places
    - Render invoice in preferred language
    - Assign unique invoice number on finalization; PDF available within 30 seconds
    - Block generation if missing cost data
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.8_

  - [x]* 14.2 Write property tests for billing
    - **Property 27: Invoice calculation correctness**
    - **Validates: Requirements 9.1, 9.2, 9.4**
    - **Property 28: Invoice number uniqueness**
    - **Validates: Requirements 9.6**

  - [x] 14.3 Implement payment status tracking
    - Track outstanding balance: Unpaid / Partially Paid / Paid in Full
    - Update status based on payments received vs amount due
    - _Requirements: 9.7_

  - [x]* 14.4 Write property test for payment status
    - **Property 29: Payment status derivation**
    - **Validates: Requirements 9.7**

- [x] 15. Payment Processing Service
  - [x] 15.1 Implement payment processing with multiple methods
    - Create `PaymentProcessingService` with `initiatePayment`, `processPayment`, `retryPayment`, `setupInstallmentPlan`, `expireSession`
    - Support credit card, debit card, bank transfer, digital wallet
    - Validate payment details (card format, expiry, required fields); process within 30 seconds
    - Generate receipt and send confirmation within 1 minute of success
    - Allow max 5 retry attempts per session after failure
    - Expire session after 10 minutes of inactivity; release holds; allow new session
    - Process refunds to original method within 7 business days
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.6, 10.7_

  - [x]* 15.2 Write property test for payment retry limits
    - **Property 30: Payment retry limit enforcement**
    - **Validates: Requirements 10.4**

  - [x] 15.3 Implement installment plan support
    - Allow installment plans for Comprehensive packages with amount ≥500
    - Split into up to 3 equal monthly installments where sum equals total
    - _Requirements: 10.5_

  - [x]* 15.4 Write property test for installment plan
    - **Property 31: Installment plan computation**
    - **Validates: Requirements 10.5**

- [x] 16. Insurance Integration Service
  - [x] 16.1 Implement insurance policy management and coverage calculation
    - Create `InsuranceIntegrationService` with `recordInsuranceDetails`, `calculateCoverage`, `submitClaim`, `getClaimStatus`, `processClaimApproval`, `processClaimRejection`
    - Record policy: provider, policy number, coverage percentage, max claimable amount
    - Calculate eligible amount: min(invoice × coverage%, max claimable)
    - Display insurance-covered and patient-responsible portions on invoice
    - Cap claims at max claimable amount; assign remainder as patient responsibility
    - _Requirements: 11.1, 11.2, 11.8_

  - [x]* 16.2 Write property test for insurance coverage
    - **Property 32: Insurance coverage calculation**
    - **Validates: Requirements 11.2, 11.8**

  - [x] 16.3 Implement claim submission and status tracking
    - Submit claims with line items, policy number, senior citizen ID; show confirmation with reference number within 30 seconds
    - Track claim status with last update date
    - On approval: reduce invoice balance by approved amount
    - On rejection: notify within 24 hours with reason; mark full amount as patient responsibility
    - Handle communication errors: retain data, allow retry
    - _Requirements: 11.3, 11.4, 11.5, 11.6, 11.7_

  - [x]* 16.4 Write property test for claim approval
    - **Property 33: Claim approval reduces invoice balance**
    - **Validates: Requirements 11.5**

- [x] 17. Checkpoint - Billing and Payments
  - Ensure all tests pass, ask the user if questions arise.

- [x] 18. Notification Service
  - [x] 18.1 Implement multi-channel notification delivery
    - Create `NotificationService` with `sendNotification`, `sendCriticalAlert`, `acknowledgeCriticalAlert`, `escalateAlert`, `configurePreferences`, `getDeliveryLog`
    - Support SMS, email, push, phone call channels
    - Require at least one active channel in preferences
    - Deliver in recipient's preferred language
    - Apply default preferences (in-app push) for new accounts
    - _Requirements: 20.1, 20.2, 20.7, 19.6_

  - [x]* 18.2 Write property test for notification preferences
    - **Property 42: Notification preference minimum channel**
    - **Validates: Requirements 20.2**

  - [x] 18.3 Implement notification fallback, opt-out, and caregiver preferences
    - On primary channel failure: attempt remaining channels in preference order, max 3 fallbacks, ≤5 minutes between attempts
    - Log delivery failure; show indicator on next login when all channels fail
    - Allow caregivers to configure separate preferences
    - Suppress informational messages when opted out; continue critical alerts and appointment reminders
    - _Requirements: 20.3, 20.4, 20.5, 20.6_

  - [x]* 18.4 Write property tests for notification delivery
    - **Property 43: Notification channel fallback ordering**
    - **Validates: Requirements 20.4**
    - **Property 44: Non-critical notification opt-out routing**
    - **Validates: Requirements 20.6**

- [x] 19. Critical Alert and Escalation System
  - [x] 19.1 Implement critical alert escalation state machine
    - Send critical alert to physician within 5 minutes of result entry (include patient name, test, value, threshold, timestamp)
    - Notify emergency contact within 5 minutes of same result
    - If not acknowledged within 30 minutes: escalate to department head
    - If department head doesn't acknowledge within 60 minutes: escalate to facility administrator
    - Record all escalation events in alert log (7-year retention)
    - _Requirements: 19.1, 19.2, 19.3, 19.4, 19.5_

  - [x]* 19.2 Write property test for escalation state machine
    - **Property 39: Critical alert escalation state machine**
    - **Validates: Requirements 19.3, 19.4**

  - [x] 19.3 Implement alert delivery retry and acknowledgement
    - On primary channel failure: retry 3 times at 2-minute intervals; fallback to secondary within 1 minute
    - Acknowledgement requires: responder identity, timestamp, action status selection
    - Reject incomplete acknowledgements
    - _Requirements: 19.7, 19.8_

  - [x]* 19.4 Write property tests for alert delivery and acknowledgement
    - **Property 40: Alert delivery retry and fallback**
    - **Validates: Requirements 19.7**
    - **Property 41: Alert acknowledgement validation**
    - **Validates: Requirements 19.8**

- [x] 20. Checkpoint - Notifications and Alerts
  - Ensure all tests pass, ask the user if questions arise.

- [x] 21. Localization Service
  - [x] 21.1 Implement multi-language translation and formatting
    - Create `LocalizationService` with `translate`, `translateMedicalTerm`, `formatDate`, `formatCurrency`, `formatNumber`, `isRTL`, `getAvailableLanguages`
    - Support 10 languages: en, hi, es, zh, ar, fr, pt, bn, ja, de
    - Format dates, numbers, currency per locale conventions
    - Translate medical terminology with plain-language explanations (≤6th-grade reading level)
    - Fallback to English with visible notification when translation unavailable
    - Apply language switch within 3 seconds without re-login
    - Retain previous language if switch fails; show error notification
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7, 12.9_

  - [x]* 21.2 Write property tests for localization
    - **Property 34: Translation completeness**
    - **Validates: Requirements 12.2, 12.3, 12.7**
    - **Property 35: Locale-specific formatting**
    - **Validates: Requirements 12.5**

  - [x] 21.3 Implement RTL layout support
    - Detect RTL for Arabic; mirror interface layout for all text, navigation, directional UI elements
    - _Requirements: 12.8_

  - [x]* 21.4 Write property test for RTL detection
    - **Property 36: RTL detection**
    - **Validates: Requirements 12.8**

- [x] 22. Accessibility Manager and Voice Assistance
  - [x] 22.1 Implement accessibility settings and WCAG compliance infrastructure
    - Create `AccessibilityManager` with `getAccessibilitySettings`, `updateAccessibilitySettings`, `getSimplifiedNavigation`
    - WCAG 2.1 AA: minimum 16px font, scaling to 200%, contrast ratio ≥4.5:1 (normal) / ≥3:1 (large)
    - Keyboard-only navigation with 2px focus indicators
    - ARIA labels, roles, live region announcements
    - Large button mode: min 44×44px target, 8px spacing
    - Captions/transcripts for all audio/video
    - Simplified navigation: ≤6 top-level items, prominent common actions
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.7, 13.8, 13.9_

  - [x]* 22.2 Write property test for simplified navigation
    - **Property 50: Simplified navigation item limit**
    - **Validates: Requirements 13.9**

  - [x] 22.3 Implement voice assistance module
    - Create `processVoiceCommand`, `generateAudioFeedback` methods
    - Read page headings, form labels, navigation options within 2 seconds
    - Audio confirmation for completed actions within 2 seconds
    - Announce errors with field name through audio within 2 seconds
    - Support commands: "next", "back", "home", "appointments", "reports"
    - Pause playback within 500ms when user speaks; resume after 2 seconds of silence
    - Audio prompt if command not recognized within 5 seconds
    - Announce voice assistance activation with summary of commands
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.7_

  - [x]* 22.4 Write property test for voice commands
    - **Property 49: Voice command recognition**
    - **Validates: Requirements 14.4**

- [x] 23. Checkpoint - Localization and Accessibility
  - Ensure all tests pass, ask the user if questions arise.

- [x] 24. Analytics Service - Patient Dashboard
  - [x] 24.1 Implement patient health trends and summary
    - Create `AnalyticsService` with `getPatientTrends`, `getPatientSummaryCard`, `getBenchmarks`
    - Display trend lines per health parameter (max 50 data points per parameter)
    - Summary card: health score 0–100, point change from previous, count of high/critical parameters
    - Filter by date range (1 month–5 years), test category, risk level
    - Highlight parameters with 3+ consecutive abnormal readings with visual warning
    - Show comparative benchmarks by age group (10-year brackets)
    - Display "insufficient data" message if <2 checkups; hide trend section
    - Display "benchmark unavailable" if no data for age group
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 15.6, 15.7_

  - [x]* 24.2 Write property tests for patient analytics
    - **Property 45: Analytics trend data point limiting**
    - **Validates: Requirements 15.1**
    - **Property 46: Consecutive abnormal parameter warning**
    - **Validates: Requirements 15.4**

- [x] 25. Analytics Service - Physician Dashboard
  - [x] 25.1 Implement physician population health dashboard
    - Create `getPhysicianDashboard` method
    - Aggregated health scores, risk distributions, top 5 health issues by patient count
    - Percentage of Normal/Borderline/Critical per test type (must sum to 100%)
    - Follow-up compliance rate: completed vs pending (30-day rolling)
    - Update aggregated statistics within 1 hour of data entry
    - Export CSV/PDF (up to 10,000 records)
    - Appointment utilization: scheduled vs completed per month (12 months)
    - Handle no-data scenario: display message, metrics at zero/empty
    - _Requirements: 16.1, 16.2, 16.3, 16.4, 16.5, 16.6, 16.7_

  - [x]* 25.2 Write property test for physician dashboard
    - **Property 47: Physician dashboard percentage invariant**
    - **Validates: Requirements 16.2**

- [x] 26. Analytics Service - Admin Dashboard
  - [x] 26.1 Implement administrative reporting and operational analytics
    - Create `getAdminDashboard`, `exportData`, `scheduleAutomatedReport` methods
    - Reports: registrations, active patients, completed checkups, revenue (daily/weekly/monthly/quarterly/yearly)
    - Resource utilization: physician workload %, lab capacity %, slot occupancy %
    - Financial summary within 30 seconds of request
    - Package popularity: count and % distribution of Basic/Standard/Comprehensive
    - Multi-language usage: count and % distribution of preferred languages
    - Schedule automated reports (daily/weekly/monthly) with email delivery
    - Retry generation 3 times at 5-minute intervals on failure; notify admin if all fail
    - Data freshness ≤15 minutes; show last refresh timestamp
    - _Requirements: 17.1, 17.2, 17.3, 17.4, 17.5, 17.6, 17.7, 17.8_

  - [x]* 26.2 Write property test for admin statistics
    - **Property 48: Administrative statistics percentage distribution**
    - **Validates: Requirements 17.4, 17.6**

- [x] 27. Checkpoint - Analytics
  - Ensure all tests pass, ask the user if questions arise.

- [x] 28. API Gateway and Integration Layer
  - [x] 28.1 Implement API Gateway with routing, auth middleware, and rate limiting
    - Create Express-based API Gateway (BFF pattern)
    - Route requests to appropriate services
    - Apply auth middleware for all protected routes
    - Add rate limiting per endpoint
    - Implement request validation and error formatting
    - _Requirements: 18.1, 18.4, 18.5_

  - [x] 28.2 Wire all services through the API Gateway
    - Create REST endpoints for each service interface defined in the design
    - Connect event bus subscriptions between services (e.g., TestResultRecorded → RiskAssessment → CriticalAlert → Notification)
    - Ensure end-to-end flows: Registration → Scheduling → TestExecution → RiskAssessment → Report → FollowUp → Billing → Payment
    - _Requirements: All (integration)_

- [x] 29. Frontend - Core Accessible UI
  - [x] 29.1 Set up accessible frontend framework
    - Initialize React/Next.js app with TypeScript
    - Configure accessibility testing (axe-core integration)
    - Set up i18n framework for 10 languages with RTL support
    - Implement theme system: default, high-contrast-light, high-contrast-dark
    - Create base accessible components: buttons (44×44px large mode), forms, navigation
    - Implement keyboard navigation with 2px visible focus indicators
    - Set up screen reader compatibility (ARIA labels, roles, live regions)
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.7, 13.9_

  - [x] 29.2 Implement registration and profile management UI
    - Registration form with all required fields and validation messages
    - Language and accessibility preference selection
    - Duplicate detection warning display
    - Profile view and edit with audit trail awareness
    - _Requirements: 1.1, 1.2, 1.5, 1.6, 1.7_

  - [x] 29.3 Implement scheduling and appointment UI
    - Available slot display (30 days, max 20/day, sorted)
    - Physician selection and alternative suggestions
    - Appointment confirmation, cancellation, rescheduling flows
    - Waiting list enrollment
    - _Requirements: 3.1, 3.4, 3.6, 3.7, 3.8_

  - [x] 29.4 Implement test result recording UI (Lab Technician)
    - Test result entry form with plausible range validation
    - Visual warning for out-of-range values with confirmation dialog
    - Age-adjusted reference range display
    - Amendment workflow with original/updated value display
    - Error handling: preserve data on failure, allow retry
    - _Requirements: 5.1, 5.2, 5.3, 5.6, 5.7, 5.8_

  - [x] 29.5 Implement health report viewing and download UI
    - Clinical and simplified report views
    - Critical findings section at top
    - Trend charts (when applicable)
    - PDF download
    - Pending test indicator
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.8_

  - [x] 29.6 Implement billing, payment, and insurance UI
    - Invoice display with line items, discounts, insurance coverage
    - Multi-method payment form with validation
    - Installment plan setup
    - Payment receipt and status tracking
    - Insurance claim submission and status display
    - _Requirements: 9.1, 9.5, 9.7, 10.1, 10.3, 10.5, 11.3, 11.4_

  - [x] 29.7 Implement analytics dashboards UI
    - Patient trend charts with filters and benchmarks
    - Summary card (health score, change, critical count)
    - Physician population health dashboard
    - Admin operational dashboard with export and scheduling
    - _Requirements: 15.1, 15.2, 15.3, 15.5, 16.1, 16.5, 17.1, 17.5_

  - [x] 29.8 Implement notification preferences and alert UI
    - Channel configuration (min 1 required)
    - Opt-out settings for non-critical notifications
    - Critical alert display and acknowledgement flow
    - Undelivered notification indicator
    - _Requirements: 20.1, 20.2, 20.5, 20.6, 19.8_

- [x] 30. Checkpoint - Frontend
  - Ensure all tests pass, ask the user if questions arise.

- [x] 31. Integration testing and final wiring
  - [x]* 31.1 Write integration tests for critical workflows
    - Test end-to-end: Registration → Package Assignment → Scheduling → Test Execution → Report → Follow-up → Billing → Payment
    - Test critical result flow: Test recording → Risk alert → Escalation → Acknowledgement
    - Test insurance flow: Registration with insurance → Checkup → Invoice → Claim → Approval → Balance update
    - Test notification delivery with fallback channels
    - Test language switch and RTL rendering
    - _Requirements: All (integration)_

  - [x]* 31.2 Write accessibility automated tests
    - Run axe-core audits on all pages
    - Verify keyboard navigation flow
    - Verify contrast ratios in all themes
    - Verify large button mode target sizes
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.7_

- [x] 32. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation throughout implementation
- Property tests validate universal correctness properties from the design document using fast-check
- Unit tests validate specific examples and edge cases
- The system uses TypeScript throughout (backend and frontend)
- All monetary calculations use 2-decimal-place rounding
- All date/time handling must be timezone-aware
- Event-driven communication between services enables loose coupling
- HIPAA-compliant patterns (encryption at rest/in transit, audit logging, access control) are implemented from the start

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.4"] },
    { "id": 2, "tasks": ["1.3", "1.5", "1.6"] },
    { "id": 3, "tasks": ["2.1", "4.1", "21.1"] },
    { "id": 4, "tasks": ["2.2", "2.3", "4.2", "4.3", "21.2", "21.3"] },
    { "id": 5, "tasks": ["2.4", "2.5", "4.4", "21.4", "5.1"] },
    { "id": 6, "tasks": ["2.6", "5.2", "5.3", "6.1"] },
    { "id": 7, "tasks": ["5.4", "6.2", "8.1"] },
    { "id": 8, "tasks": ["8.2", "8.3"] },
    { "id": 9, "tasks": ["8.4", "9.1"] },
    { "id": 10, "tasks": ["9.2", "9.3"] },
    { "id": 11, "tasks": ["9.4", "11.1", "12.1"] },
    { "id": 12, "tasks": ["11.2", "11.3", "12.2", "12.3"] },
    { "id": 13, "tasks": ["11.4", "12.4", "14.1"] },
    { "id": 14, "tasks": ["14.2", "14.3", "15.1"] },
    { "id": 15, "tasks": ["14.4", "15.2", "15.3", "16.1"] },
    { "id": 16, "tasks": ["15.4", "16.2", "16.3"] },
    { "id": 17, "tasks": ["16.4", "18.1"] },
    { "id": 18, "tasks": ["18.2", "18.3", "19.1"] },
    { "id": 19, "tasks": ["18.4", "19.2", "19.3"] },
    { "id": 20, "tasks": ["19.4", "22.1"] },
    { "id": 21, "tasks": ["22.2", "22.3"] },
    { "id": 22, "tasks": ["22.4", "24.1"] },
    { "id": 23, "tasks": ["24.2", "25.1"] },
    { "id": 24, "tasks": ["25.2", "26.1"] },
    { "id": 25, "tasks": ["26.2", "28.1"] },
    { "id": 26, "tasks": ["28.2"] },
    { "id": 27, "tasks": ["29.1"] },
    { "id": 28, "tasks": ["29.2", "29.3", "29.4"] },
    { "id": 29, "tasks": ["29.5", "29.6", "29.7", "29.8"] },
    { "id": 30, "tasks": ["31.1", "31.2"] }
  ]
}
```
