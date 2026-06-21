/**
 * Notification Fallback, Opt-Out Routing, and Caregiver Preferences
 *
 * Handles:
 * - Fallback delivery when primary channel fails (Req 20.4)
 * - Undelivered notification indicator on next login (Req 20.5)
 * - Caregiver notification preferences (Req 20.3)
 * - Opt-out routing: suppress informational, continue critical/appointment/escalation (Req 20.6)
 *
 * Validates: Requirements 20.3, 20.4, 20.5, 20.6
 */

import { DeliveryChannel, NotificationType } from '@health-checkup/shared';
import type {
  NotificationRequest,
  ChannelProvider,
  NotificationPreferences,
  DeliveryLogEntry,
  ChannelDeliveryResult,
} from './notification.types';

/** Maximum number of fallback attempts after primary channel failure */
export const MAX_FALLBACK_ATTEMPTS = 3;

/** Maximum delay between fallback attempts in milliseconds (5 minutes) */
export const MAX_DELAY_BETWEEN_ATTEMPTS_MS = 5 * 60 * 1000;

/**
 * Notification types that are always delivered regardless of opt-out settings.
 * Requirement 20.6: Continue delivering critical alerts, appointment reminders, and escalations.
 */
export const ALWAYS_DELIVER_TYPES: NotificationType[] = [
  NotificationType.CriticalAlert,
  NotificationType.AppointmentReminder,
  NotificationType.AppointmentConfirmation,
  NotificationType.Escalation,
];

/**
 * Notification types suppressed when user opts out of non-critical notifications.
 * Requirement 20.6: Suppress informational messages (health tips, system announcements, etc.).
 */
export const SUPPRESSIBLE_TYPES: NotificationType[] = [
  NotificationType.ReportAvailable,
  NotificationType.FollowUpReminder,
  NotificationType.PaymentConfirmation,
];

/**
 * Represents an undelivered notification indicator shown on next login.
 * Requirement 20.5: Display undelivered notification indicator upon next login.
 */
export interface UndeliveredNotification {
  id: string;
  recipientId: string;
  notificationId: string;
  subject: string;
  body: string;
  type: NotificationType;
  failedChannels: DeliveryChannel[];
  failedAt: Date;
  displayedOnLogin: boolean;
}

/**
 * Caregiver notification preferences, linked to a senior citizen.
 * Requirement 20.3: Allow caregivers to configure separate preferences.
 */
export interface CaregiverPreferences {
  caregiverId: string;
  seniorId: string;
  activeChannels: DeliveryChannel[];
  optOutNonCritical: boolean;
  quietHoursStart?: string;
  quietHoursEnd?: string;
}

/**
 * Result of a fallback delivery attempt sequence.
 */
export interface FallbackDeliveryResult {
  notificationId: string;
  recipientId: string;
  delivered: boolean;
  channelAttempts: ChannelDeliveryResult[];
  fallbackCount: number;
  finalChannel?: DeliveryChannel;
  undelivered?: UndeliveredNotification;
}

/**
 * Repository interface for undelivered notifications.
 */
export interface UndeliveredNotificationRepository {
  save(entry: UndeliveredNotification): Promise<UndeliveredNotification>;
  findByRecipientId(recipientId: string): Promise<UndeliveredNotification[]>;
  markDisplayed(id: string): Promise<void>;
}

/**
 * Repository interface for caregiver preferences.
 */
export interface CaregiverPreferencesRepository {
  save(prefs: CaregiverPreferences): Promise<CaregiverPreferences>;
  findByCaregiverId(caregiverId: string): Promise<CaregiverPreferences[]>;
  findBySeniorId(seniorId: string): Promise<CaregiverPreferences[]>;
  findByCaregiverAndSenior(caregiverId: string, seniorId: string): Promise<CaregiverPreferences | null>;
  update(prefs: CaregiverPreferences): Promise<CaregiverPreferences>;
}

/**
 * Dependencies for the NotificationFallbackService.
 */
export interface FallbackDependencies {
  idGenerator: () => string;
  dateProvider: () => Date;
  channelProviders: Record<DeliveryChannel, ChannelProvider>;
  undeliveredRepository: UndeliveredNotificationRepository;
  caregiverPreferencesRepository: CaregiverPreferencesRepository;
  delayFn?: (ms: number) => Promise<void>;
}

/**
 * In-memory implementation of UndeliveredNotificationRepository.
 */
export class InMemoryUndeliveredRepository implements UndeliveredNotificationRepository {
  private entries: UndeliveredNotification[] = [];

  async save(entry: UndeliveredNotification): Promise<UndeliveredNotification> {
    this.entries.push(entry);
    return entry;
  }

  async findByRecipientId(recipientId: string): Promise<UndeliveredNotification[]> {
    return this.entries.filter((e) => e.recipientId === recipientId && !e.displayedOnLogin);
  }

  async markDisplayed(id: string): Promise<void> {
    const entry = this.entries.find((e) => e.id === id);
    if (entry) {
      entry.displayedOnLogin = true;
    }
  }

  clear(): void {
    this.entries = [];
  }
}

/**
 * In-memory implementation of CaregiverPreferencesRepository.
 */
export class InMemoryCaregiverPreferencesRepository implements CaregiverPreferencesRepository {
  private preferences: CaregiverPreferences[] = [];

  async save(prefs: CaregiverPreferences): Promise<CaregiverPreferences> {
    this.preferences.push(prefs);
    return prefs;
  }

  async findByCaregiverId(caregiverId: string): Promise<CaregiverPreferences[]> {
    return this.preferences.filter((p) => p.caregiverId === caregiverId);
  }

  async findBySeniorId(seniorId: string): Promise<CaregiverPreferences[]> {
    return this.preferences.filter((p) => p.seniorId === seniorId);
  }

  async findByCaregiverAndSenior(caregiverId: string, seniorId: string): Promise<CaregiverPreferences | null> {
    return this.preferences.find((p) => p.caregiverId === caregiverId && p.seniorId === seniorId) ?? null;
  }

  async update(prefs: CaregiverPreferences): Promise<CaregiverPreferences> {
    const index = this.preferences.findIndex(
      (p) => p.caregiverId === prefs.caregiverId && p.seniorId === prefs.seniorId,
    );
    if (index === -1) {
      this.preferences.push(prefs);
    } else {
      this.preferences[index] = prefs;
    }
    return prefs;
  }

  clear(): void {
    this.preferences = [];
  }
}

/** Default delay function using setTimeout */
const defaultDelay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * NotificationFallbackService
 *
 * Provides fallback delivery, opt-out routing, undelivered indicator, and caregiver preferences.
 */
export class NotificationFallbackService {
  private readonly idGenerator: () => string;
  private readonly dateProvider: () => Date;
  private readonly channelProviders: Record<DeliveryChannel, ChannelProvider>;
  private readonly undeliveredRepository: UndeliveredNotificationRepository;
  private readonly caregiverPreferencesRepository: CaregiverPreferencesRepository;
  private readonly delayFn: (ms: number) => Promise<void>;

  constructor(deps: FallbackDependencies) {
    this.idGenerator = deps.idGenerator;
    this.dateProvider = deps.dateProvider;
    this.channelProviders = deps.channelProviders;
    this.undeliveredRepository = deps.undeliveredRepository;
    this.caregiverPreferencesRepository = deps.caregiverPreferencesRepository;
    this.delayFn = deps.delayFn ?? defaultDelay;
  }

  /**
   * Determine whether a notification should be delivered based on opt-out settings.
   *
   * Requirement 20.6: Suppress informational messages when opted out;
   * continue critical alerts, appointment reminders, and escalation notifications.
   */
  shouldDeliver(request: NotificationRequest, preferences: NotificationPreferences): boolean {
    if (!preferences.optOutNonCritical) {
      return true;
    }

    // Always deliver critical/appointment/escalation types
    if (ALWAYS_DELIVER_TYPES.includes(request.type)) {
      return true;
    }

    // Suppress informational/non-critical types
    return false;
  }

  /**
   * Attempt delivery with fallback channels.
   *
   * Requirement 20.4: On primary channel failure, attempt remaining channels
   * in preference order, max 3 fallback attempts, ≤5 minutes between attempts.
   *
   * Requirement 20.5: If all channels fail, log the failure and mark as undelivered.
   */
  async deliverWithFallback(
    request: NotificationRequest,
    preferences: NotificationPreferences,
    language: string,
  ): Promise<FallbackDeliveryResult> {
    const notificationId = this.idGenerator();
    const channelAttempts: ChannelDeliveryResult[] = [];
    let fallbackCount = 0;

    // Start with all active channels in preference order
    const channelsToTry = [...preferences.activeChannels];

    for (let i = 0; i < channelsToTry.length && fallbackCount <= MAX_FALLBACK_ATTEMPTS; i++) {
      const channel = channelsToTry[i];
      const provider = this.channelProviders[channel];
      const now = this.dateProvider();

      let status: 'delivered' | 'failed' = 'failed';
      let failureReason: string | undefined;

      try {
        const success = await provider.send(request.recipientId, request.subject, request.body, language as any);
        status = success ? 'delivered' : 'failed';
        if (!success) {
          failureReason = 'Channel delivery returned false';
        }
      } catch (error) {
        failureReason = error instanceof Error ? error.message : 'Unknown error';
      }

      channelAttempts.push({
        channel,
        status,
        attemptedAt: now,
        failureReason,
      });

      if (status === 'delivered') {
        return {
          notificationId,
          recipientId: request.recipientId,
          delivered: true,
          channelAttempts,
          fallbackCount,
          finalChannel: channel,
        };
      }

      // Primary attempt failed; increment fallback counter for subsequent attempts
      if (i > 0) {
        fallbackCount++;
      }

      // If we have more channels to try and haven't exceeded fallback limit, wait before next attempt
      if (i < channelsToTry.length - 1 && fallbackCount < MAX_FALLBACK_ATTEMPTS) {
        await this.delayFn(MAX_DELAY_BETWEEN_ATTEMPTS_MS);
      }

      // Stop if we hit fallback limit
      if (fallbackCount >= MAX_FALLBACK_ATTEMPTS) {
        break;
      }
    }

    // All channels failed — create undelivered indicator
    const undelivered: UndeliveredNotification = {
      id: this.idGenerator(),
      recipientId: request.recipientId,
      notificationId,
      subject: request.subject,
      body: request.body,
      type: request.type,
      failedChannels: channelAttempts.map((a) => a.channel),
      failedAt: this.dateProvider(),
      displayedOnLogin: false,
    };

    await this.undeliveredRepository.save(undelivered);

    return {
      notificationId,
      recipientId: request.recipientId,
      delivered: false,
      channelAttempts,
      fallbackCount,
      undelivered,
    };
  }

  /**
   * Get undelivered notification indicators for display on login.
   *
   * Requirement 20.5: Display undelivered notification indicator upon next login.
   */
  async getUndeliveredIndicators(recipientId: string): Promise<UndeliveredNotification[]> {
    return this.undeliveredRepository.findByRecipientId(recipientId);
  }

  /**
   * Mark an undelivered notification as displayed (after user sees it on login).
   */
  async markIndicatorDisplayed(indicatorId: string): Promise<void> {
    await this.undeliveredRepository.markDisplayed(indicatorId);
  }

  /**
   * Configure caregiver notification preferences, linked to a senior citizen.
   *
   * Requirement 20.3: Allow caregivers to configure separate notification preferences.
   */
  async configureCaregiverPreferences(
    caregiverId: string,
    seniorId: string,
    channels: DeliveryChannel[],
    optOutNonCritical: boolean,
    quietHoursStart?: string,
    quietHoursEnd?: string,
  ): Promise<CaregiverPreferences> {
    if (!channels || channels.length === 0) {
      throw new Error('At least one active delivery channel is required for caregiver preferences.');
    }

    const prefs: CaregiverPreferences = {
      caregiverId,
      seniorId,
      activeChannels: channels,
      optOutNonCritical,
      quietHoursStart,
      quietHoursEnd,
    };

    const existing = await this.caregiverPreferencesRepository.findByCaregiverAndSenior(caregiverId, seniorId);
    if (existing) {
      return this.caregiverPreferencesRepository.update(prefs);
    }

    return this.caregiverPreferencesRepository.save(prefs);
  }

  /**
   * Get caregiver preferences for a specific senior citizen.
   */
  async getCaregiverPreferences(caregiverId: string, seniorId: string): Promise<CaregiverPreferences | null> {
    return this.caregiverPreferencesRepository.findByCaregiverAndSenior(caregiverId, seniorId);
  }

  /**
   * Get all caregiver preferences linked to a senior citizen.
   */
  async getCaregiverPreferencesForSenior(seniorId: string): Promise<CaregiverPreferences[]> {
    return this.caregiverPreferencesRepository.findBySeniorId(seniorId);
  }
}
