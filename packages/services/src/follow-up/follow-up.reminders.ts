/**
 * Follow-Up Reminder and Escalation Service
 * Handles reminder scheduling, sending, and escalation for overdue follow-up actions.
 *
 * Validates: Requirements 8.2, 8.4, 8.5
 */

import type { FollowUpAction } from '@health-checkup/shared';
import type { FollowUpActionRepository } from './follow-up.types';

/** Interval between reminders in days */
const REMINDER_INTERVAL_DAYS = 7;

/** Number of days after due date before action is considered expired */
const EXPIRATION_DAYS = 30;

/** Hours after due date before escalation to physician */
const ESCALATION_HOURS = 24;

/**
 * Represents a scheduled reminder for a follow-up action.
 */
export interface FollowUpReminderSchedule {
  actionId: string;
  seniorId: string;
  nextReminderDate: Date;
  reminderCount: number;
  status: 'active' | 'completed' | 'expired';
}

/**
 * Represents an escalation event for an overdue follow-up action.
 */
export interface EscalationEvent {
  actionId: string;
  seniorId: string;
  physicianId: string;
  actionType: string;
  description: string;
  dueDate: Date;
  escalatedAt: Date;
}

/**
 * Represents a processed reminder result.
 */
export interface ReminderResult {
  actionId: string;
  seniorId: string;
  sentAt: Date;
  reminderNumber: number;
}

/**
 * Dependencies injected into the FollowUpReminderService.
 */
export interface FollowUpReminderDependencies {
  repository: FollowUpActionRepository;
  dateProvider: () => Date;
  onReminderSent?: (result: ReminderResult) => void;
  onEscalation?: (event: EscalationEvent) => void;
}

/**
 * FollowUpReminderService handles:
 * 1. Calculating next reminder dates for pending actions (every 7 days from assignment)
 * 2. Determining which reminders are due at a given point in time
 * 3. Processing reminders (sending notifications)
 * 4. Processing escalations (notifying physicians within 24h of overdue)
 *
 * Requirement 8.2: Send reminders every 7 days starting 7 days after assignment
 *                  until action is complete or expired (>30 days past due).
 * Requirement 8.4: Escalate to physician within 24 hours after due date passes.
 */
export class FollowUpReminderService {
  private readonly repository: FollowUpActionRepository;
  private readonly dateProvider: () => Date;
  private readonly onReminderSent?: (result: ReminderResult) => void;
  private readonly onEscalation?: (event: EscalationEvent) => void;
  private readonly escalatedActions: Set<string> = new Set();

  constructor(deps: FollowUpReminderDependencies) {
    this.repository = deps.repository;
    this.dateProvider = deps.dateProvider;
    this.onReminderSent = deps.onReminderSent;
    this.onEscalation = deps.onEscalation;
  }

  /**
   * Calculate the next reminder date for a given follow-up action.
   *
   * Reminders are sent every 7 days starting 7 days after assignment.
   * Returns null if the action is completed or expired (>30 days past due).
   *
   * @param action - The follow-up action
   * @param currentDate - The current date for evaluation
   * @returns The next reminder date, or null if no more reminders are due
   */
  calculateNextReminder(action: FollowUpAction, currentDate: Date): Date | null {
    // No reminders for completed actions
    if (action.status === 'completed') {
      return null;
    }

    // Check if expired (>30 days past due)
    const dueTime = new Date(action.dueDate).getTime();
    const currentTime = currentDate.getTime();
    const daysPastDue = (currentTime - dueTime) / (1000 * 60 * 60 * 24);

    if (daysPastDue > EXPIRATION_DAYS) {
      return null;
    }

    // Calculate reminder schedule: first reminder at assignedDate + 7 days
    const assignedTime = new Date(action.assignedDate).getTime();
    const intervalMs = REMINDER_INTERVAL_DAYS * 24 * 60 * 60 * 1000;

    // Find the next reminder date that is >= currentDate
    let nextReminderTime = assignedTime + intervalMs;
    while (nextReminderTime < currentTime) {
      nextReminderTime += intervalMs;
    }

    // If the next reminder would be after expiration, return null
    const nextReminderDate = new Date(nextReminderTime);
    const daysFromDueToReminder = (nextReminderTime - dueTime) / (1000 * 60 * 60 * 24);
    if (daysFromDueToReminder > EXPIRATION_DAYS) {
      return null;
    }

    return nextReminderDate;
  }

  /**
   * Get all actions that have reminders due at the given date.
   *
   * A reminder is "due" when:
   * - The action is pending or overdue (not completed, not expired)
   * - The current date has reached or passed the next scheduled reminder date
   *
   * @param seniorId - The senior citizen's ID
   * @param currentDate - The current date for evaluation
   * @returns Array of reminder schedules with next dates and counts
   */
  async getDueReminders(seniorId: string, currentDate: Date): Promise<FollowUpReminderSchedule[]> {
    const actions = await this.repository.findBySeniorId(seniorId);
    const dueReminders: FollowUpReminderSchedule[] = [];

    for (const action of actions) {
      const schedule = this.buildReminderSchedule(action, currentDate);
      if (schedule && schedule.status === 'active') {
        // Only include if the next reminder date is at or before currentDate
        if (schedule.nextReminderDate.getTime() <= currentDate.getTime()) {
          dueReminders.push(schedule);
        }
      }
    }

    return dueReminders;
  }

  /**
   * Get all reminder schedules for a given senior (regardless of whether they are due now).
   *
   * @param seniorId - The senior citizen's ID
   * @param currentDate - The current date for evaluation
   * @returns Array of all reminder schedules
   */
  async getAllReminderSchedules(seniorId: string, currentDate: Date): Promise<FollowUpReminderSchedule[]> {
    const actions = await this.repository.findBySeniorId(seniorId);
    const schedules: FollowUpReminderSchedule[] = [];

    for (const action of actions) {
      const schedule = this.buildReminderSchedule(action, currentDate);
      if (schedule) {
        schedules.push(schedule);
      }
    }

    return schedules;
  }

  /**
   * Process all due reminders for a given senior at the current time.
   * Sends reminder notifications for each pending/overdue action that has a due reminder.
   *
   * @param seniorId - The senior citizen's ID
   * @param currentDate - The current date for processing
   * @returns Array of reminder results that were sent
   */
  async processReminders(seniorId: string, currentDate: Date): Promise<ReminderResult[]> {
    const dueReminders = await this.getDueReminders(seniorId, currentDate);
    const results: ReminderResult[] = [];

    for (const reminder of dueReminders) {
      const result: ReminderResult = {
        actionId: reminder.actionId,
        seniorId: reminder.seniorId,
        sentAt: currentDate,
        reminderNumber: reminder.reminderCount,
      };

      if (this.onReminderSent) {
        this.onReminderSent(result);
      }

      results.push(result);
    }

    return results;
  }

  /**
   * Process escalations for overdue actions.
   * An action should be escalated to the assigned physician within 24 hours
   * after the due date passes.
   *
   * Requirement 8.4: Escalate to physician within 24 hours after due date passes.
   *
   * @param seniorId - The senior citizen's ID
   * @param currentDate - The current date for processing
   * @returns Array of escalation events that were triggered
   */
  async processEscalations(seniorId: string, currentDate: Date): Promise<EscalationEvent[]> {
    const actions = await this.repository.findBySeniorId(seniorId);
    const escalations: EscalationEvent[] = [];

    for (const action of actions) {
      if (action.status === 'completed') {
        continue;
      }

      const dueTime = new Date(action.dueDate).getTime();
      const currentTime = currentDate.getTime();
      const hoursPastDue = (currentTime - dueTime) / (1000 * 60 * 60);

      // Escalate if past due and within the escalation window (24 hours after due date)
      // or if overdue and not yet escalated
      if (hoursPastDue >= ESCALATION_HOURS && !this.escalatedActions.has(action.id)) {
        // Check not expired (> 30 days past due)
        const daysPastDue = hoursPastDue / 24;
        if (daysPastDue > EXPIRATION_DAYS) {
          continue;
        }

        const escalation: EscalationEvent = {
          actionId: action.id,
          seniorId: action.seniorId,
          physicianId: action.assignedPhysicianId,
          actionType: action.actionType,
          description: action.description,
          dueDate: new Date(action.dueDate),
          escalatedAt: currentDate,
        };

        this.escalatedActions.add(action.id);

        if (this.onEscalation) {
          this.onEscalation(escalation);
        }

        escalations.push(escalation);
      }
    }

    return escalations;
  }

  /**
   * Check if an action has already been escalated.
   */
  isEscalated(actionId: string): boolean {
    return this.escalatedActions.has(actionId);
  }

  /**
   * Build a reminder schedule for an action based on current date.
   */
  private buildReminderSchedule(action: FollowUpAction, currentDate: Date): FollowUpReminderSchedule | null {
    // Completed actions have a 'completed' schedule
    if (action.status === 'completed') {
      return {
        actionId: action.id,
        seniorId: action.seniorId,
        nextReminderDate: new Date(0), // not applicable
        reminderCount: this.calculateReminderCount(action, currentDate),
        status: 'completed',
      };
    }

    // Check expiration
    const dueTime = new Date(action.dueDate).getTime();
    const currentTime = currentDate.getTime();
    const daysPastDue = (currentTime - dueTime) / (1000 * 60 * 60 * 24);

    if (daysPastDue > EXPIRATION_DAYS) {
      return {
        actionId: action.id,
        seniorId: action.seniorId,
        nextReminderDate: new Date(0), // not applicable
        reminderCount: this.calculateReminderCount(action, currentDate),
        status: 'expired',
      };
    }

    // Active reminder schedule
    const nextReminder = this.calculateNextReminder(action, currentDate);
    if (!nextReminder) {
      return null;
    }

    return {
      actionId: action.id,
      seniorId: action.seniorId,
      nextReminderDate: nextReminder,
      reminderCount: this.calculateReminderCount(action, currentDate),
      status: 'active',
    };
  }

  /**
   * Calculate how many reminders have already been sent (based on elapsed time).
   */
  private calculateReminderCount(action: FollowUpAction, currentDate: Date): number {
    const assignedTime = new Date(action.assignedDate).getTime();
    const currentTime = currentDate.getTime();
    const intervalMs = REMINDER_INTERVAL_DAYS * 24 * 60 * 60 * 1000;

    const elapsed = currentTime - assignedTime;
    if (elapsed < intervalMs) {
      return 0;
    }

    return Math.floor(elapsed / intervalMs);
  }
}
