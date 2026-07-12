import {
  CONSENT_SYNC_SCHEDULE,
  DIGEST_DELIVERY_SCHEDULE,
  WEARABLE_SYNC_SCHEDULE,
} from '@calorie-cortisol/shared/result';
import {
  type DeviationAlertEvent,
  type DigestDeliveryEvent,
  type NotificationEvent,
  type ReferralPromptEvent,
  type SyncFailureNoticeEvent,
  NotificationDispatcher,
} from './notifications';
import {
  FakeInAppStore,
  FakePushTransport,
  FakeQueueConsumer,
  type EmailTransport,
} from './transports';

/**
 * Unit tests for the event-driven NotificationDispatcher (Task 13.1): SQS-style
 * consumption of push/alert/digest/referral events, schedule routing, bounded
 * retry, and the in-app fallback after exhaustion.
 *
 * Requirements: 9.7, 15.6, 15.7, 17.5, 27.5
 */
const noopEmail: EmailTransport = { async send() {} };

const makeDispatcher = (push: FakePushTransport, inApp: FakeInAppStore) =>
  new NotificationDispatcher({ push, email: noopEmail, inApp });

describe('NotificationDispatcher', () => {
  const deviation: DeviationAlertEvent = {
    type: 'deviationAlert',
    userId: 'u1',
    cause: 'flattenedCAR',
    detail: 'Your morning cortisol rise looks flatter than usual.',
  };

  const digest: DigestDeliveryEvent = {
    type: 'digestDelivery',
    userId: 'u2',
    digestId: 'd-1',
    weekOf: '2024-06-02',
    summary: 'Here is your week in review.',
  };

  const referral: ReferralPromptEvent = {
    type: 'referralPrompt',
    userId: 'u3',
    weeksAboveThreshold: 3,
  };

  it('delivers a deviation alert as a push notification on first try', async () => {
    const push = new FakePushTransport(0);
    const inApp = new FakeInAppStore();
    const outcome = await makeDispatcher(push, inApp).dispatch(deviation);

    expect(outcome.delivered).toBe(true);
    expect(outcome.eventType).toBe('deviationAlert');
    expect(outcome.schedule).toBe(WEARABLE_SYNC_SCHEDULE);
    expect(push.sent).toHaveLength(1);
    expect(push.sent[0].userId).toBe('u1');
    expect(inApp.saved).toHaveLength(0);
  });

  it('retries then delivers when the transport is transiently down', async () => {
    const push = new FakePushTransport(2); // fail twice, then succeed
    const inApp = new FakeInAppStore();
    const outcome = await makeDispatcher(push, inApp).dispatch(deviation);

    expect(outcome.delivered).toBe(true);
    expect(outcome.retries).toBe(2);
    expect(push.sent).toHaveLength(1);
    expect(inApp.saved).toHaveLength(0);
  });

  it('falls back to the in-app inbox after exhausting the retry schedule', async () => {
    const push = new FakePushTransport(Number.POSITIVE_INFINITY);
    const inApp = new FakeInAppStore();
    const outcome = await makeDispatcher(push, inApp).dispatch(deviation);

    expect(outcome.delivered).toBe(false);
    expect(outcome.fallbackPresented).toBe(true);
    expect(outcome.error?.retainedState).toBe(true);
    expect(outcome.error?.retryable).toBe(false);
    expect(inApp.saved).toHaveLength(1);
    expect(inApp.saved[0]).toMatchObject({
      userId: 'u1',
      category: 'deviationAlert',
      fallback: true,
    });
  });

  it('routes a wearable sync-failure notice onto the wearable schedule', async () => {
    const event: SyncFailureNoticeEvent = {
      type: 'syncFailureNotice',
      userId: 'u4',
      category: 'wearable:oura',
      operation: 'wearableSync',
    };
    const push = new FakePushTransport(0);
    const outcome = await makeDispatcher(push, new FakeInAppStore()).dispatch(event);

    expect(outcome.schedule).toBe(WEARABLE_SYNC_SCHEDULE);
    expect(push.sent[0].data).toMatchObject({ operation: 'wearableSync' });
  });

  it('routes consent/offline sync-failure notices onto the consent schedule', async () => {
    const consentEvent: SyncFailureNoticeEvent = {
      type: 'syncFailureNotice',
      userId: 'u5',
      category: 'consent',
      operation: 'consentSync',
    };
    const offlineEvent: SyncFailureNoticeEvent = {
      type: 'syncFailureNotice',
      userId: 'u6',
      category: 'vault',
      operation: 'offlineSync',
    };
    const dispatcher = makeDispatcher(new FakePushTransport(0), new FakeInAppStore());

    expect((await dispatcher.dispatch(consentEvent)).schedule).toBe(CONSENT_SYNC_SCHEDULE);
    expect((await dispatcher.dispatch(offlineEvent)).schedule).toBe(CONSENT_SYNC_SCHEDULE);
  });

  it('delivers the weekly digest on the digest schedule', async () => {
    const push = new FakePushTransport(0);
    const outcome = await makeDispatcher(push, new FakeInAppStore()).dispatch(digest);

    expect(outcome.delivered).toBe(true);
    expect(outcome.schedule).toBe(DIGEST_DELIVERY_SCHEDULE);
    expect(push.sent[0].data).toMatchObject({ digestId: 'd-1', weekOf: '2024-06-02' });
  });

  it('retains the digest artifact in the in-app inbox when delivery is exhausted', async () => {
    const push = new FakePushTransport(Number.POSITIVE_INFINITY);
    const inApp = new FakeInAppStore();
    const outcome = await makeDispatcher(push, inApp).dispatch(digest);

    expect(outcome.fallbackPresented).toBe(true);
    expect(inApp.saved[0]).toMatchObject({
      userId: 'u2',
      category: 'digestDelivery',
      body: 'Here is your week in review.',
      fallback: true,
    });
  });

  it('delivers a referral prompt on the consent schedule', async () => {
    const push = new FakePushTransport(0);
    const outcome = await makeDispatcher(push, new FakeInAppStore()).dispatch(referral);

    expect(outcome.delivered).toBe(true);
    expect(outcome.schedule).toBe(CONSENT_SYNC_SCHEDULE);
  });

  it('consumes a batch off the queue, delivering and acknowledging each message', async () => {
    const events: NotificationEvent[] = [deviation, digest, referral];
    const consumer = new FakeQueueConsumer(
      events.map((body, i) => ({ id: `m${i}`, body })),
    );
    const push = new FakePushTransport(0);
    const dispatcher = makeDispatcher(push, new FakeInAppStore());

    const outcomes = await dispatcher.consume(consumer);

    expect(outcomes).toHaveLength(3);
    expect(outcomes.every((o) => o.delivered)).toBe(true);
    expect(push.sent).toHaveLength(3);
    // All messages were acknowledged/deleted, so a re-poll is empty.
    expect(await consumer.poll()).toHaveLength(0);
  });

  it('reaches a terminal outcome for every message even when the transport is down', async () => {
    const consumer = new FakeQueueConsumer([{ id: 'm0', body: deviation }]);
    const push = new FakePushTransport(Number.POSITIVE_INFINITY);
    const inApp = new FakeInAppStore();
    const outcomes = await makeDispatcher(push, inApp).consume(consumer);

    expect(outcomes[0].fallbackPresented).toBe(true);
    expect(inApp.saved).toHaveLength(1);
    expect(await consumer.poll()).toHaveLength(0);
  });
});
