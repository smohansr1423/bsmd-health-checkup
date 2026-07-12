/**
 * @calorie-cortisol/notification
 *
 * Event-driven push/email/alert delivery (deviation alerts, sync-failure
 * notices, digest delivery, referral prompts) plus a shared bounded-retry
 * scheduler that retains the affected artifact, retries on the defined schedule
 * (wearable sync 3× at 1/5/15 min; consent/offline sync 3×; digest 3× at
 * 30 min), and presents an in-app fallback after the final failure.
 *
 * Requirements: 9.7, 15.6, 15.7, 17.5, 27.5
 */
export const PACKAGE_NAME = '@calorie-cortisol/notification';

// Bounded-retry scheduler (shared engine over @calorie-cortisol/shared/result).
export {
  type AttemptRecord,
  type BoundedRetryOptions,
  type BoundedRetryResult,
  type RetainableOperation,
  type RetrySchedule,
  executeWithRetry,
} from './retry-scheduler';

// Injectable transport ports + in-memory fakes.
export {
  type EmailMessage,
  type EmailTransport,
  type InAppMessage,
  type InAppStore,
  type PushMessage,
  type PushTransport,
  type QueueConsumer,
  type QueueMessage,
  FakeEmailTransport,
  FakeInAppStore,
  FakePushTransport,
  FakeQueueConsumer,
} from './transports';

// Event-driven dispatcher.
export {
  type DeliveryOutcome,
  type DeviationAlertEvent,
  type DigestDeliveryEvent,
  type NotificationEvent,
  type NotificationEventType,
  type NotificationTransports,
  type ReferralPromptEvent,
  type SyncFailureNoticeEvent,
  NotificationDispatcher,
} from './notifications';
