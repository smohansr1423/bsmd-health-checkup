/**
 * Critical Alert Escalation State Machine - Unit Tests
 * Validates: Requirements 19.1, 19.2, 19.3, 19.4, 19.5
 */

import { EscalationLevel } from '@health-checkup/shared';
import {
  CriticalAlertService,
  InMemoryCriticalAlertRepository,
  InMemoryAlertLogRepository,
} from './critical-alert.service';
import {
  CriticalAlertNotFoundError,
  AlertAlreadyAcknowledgedError,
  IncompleteAcknowledgementError,
  InvalidAlertDataError,
} from './critical-alert.errors';
import type { CriticalAlertData, CriticalAlertDependencies } from './critical-alert.types';

// --- Test Helpers ---

function createTestAlertData(overrides?: Partial<CriticalAlertData>): CriticalAlertData {
  return {
    testResultId: 'result-1',
    patientName: 'John Doe',
    patientId: 'patient-1',
    testName: 'Blood Glucose',
    resultValue: 450,
    criticalThreshold: 400,
    thresholdDirection: 'above',
    physicianId: 'physician-1',
    emergencyContactId: 'emergency-1',
    departmentHeadId: 'dept-head-1',
    facilityAdminId: 'facility-admin-1',
    ...overrides,
  };
}

let idCounter = 0;

function createTestDeps(overrides?: Partial<CriticalAlertDependencies>): Partial<CriticalAlertDependencies> {
  idCounter = 0;
  return {
    idGenerator: () => `test-id-${++idCounter}`,
    dateProvider: () => new Date('2024-03-01T10:00:00.000Z'),
    alertRepository: new InMemoryCriticalAlertRepository(),
    alertLogRepository: new InMemoryAlertLogRepository(),
    physicianTimeoutMs: 30 * 60 * 1000, // 30 minutes
    departmentHeadTimeoutMs: 60 * 60 * 1000, // 60 minutes
    retentionYears: 7,
    ...overrides,
  };
}

// --- Tests ---

describe('CriticalAlertService', () => {
  describe('createAlert', () => {
    it('should create an alert in awaiting_physician_ack state', async () => {
      const deps = createTestDeps();
      const service = new CriticalAlertService(deps);
      const alertData = createTestAlertData();

      const result = await service.createAlert(alertData);

      expect(result.status).toBe('awaiting_physician_ack');
      expect(result.alertId).toBe('test-id-1');
      expect(result.physicianId).toBe('physician-1');
      expect(result.emergencyContactId).toBe('emergency-1');
      expect(result.departmentHeadId).toBe('dept-head-1');
      expect(result.facilityAdminId).toBe('facility-admin-1');
      expect(result.sentAt).toEqual(new Date('2024-03-01T10:00:00.000Z'));
      expect(result.escalationHistory).toHaveLength(0);
      expect(result.acknowledgedAt).toBeUndefined();
      expect(result.alertData).toEqual(alertData);
    });

    it('should include patient name, test, value, threshold, timestamp in alert data (Req 19.1)', async () => {
      const deps = createTestDeps();
      const service = new CriticalAlertService(deps);
      const alertData = createTestAlertData({
        patientName: 'Jane Smith',
        testName: 'LDL Cholesterol',
        resultValue: 250,
        criticalThreshold: 200,
        thresholdDirection: 'above',
      });

      const result = await service.createAlert(alertData);

      expect(result.alertData.patientName).toBe('Jane Smith');
      expect(result.alertData.testName).toBe('LDL Cholesterol');
      expect(result.alertData.resultValue).toBe(250);
      expect(result.alertData.criticalThreshold).toBe(200);
      expect(result.sentAt).toBeDefined();
    });

    it('should log creation event and notification events (Req 19.5)', async () => {
      const logRepo = new InMemoryAlertLogRepository();
      const deps = createTestDeps({ alertLogRepository: logRepo });
      const service = new CriticalAlertService(deps);

      const result = await service.createAlert(createTestAlertData());
      const logs = await logRepo.findByAlertId(result.alertId);

      // Expect: created + physician notification + emergency contact notification
      expect(logs.length).toBe(3);
      expect(logs[0].eventType).toBe('created');
      expect(logs[1].eventType).toBe('notification_sent');
      expect(logs[1].details.recipientType).toBe('physician');
      expect(logs[2].eventType).toBe('notification_sent');
      expect(logs[2].details.recipientType).toBe('emergency_contact');
    });

    it('should set 7-year retention on log entries (Req 19.5)', async () => {
      const logRepo = new InMemoryAlertLogRepository();
      const deps = createTestDeps({ alertLogRepository: logRepo });
      const service = new CriticalAlertService(deps);

      const result = await service.createAlert(createTestAlertData());
      const logs = await logRepo.findByAlertId(result.alertId);

      for (const log of logs) {
        const expectedExpiry = new Date('2024-03-01T10:00:00.000Z');
        expectedExpiry.setFullYear(expectedExpiry.getFullYear() + 7);
        expect(log.retentionExpiresAt).toEqual(expectedExpiry);
      }
    });

    it('should notify emergency contact within same alert creation (Req 19.2)', async () => {
      const logRepo = new InMemoryAlertLogRepository();
      const deps = createTestDeps({ alertLogRepository: logRepo });
      const service = new CriticalAlertService(deps);

      const result = await service.createAlert(createTestAlertData({ emergencyContactId: 'ec-999' }));
      const logs = await logRepo.findByAlertId(result.alertId);

      const ecNotification = logs.find(
        (l) => l.eventType === 'notification_sent' && l.details.recipientType === 'emergency_contact'
      );
      expect(ecNotification).toBeDefined();
      expect(ecNotification!.details.recipientId).toBe('ec-999');
    });

    it('should throw InvalidAlertDataError for missing patientName', async () => {
      const service = new CriticalAlertService(createTestDeps());

      await expect(
        service.createAlert(createTestAlertData({ patientName: '' }))
      ).rejects.toThrow(InvalidAlertDataError);
    });

    it('should throw InvalidAlertDataError for missing physicianId', async () => {
      const service = new CriticalAlertService(createTestDeps());

      await expect(
        service.createAlert(createTestAlertData({ physicianId: '' }))
      ).rejects.toThrow(InvalidAlertDataError);
    });

    it('should throw InvalidAlertDataError for invalid thresholdDirection', async () => {
      const service = new CriticalAlertService(createTestDeps());

      await expect(
        service.createAlert(createTestAlertData({ thresholdDirection: 'invalid' as any }))
      ).rejects.toThrow(InvalidAlertDataError);
    });
  });

  describe('processTimeouts', () => {
    it('should escalate to department head after 30 minutes without ack (Req 19.3)', async () => {
      const deps = createTestDeps();
      const service = new CriticalAlertService(deps);

      await service.createAlert(createTestAlertData());

      // Advance time by 31 minutes
      const escalationTime = new Date('2024-03-01T10:31:00.000Z');
      const actions = await service.processTimeouts(escalationTime);

      expect(actions).toHaveLength(1);
      expect(actions[0].previousStatus).toBe('awaiting_physician_ack');
      expect(actions[0].newStatus).toBe('escalated_department_head');
      expect(actions[0].escalatedTo).toBe('dept-head-1');
      expect(actions[0].escalationLevel).toBe(EscalationLevel.DepartmentHead);
    });

    it('should NOT escalate if within 30 minutes', async () => {
      const deps = createTestDeps();
      const service = new CriticalAlertService(deps);

      await service.createAlert(createTestAlertData());

      // Only 20 minutes elapsed
      const checkTime = new Date('2024-03-01T10:20:00.000Z');
      const actions = await service.processTimeouts(checkTime);

      expect(actions).toHaveLength(0);
    });

    it('should escalate to facility admin after 60 minutes without dept head ack (Req 19.4)', async () => {
      const deps = createTestDeps();
      const service = new CriticalAlertService(deps);

      await service.createAlert(createTestAlertData());

      // First escalation at 31 minutes
      const firstEscalation = new Date('2024-03-01T10:31:00.000Z');
      await service.processTimeouts(firstEscalation);

      // Second escalation at 91 minutes after dept head escalation (61 min after dept head was notified)
      const secondEscalation = new Date('2024-03-01T11:32:00.000Z');
      const actions = await service.processTimeouts(secondEscalation);

      expect(actions).toHaveLength(1);
      expect(actions[0].previousStatus).toBe('escalated_department_head');
      expect(actions[0].newStatus).toBe('escalated_facility_admin');
      expect(actions[0].escalatedTo).toBe('facility-admin-1');
      expect(actions[0].escalationLevel).toBe(EscalationLevel.FacilityAdministrator);
    });

    it('should NOT escalate facility admin if dept head timeout not reached', async () => {
      const deps = createTestDeps();
      const service = new CriticalAlertService(deps);

      await service.createAlert(createTestAlertData());

      // First escalation at 31 minutes
      const firstEscalation = new Date('2024-03-01T10:31:00.000Z');
      await service.processTimeouts(firstEscalation);

      // Only 45 minutes after dept head escalation (not 60)
      const checkTime = new Date('2024-03-01T11:16:00.000Z');
      const actions = await service.processTimeouts(checkTime);

      expect(actions).toHaveLength(0);
    });

    it('should not escalate already acknowledged alerts', async () => {
      const deps = createTestDeps();
      const service = new CriticalAlertService(deps);

      const alert = await service.createAlert(createTestAlertData());
      await service.acknowledge(alert.alertId, 'physician-1', 'patient_contacted');

      // Even after 31 minutes, no escalation should happen
      const checkTime = new Date('2024-03-01T10:31:00.000Z');
      const actions = await service.processTimeouts(checkTime);

      expect(actions).toHaveLength(0);
    });

    it('should not further escalate from facility_admin status', async () => {
      const deps = createTestDeps();
      const service = new CriticalAlertService(deps);

      await service.createAlert(createTestAlertData());

      // First escalation
      await service.processTimeouts(new Date('2024-03-01T10:31:00.000Z'));
      // Second escalation
      await service.processTimeouts(new Date('2024-03-01T11:32:00.000Z'));

      // Much later - no further escalation
      const actions = await service.processTimeouts(new Date('2024-03-01T15:00:00.000Z'));
      expect(actions).toHaveLength(0);
    });

    it('should record escalation events in alert log (Req 19.5)', async () => {
      const logRepo = new InMemoryAlertLogRepository();
      const deps = createTestDeps({ alertLogRepository: logRepo });
      const service = new CriticalAlertService(deps);

      const alert = await service.createAlert(createTestAlertData());

      await service.processTimeouts(new Date('2024-03-01T10:31:00.000Z'));

      const logs = await logRepo.findByAlertId(alert.alertId);
      const escalationLogs = logs.filter((l) => l.eventType === 'escalated');
      expect(escalationLogs).toHaveLength(1);
      expect(escalationLogs[0].details.newStatus).toBe('escalated_department_head');
      expect(escalationLogs[0].details.escalatedTo).toBe('dept-head-1');
    });

    it('should update escalation history on the alert state', async () => {
      const deps = createTestDeps();
      const service = new CriticalAlertService(deps);

      const alert = await service.createAlert(createTestAlertData());
      await service.processTimeouts(new Date('2024-03-01T10:31:00.000Z'));

      const state = await service.getAlertState(alert.alertId);
      expect(state.escalationHistory).toHaveLength(1);
      expect(state.escalationHistory[0].level).toBe(EscalationLevel.DepartmentHead);
      expect(state.escalationHistory[0].notifiedId).toBe('dept-head-1');
    });

    it('should handle multiple unacknowledged alerts', async () => {
      const deps = createTestDeps();
      const service = new CriticalAlertService(deps);

      await service.createAlert(createTestAlertData({ physicianId: 'doc-1' }));
      await service.createAlert(createTestAlertData({ physicianId: 'doc-2' }));

      const actions = await service.processTimeouts(new Date('2024-03-01T10:31:00.000Z'));
      expect(actions).toHaveLength(2);
    });
  });

  describe('acknowledge', () => {
    it('should transition to acknowledged state from awaiting_physician_ack', async () => {
      const deps = createTestDeps();
      const service = new CriticalAlertService(deps);

      const alert = await service.createAlert(createTestAlertData());
      const result = await service.acknowledge(alert.alertId, 'physician-1', 'patient_contacted');

      expect(result.status).toBe('acknowledged');
      expect(result.acknowledgedBy).toBe('physician-1');
      expect(result.actionStatus).toBe('patient_contacted');
      expect(result.acknowledgedAt).toEqual(new Date('2024-03-01T10:00:00.000Z'));
    });

    it('should transition to acknowledged state from escalated_department_head', async () => {
      const deps = createTestDeps();
      const service = new CriticalAlertService(deps);

      const alert = await service.createAlert(createTestAlertData());
      await service.processTimeouts(new Date('2024-03-01T10:31:00.000Z'));

      const result = await service.acknowledge(alert.alertId, 'dept-head-1', 'escalation_reviewed');

      expect(result.status).toBe('acknowledged');
      expect(result.acknowledgedBy).toBe('dept-head-1');
      expect(result.actionStatus).toBe('escalation_reviewed');
    });

    it('should transition to acknowledged state from escalated_facility_admin', async () => {
      const deps = createTestDeps();
      const service = new CriticalAlertService(deps);

      const alert = await service.createAlert(createTestAlertData());
      await service.processTimeouts(new Date('2024-03-01T10:31:00.000Z'));
      await service.processTimeouts(new Date('2024-03-01T11:32:00.000Z'));

      const result = await service.acknowledge(alert.alertId, 'facility-admin-1', 'critical_response_initiated');

      expect(result.status).toBe('acknowledged');
      expect(result.acknowledgedBy).toBe('facility-admin-1');
    });

    it('should record acknowledgement in alert log (Req 19.5)', async () => {
      const logRepo = new InMemoryAlertLogRepository();
      const deps = createTestDeps({ alertLogRepository: logRepo });
      const service = new CriticalAlertService(deps);

      const alert = await service.createAlert(createTestAlertData());
      await service.acknowledge(alert.alertId, 'physician-1', 'patient_contacted');

      const logs = await logRepo.findByAlertId(alert.alertId);
      const ackLog = logs.find((l) => l.eventType === 'acknowledged');
      expect(ackLog).toBeDefined();
      expect(ackLog!.details.responderId).toBe('physician-1');
      expect(ackLog!.details.actionStatus).toBe('patient_contacted');
    });

    it('should update last escalation event with acknowledgement info', async () => {
      const deps = createTestDeps();
      const service = new CriticalAlertService(deps);

      const alert = await service.createAlert(createTestAlertData());
      await service.processTimeouts(new Date('2024-03-01T10:31:00.000Z'));
      await service.acknowledge(alert.alertId, 'dept-head-1', 'reviewed');

      const state = await service.getAlertState(alert.alertId);
      const lastEscalation = state.escalationHistory[state.escalationHistory.length - 1];
      expect(lastEscalation.acknowledgedBy).toBe('dept-head-1');
      expect(lastEscalation.acknowledgedAt).toBeDefined();
    });

    it('should throw CriticalAlertNotFoundError for non-existent alert', async () => {
      const service = new CriticalAlertService(createTestDeps());

      await expect(
        service.acknowledge('nonexistent-id', 'physician-1', 'action')
      ).rejects.toThrow(CriticalAlertNotFoundError);
    });

    it('should throw AlertAlreadyAcknowledgedError for already acknowledged alert', async () => {
      const deps = createTestDeps();
      const service = new CriticalAlertService(deps);

      const alert = await service.createAlert(createTestAlertData());
      await service.acknowledge(alert.alertId, 'physician-1', 'patient_contacted');

      await expect(
        service.acknowledge(alert.alertId, 'physician-1', 'duplicate')
      ).rejects.toThrow(AlertAlreadyAcknowledgedError);
    });

    it('should throw IncompleteAcknowledgementError for empty responderId', async () => {
      const deps = createTestDeps();
      const service = new CriticalAlertService(deps);

      const alert = await service.createAlert(createTestAlertData());

      await expect(
        service.acknowledge(alert.alertId, '', 'action')
      ).rejects.toThrow(IncompleteAcknowledgementError);
    });

    it('should throw IncompleteAcknowledgementError for empty actionStatus', async () => {
      const deps = createTestDeps();
      const service = new CriticalAlertService(deps);

      const alert = await service.createAlert(createTestAlertData());

      await expect(
        service.acknowledge(alert.alertId, 'physician-1', '')
      ).rejects.toThrow(IncompleteAcknowledgementError);
    });
  });

  describe('getAlertState', () => {
    it('should return current alert state', async () => {
      const deps = createTestDeps();
      const service = new CriticalAlertService(deps);

      const alert = await service.createAlert(createTestAlertData());
      const state = await service.getAlertState(alert.alertId);

      expect(state.alertId).toBe(alert.alertId);
      expect(state.status).toBe('awaiting_physician_ack');
    });

    it('should throw CriticalAlertNotFoundError for non-existent alert', async () => {
      const service = new CriticalAlertService(createTestDeps());

      await expect(service.getAlertState('nonexistent')).rejects.toThrow(CriticalAlertNotFoundError);
    });
  });

  describe('getAlertLog', () => {
    it('should return all log entries for an alert', async () => {
      const logRepo = new InMemoryAlertLogRepository();
      const deps = createTestDeps({ alertLogRepository: logRepo });
      const service = new CriticalAlertService(deps);

      const alert = await service.createAlert(createTestAlertData());
      const logs = await service.getAlertLog(alert.alertId);

      // created + physician notification + emergency contact notification
      expect(logs.length).toBe(3);
    });

    it('should throw CriticalAlertNotFoundError for non-existent alert', async () => {
      const service = new CriticalAlertService(createTestDeps());

      await expect(service.getAlertLog('nonexistent')).rejects.toThrow(CriticalAlertNotFoundError);
    });
  });

  describe('full escalation lifecycle', () => {
    it('should progress through all states: created → dept_head → facility_admin → acknowledged', async () => {
      const logRepo = new InMemoryAlertLogRepository();
      const deps = createTestDeps({ alertLogRepository: logRepo });
      const service = new CriticalAlertService(deps);

      // Create alert
      const alert = await service.createAlert(createTestAlertData());
      let state = await service.getAlertState(alert.alertId);
      expect(state.status).toBe('awaiting_physician_ack');

      // 31 min → escalate to dept head
      await service.processTimeouts(new Date('2024-03-01T10:31:00.000Z'));
      state = await service.getAlertState(alert.alertId);
      expect(state.status).toBe('escalated_department_head');
      expect(state.escalationHistory).toHaveLength(1);

      // 61 min after dept head → escalate to facility admin
      await service.processTimeouts(new Date('2024-03-01T11:32:00.000Z'));
      state = await service.getAlertState(alert.alertId);
      expect(state.status).toBe('escalated_facility_admin');
      expect(state.escalationHistory).toHaveLength(2);

      // Acknowledge
      await service.acknowledge(alert.alertId, 'facility-admin-1', 'emergency_response');
      state = await service.getAlertState(alert.alertId);
      expect(state.status).toBe('acknowledged');
      expect(state.acknowledgedBy).toBe('facility-admin-1');

      // Verify full log
      const logs = await service.getAlertLog(alert.alertId);
      const eventTypes = logs.map((l) => l.eventType);
      expect(eventTypes).toContain('created');
      expect(eventTypes).toContain('notification_sent');
      expect(eventTypes).toContain('escalated');
      expect(eventTypes).toContain('acknowledged');

      // All logs should have 7-year retention
      for (const log of logs) {
        expect(log.retentionExpiresAt.getFullYear()).toBeGreaterThanOrEqual(2031);
      }
    });

    it('should allow early acknowledgement at physician level without escalation', async () => {
      const deps = createTestDeps();
      const service = new CriticalAlertService(deps);

      const alert = await service.createAlert(createTestAlertData());

      // Acknowledge within 5 minutes (no escalation)
      await service.acknowledge(alert.alertId, 'physician-1', 'patient_contacted');

      const state = await service.getAlertState(alert.alertId);
      expect(state.status).toBe('acknowledged');
      expect(state.escalationHistory).toHaveLength(0);

      // No further escalation
      const actions = await service.processTimeouts(new Date('2024-03-01T12:00:00.000Z'));
      expect(actions).toHaveLength(0);
    });
  });
});
