/**
 * Notification Service
 * Handles multi-channel notification delivery, critical alerts, escalation,
 * preferences configuration, and delivery logging.
 *
 * Validates: Requirements 20.1, 20.2, 20.7, 19.6
 */

import { DeliveryChannel, EscalationLevel, NotificationType, SupportedLanguage } from '@health-checkup/shared';
import type {
  NotificationRequest,
  CriticalAlertRequest,
  DeliveryResult,
  ChannelDeliveryResult,
  NotificationPreferences,
  DeliveryLogEntry,
  NotificationDependencies,
  NotificationPreferencesRepository,
  DeliveryLogRepository,
  LanguageProvider,
  ChannelProvider,
} from './notification.types';
import {
  NoActiveChannelError,
  PreferencesNotFoundError,
  AlertNotFoundError,
} from './notification.errors';

/** Valid delivery channels */
const VALID_CHANNELS: DeliveryChannel[] = [
  DeliveryChannel.SMS,
  DeliveryChannel.Email,
  DeliveryChannel.Push,
  DeliveryChannel.PhoneCall,
];

/**
 * Default preferences applied for new accounts.
 * Requirement 20.7: Default to in-app push notification.
 */
const DEFAULT_PREFERENCES: Omit<NotificationPreferences, 'userId'> = {
  activeChannels: [DeliveryChannel.Push],
  optOutNonCritical: false,
};

/**
 * In-memory implementation of NotificationPreferencesRepository.
 */
export class InMemoryPreferencesRepository implements NotificationPreferencesRepository {
  private preferences: NotificationPreferences[] = [];

  async save(prefs: NotificationPreferences): Promise<NotificationPreferences> {
    this.preferences.push(prefs);
    return prefs;
  }

  async findByUserId(userId: string): Promise<NotificationPreferences | null> {
    return this.preferences.find((p) => p.userId === userId) ?? null;
  }

  async update(prefs: NotificationPreferences): Promise<NotificationPreferences> {
    const index = this.preferences.findIndex((p) => p.userId === prefs.userId);
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

/**
 * In-memory implementation of DeliveryLogRepository.
 */
export class InMemoryDeliveryLogRepository implements DeliveryLogRepository {
  private logs: DeliveryLogEntry[] = [];

  async save(entry: DeliveryLogEntry): Promise<DeliveryLogEntry> {
    this.logs.push(entry);
    return entry;
  }

  async findByNotificationId(notificationId: string): Promise<DeliveryLogEntry[]> {
    return this.logs.filter((l) => l.notificationId === notificationId);
  }

  async findByAlertId(alertId: string): Promise<DeliveryLogEntry[]> {
    return this.logs.filter((l) => l.alertId === alertId);
  }

  clear(): void {
    this.logs = [];
  }
}

/** Default ID generator */
const defaultIdGenerator = (): string => {
  return `NOTIF_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
};

/** Default date provider */
const defaultDateProvider = (): Date => new Date();

/** Default language provider - returns English */
const defaultLanguageProvider: LanguageProvider = {
  getPreferredLanguage: async () => SupportedLanguage.English,
};

/** Default channel provider that always succeeds (stub for dev) */
const createDefaultChannelProvider = (): ChannelProvider => ({
  send: async () => true,
});

/** Default channel providers for all supported channels */
const defaultChannelProviders: Record<DeliveryChannel, ChannelProvider> = {
  [DeliveryChannel.SMS]: createDefaultChannelProvider(),
  [DeliveryChannel.Email]: createDefaultChannelProvider(),
  [DeliveryChannel.Push]: createDefaultChannelProvider(),
  [DeliveryChannel.PhoneCall]: createDefaultChannelProvider(),
};

/**
 * In-memory store for critical alerts (acknowledgement/escalation tracking).
 */
interface CriticalAlertRecord {
  alertId: string;
  recipientId: string;
  escalationLevel: EscalationLevel;
  acknowledgedAt?: Date;
  acknowledgedBy?: string;
  actionStatus?: string;
  escalationHistory: Array<{
    level: EscalationLevel;
    escalatedAt: Date;
    acknowledgedAt?: Date;
    acknowledgedBy?: string;
  }>;
}

/**
 * NotificationService implementation.
 *
 * Uses dependency injection for ID generation, date provision, repositories,
 * language resolution, and channel providers to support testability.
 *
 * Business rules:
 * - At least one active channel required in preferences (Req 20.2)
 * - Default preferences for new accounts: push channel only (Req 20.7)
 * - Deliver in recipient's preferred language (Req 19.6)
 * - Support 4 channels: SMS, email, push, phone_call (Req 20.1)
 * - Log all delivery attempts with timestamp and status
 */
export class NotificationService {
  private readonly idGenerator: () => string;
  private readonly dateProvider: () => Date;
  private readonly preferencesRepository: NotificationPreferencesRepository;
  private readonly deliveryLogRepository: DeliveryLogRepository;
  private readonly languageProvider: LanguageProvider;
  private readonly channelProviders: Record<DeliveryChannel, ChannelProvider>;
  private readonly criticalAlerts: Map<string, CriticalAlertRecord> = new Map();

  constructor(deps?: Partial<NotificationDependencies>) {
    this.idGenerator = deps?.idGenerator ?? defaultIdGenerator;
    this.dateProvider = deps?.dateProvider ?? defaultDateProvider;
    this.preferencesRepository = deps?.preferencesRepository ?? new InMemoryPreferencesRepository();
    this.deliveryLogRepository = deps?.deliveryLogRepository ?? new InMemoryDeliveryLogRepository();
    this.languageProvider = deps?.languageProvider ?? defaultLanguageProvider;
    this.channelProviders = deps?.channelProviders ?? defaultChannelProviders;
  }

  /**
   * Send a notification to the recipient via their configured channels.
   *
   * Requirement 20.1: Support SMS, email, push, phone_call.
   * Requirement 19.6: Deliver in recipient's preferred language.
   * Requirement 20.7: Apply default preferences if none configured.
   */
  async sendNotification(request: NotificationRequest): Promise<DeliveryResult> {
    const preferences = await this.getOrCreateDefaultPreferences(request.recipientId);
    const language = await this.languageProvider.getPreferredLanguage(request.recipientId);
    const notificationId = this.idGenerator();
    const now = this.dateProvider();

    const channelResults: ChannelDeliveryResult[] = [];

    for (const channel of preferences.activeChannels) {
      const provider = this.channelProviders[channel];
      let status: 'delivered' | 'failed' = 'failed';
      let failureReason: string | undefined;

      try {
        const success = await provider.send(request.recipientId, request.subject, request.body, language);
        status = success ? 'delivered' : 'failed';
        if (!success) {
          failureReason = 'Channel delivery returned false';
        }
      } catch (error) {
        failureReason = error instanceof Error ? error.message : 'Unknown error';
      }

      const channelResult: ChannelDeliveryResult = {
        channel,
        status,
        attemptedAt: now,
        failureReason,
      };
      channelResults.push(channelResult);

      // Log the delivery attempt
      await this.deliveryLogRepository.save({
        id: this.idGenerator(),
        notificationId,
        recipientId: request.recipientId,
        channel,
        status,
        timestamp: now,
        language,
        failureReason,
      });
    }

    return {
      notificationId,
      recipientId: request.recipientId,
      channels: channelResults,
      deliveredAt: now,
      language,
    };
  }

  /**
   * Send a critical alert notification.
   *
   * Requirement 19.6: Deliver in recipient's preferred language.
   * Critical alerts bypass quiet hours and opt-out settings.
   */
  async sendCriticalAlert(request: CriticalAlertRequest): Promise<DeliveryResult> {
    const preferences = await this.getOrCreateDefaultPreferences(request.recipientId);
    const language = await this.languageProvider.getPreferredLanguage(request.recipientId);
    const notificationId = this.idGenerator();
    const now = this.dateProvider();

    const subject = `CRITICAL ALERT: ${request.testName}`;
    const body = `Patient: ${request.patientName}\nTest: ${request.testName}\nValue: ${request.resultValue}\nThreshold: ${request.criticalThreshold} (${request.thresholdDirection})\nTime: ${request.timestamp}`;

    const channelResults: ChannelDeliveryResult[] = [];

    for (const channel of preferences.activeChannels) {
      const provider = this.channelProviders[channel];
      let status: 'delivered' | 'failed' = 'failed';
      let failureReason: string | undefined;

      try {
        const success = await provider.send(request.recipientId, subject, body, language);
        status = success ? 'delivered' : 'failed';
        if (!success) {
          failureReason = 'Channel delivery returned false';
        }
      } catch (error) {
        failureReason = error instanceof Error ? error.message : 'Unknown error';
      }

      const channelResult: ChannelDeliveryResult = {
        channel,
        status,
        attemptedAt: now,
        failureReason,
      };
      channelResults.push(channelResult);

      // Log the delivery attempt with alertId
      await this.deliveryLogRepository.save({
        id: this.idGenerator(),
        notificationId,
        alertId: request.alertId,
        recipientId: request.recipientId,
        channel,
        status,
        timestamp: now,
        language,
        failureReason,
      });
    }

    // Track critical alert for acknowledgement/escalation
    this.criticalAlerts.set(request.alertId, {
      alertId: request.alertId,
      recipientId: request.recipientId,
      escalationLevel: EscalationLevel.Physician,
      escalationHistory: [],
    });

    return {
      notificationId,
      recipientId: request.recipientId,
      channels: channelResults,
      deliveredAt: now,
      language,
    };
  }

  /**
   * Acknowledge a critical alert.
   *
   * Requirement 19.8: Record responder identity, timestamp, and action status.
   */
  async acknowledgeCriticalAlert(alertId: string, responderId: string, actionStatus: string): Promise<void> {
    const alert = this.criticalAlerts.get(alertId);
    if (!alert) {
      throw new AlertNotFoundError(alertId);
    }

    const now = this.dateProvider();
    alert.acknowledgedAt = now;
    alert.acknowledgedBy = responderId;
    alert.actionStatus = actionStatus;

    // Update escalation history with acknowledgement
    if (alert.escalationHistory.length > 0) {
      const lastEscalation = alert.escalationHistory[alert.escalationHistory.length - 1];
      lastEscalation.acknowledgedAt = now;
      lastEscalation.acknowledgedBy = responderId;
    }

    this.criticalAlerts.set(alertId, alert);
  }

  /**
   * Escalate a critical alert to the next level.
   *
   * Requirement 19.3: Escalate to department head after 30 minutes.
   * Requirement 19.4: Escalate to facility administrator after 60 minutes.
   */
  async escalateAlert(alertId: string, escalationLevel: EscalationLevel): Promise<void> {
    const alert = this.criticalAlerts.get(alertId);
    if (!alert) {
      throw new AlertNotFoundError(alertId);
    }

    const now = this.dateProvider();
    alert.escalationLevel = escalationLevel;
    alert.escalationHistory.push({
      level: escalationLevel,
      escalatedAt: now,
    });

    this.criticalAlerts.set(alertId, alert);
  }

  /**
   * Configure notification preferences for a user.
   *
   * Requirement 20.2: At least one active delivery channel required.
   *
   * @throws NoActiveChannelError if activeChannels is empty.
   */
  async configurePreferences(userId: string, preferences: NotificationPreferences): Promise<void> {
    if (!preferences.activeChannels || preferences.activeChannels.length === 0) {
      throw new NoActiveChannelError(userId);
    }

    // Validate all channels are valid
    for (const channel of preferences.activeChannels) {
      if (!VALID_CHANNELS.includes(channel)) {
        throw new NoActiveChannelError(userId);
      }
    }

    const existing = await this.preferencesRepository.findByUserId(userId);
    if (existing) {
      await this.preferencesRepository.update({ ...preferences, userId });
    } else {
      await this.preferencesRepository.save({ ...preferences, userId });
    }
  }

  /**
   * Get the delivery log for an alert.
   *
   * Requirement 19.5: Maintain log of all Critical alerts.
   */
  async getDeliveryLog(alertId: string): Promise<DeliveryLogEntry[]> {
    return this.deliveryLogRepository.findByAlertId(alertId);
  }

  /**
   * Get or create default preferences for a user.
   *
   * Requirement 20.7: Apply default preferences (in-app push) for new accounts.
   */
  private async getOrCreateDefaultPreferences(userId: string): Promise<NotificationPreferences> {
    const existing = await this.preferencesRepository.findByUserId(userId);
    if (existing) {
      return existing;
    }

    // Apply defaults for new accounts
    const defaults: NotificationPreferences = {
      userId,
      ...DEFAULT_PREFERENCES,
    };

    await this.preferencesRepository.save(defaults);
    return defaults;
  }
}
