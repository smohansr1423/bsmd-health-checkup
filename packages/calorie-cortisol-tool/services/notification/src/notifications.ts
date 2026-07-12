/**
 * Event-driven notification delivery (Task 13.1).
 *
 * The Notification Service consumes events off SQS and delivers them as
 * push/email/in-app notifications (design: "Event-driven push/email/alerts:
 * deviation alerts, sync-failure notices, digest delivery, referral prompts.
 * Consumes SQS events from other services").
 *
 * Every delivery runs through the shared bounded-retry scheduler
 * (`executeWithRetry`) so a transient transport failure is retried on the
 * operation's defined schedule and, once exhausted, falls back to the in-app
 * inbox — retaining the affected notification/artifact for in-app viewing
 * (Req 15.7, 17.5, 27.5).
 *
 * Schedule routing (all reuse `@calorie-cortisol/shared/result`):
 *   - weekly digest delivery → DIGEST_DELIVERY_SCHEDULE (3× at 30 min, Req 15.7)
 *   - wearable sync-failure notice → WEARABLE_SYNC_SCHEDULE (3× at 1/5/15 min, Req 9.7)
 *   - consent/offline sync-failure notice → CONSENT_SYNC_SCHEDULE (3×, Req 17.5/27.5)
 *   - deviation alerts / referral prompts → CONSENT_SYNC_SCHEDULE (bounded 3×)
 *
 * Requirements: 9.7, 15.6, 15.7, 17.5, 27.5
 */

import {
  type RetrySchedule,
  CONSENT_SYNC_SCHEDULE,
  DIGEST_DELIVERY_SCHEDULE,
  WEARABLE_SYNC_SCHEDULE,
} from '@calorie-cortisol/shared/result';
import {
  type BoundedRetryOptions,
  type BoundedRetryResult,
  executeWithRetry,
} from './retry-scheduler';
import {
  type EmailTransport,
  type InAppMessage,
  type InAppStore,
  type PushTransport,
  type QueueConsumer,
} from './transports';

/** The four notification kinds this service delivers. */
export type NotificationEventType =
  | 'deviationAlert'
  | 'syncFailureNotice'
  | 'digestDelivery'
  | 'referralPrompt';

/** A diurnal-pattern deviation alert (flattened CAR / elevated evening) (Req 11.5/11.6). */
export interface DeviationAlertEvent {
  readonly type: 'deviationAlert';
  readonly userId: string;
  readonly cause: 'flattenedCAR' | 'elevatedEvening';
  readonly detail: string;
}

/** A background sync-failure notice for a specific source/category (Req 9.7, 17.5, 27.5). */
export interface SyncFailureNoticeEvent {
  readonly type: 'syncFailureNotice';
  readonly userId: string;
  /** The affected data category / source (e.g. "wearable:oura", "cortisol"). */
  readonly category: string;
  /** Which upstream operation failed — selects the retry schedule. */
  readonly operation: 'wearableSync' | 'consentSync' | 'offlineSync';
}

/** Weekly digest delivery event emitted by the Insights service (Req 15.6/15.7). */
export interface DigestDeliveryEvent {
  readonly type: 'digestDelivery';
  readonly userId: string;
  readonly digestId: string;
  /** ISO date of the week the digest covers. */
  readonly weekOf: string;
  /** Rendered digest summary retained for in-app viewing on exhaustion. */
  readonly summary: string;
}

/** A professional-referral prompt (cortisol above threshold ≥3 weeks) (Req 13.2). */
export interface ReferralPromptEvent {
  readonly type: 'referralPrompt';
  readonly userId: string;
  readonly weeksAboveThreshold: number;
}

/** Discriminated union of all consumable notification events. */
export type NotificationEvent =
  | DeviationAlertEvent
  | SyncFailureNoticeEvent
  | DigestDeliveryEvent
  | ReferralPromptEvent;

/** External transports the dispatcher delivers through (all injectable). */
export interface NotificationTransports {
  readonly push: PushTransport;
  readonly email: EmailTransport;
  readonly inApp: InAppStore;
}

/** The result of delivering a single notification event. */
export interface DeliveryOutcome<T = unknown> extends BoundedRetryResult<T> {
  readonly eventType: NotificationEventType;
  readonly userId: string;
  /** The schedule the delivery was retried under. */
  readonly schedule: RetrySchedule;
}

const scheduleForOperation = (
  operation: SyncFailureNoticeEvent['operation'],
): RetrySchedule => {
  switch (operation) {
    case 'wearableSync':
      return WEARABLE_SYNC_SCHEDULE;
    case 'consentSync':
    case 'offlineSync':
      return CONSENT_SYNC_SCHEDULE;
  }
};

/**
 * Delivers notification events with bounded retry and in-app fallback. Consumes
 * events from an injected {@link QueueConsumer} (SQS in production, an in-memory
 * fake in tests).
 */
export class NotificationDispatcher {
  private readonly transports: NotificationTransports;
  private readonly retryOptions: Pick<BoundedRetryOptions, 'waitMinutes'>;

  constructor(
    transports: NotificationTransports,
    options: { waitMinutes?: BoundedRetryOptions['waitMinutes'] } = {},
  ) {
    this.transports = transports;
    this.retryOptions = { waitMinutes: options.waitMinutes };
  }

  /** Route and deliver a single event based on its type. */
  async dispatch(event: NotificationEvent): Promise<DeliveryOutcome> {
    switch (event.type) {
      case 'deviationAlert':
        return this.deliverDeviationAlert(event);
      case 'syncFailureNotice':
        return this.deliverSyncFailureNotice(event);
      case 'digestDelivery':
        return this.deliverDigest(event);
      case 'referralPrompt':
        return this.deliverReferralPrompt(event);
    }
  }

  /**
   * Consume a batch of events from the queue, dispatching each and deleting it
   * on completion. Returns every delivery outcome. A per-message failure never
   * aborts the batch; the bounded-retry + fallback path guarantees each event
   * reaches a terminal outcome.
   */
  async consume(
    consumer: QueueConsumer<NotificationEvent>,
  ): Promise<DeliveryOutcome[]> {
    const messages = await consumer.poll();
    const outcomes: DeliveryOutcome[] = [];
    for (const message of messages) {
      outcomes.push(await this.dispatch(message.body));
      await consumer.delete(message.id);
    }
    return outcomes;
  }

  // ----- per-kind delivery -------------------------------------------------

  private async deliverDeviationAlert(
    event: DeviationAlertEvent,
  ): Promise<DeliveryOutcome<DeviationAlertEvent>> {
    const title =
      event.cause === 'flattenedCAR'
        ? 'Cortisol pattern check-in'
        : 'Evening cortisol check-in';
    return this.pushWithFallback(event, WEARABLE_SYNC_SCHEDULE, {
      title,
      body: event.detail,
      category: 'deviationAlert',
      data: { cause: event.cause },
    });
  }

  private async deliverSyncFailureNotice(
    event: SyncFailureNoticeEvent,
  ): Promise<DeliveryOutcome<SyncFailureNoticeEvent>> {
    return this.pushWithFallback(event, scheduleForOperation(event.operation), {
      title: 'Sync unavailable',
      body: `Synchronization is currently unavailable for ${event.category}.`,
      category: 'syncFailureNotice',
      data: { category: event.category, operation: event.operation },
    });
  }

  private async deliverReferralPrompt(
    event: ReferralPromptEvent,
  ): Promise<DeliveryOutcome<ReferralPromptEvent>> {
    return this.pushWithFallback(event, CONSENT_SYNC_SCHEDULE, {
      title: 'A wellness suggestion',
      body: 'Consider connecting with a licensed professional about your recent readings.',
      category: 'referralPrompt',
      data: { weeksAboveThreshold: String(event.weeksAboveThreshold) },
    });
  }

  /**
   * Deliver the weekly digest. Delivery is attempted over email/push and retried
   * on the 30-minute digest schedule; after exhaustion the digest is retained in
   * the in-app inbox for in-app viewing (Req 15.7).
   */
  private async deliverDigest(
    event: DigestDeliveryEvent,
  ): Promise<DeliveryOutcome<DigestDeliveryEvent>> {
    const result = await executeWithRetry<DigestDeliveryEvent>(
      {
        artifact: event,
        attempt: async () => {
          await this.transports.push.send({
            userId: event.userId,
            title: 'Your weekly wellness digest',
            body: event.summary,
            data: { digestId: event.digestId, weekOf: event.weekOf },
          });
          return true;
        },
      },
      DIGEST_DELIVERY_SCHEDULE,
      {
        ...this.retryOptions,
        errorCode: 'DIGEST_DELIVERY_FAILED',
        errorMessage: 'Weekly digest delivery failed after 3 retries.',
      },
    );

    if (result.fallbackPresented) {
      await this.saveFallback({
        userId: event.userId,
        title: 'Your weekly wellness digest',
        body: event.summary,
        category: 'digestDelivery',
        fallback: true,
      });
    }

    return { ...result, eventType: 'digestDelivery', userId: event.userId, schedule: DIGEST_DELIVERY_SCHEDULE };
  }

  // ----- shared push+fallback helper --------------------------------------

  private async pushWithFallback<T extends NotificationEvent>(
    event: T,
    schedule: RetrySchedule,
    message: {
      title: string;
      body: string;
      category: string;
      data?: Record<string, string>;
    },
  ): Promise<DeliveryOutcome<T>> {
    const result = await executeWithRetry<T>(
      {
        artifact: event,
        attempt: async () => {
          await this.transports.push.send({
            userId: event.userId,
            title: message.title,
            body: message.body,
            data: message.data,
          });
          return true;
        },
      },
      schedule,
      {
        ...this.retryOptions,
        errorCode: `${message.category.toUpperCase()}_DELIVERY_FAILED`,
        errorMessage: `${message.category} delivery failed after exhausting the retry schedule.`,
      },
    );

    if (result.fallbackPresented) {
      await this.saveFallback({
        userId: event.userId,
        title: message.title,
        body: message.body,
        category: message.category,
        fallback: true,
      });
    }

    return {
      ...result,
      eventType: event.type,
      userId: event.userId,
      schedule,
    };
  }

  private async saveFallback(message: InAppMessage): Promise<void> {
    await this.transports.inApp.save(message);
  }
}
