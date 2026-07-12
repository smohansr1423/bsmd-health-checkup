/**
 * Notification transports — injectable ports + in-memory fakes (Task 13.1).
 *
 * The Notification Service (design: "Notification Service — Node.js + SNS/FCM +
 * SQS") delivers push/email/alert notifications and consumes work from an SQS
 * queue. To keep the service unit-testable without touching AWS, every external
 * transport (SNS/FCM push, email, the SQS queue) is expressed as a small
 * injectable interface. Production wiring supplies SNS/FCM/SES/SQS adapters;
 * unit and property tests supply the in-memory fakes defined here.
 *
 * The in-app store is the *fallback* channel: when a push/email delivery is
 * exhausted after its bounded retry schedule, the notification (or artifact) is
 * retained here for in-app viewing (Req 15.7, 17.5, 27.5).
 *
 * Requirements: 9.7, 15.6, 15.7, 17.5, 27.5
 */

/** A push notification routed through SNS/FCM in production. */
export interface PushMessage {
  readonly userId: string;
  readonly title: string;
  readonly body: string;
  /** Optional structured payload for client-side deep-linking. */
  readonly data?: Readonly<Record<string, string>>;
}

/** An email notification routed through SES (or equivalent) in production. */
export interface EmailMessage {
  readonly to: string;
  readonly subject: string;
  readonly body: string;
}

/**
 * An entry in the in-app inbox — the fallback channel presented when a push or
 * email delivery is exhausted, or when an artifact (e.g. a weekly digest) must
 * be retained for in-app viewing.
 */
export interface InAppMessage {
  readonly userId: string;
  readonly title: string;
  readonly body: string;
  /** Which notification kind produced this entry. */
  readonly category: string;
  /**
   * Whether this entry is a fallback presented after delivery exhaustion, as
   * opposed to a normally-delivered in-app message.
   */
  readonly fallback: boolean;
}

/** Push transport port (SNS/FCM behind an interface). */
export interface PushTransport {
  send(message: PushMessage): Promise<void>;
}

/** Email transport port (SES behind an interface). */
export interface EmailTransport {
  send(message: EmailMessage): Promise<void>;
}

/** In-app inbox port — durable fallback presentation surface. */
export interface InAppStore {
  save(message: InAppMessage): Promise<void>;
}

/** A single message pulled from the queue. */
export interface QueueMessage<T> {
  readonly id: string;
  readonly body: T;
}

/**
 * SQS consumer port. `poll` returns a batch of available messages; `delete`
 * acknowledges a message so it is not redelivered.
 */
export interface QueueConsumer<T> {
  poll(): Promise<ReadonlyArray<QueueMessage<T>>>;
  delete(id: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// In-memory fakes for unit / property tests
// ---------------------------------------------------------------------------

/**
 * A transport fake that can be scripted to fail a fixed number of times before
 * succeeding. `failuresRemaining` counts down on every send; while it is
 * greater than zero the send throws. Set it to `Infinity` for a transport that
 * always fails (to exercise the exhaustion / fallback path).
 */
export class FakePushTransport implements PushTransport {
  public readonly sent: PushMessage[] = [];
  public attempts = 0;

  constructor(public failuresRemaining = 0) {}

  async send(message: PushMessage): Promise<void> {
    this.attempts += 1;
    if (this.failuresRemaining > 0) {
      this.failuresRemaining -= 1;
      throw new Error('push transport unavailable');
    }
    this.sent.push(message);
  }
}

/** Email transport fake with the same scripted-failure behaviour. */
export class FakeEmailTransport implements EmailTransport {
  public readonly sent: EmailMessage[] = [];
  public attempts = 0;

  constructor(public failuresRemaining = 0) {}

  async send(message: EmailMessage): Promise<void> {
    this.attempts += 1;
    if (this.failuresRemaining > 0) {
      this.failuresRemaining -= 1;
      throw new Error('email transport unavailable');
    }
    this.sent.push(message);
  }
}

/** In-memory in-app inbox capturing every saved (including fallback) message. */
export class FakeInAppStore implements InAppStore {
  public readonly saved: InAppMessage[] = [];

  async save(message: InAppMessage): Promise<void> {
    this.saved.push(message);
  }
}

/**
 * In-memory queue consumer seeded with a fixed batch of messages. `poll`
 * returns the messages not yet deleted; `delete` removes them so a consume loop
 * terminates deterministically.
 */
export class FakeQueueConsumer<T> implements QueueConsumer<T> {
  private readonly messages: Map<string, QueueMessage<T>>;

  constructor(messages: ReadonlyArray<QueueMessage<T>>) {
    this.messages = new Map(messages.map((m) => [m.id, m]));
  }

  async poll(): Promise<ReadonlyArray<QueueMessage<T>>> {
    return [...this.messages.values()];
  }

  async delete(id: string): Promise<void> {
    this.messages.delete(id);
  }
}
