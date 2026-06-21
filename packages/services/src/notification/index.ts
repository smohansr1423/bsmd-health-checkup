/**
 * Notification Service barrel export
 */
export {
  NotificationService,
  InMemoryPreferencesRepository,
  InMemoryDeliveryLogRepository,
} from './notification.service';
export {
  NoActiveChannelError,
  PreferencesNotFoundError,
  AlertNotFoundError,
  InvalidChannelError,
  AllChannelsFailedError,
} from './notification.errors';
export {
  NotificationFallbackService,
  InMemoryUndeliveredRepository,
  InMemoryCaregiverPreferencesRepository,
  MAX_FALLBACK_ATTEMPTS,
  MAX_DELAY_BETWEEN_ATTEMPTS_MS,
  ALWAYS_DELIVER_TYPES,
  SUPPRESSIBLE_TYPES,
} from './notification.fallback';
export type {
  NotificationRequest,
  CriticalAlertRequest,
  DeliveryResult,
  ChannelDeliveryResult,
  NotificationPreferences,
  DeliveryLogEntry,
  ChannelProvider,
  NotificationPreferencesRepository,
  DeliveryLogRepository,
  LanguageProvider,
  NotificationDependencies,
} from './notification.types';
export type {
  UndeliveredNotification,
  CaregiverPreferences,
  FallbackDeliveryResult,
  UndeliveredNotificationRepository,
  CaregiverPreferencesRepository,
  FallbackDependencies,
} from './notification.fallback';
