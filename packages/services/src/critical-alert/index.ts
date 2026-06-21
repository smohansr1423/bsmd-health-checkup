/**
 * Critical Alert Escalation State Machine barrel export
 */
export {
  CriticalAlertService,
  InMemoryCriticalAlertRepository,
  InMemoryAlertLogRepository,
} from './critical-alert.service';
export {
  CriticalAlertNotFoundError,
  AlertAlreadyAcknowledgedError,
  IncompleteAcknowledgementError,
  InvalidAlertDataError,
} from './critical-alert.errors';
export {
  AlertDeliveryService,
  MAX_PRIMARY_RETRIES,
  PRIMARY_RETRY_INTERVAL_MS,
  SECONDARY_FALLBACK_DEADLINE_MS,
} from './critical-alert.delivery';
export type {
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
export type {
  AlertDeliveryAttempt,
  AlertDeliveryResult,
  IAlertDeliveryService,
  AlertDeliveryDependencies,
} from './critical-alert.delivery';
