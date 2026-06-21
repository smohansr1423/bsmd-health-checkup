/**
 * Notification Service Errors
 * Custom error types for the notification delivery workflow.
 * Validates: Requirements 20.2
 */

/**
 * Thrown when notification preferences are configured with no active channels.
 * Requirement 20.2: At least one active delivery channel is required.
 */
export class NoActiveChannelError extends Error {
  public readonly userId: string;

  constructor(userId: string) {
    super(`Notification preferences must include at least one active delivery channel. User: ${userId}`);
    this.name = 'NoActiveChannelError';
    this.userId = userId;
  }
}

/**
 * Thrown when a notification is sent to a user with no configured preferences
 * and the system cannot apply defaults (should not occur with proper default handling).
 */
export class PreferencesNotFoundError extends Error {
  public readonly userId: string;

  constructor(userId: string) {
    super(`Notification preferences not found for user: ${userId}`);
    this.name = 'PreferencesNotFoundError';
    this.userId = userId;
  }
}

/**
 * Thrown when an alert is not found by ID.
 */
export class AlertNotFoundError extends Error {
  public readonly alertId: string;

  constructor(alertId: string) {
    super(`Alert not found: ${alertId}`);
    this.name = 'AlertNotFoundError';
    this.alertId = alertId;
  }
}

/**
 * Thrown when an invalid delivery channel is specified.
 */
export class InvalidChannelError extends Error {
  public readonly channel: string;

  constructor(channel: string) {
    super(`Invalid delivery channel: ${channel}`);
    this.name = 'InvalidChannelError';
    this.channel = channel;
  }
}

/**
 * Thrown when delivery fails on all configured channels.
 */
export class AllChannelsFailedError extends Error {
  public readonly recipientId: string;
  public readonly channels: string[];

  constructor(recipientId: string, channels: string[]) {
    super(`Notification delivery failed on all channels [${channels.join(', ')}] for recipient: ${recipientId}`);
    this.name = 'AllChannelsFailedError';
    this.recipientId = recipientId;
    this.channels = channels;
  }
}
