/**
 * Event type definitions for the Senior Citizen Health Checkup System.
 * These events drive asynchronous communication between bounded contexts.
 *
 * Validates: Requirements 5.4, 6.2, 7.1, 19.1
 */

/** Base interface for all domain events */
export interface DomainEvent {
  /** Unique identifier for this event instance */
  readonly id: string;
  /** The type discriminator for routing */
  readonly type: EventType;
  /** ISO 8601 timestamp of when the event occurred */
  readonly occurredAt: string;
  /** Correlation ID for tracing related events across services */
  readonly correlationId?: string;
  /** The aggregate/entity ID that produced this event */
  readonly sourceId: string;
}

/** Discriminated union of all event types in the system */
export type EventType =
  | 'TestResultRecorded'
  | 'CheckupSessionCompleted'
  | 'CriticalAlertRaised'
  | 'InvoiceGenerated'
  | 'PaymentProcessed'
  | 'ReportGenerated'
  | 'DeviceReadingStored'
  | 'DeviceReadingAlertRaised'
  | 'DeviceSyncStale';

/**
 * Emitted when a lab technician records a test result.
 * Triggers: Risk Assessment categorization.
 * Requirement 5.4: When all tests complete, session marked complete.
 */
export interface TestResultRecordedEvent extends DomainEvent {
  readonly type: 'TestResultRecorded';
  readonly payload: {
    readonly testResultId: string;
    readonly checkupSessionId: string;
    readonly seniorId: string;
    readonly testType: string;
    readonly measuredValue: number;
    readonly unit: string;
    readonly technicianId: string;
    readonly collectionTimestamp: string;
  };
}

/**
 * Emitted when all tests in a checkup package are completed.
 * Triggers: Report Generation within 5 seconds (Req 5.4),
 *           Risk Assessment analysis (Req 6.1).
 * Requirement 7.1: Health Report generation within 24 hours.
 */
export interface CheckupSessionCompletedEvent extends DomainEvent {
  readonly type: 'CheckupSessionCompleted';
  readonly payload: {
    readonly checkupSessionId: string;
    readonly seniorId: string;
    readonly packageId: string;
    readonly assignedPhysicianId: string;
    readonly completedAt: string;
  };
}

/**
 * Emitted when the Risk Assessment Engine categorizes a result as Critical.
 * Triggers: Notification to assigned Physician within 5 minutes (Req 19.1),
 *           Notification to emergency contact (Req 19.2).
 * Requirement 6.2: Alert to Physician within 30 seconds of categorization.
 */
export interface CriticalAlertRaisedEvent extends DomainEvent {
  readonly type: 'CriticalAlertRaised';
  readonly payload: {
    readonly alertId: string;
    readonly testResultId: string;
    readonly seniorId: string;
    readonly physicianId: string;
    readonly testName: string;
    readonly measuredValue: number;
    readonly unit: string;
    readonly criticalThreshold: number;
    readonly thresholdDirection: 'above' | 'below';
  };
}

/**
 * Emitted when the Billing Engine generates an invoice for a checkup session.
 * Triggers: Billing flow, insurance claim processing.
 * Requirement 9.1: Invoice generated after checkup session completion.
 */
export interface InvoiceGeneratedEvent extends DomainEvent {
  readonly type: 'InvoiceGenerated';
  readonly payload: {
    readonly invoiceId: string;
    readonly invoiceNumber: string;
    readonly checkupSessionId: string;
    readonly seniorId: string;
    readonly totalAmountDue: number;
    readonly currency: string;
  };
}

/**
 * Emitted when a payment is successfully processed.
 * Triggers: Invoice status update, payment confirmation notification.
 * Requirement 10.3: Payment receipt and confirmation sent within 1 minute.
 */
export interface PaymentProcessedEvent extends DomainEvent {
  readonly type: 'PaymentProcessed';
  readonly payload: {
    readonly paymentId: string;
    readonly invoiceId: string;
    readonly seniorId: string;
    readonly amount: number;
    readonly method: string;
    readonly transactionId: string;
  };
}

/**
 * Emitted when a Health Report is generated or regenerated.
 * Triggers: Notification to patient and caregiver (Req 7.9).
 * Requirement 7.1: Report generated within 24 hours of session completion.
 */
export interface ReportGeneratedEvent extends DomainEvent {
  readonly type: 'ReportGenerated';
  readonly payload: {
    readonly reportId: string;
    readonly checkupSessionId: string;
    readonly seniorId: string;
    readonly isRegeneration: boolean;
    readonly generatedAt: string;
  };
}

/**
 * Emitted when a health reading from a connected medical device is successfully stored.
 * Triggers: Daily Health Record aggregation, Alert evaluation.
 * Requirement 4.5: Alert evaluation on each stored reading.
 * Requirement 7.1: Device sync timestamp update.
 */
export interface DeviceReadingStoredEvent extends DomainEvent {
  readonly type: 'DeviceReadingStored';
  readonly payload: {
    readonly readingId: string;
    readonly deviceId: string;
    readonly seniorId: string;
    readonly readingType: string;
    readonly measuredValue: number;
    readonly unit: string;
    readonly timestamp: string;
  };
}

/**
 * Emitted when the Reading Alert Engine detects a reading outside normal range.
 * Triggers: Notification to assigned healthcare provider for critical alerts.
 * Requirement 4.5: Dispatch notification to assigned healthcare provider.
 */
export interface DeviceReadingAlertRaisedEvent extends DomainEvent {
  readonly type: 'DeviceReadingAlertRaised';
  readonly payload: {
    readonly alertId: string;
    readonly seniorId: string;
    readonly readingId: string;
    readonly readingType: string;
    readonly measuredValue: number;
    readonly thresholdBreached: number;
    readonly severity: 'warning' | 'critical';
    readonly direction: 'above' | 'below';
    readonly assignedProviderId: string;
  };
}

/**
 * Emitted when a registered device has not synced for more than 4 hours during daytime.
 * Triggers: Visual indicator on the Reading Dashboard.
 * Requirement 7.1: Device sync status monitoring.
 */
export interface DeviceSyncStaleEvent extends DomainEvent {
  readonly type: 'DeviceSyncStale';
  readonly payload: {
    readonly deviceId: string;
    readonly seniorId: string;
    readonly deviceType: string;
    readonly lastSyncTimestamp: string;
  };
}

/** Union type of all concrete event types for type-safe handling */
export type SystemEvent =
  | TestResultRecordedEvent
  | CheckupSessionCompletedEvent
  | CriticalAlertRaisedEvent
  | InvoiceGeneratedEvent
  | PaymentProcessedEvent
  | ReportGeneratedEvent
  | DeviceReadingStoredEvent
  | DeviceReadingAlertRaisedEvent
  | DeviceSyncStaleEvent;

/** Map from event type string to its corresponding event interface */
export interface EventMap {
  TestResultRecorded: TestResultRecordedEvent;
  CheckupSessionCompleted: CheckupSessionCompletedEvent;
  CriticalAlertRaised: CriticalAlertRaisedEvent;
  InvoiceGenerated: InvoiceGeneratedEvent;
  PaymentProcessed: PaymentProcessedEvent;
  ReportGenerated: ReportGeneratedEvent;
  DeviceReadingStored: DeviceReadingStoredEvent;
  DeviceReadingAlertRaised: DeviceReadingAlertRaisedEvent;
  DeviceSyncStale: DeviceSyncStaleEvent;
}
