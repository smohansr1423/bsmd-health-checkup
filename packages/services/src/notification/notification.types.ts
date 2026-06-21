/**
 * Notification Service Types
 * Request/response types and DI interfaces for multi-channel notification delivery.
 * Validates: Requirements 20.1, 20.2, 20.7, 19.6
 */

import type { DeliveryChannel, EscalationLevel, NotificationType, SupportedLanguage, NotificationPreferences } from '@health-checkup/shared';

/**
 * Request payload for sending a notification.
 */
export interface NotificationRequest {
  recipientId: string;
  type: NotificationType;
  subject: string;
  body: string;
  metadata?: Record<string, string>;
}

/**
 * Request payload for sending a critical alert notification.
 */
export interface CriticalAlertRequest {
  alertId: string;
  recipientId: string;
  testName: string;
  resultValue: number;
  criticalThreshold: number;
  thresholdDirection: 'above' | 'below';
  patientName: string;
  timestamp: string; // ISO 8601
}

/**
 * Result of a notification delivery attempt.
 */
export interface DeliveryResult {
  notificationId: string;
  recipientId: string;
  channels: ChannelDeliveryResult[];
  deliveredAt: Date;
  language: SupportedLanguage;
}

/**
 * Result of delivery attempt on a single channel.
 */
export interface ChannelDeliveryResult {
  channel: DeliveryChannel;
  status: 'delivered' | 'failed' | 'pending';
  attemptedAt: Date;
  failureReason?: string;
}

/**
 * Re-export NotificationPreferences from shared for convenience.
 * At least one active channel is required (Req 20.2).
 */
export type { NotificationPreferences };

/**
 * Entry in the delivery log for audit trail.
 */
export interface DeliveryLogEntry {
  id: string;
  notificationId: string;
  alertId?: string;
  recipientId: string;
  channel: DeliveryChannel;
  status: 'delivered' | 'failed' | 'pending';
  timestamp: Date;
  language: SupportedLanguage;
  failureReason?: string;
}

/**
 * Channel delivery provider interface.
 * Each channel (SMS, email, push, phone_call) implements this.
 */
export interface ChannelProvider {
  send(recipientId: string, subject: string, body: string, language: SupportedLanguage): Promise<boolean>;
}

/**
 * Repository interface for notification preferences persistence.
 */
export interface NotificationPreferencesRepository {
  save(preferences: NotificationPreferences): Promise<NotificationPreferences>;
  findByUserId(userId: string): Promise<NotificationPreferences | null>;
  update(preferences: NotificationPreferences): Promise<NotificationPreferences>;
}

/**
 * Repository interface for delivery log persistence.
 */
export interface DeliveryLogRepository {
  save(entry: DeliveryLogEntry): Promise<DeliveryLogEntry>;
  findByNotificationId(notificationId: string): Promise<DeliveryLogEntry[]>;
  findByAlertId(alertId: string): Promise<DeliveryLogEntry[]>;
}

/**
 * Provider for resolving user's preferred language.
 */
export interface LanguageProvider {
  getPreferredLanguage(userId: string): Promise<SupportedLanguage>;
}

/**
 * Dependencies injected into the NotificationService for testability.
 */
export interface NotificationDependencies {
  idGenerator: () => string;
  dateProvider: () => Date;
  preferencesRepository: NotificationPreferencesRepository;
  deliveryLogRepository: DeliveryLogRepository;
  languageProvider: LanguageProvider;
  channelProviders: Record<DeliveryChannel, ChannelProvider>;
}
