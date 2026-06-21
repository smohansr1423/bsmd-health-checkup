/**
 * Event Wiring — Inter-Service Communication
 *
 * Sets up event bus subscriptions that connect services for asynchronous workflows.
 * Each subscription defines how an event published by one service triggers actions
 * in another service, forming the end-to-end flows:
 *
 *   TestResultRecorded → RiskAssessment → CriticalAlertRaised → Notification/CriticalAlert
 *   CheckupSessionCompleted → ReportGeneration
 *   ReportGenerated → Notification (report available)
 *   InvoiceGenerated → PaymentProcessingService (session initiation ready)
 *   DeviceReadingAlertRaised → Notification (critical device reading alert)
 *
 * Validates: Requirements 5.4, 6.2, 7.1, 19.1, 19.2, 4.5
 */

import type { EventBus, Subscription } from '@health-checkup/shared';
import { AgeGroup, NotificationType } from '@health-checkup/shared';
import type {
  TestResultRecordedEvent,
  CheckupSessionCompletedEvent,
  CriticalAlertRaisedEvent,
  ReportGeneratedEvent,
  InvoiceGeneratedEvent,
  DeviceReadingAlertRaisedEvent,
} from '@health-checkup/shared';

import type {
  RiskAssessmentEngine,
  ReportGenerationService,
  NotificationService,
  CriticalAlertService,
  PaymentProcessingService,
} from '@health-checkup/services';

/**
 * Services that participate in event-driven flows.
 */
export interface EventWiringDependencies {
  riskAssessmentEngine: RiskAssessmentEngine;
  reportGenerationService: ReportGenerationService;
  notificationService: NotificationService;
  criticalAlertService: CriticalAlertService;
  paymentProcessingService: PaymentProcessingService;
}

/**
 * Wires all event bus subscriptions for inter-service communication.
 * Returns the subscription handles for cleanup (useful in testing).
 *
 * Event flow summary:
 * 1. TestResultRecorded → RiskAssessmentEngine categorizes → may publish CriticalAlertRaised
 * 2. CheckupSessionCompleted → ReportGenerationService generates report
 * 3. CriticalAlertRaised → NotificationService sends alert + CriticalAlertService creates alert
 * 4. ReportGenerated → NotificationService sends "report available" notification
 * 5. InvoiceGenerated → signals payment session is ready for initiation
 * 6. DeviceReadingAlertRaised → NotificationService sends critical device reading alert
 */
export function wireEventSubscriptions(
  eventBus: EventBus,
  services: EventWiringDependencies
): Subscription[] {
  const subscriptions: Subscription[] = [];

  // ─── 1. TestResultRecorded → RiskAssessmentEngine ─────────────────────────
  // When a test result is recorded, categorize it and publish a CriticalAlertRaised
  // event if the result is Critical (Requirement 6.2: alert within 30 seconds).
  const testResultSub = eventBus.subscribe('TestResultRecorded', async (event: TestResultRecordedEvent) => {
    try {
      const { payload } = event;

      // Build a minimal TestResult for categorization
      const testResult = {
        id: payload.testResultId,
        checkupSessionId: payload.checkupSessionId,
        seniorId: payload.seniorId,
        testType: payload.testType,
        measuredValue: payload.measuredValue,
        unit: payload.unit,
        technicianId: payload.technicianId,
        collectionTimestamp: new Date(payload.collectionTimestamp),
        amendmentHistory: [],
        createdAt: new Date(event.occurredAt),
      };

      // Use default age group for categorization — in production, resolve from profile
      const ageGroup = AgeGroup.SixtyToSixtyNine;
      const category = services.riskAssessmentEngine.categorizeResult(testResult, ageGroup);

      // If Critical, publish a CriticalAlertRaised event via the engine
      if (category === 'Critical') {
        // publishCriticalAlert is the engine's built-in method that emits the event
        await services.riskAssessmentEngine.publishCriticalAlert(
          testResult,
          AgeGroup.SixtyToSixtyNine,
          payload.technicianId // physician would come from session in production
        );
      }
    } catch (error) {
      // Log but don't propagate — event handlers are best-effort
      console.error('[EventWiring] TestResultRecorded handler error:', error);
    }
  });
  subscriptions.push(testResultSub);

  // ─── 2. CheckupSessionCompleted → ReportGenerationService ─────────────────
  // When all tests in a session are complete, generate the health report.
  // Requirement 7.1: Generate within 24 hours (triggered within 5 seconds per Req 5.4).
  // NOTE: ReportGenerationService also subscribes internally via its constructor,
  // but we wire it here as well for explicit documentation in the composition root.
  const sessionCompletedSub = eventBus.subscribe('CheckupSessionCompleted', async (event: CheckupSessionCompletedEvent) => {
    try {
      await services.reportGenerationService.generateReport(event.payload.checkupSessionId);
    } catch (error) {
      // Best-effort — report can still be manually generated within 24 hours
      console.error('[EventWiring] CheckupSessionCompleted → ReportGeneration error:', error);
    }
  });
  subscriptions.push(sessionCompletedSub);

  // ─── 3. CriticalAlertRaised → NotificationService + CriticalAlertService ──
  // When Risk Assessment detects a Critical result:
  //   a) NotificationService sends critical alert to physician (Req 19.1: within 5 min)
  //   b) CriticalAlertService creates the alert state machine entry for escalation tracking
  const criticalAlertSub = eventBus.subscribe('CriticalAlertRaised', async (event: CriticalAlertRaisedEvent) => {
    try {
      const { payload } = event;

      // a) Send critical alert notification to physician
      await services.notificationService.sendCriticalAlert({
        alertId: payload.alertId,
        recipientId: payload.physicianId,
        testName: payload.testName,
        resultValue: payload.measuredValue,
        criticalThreshold: payload.criticalThreshold,
        thresholdDirection: payload.thresholdDirection,
        patientName: payload.seniorId, // In production, resolve actual name from profile
        timestamp: event.occurredAt,
      });

      // b) Create critical alert state machine entry for escalation tracking
      await services.criticalAlertService.createAlert({
        testResultId: payload.testResultId,
        patientName: payload.seniorId, // In production, resolve actual name
        patientId: payload.seniorId,
        testName: payload.testName,
        resultValue: payload.measuredValue,
        criticalThreshold: payload.criticalThreshold,
        thresholdDirection: payload.thresholdDirection,
        physicianId: payload.physicianId,
        emergencyContactId: `ec_${payload.seniorId}`, // In production, resolve from profile
        departmentHeadId: `dh_${payload.physicianId}`, // In production, resolve from org chart
        facilityAdminId: 'facility_admin_default', // In production, resolve from config
        unit: payload.unit,
      });
    } catch (error) {
      console.error('[EventWiring] CriticalAlertRaised handler error:', error);
    }
  });
  subscriptions.push(criticalAlertSub);

  // ─── 4. ReportGenerated → NotificationService ─────────────────────────────
  // When a report is generated/regenerated, notify the senior citizen.
  // Requirement 7.9: Send notification when report is available.
  const reportGeneratedSub = eventBus.subscribe('ReportGenerated', async (event: ReportGeneratedEvent) => {
    try {
      const { payload } = event;

      const subject = payload.isRegeneration
        ? 'Your updated health report is ready'
        : 'Your health report is ready';

      await services.notificationService.sendNotification({
        recipientId: payload.seniorId,
        type: NotificationType.ReportAvailable,
        subject,
        body: `Your health report for session ${payload.checkupSessionId} is now available. Please log in to view your results.`,
        metadata: {
          reportId: payload.reportId,
          checkupSessionId: payload.checkupSessionId,
        },
      });
    } catch (error) {
      // Notification is best-effort
      console.error('[EventWiring] ReportGenerated → Notification error:', error);
    }
  });
  subscriptions.push(reportGeneratedSub);

  // ─── 5. InvoiceGenerated → Payment session readiness ──────────────────────
  // When an invoice is generated, the payment flow becomes available.
  // This subscription logs the event for observability; actual payment initiation
  // is user-driven via the API endpoint.
  const invoiceGeneratedSub = eventBus.subscribe('InvoiceGenerated', async (event: InvoiceGeneratedEvent) => {
    try {
      const { payload } = event;
      console.log(
        `[EventWiring] Invoice ${payload.invoiceNumber} generated for session ${payload.checkupSessionId}. ` +
        `Amount due: ${payload.totalAmountDue} ${payload.currency}. Payment session can now be initiated.`
      );
      // In production, this could trigger automated insurance claim submission
      // or send a payment reminder notification to the senior citizen.
    } catch (error) {
      console.error('[EventWiring] InvoiceGenerated handler error:', error);
    }
  });
  subscriptions.push(invoiceGeneratedSub);

  // ─── 6. DeviceReadingAlertRaised → NotificationService ────────────────────
  // When the Reading Alert Engine detects a critical device reading,
  // dispatch a notification to the assigned healthcare provider.
  // Requirement 4.5: Notification to assigned provider for critical alerts.
  const deviceAlertSub = eventBus.subscribe('DeviceReadingAlertRaised', async (event: DeviceReadingAlertRaisedEvent) => {
    try {
      const { payload } = event;

      // Only dispatch notifications for critical severity alerts
      if (payload.severity !== 'critical') {
        return;
      }

      await services.notificationService.sendCriticalAlert({
        alertId: payload.alertId,
        recipientId: payload.assignedProviderId,
        testName: payload.readingType,
        resultValue: payload.measuredValue,
        criticalThreshold: payload.thresholdBreached,
        thresholdDirection: payload.direction,
        patientName: payload.seniorId, // In production, resolve actual name from profile
        timestamp: event.occurredAt,
      });
    } catch (error) {
      // Log but don't propagate — event handlers are best-effort
      console.error('[EventWiring] DeviceReadingAlertRaised handler error:', error);
    }
  });
  subscriptions.push(deviceAlertSub);

  return subscriptions;
}
