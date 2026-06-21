/**
 * Unit tests for Follow-Up Tracker Service
 * Validates: Requirements 8.1, 8.3, 8.6
 */

import {
  FollowUpTrackerService,
  InMemoryFollowUpActionRepository,
} from './follow-up.service';
import { validateAssignmentRequest, validateCompletionNotes } from './follow-up.validators';
import {
  FollowUpValidationError,
  MaxFollowUpActionsExceededError,
  FollowUpNotFoundError,
  FollowUpAlreadyCompletedError,
} from './follow-up.errors';
import type { FollowUpAssignmentRequest, ReportContext } from './follow-up.types';

/** Helper to create a valid assignment request */
function createValidRequest(overrides?: Partial<FollowUpAssignmentRequest>): FollowUpAssignmentRequest {
  return {
    reportId: 'report-1',
    description: 'Schedule follow-up appointment with cardiologist',
    actionType: 'specialist_referral',
    dueDate: new Date('2025-03-01'),
    assigneeNote: 'High priority',
    ...overrides,
  };
}

/** Default report context for testing */
const defaultContext: ReportContext = {
  reportId: 'report-1',
  seniorId: 'senior-1',
  physicianId: 'physician-1',
};

describe('FollowUpTrackerService', () => {
  let service: FollowUpTrackerService;
  let idCounter: number;
  const fixedDate = new Date('2025-01-15T10:00:00Z');

  beforeEach(() => {
    idCounter = 0;
    service = new FollowUpTrackerService({
      idGenerator: () => `FA_${++idCounter}`,
      dateProvider: () => fixedDate,
      repository: new InMemoryFollowUpActionRepository(),
    });
    service.registerReportContext(defaultContext);
  });

  describe('assignFollowUp (Req 8.1, 8.6)', () => {
    it('should create a follow-up action with all required fields', async () => {
      const request = createValidRequest();
      const action = await service.assignFollowUp(request);

      expect(action.id).toBe('FA_1');
      expect(action.reportId).toBe('report-1');
      expect(action.seniorId).toBe('senior-1');
      expect(action.description).toBe('Schedule follow-up appointment with cardiologist');
      expect(action.actionType).toBe('specialist_referral');
      expect(action.dueDate).toEqual(new Date('2025-03-01'));
      expect(action.assigneeNote).toBe('High priority');
      expect(action.status).toBe('pending');
      expect(action.assignedDate).toEqual(fixedDate);
      expect(action.assignedPhysicianId).toBe('physician-1');
    });

    it('should generate unique IDs for each action', async () => {
      const action1 = await service.assignFollowUp(createValidRequest());
      const action2 = await service.assignFollowUp(createValidRequest({
        description: 'Another follow-up',
      }));

      expect(action1.id).toBe('FA_1');
      expect(action2.id).toBe('FA_2');
      expect(action1.id).not.toBe(action2.id);
    });

    it('should allow action without assignee note', async () => {
      const request = createValidRequest({ assigneeNote: undefined });
      const action = await service.assignFollowUp(request);

      expect(action.assigneeNote).toBeUndefined();
    });

    it('should support all valid action types', async () => {
      const actionTypes = [
        'specialist_referral',
        'medication_change',
        'lifestyle_recommendation',
        'next_checkup_date',
      ] as const;

      for (const actionType of actionTypes) {
        const action = await service.assignFollowUp(createValidRequest({ actionType }));
        expect(action.actionType).toBe(actionType);
      }
    });

    it('should reject when description is empty', async () => {
      const request = createValidRequest({ description: '' });

      await expect(service.assignFollowUp(request)).rejects.toThrow(FollowUpValidationError);
      await expect(service.assignFollowUp(request)).rejects.toThrow(/description/i);
    });

    it('should reject when description exceeds 500 characters', async () => {
      const request = createValidRequest({ description: 'x'.repeat(501) });

      await expect(service.assignFollowUp(request)).rejects.toThrow(FollowUpValidationError);
      await expect(service.assignFollowUp(request)).rejects.toThrow(/500/);
    });

    it('should accept description at exactly 500 characters', async () => {
      const request = createValidRequest({ description: 'x'.repeat(500) });
      const action = await service.assignFollowUp(request);

      expect(action.description).toHaveLength(500);
    });

    it('should accept description at exactly 1 character', async () => {
      const request = createValidRequest({ description: 'A' });
      const action = await service.assignFollowUp(request);

      expect(action.description).toBe('A');
    });

    it('should reject invalid action type', async () => {
      const request = createValidRequest({ actionType: 'invalid_type' as any });

      await expect(service.assignFollowUp(request)).rejects.toThrow(FollowUpValidationError);
      await expect(service.assignFollowUp(request)).rejects.toThrow(/actionType/i);
    });

    it('should reject past due date', async () => {
      const request = createValidRequest({ dueDate: new Date('2024-12-01') });

      await expect(service.assignFollowUp(request)).rejects.toThrow(FollowUpValidationError);
      await expect(service.assignFollowUp(request)).rejects.toThrow(/future/i);
    });

    it('should reject due date equal to current time', async () => {
      const request = createValidRequest({ dueDate: fixedDate });

      await expect(service.assignFollowUp(request)).rejects.toThrow(FollowUpValidationError);
      await expect(service.assignFollowUp(request)).rejects.toThrow(/future/i);
    });

    it('should reject assignee note exceeding 300 characters', async () => {
      const request = createValidRequest({ assigneeNote: 'x'.repeat(301) });

      await expect(service.assignFollowUp(request)).rejects.toThrow(FollowUpValidationError);
      await expect(service.assignFollowUp(request)).rejects.toThrow(/300/);
    });

    it('should accept assignee note at exactly 300 characters', async () => {
      const request = createValidRequest({ assigneeNote: 'x'.repeat(300) });
      const action = await service.assignFollowUp(request);

      expect(action.assigneeNote).toHaveLength(300);
    });

    it('should reject when reportId is missing', async () => {
      const request = createValidRequest({ reportId: '' });

      await expect(service.assignFollowUp(request)).rejects.toThrow(FollowUpValidationError);
      await expect(service.assignFollowUp(request)).rejects.toThrow(/reportId/i);
    });

    it('should enforce maximum of 20 follow-up actions per report', async () => {
      // Create 20 actions
      for (let i = 0; i < 20; i++) {
        await service.assignFollowUp(
          createValidRequest({ description: `Follow-up ${i + 1}` })
        );
      }

      // 21st should be rejected
      await expect(
        service.assignFollowUp(createValidRequest({ description: 'Follow-up 21' }))
      ).rejects.toThrow(MaxFollowUpActionsExceededError);
    });

    it('should throw when report context is not registered', async () => {
      const request = createValidRequest({ reportId: 'unregistered-report' });

      await expect(service.assignFollowUp(request)).rejects.toThrow(/Report context not found/);
    });
  });

  describe('completeFollowUp (Req 8.3)', () => {
    it('should mark action as completed with completion date', async () => {
      const action = await service.assignFollowUp(createValidRequest());

      const completed = await service.completeFollowUp(action.id);

      expect(completed.status).toBe('completed');
      expect(completed.completionDate).toEqual(fixedDate);
    });

    it('should record optional completion notes', async () => {
      const action = await service.assignFollowUp(createValidRequest());

      const completed = await service.completeFollowUp(action.id, 'Patient responded well to treatment.');

      expect(completed.completionNotes).toBe('Patient responded well to treatment.');
    });

    it('should allow completion without notes', async () => {
      const action = await service.assignFollowUp(createValidRequest());

      const completed = await service.completeFollowUp(action.id);

      expect(completed.completionNotes).toBeUndefined();
    });

    it('should reject completion notes exceeding 1000 characters', async () => {
      const action = await service.assignFollowUp(createValidRequest());

      await expect(
        service.completeFollowUp(action.id, 'x'.repeat(1001))
      ).rejects.toThrow(FollowUpValidationError);
      await expect(
        service.completeFollowUp(action.id, 'x'.repeat(1001))
      ).rejects.toThrow(/1000/);
    });

    it('should accept completion notes at exactly 1000 characters', async () => {
      const action = await service.assignFollowUp(createValidRequest());
      const notes = 'x'.repeat(1000);

      const completed = await service.completeFollowUp(action.id, notes);

      expect(completed.completionNotes).toHaveLength(1000);
    });

    it('should throw FollowUpNotFoundError for non-existent action', async () => {
      await expect(
        service.completeFollowUp('nonexistent-id')
      ).rejects.toThrow(FollowUpNotFoundError);
    });

    it('should throw FollowUpAlreadyCompletedError for already-completed action', async () => {
      const action = await service.assignFollowUp(createValidRequest());
      await service.completeFollowUp(action.id);

      await expect(
        service.completeFollowUp(action.id)
      ).rejects.toThrow(FollowUpAlreadyCompletedError);
    });
  });

  describe('getDashboard', () => {
    it('should return empty dashboard when no actions exist', async () => {
      const dashboard = await service.getDashboard('senior-1');

      expect(dashboard.seniorId).toBe('senior-1');
      expect(dashboard.actions).toHaveLength(0);
      expect(dashboard.summary).toEqual({
        pending: 0,
        completed: 0,
        overdue: 0,
        expired: 0,
        total: 0,
      });
    });

    it('should categorize pending actions correctly', async () => {
      await service.assignFollowUp(createValidRequest({
        dueDate: new Date('2025-02-01'), // future date
      }));

      const dashboard = await service.getDashboard('senior-1');

      expect(dashboard.summary.pending).toBe(1);
      expect(dashboard.actions[0].status).toBe('pending');
    });

    it('should categorize completed actions correctly', async () => {
      const action = await service.assignFollowUp(createValidRequest());
      await service.completeFollowUp(action.id);

      const dashboard = await service.getDashboard('senior-1');

      expect(dashboard.summary.completed).toBe(1);
      expect(dashboard.actions[0].status).toBe('completed');
    });

    it('should categorize overdue actions (past due, within 30 days)', async () => {
      // Use a service with a "future" date to make the action overdue
      const futureDate = new Date('2025-03-10T10:00:00Z'); // past the due date of 2025-03-01
      const futureService = new FollowUpTrackerService({
        idGenerator: () => `FA_${++idCounter}`,
        dateProvider: () => futureDate,
        repository: (service as any).repository,
      });
      futureService.registerReportContext(defaultContext);

      await service.assignFollowUp(createValidRequest({
        dueDate: new Date('2025-03-01'),
      }));

      const dashboard = await futureService.getDashboard('senior-1');

      expect(dashboard.summary.overdue).toBe(1);
      expect(dashboard.actions[0].status).toBe('overdue');
    });

    it('should categorize expired actions (more than 30 days past due)', async () => {
      // Use a service with a date >30 days past the due date
      const farFutureDate = new Date('2025-04-15T10:00:00Z'); // >30 days past 2025-03-01
      const farFutureService = new FollowUpTrackerService({
        idGenerator: () => `FA_${++idCounter}`,
        dateProvider: () => farFutureDate,
        repository: (service as any).repository,
      });
      farFutureService.registerReportContext(defaultContext);

      await service.assignFollowUp(createValidRequest({
        dueDate: new Date('2025-03-01'),
      }));

      const dashboard = await farFutureService.getDashboard('senior-1');

      expect(dashboard.summary.expired).toBe(1);
      expect(dashboard.actions[0].status).toBe('expired');
    });

    it('should show correct summary with mixed statuses', async () => {
      // Create multiple actions with different due dates
      const action1 = await service.assignFollowUp(createValidRequest({
        description: 'Pending action',
        dueDate: new Date('2025-06-01'), // far future - pending
      }));
      const action2 = await service.assignFollowUp(createValidRequest({
        description: 'Completed action',
        dueDate: new Date('2025-06-01'),
      }));
      await service.completeFollowUp(action2.id);

      // Create a service at a future date to make some overdue
      const action3 = await service.assignFollowUp(createValidRequest({
        description: 'Will be overdue',
        dueDate: new Date('2025-01-20'), // soon
      }));

      // Dashboard from a date after action3's due date
      const futureDate = new Date('2025-01-25T10:00:00Z');
      const futureService = new FollowUpTrackerService({
        idGenerator: () => `FA_${++idCounter}`,
        dateProvider: () => futureDate,
        repository: (service as any).repository,
      });

      const dashboard = await futureService.getDashboard('senior-1');

      expect(dashboard.summary.total).toBe(3);
      expect(dashboard.summary.pending).toBe(1);
      expect(dashboard.summary.completed).toBe(1);
      expect(dashboard.summary.overdue).toBe(1);
    });
  });

  describe('getOverdueActions', () => {
    it('should return empty array when no overdue actions exist', async () => {
      const overdue = await service.getOverdueActions('physician-1');
      expect(overdue).toHaveLength(0);
    });

    it('should return overdue actions for a specific physician', async () => {
      await service.assignFollowUp(createValidRequest({
        dueDate: new Date('2025-01-20'),
      }));

      // Check from a date after due date
      const futureDate = new Date('2025-01-25T10:00:00Z');
      const futureService = new FollowUpTrackerService({
        idGenerator: () => `FA_${++idCounter}`,
        dateProvider: () => futureDate,
        repository: (service as any).repository,
      });

      const overdue = await futureService.getOverdueActions('physician-1');
      expect(overdue).toHaveLength(1);
      expect(overdue[0].status).toBe('overdue');
    });

    it('should not include pending actions', async () => {
      await service.assignFollowUp(createValidRequest({
        dueDate: new Date('2025-06-01'), // future
      }));

      const overdue = await service.getOverdueActions('physician-1');
      expect(overdue).toHaveLength(0);
    });

    it('should not include completed actions', async () => {
      const action = await service.assignFollowUp(createValidRequest({
        dueDate: new Date('2025-01-20'),
      }));
      await service.completeFollowUp(action.id);

      // Check from a date after due date
      const futureDate = new Date('2025-01-25T10:00:00Z');
      const futureService = new FollowUpTrackerService({
        idGenerator: () => `FA_${++idCounter}`,
        dateProvider: () => futureDate,
        repository: (service as any).repository,
      });

      const overdue = await futureService.getOverdueActions('physician-1');
      expect(overdue).toHaveLength(0);
    });

    it('should include expired actions (>30 days overdue)', async () => {
      await service.assignFollowUp(createValidRequest({
        dueDate: new Date('2025-01-20'),
      }));

      // Check from >30 days past due
      const farFutureDate = new Date('2025-02-25T10:00:00Z');
      const farFutureService = new FollowUpTrackerService({
        idGenerator: () => `FA_${++idCounter}`,
        dateProvider: () => farFutureDate,
        repository: (service as any).repository,
      });

      const overdue = await farFutureService.getOverdueActions('physician-1');
      expect(overdue).toHaveLength(1);
      expect(overdue[0].status).toBe('expired');
    });

    it('should only return actions for the specified physician', async () => {
      // Register a second context with a different physician
      const context2: ReportContext = {
        reportId: 'report-2',
        seniorId: 'senior-2',
        physicianId: 'physician-2',
      };
      service.registerReportContext(context2);

      await service.assignFollowUp(createValidRequest({
        reportId: 'report-1',
        dueDate: new Date('2025-01-20'),
      }));
      await service.assignFollowUp(createValidRequest({
        reportId: 'report-2',
        description: 'Other physician action',
        dueDate: new Date('2025-01-20'),
      }));

      // Check from a date after due date
      const futureDate = new Date('2025-01-25T10:00:00Z');
      const futureService = new FollowUpTrackerService({
        idGenerator: () => `FA_${++idCounter}`,
        dateProvider: () => futureDate,
        repository: (service as any).repository,
      });

      const overdueP1 = await futureService.getOverdueActions('physician-1');
      const overdueP2 = await futureService.getOverdueActions('physician-2');

      expect(overdueP1).toHaveLength(1);
      expect(overdueP1[0].assignedPhysicianId).toBe('physician-1');
      expect(overdueP2).toHaveLength(1);
      expect(overdueP2[0].assignedPhysicianId).toBe('physician-2');
    });
  });
});

describe('validateAssignmentRequest (standalone)', () => {
  const currentDate = new Date('2025-01-15T10:00:00Z');

  it('should pass for a valid request', () => {
    expect(() =>
      validateAssignmentRequest(createValidRequest(), currentDate)
    ).not.toThrow();
  });

  it('should reject whitespace-only description', () => {
    expect(() =>
      validateAssignmentRequest(createValidRequest({ description: '   ' }), currentDate)
    ).toThrow(FollowUpValidationError);
  });

  it('should reject missing dueDate', () => {
    expect(() =>
      validateAssignmentRequest(
        createValidRequest({ dueDate: undefined as unknown as Date }),
        currentDate
      )
    ).toThrow(FollowUpValidationError);
  });
});

describe('validateCompletionNotes (standalone)', () => {
  it('should pass for undefined notes', () => {
    expect(() => validateCompletionNotes(undefined)).not.toThrow();
  });

  it('should pass for empty string notes', () => {
    expect(() => validateCompletionNotes('')).not.toThrow();
  });

  it('should pass for notes at max length', () => {
    expect(() => validateCompletionNotes('x'.repeat(1000))).not.toThrow();
  });

  it('should reject notes exceeding max length', () => {
    expect(() => validateCompletionNotes('x'.repeat(1001))).toThrow(FollowUpValidationError);
  });
});
