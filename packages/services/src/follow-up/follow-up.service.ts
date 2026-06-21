/**
 * Follow-Up Tracker Service
 * Manages follow-up action assignment, completion, dashboard, and overdue tracking.
 * Validates: Requirements 8.1, 8.3, 8.6
 */

import type { FollowUpAction } from '@health-checkup/shared';
import type {
  FollowUpAssignmentRequest,
  FollowUpDashboard,
  FollowUpTrackerDependencies,
  FollowUpActionRepository,
  ReportContext,
} from './follow-up.types';
import { validateAssignmentRequest, validateCompletionNotes } from './follow-up.validators';
import {
  MaxFollowUpActionsExceededError,
  FollowUpNotFoundError,
  FollowUpAlreadyCompletedError,
} from './follow-up.errors';

const MAX_ACTIONS_PER_REPORT = 20;

/**
 * In-memory implementation of FollowUpActionRepository.
 * Suitable for development and testing; replace with database-backed
 * implementation for production.
 */
export class InMemoryFollowUpActionRepository implements FollowUpActionRepository {
  private actions: FollowUpAction[] = [];

  async save(action: FollowUpAction): Promise<FollowUpAction> {
    this.actions.push(action);
    return action;
  }

  async findById(id: string): Promise<FollowUpAction | null> {
    return this.actions.find((a) => a.id === id) ?? null;
  }

  async findByReportId(reportId: string): Promise<FollowUpAction[]> {
    return this.actions.filter((a) => a.reportId === reportId);
  }

  async findBySeniorId(seniorId: string): Promise<FollowUpAction[]> {
    return this.actions.filter((a) => a.seniorId === seniorId);
  }

  async findByPhysicianId(physicianId: string): Promise<FollowUpAction[]> {
    return this.actions.filter((a) => a.assignedPhysicianId === physicianId);
  }

  async update(action: FollowUpAction): Promise<FollowUpAction> {
    const index = this.actions.findIndex((a) => a.id === action.id);
    if (index === -1) {
      throw new Error(`Follow-up action not found: ${action.id}`);
    }
    this.actions[index] = action;
    return action;
  }

  /** Utility for testing: clear all stored actions */
  clear(): void {
    this.actions = [];
  }
}

/** Default ID generator using timestamp + random suffix */
const defaultIdGenerator = (): string => {
  return `FA_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
};

/** Default date provider returning the current system date */
const defaultDateProvider = (): Date => new Date();

/**
 * FollowUpTrackerService implementation.
 *
 * Uses dependency injection for ID generation, date provision, and repository
 * access to support testability.
 */
export class FollowUpTrackerService {
  private readonly idGenerator: () => string;
  private readonly dateProvider: () => Date;
  private readonly repository: FollowUpActionRepository;
  private reportContexts: Map<string, ReportContext> = new Map();

  constructor(deps?: Partial<FollowUpTrackerDependencies>) {
    this.idGenerator = deps?.idGenerator ?? defaultIdGenerator;
    this.dateProvider = deps?.dateProvider ?? defaultDateProvider;
    this.repository = deps?.repository ?? new InMemoryFollowUpActionRepository();
  }

  /**
   * Register report context (links reportId to seniorId and physicianId).
   * Must be called before assigning follow-ups to a report.
   */
  registerReportContext(context: ReportContext): void {
    this.reportContexts.set(context.reportId, context);
  }

  /**
   * Assign a new follow-up action to a report.
   *
   * Requirement 8.1: Assign follow-up actions with description, type, due date.
   * Requirement 8.6: Validate all fields; reject invalid inputs with specific messages.
   *
   * @param request - The follow-up assignment request
   * @returns The created follow-up action
   * @throws FollowUpValidationError if validation fails
   * @throws MaxFollowUpActionsExceededError if report already has 20 actions
   */
  async assignFollowUp(request: FollowUpAssignmentRequest): Promise<FollowUpAction> {
    const currentDate = this.dateProvider();

    // Validate the request
    validateAssignmentRequest(request, currentDate);

    // Check max actions per report
    const existingActions = await this.repository.findByReportId(request.reportId);
    if (existingActions.length >= MAX_ACTIONS_PER_REPORT) {
      throw new MaxFollowUpActionsExceededError(
        request.reportId,
        existingActions.length,
        MAX_ACTIONS_PER_REPORT
      );
    }

    // Resolve report context
    const context = this.reportContexts.get(request.reportId);
    if (!context) {
      throw new Error(
        `Report context not found for reportId: ${request.reportId}. ` +
        `Register the report context before assigning follow-ups.`
      );
    }

    // Create the follow-up action
    const action: FollowUpAction = {
      id: this.idGenerator(),
      reportId: request.reportId,
      seniorId: context.seniorId,
      description: request.description,
      actionType: request.actionType,
      dueDate: new Date(request.dueDate),
      assigneeNote: request.assigneeNote,
      status: 'pending',
      assignedDate: currentDate,
      assignedPhysicianId: context.physicianId,
    };

    return this.repository.save(action);
  }

  /**
   * Mark a follow-up action as completed.
   *
   * Requirement 8.3: Record completion date and optional notes.
   *
   * @param actionId - The ID of the action to complete
   * @param notes - Optional completion notes (max 1000 chars)
   * @returns The updated follow-up action
   * @throws FollowUpNotFoundError if action does not exist
   * @throws FollowUpAlreadyCompletedError if action is already completed
   * @throws FollowUpValidationError if notes exceed max length
   */
  async completeFollowUp(actionId: string, notes?: string): Promise<FollowUpAction> {
    // Validate completion notes
    validateCompletionNotes(notes);

    const action = await this.repository.findById(actionId);
    if (!action) {
      throw new FollowUpNotFoundError(actionId);
    }

    if (action.status === 'completed') {
      throw new FollowUpAlreadyCompletedError(actionId);
    }

    const currentDate = this.dateProvider();

    const updatedAction: FollowUpAction = {
      ...action,
      status: 'completed',
      completionDate: currentDate,
      completionNotes: notes,
    };

    return this.repository.update(updatedAction);
  }

  /**
   * Get a dashboard view of all follow-up actions for a senior citizen.
   *
   * Actions are categorized by status:
   * - pending: assigned and not yet due
   * - overdue: past due date, not completed
   * - expired: more than 30 days past due, not completed
   * - completed: marked as done
   *
   * @param seniorId - The senior citizen's ID
   * @returns Dashboard with actions and summary counts
   */
  async getDashboard(seniorId: string): Promise<FollowUpDashboard> {
    const actions = await this.repository.findBySeniorId(seniorId);
    const currentDate = this.dateProvider();

    // Update statuses based on current date
    const categorizedActions = actions.map((action) =>
      this.categorizeAction(action, currentDate)
    );

    const summary = {
      pending: categorizedActions.filter((a) => a.status === 'pending').length,
      completed: categorizedActions.filter((a) => a.status === 'completed').length,
      overdue: categorizedActions.filter((a) => a.status === 'overdue').length,
      expired: categorizedActions.filter((a) => a.status === 'expired').length,
      total: categorizedActions.length,
    };

    return {
      seniorId,
      actions: categorizedActions,
      summary,
    };
  }

  /**
   * Get all overdue follow-up actions assigned by a specific physician.
   *
   * @param physicianId - The physician's ID
   * @returns List of overdue follow-up actions
   */
  async getOverdueActions(physicianId: string): Promise<FollowUpAction[]> {
    const actions = await this.repository.findByPhysicianId(physicianId);
    const currentDate = this.dateProvider();

    return actions
      .map((action) => this.categorizeAction(action, currentDate))
      .filter((action) => action.status === 'overdue' || action.status === 'expired');
  }

  /**
   * Categorize a follow-up action's status based on the current date.
   * - completed actions remain completed
   * - if past due > 30 days: expired
   * - if past due: overdue
   * - otherwise: pending
   */
  private categorizeAction(action: FollowUpAction, currentDate: Date): FollowUpAction {
    if (action.status === 'completed') {
      return action;
    }

    const dueTime = new Date(action.dueDate).getTime();
    const currentTime = currentDate.getTime();
    const daysPastDue = (currentTime - dueTime) / (1000 * 60 * 60 * 24);

    if (daysPastDue > 30) {
      return { ...action, status: 'expired' };
    }

    if (currentTime > dueTime) {
      return { ...action, status: 'overdue' };
    }

    return { ...action, status: 'pending' };
  }
}
