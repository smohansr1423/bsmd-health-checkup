/**
 * Notification and Critical Alert interfaces
 */
import { DeliveryChannel, EscalationLevel, NotificationType, SupportedLanguage } from '../enums';

export interface NotificationContent {
  subject: string;
  body: string;
  metadata?: Record<string, string>;
}

export interface DeliveryStatus {
  channel: DeliveryChannel;
  status: 'pending' | 'delivered' | 'failed';
  attemptCount: number;
  lastAttemptAt?: Date;
  deliveredAt?: Date;
  failureReason?: string;
}

export interface Notification {
  id: string;
  recipientId: string;
  type: NotificationType;
  category: 'critical' | 'appointment' | 'informational';
  content: NotificationContent;
  channels: DeliveryChannel[];
  deliveryStatus: DeliveryStatus[];
  language: SupportedLanguage;
  createdAt: Date;
}

export interface NotificationPreferences {
  userId: string;
  activeChannels: DeliveryChannel[]; // min 1
  optOutNonCritical: boolean;
  quietHoursStart?: string; // HH:mm
  quietHoursEnd?: string;
}

export interface EscalationEvent {
  level: EscalationLevel;
  escalatedAt: Date;
  acknowledgedAt?: Date;
  acknowledgedBy?: string;
}

export interface CriticalAlert {
  id: string;
  testResultId: string;
  seniorId: string;
  physicianId: string;
  testName: string;
  resultValue: number;
  criticalThreshold: number;
  sentAt: Date;
  acknowledgedAt?: Date;
  acknowledgedBy?: string;
  actionStatus?: string;
  escalationLevel: EscalationLevel;
  escalationHistory: EscalationEvent[];
}
