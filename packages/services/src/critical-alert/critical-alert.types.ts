/**
 * Critical Alert Escalation State Machine Types
 * Defines the state machine interfaces for managing critical alert lifecycle,
 * escalation transitions, and alert logging.
 *
 * Validates: Requirements 19.1, 19.2, 19.3, 19.4, 19.5
 */

import type { EscalationLevel } from '@health-checkup/shared';

/**
 * Status values for the critical alert state machine.
 * State transitions:
 *   awaiting_physician_ack → escalated_department_head → escalated_facility_admin → acknowledged
 *   Any state → acknowledged (terminal)
 */
export type CriticalAlertStatus =
  | 'awaiting_physician_ack'
  | 'escalated_department_head'
  | 'escalated_facility_admin'
  | 'acknowledged';

/**
 * Input data to create a critical alert.
 */
export interface CriticalAlertData {
  testResultId: string;
  patientName: string;
  patientId: string;
  testName: string;
  resultValue: number;
  criticalThreshold: number;
  thresholdDirection: 'above' | 'below';
  physicianId: string;
  emergencyContactId: string;
  departmentHeadId: string;
  facilityAdminId: string;
  unit?: string;
}

/**
 * Current state of a critical alert in the escalation state machine.
 */
export interface CriticalAlertState {
  alertId: string;
  status: CriticalAlertStatus;
  sentAt: Date;
  physicianId: string;
  emergencyContactId: string;
  departmentHeadId?: string;
  facilityAdminId?: string;
  acknowledgedAt?: Date;
  acknowledgedBy?: string;
  actionStatus?: string;
  escalationHistory: EscalationEvent[];
  alertData: CriticalAlertData;
}

/**
 * An escalation event recorded in the alert lifecycle.
 */
export interface EscalationEvent {
  level: EscalationLevel;
  escalatedAt: Date;
  notifiedId: string;
  acknowledgedAt?: Date;
  acknowledgedBy?: string;
}

/**
 * An action produced by processTimeouts indicating what escalation just occurred.
 */
export interface EscalationAction {
  alertId: string;
  previousStatus: CriticalAlertStatus;
  newStatus: CriticalAlertStatus;
  escalatedTo: string;
  escalationLevel: EscalationLevel;
  escalatedAt: Date;
}

/**
 * Entry in the alert log for audit and retention (7-year retention).
 */
export interface AlertLogEntry {
  id: string;
  alertId: string;
  eventType: 'created' | 'escalated' | 'acknowledged' | 'notification_sent';
  timestamp: Date;
  details: Record<string, unknown>;
  retentionExpiresAt: Date;
}

/**
 * Interface for the critical alert state machine.
 */
export interface ICriticalAlertStateMachine {
  createAlert(alertData: CriticalAlertData): Promise<CriticalAlertState>;
  processTimeouts(currentTime: Date): Promise<EscalationAction[]>;
  acknowledge(alertId: string, responderId: string, actionStatus: string): Promise<CriticalAlertState>;
  getAlertState(alertId: string): Promise<CriticalAlertState>;
  getAlertLog(alertId: string): Promise<AlertLogEntry[]>;
}

/**
 * Repository interface for persisting critical alert states.
 */
export interface CriticalAlertRepository {
  save(state: CriticalAlertState): Promise<CriticalAlertState>;
  findById(alertId: string): Promise<CriticalAlertState | null>;
  findByStatus(status: CriticalAlertStatus): Promise<CriticalAlertState[]>;
  findUnacknowledged(): Promise<CriticalAlertState[]>;
  update(state: CriticalAlertState): Promise<CriticalAlertState>;
}

/**
 * Repository interface for persisting alert log entries.
 */
export interface AlertLogRepository {
  save(entry: AlertLogEntry): Promise<AlertLogEntry>;
  findByAlertId(alertId: string): Promise<AlertLogEntry[]>;
}

/**
 * Dependencies injected into the CriticalAlertService for testability.
 */
export interface CriticalAlertDependencies {
  idGenerator: () => string;
  dateProvider: () => Date;
  alertRepository: CriticalAlertRepository;
  alertLogRepository: AlertLogRepository;
  /** Physician acknowledgement timeout in milliseconds (default: 30 minutes) */
  physicianTimeoutMs: number;
  /** Department head acknowledgement timeout in milliseconds (default: 60 minutes) */
  departmentHeadTimeoutMs: number;
  /** Alert log retention period in years (default: 7) */
  retentionYears: number;
}
