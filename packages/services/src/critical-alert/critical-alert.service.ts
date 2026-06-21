/**
 * Critical Alert Escalation State Machine Service
 * Manages the full lifecycle of critical alerts including creation, escalation,
 * acknowledgement, and audit logging with 7-year retention.
 *
 * State transitions:
 *   Alert created → awaiting_physician_ack (30-min timer starts)
 *   30 min without ack → escalated_department_head (60-min timer starts)
 *   60 min without ack → escalated_facility_admin
 *   Acknowledged at any level → acknowledged (terminal state)
 *
 * Validates: Requirements 19.1, 19.2, 19.3, 19.4, 19.5
 */

import { EscalationLevel } from '@health-checkup/shared';
import type {
  CriticalAlertData,
  CriticalAlertState,
  CriticalAlertStatus,
  EscalationEvent,
  EscalationAction,
  AlertLogEntry,
  ICriticalAlertStateMachine,
  CriticalAlertRepository,
  AlertLogRepository,
  CriticalAlertDependencies,
} from './critical-alert.types';
import {
  CriticalAlertNotFoundError,
  AlertAlreadyAcknowledgedError,
  IncompleteAcknowledgementError,
  InvalidAlertDataError,
} from './critical-alert.errors';

/** Default physician acknowledgement timeout: 30 minutes */
const DEFAULT_PHYSICIAN_TIMEOUT_MS = 30 * 60 * 1000;

/** Default department head acknowledgement timeout: 60 minutes */
const DEFAULT_DEPARTMENT_HEAD_TIMEOUT_MS = 60 * 60 * 1000;

/** Default alert log retention: 7 years */
const DEFAULT_RETENTION_YEARS = 7;

/** Default ID generator */
const defaultIdGenerator = (): string => {
  return `ALERT_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
};

/** Default date provider */
const defaultDateProvider = (): Date => new Date();

/**
 * In-memory implementation of CriticalAlertRepository.
 */
export class InMemoryCriticalAlertRepository implements CriticalAlertRepository {
  private alerts: Map<string, CriticalAlertState> = new Map();

  async save(state: CriticalAlertState): Promise<CriticalAlertState> {
    this.alerts.set(state.alertId, { ...state });
    return state;
  }

  async findById(alertId: string): Promise<CriticalAlertState | null> {
    return this.alerts.get(alertId) ?? null;
  }

  async findByStatus(status: CriticalAlertStatus): Promise<CriticalAlertState[]> {
    return Array.from(this.alerts.values()).filter((a) => a.status === status);
  }

  async findUnacknowledged(): Promise<CriticalAlertState[]> {
    return Array.from(this.alerts.values()).filter((a) => a.status !== 'acknowledged');
  }

  async update(state: CriticalAlertState): Promise<CriticalAlertState> {
    this.alerts.set(state.alertId, { ...state });
    return state;
  }

  clear(): void {
    this.alerts.clear();
  }
}

/**
 * In-memory implementation of AlertLogRepository.
 */
export class InMemoryAlertLogRepository implements AlertLogRepository {
  private logs: AlertLogEntry[] = [];

  async save(entry: AlertLogEntry): Promise<AlertLogEntry> {
    this.logs.push(entry);
    return entry;
  }

  async findByAlertId(alertId: string): Promise<AlertLogEntry[]> {
    return this.logs.filter((l) => l.alertId === alertId);
  }

  clear(): void {
    this.logs = [];
  }
}

/**
 * CriticalAlertService implements the escalation state machine.
 *
 * Business rules:
 * - Critical alert sent to physician within 5 minutes of result entry (Req 19.1)
 * - Emergency contact notified within 5 minutes (Req 19.2)
 * - Escalation to department head after 30 minutes without ack (Req 19.3)
 * - Escalation to facility administrator after 60 minutes without ack from dept head (Req 19.4)
 * - All events recorded in alert log with 7-year retention (Req 19.5)
 */
export class CriticalAlertService implements ICriticalAlertStateMachine {
  private readonly idGenerator: () => string;
  private readonly dateProvider: () => Date;
  private readonly alertRepository: CriticalAlertRepository;
  private readonly alertLogRepository: AlertLogRepository;
  private readonly physicianTimeoutMs: number;
  private readonly departmentHeadTimeoutMs: number;
  private readonly retentionYears: number;

  constructor(deps?: Partial<CriticalAlertDependencies>) {
    this.idGenerator = deps?.idGenerator ?? defaultIdGenerator;
    this.dateProvider = deps?.dateProvider ?? defaultDateProvider;
    this.alertRepository = deps?.alertRepository ?? new InMemoryCriticalAlertRepository();
    this.alertLogRepository = deps?.alertLogRepository ?? new InMemoryAlertLogRepository();
    this.physicianTimeoutMs = deps?.physicianTimeoutMs ?? DEFAULT_PHYSICIAN_TIMEOUT_MS;
    this.departmentHeadTimeoutMs = deps?.departmentHeadTimeoutMs ?? DEFAULT_DEPARTMENT_HEAD_TIMEOUT_MS;
    this.retentionYears = deps?.retentionYears ?? DEFAULT_RETENTION_YEARS;
  }

  /**
   * Create a new critical alert and transition to awaiting_physician_ack state.
   *
   * Requirement 19.1: Send critical alert to physician within 5 minutes of result entry.
   * Requirement 19.2: Notify emergency contact within 5 minutes of same result.
   * Requirement 19.5: Record creation event in alert log.
   */
  async createAlert(alertData: CriticalAlertData): Promise<CriticalAlertState> {
    this.validateAlertData(alertData);

    const now = this.dateProvider();
    const alertId = this.idGenerator();

    const state: CriticalAlertState = {
      alertId,
      status: 'awaiting_physician_ack',
      sentAt: now,
      physicianId: alertData.physicianId,
      emergencyContactId: alertData.emergencyContactId,
      departmentHeadId: alertData.departmentHeadId,
      facilityAdminId: alertData.facilityAdminId,
      escalationHistory: [],
      alertData,
    };

    await this.alertRepository.save(state);

    // Log creation event
    await this.logEvent(alertId, 'created', now, {
      physicianId: alertData.physicianId,
      emergencyContactId: alertData.emergencyContactId,
      patientName: alertData.patientName,
      testName: alertData.testName,
      resultValue: alertData.resultValue,
      criticalThreshold: alertData.criticalThreshold,
      thresholdDirection: alertData.thresholdDirection,
    });

    // Log physician notification
    await this.logEvent(alertId, 'notification_sent', now, {
      recipientId: alertData.physicianId,
      recipientType: 'physician',
      patientName: alertData.patientName,
      testName: alertData.testName,
      resultValue: alertData.resultValue,
      criticalThreshold: alertData.criticalThreshold,
      timestamp: now.toISOString(),
    });

    // Log emergency contact notification (Req 19.2)
    await this.logEvent(alertId, 'notification_sent', now, {
      recipientId: alertData.emergencyContactId,
      recipientType: 'emergency_contact',
      patientName: alertData.patientName,
      testName: alertData.testName,
      resultValue: alertData.resultValue,
      criticalThreshold: alertData.criticalThreshold,
      timestamp: now.toISOString(),
    });

    return state;
  }

  /**
   * Process timeouts and escalate alerts that haven't been acknowledged.
   *
   * Requirement 19.3: Escalate to department head after 30 minutes without ack.
   * Requirement 19.4: Escalate to facility administrator after 60 minutes without dept head ack.
   * Requirement 19.5: Record escalation events in alert log.
   */
  async processTimeouts(currentTime: Date): Promise<EscalationAction[]> {
    const unacknowledged = await this.alertRepository.findUnacknowledged();
    const actions: EscalationAction[] = [];

    for (const alert of unacknowledged) {
      const action = this.checkEscalation(alert, currentTime);
      if (action) {
        // Apply state transition
        const previousStatus = alert.status;
        alert.status = action.newStatus;

        const escalationEvent: EscalationEvent = {
          level: action.escalationLevel,
          escalatedAt: currentTime,
          notifiedId: action.escalatedTo,
        };
        alert.escalationHistory.push(escalationEvent);

        await this.alertRepository.update(alert);

        // Log escalation event
        await this.logEvent(alert.alertId, 'escalated', currentTime, {
          previousStatus,
          newStatus: action.newStatus,
          escalatedTo: action.escalatedTo,
          escalationLevel: action.escalationLevel,
        });

        // Log notification sent to escalation target
        await this.logEvent(alert.alertId, 'notification_sent', currentTime, {
          recipientId: action.escalatedTo,
          recipientType: action.escalationLevel,
          reason: `No acknowledgement after timeout from ${previousStatus}`,
        });

        actions.push(action);
      }
    }

    return actions;
  }

  /**
   * Acknowledge a critical alert at the current escalation level.
   *
   * Requirement 19.5: Record acknowledgement event in alert log.
   * Transitions to the terminal 'acknowledged' state.
   *
   * @throws CriticalAlertNotFoundError if alert does not exist
   * @throws AlertAlreadyAcknowledgedError if alert is already acknowledged
   * @throws IncompleteAcknowledgementError if responderId or actionStatus is missing
   */
  async acknowledge(alertId: string, responderId: string, actionStatus: string): Promise<CriticalAlertState> {
    // Validate acknowledgement data
    const missingFields: string[] = [];
    if (!responderId || responderId.trim() === '') {
      missingFields.push('responderId');
    }
    if (!actionStatus || actionStatus.trim() === '') {
      missingFields.push('actionStatus');
    }
    if (missingFields.length > 0) {
      throw new IncompleteAcknowledgementError(alertId, missingFields);
    }

    const alert = await this.alertRepository.findById(alertId);
    if (!alert) {
      throw new CriticalAlertNotFoundError(alertId);
    }

    if (alert.status === 'acknowledged') {
      throw new AlertAlreadyAcknowledgedError(alertId);
    }

    const now = this.dateProvider();
    const previousStatus = alert.status;

    alert.status = 'acknowledged';
    alert.acknowledgedAt = now;
    alert.acknowledgedBy = responderId;
    alert.actionStatus = actionStatus;

    // Update the last escalation event with acknowledgement info
    if (alert.escalationHistory.length > 0) {
      const lastEscalation = alert.escalationHistory[alert.escalationHistory.length - 1];
      lastEscalation.acknowledgedAt = now;
      lastEscalation.acknowledgedBy = responderId;
    }

    await this.alertRepository.update(alert);

    // Log acknowledgement event
    await this.logEvent(alertId, 'acknowledged', now, {
      responderId,
      actionStatus,
      previousStatus,
      acknowledgedAt: now.toISOString(),
    });

    return alert;
  }

  /**
   * Get the current state of a critical alert.
   *
   * @throws CriticalAlertNotFoundError if alert does not exist
   */
  async getAlertState(alertId: string): Promise<CriticalAlertState> {
    const alert = await this.alertRepository.findById(alertId);
    if (!alert) {
      throw new CriticalAlertNotFoundError(alertId);
    }
    return alert;
  }

  /**
   * Get the full alert log for a critical alert.
   * Requirement 19.5: Maintain log of all critical alerts with 7-year retention.
   */
  async getAlertLog(alertId: string): Promise<AlertLogEntry[]> {
    const alert = await this.alertRepository.findById(alertId);
    if (!alert) {
      throw new CriticalAlertNotFoundError(alertId);
    }
    return this.alertLogRepository.findByAlertId(alertId);
  }

  /**
   * Check if an alert needs escalation based on the current time and timeout rules.
   */
  private checkEscalation(alert: CriticalAlertState, currentTime: Date): EscalationAction | null {
    const elapsedSinceSent = currentTime.getTime() - alert.sentAt.getTime();

    if (alert.status === 'awaiting_physician_ack') {
      // Escalate to department head after physician timeout (30 min)
      if (elapsedSinceSent >= this.physicianTimeoutMs) {
        return {
          alertId: alert.alertId,
          previousStatus: 'awaiting_physician_ack',
          newStatus: 'escalated_department_head',
          escalatedTo: alert.departmentHeadId!,
          escalationLevel: EscalationLevel.DepartmentHead,
          escalatedAt: currentTime,
        };
      }
    } else if (alert.status === 'escalated_department_head') {
      // Find when the dept head escalation happened
      const deptHeadEscalation = alert.escalationHistory.find(
        (e) => e.level === EscalationLevel.DepartmentHead
      );
      if (deptHeadEscalation) {
        const elapsedSinceEscalation = currentTime.getTime() - deptHeadEscalation.escalatedAt.getTime();
        // Escalate to facility admin after department head timeout (60 min)
        if (elapsedSinceEscalation >= this.departmentHeadTimeoutMs) {
          return {
            alertId: alert.alertId,
            previousStatus: 'escalated_department_head',
            newStatus: 'escalated_facility_admin',
            escalatedTo: alert.facilityAdminId!,
            escalationLevel: EscalationLevel.FacilityAdministrator,
            escalatedAt: currentTime,
          };
        }
      }
    }

    return null;
  }

  /**
   * Validate alert data before creating an alert.
   */
  private validateAlertData(data: CriticalAlertData): void {
    if (!data.patientName || data.patientName.trim() === '') {
      throw new InvalidAlertDataError('patientName', 'Patient name is required');
    }
    if (!data.testName || data.testName.trim() === '') {
      throw new InvalidAlertDataError('testName', 'Test name is required');
    }
    if (!data.physicianId || data.physicianId.trim() === '') {
      throw new InvalidAlertDataError('physicianId', 'Physician ID is required');
    }
    if (!data.emergencyContactId || data.emergencyContactId.trim() === '') {
      throw new InvalidAlertDataError('emergencyContactId', 'Emergency contact ID is required');
    }
    if (!data.departmentHeadId || data.departmentHeadId.trim() === '') {
      throw new InvalidAlertDataError('departmentHeadId', 'Department head ID is required');
    }
    if (!data.facilityAdminId || data.facilityAdminId.trim() === '') {
      throw new InvalidAlertDataError('facilityAdminId', 'Facility admin ID is required');
    }
    if (data.resultValue === undefined || data.resultValue === null) {
      throw new InvalidAlertDataError('resultValue', 'Result value is required');
    }
    if (data.criticalThreshold === undefined || data.criticalThreshold === null) {
      throw new InvalidAlertDataError('criticalThreshold', 'Critical threshold is required');
    }
    if (!data.thresholdDirection || !['above', 'below'].includes(data.thresholdDirection)) {
      throw new InvalidAlertDataError('thresholdDirection', 'Threshold direction must be "above" or "below"');
    }
  }

  /**
   * Record an event in the alert log with 7-year retention.
   */
  private async logEvent(
    alertId: string,
    eventType: AlertLogEntry['eventType'],
    timestamp: Date,
    details: Record<string, unknown>
  ): Promise<void> {
    const retentionExpiresAt = new Date(timestamp);
    retentionExpiresAt.setFullYear(retentionExpiresAt.getFullYear() + this.retentionYears);

    await this.alertLogRepository.save({
      id: this.idGenerator(),
      alertId,
      eventType,
      timestamp,
      details,
      retentionExpiresAt,
    });
  }
}
