/**
 * Critical Alert Delivery Retry Service
 *
 * Implements alert-specific delivery retry logic:
 * - On primary channel failure: retry 3 times at 2-minute intervals
 * - If all retries on primary fail: fallback to secondary channel within 1 minute
 *
 * This is distinct from the general NotificationFallbackService (Req 20.4) which
 * tries different channels immediately. This service retries the SAME channel
 * multiple times before falling back.
 *
 * Validates: Requirements 19.7, 19.8
 */

import { DeliveryChannel } from '@health-checkup/shared';
import type { ChannelProvider } from '../notification/notification.types';

/** Maximum retries on the primary channel before fallback */
export const MAX_PRIMARY_RETRIES = 3;

/** Interval between primary channel retries in milliseconds (2 minutes) */
export const PRIMARY_RETRY_INTERVAL_MS = 2 * 60 * 1000;

/** Maximum time to attempt secondary channel after final primary failure (1 minute) */
export const SECONDARY_FALLBACK_DEADLINE_MS = 1 * 60 * 1000;

/**
 * A single delivery attempt record.
 */
export interface AlertDeliveryAttempt {
  channel: DeliveryChannel;
  attemptNumber: number;
  status: 'delivered' | 'failed';
  attemptedAt: Date;
  failureReason?: string;
}

/**
 * Result of the alert delivery process.
 */
export interface AlertDeliveryResult {
  alertId: string;
  recipientId: string;
  delivered: boolean;
  primaryChannel: DeliveryChannel;
  attempts: AlertDeliveryAttempt[];
  fallbackUsed: boolean;
  finalChannel?: DeliveryChannel;
}

/**
 * Interface for the alert delivery service.
 */
export interface IAlertDeliveryService {
  deliverWithRetry(
    alertId: string,
    recipientId: string,
    channels: DeliveryChannel[],
  ): Promise<AlertDeliveryResult>;
}

/**
 * Dependencies for the AlertDeliveryService.
 */
export interface AlertDeliveryDependencies {
  dateProvider: () => Date;
  channelProviders: Record<DeliveryChannel, ChannelProvider>;
  delayFn?: (ms: number) => Promise<void>;
}

/** Default delay function using setTimeout */
const defaultDelay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * AlertDeliveryService implements critical alert delivery with retry and fallback.
 *
 * Requirement 19.7:
 * - If delivery fails on primary channel, retry up to 3 times at 2-minute intervals
 * - If all retries fail on primary, attempt delivery via secondary channel within 1 minute
 */
export class AlertDeliveryService implements IAlertDeliveryService {
  private readonly dateProvider: () => Date;
  private readonly channelProviders: Record<DeliveryChannel, ChannelProvider>;
  private readonly delayFn: (ms: number) => Promise<void>;

  constructor(deps: AlertDeliveryDependencies) {
    this.dateProvider = deps.dateProvider;
    this.channelProviders = deps.channelProviders;
    this.delayFn = deps.delayFn ?? defaultDelay;
  }

  /**
   * Deliver a critical alert with retry on primary and fallback to secondary.
   *
   * @param alertId - The critical alert ID
   * @param recipientId - The recipient to deliver to
   * @param channels - Ordered list of delivery channels (first is primary, second is secondary)
   * @returns AlertDeliveryResult with full attempt history
   */
  async deliverWithRetry(
    alertId: string,
    recipientId: string,
    channels: DeliveryChannel[],
  ): Promise<AlertDeliveryResult> {
    if (channels.length === 0) {
      return {
        alertId,
        recipientId,
        delivered: false,
        primaryChannel: undefined as unknown as DeliveryChannel,
        attempts: [],
        fallbackUsed: false,
      };
    }

    const primaryChannel = channels[0];
    const secondaryChannel = channels.length > 1 ? channels[1] : undefined;
    const attempts: AlertDeliveryAttempt[] = [];

    // Attempt delivery on primary channel up to MAX_PRIMARY_RETRIES + 1 (initial + retries)
    const totalPrimaryAttempts = MAX_PRIMARY_RETRIES + 1;

    for (let i = 0; i < totalPrimaryAttempts; i++) {
      // Wait before retry (not before first attempt)
      if (i > 0) {
        await this.delayFn(PRIMARY_RETRY_INTERVAL_MS);
      }

      const attempt = await this.attemptDelivery(
        primaryChannel,
        recipientId,
        i + 1,
      );
      attempts.push(attempt);

      if (attempt.status === 'delivered') {
        return {
          alertId,
          recipientId,
          delivered: true,
          primaryChannel,
          attempts,
          fallbackUsed: false,
          finalChannel: primaryChannel,
        };
      }
    }

    // All primary attempts failed — fallback to secondary channel within 1 minute
    if (secondaryChannel) {
      await this.delayFn(SECONDARY_FALLBACK_DEADLINE_MS);

      const fallbackAttempt = await this.attemptDelivery(
        secondaryChannel,
        recipientId,
        1,
      );
      attempts.push(fallbackAttempt);

      if (fallbackAttempt.status === 'delivered') {
        return {
          alertId,
          recipientId,
          delivered: true,
          primaryChannel,
          attempts,
          fallbackUsed: true,
          finalChannel: secondaryChannel,
        };
      }
    }

    // All delivery attempts failed
    return {
      alertId,
      recipientId,
      delivered: false,
      primaryChannel,
      attempts,
      fallbackUsed: secondaryChannel !== undefined,
    };
  }

  /**
   * Attempt delivery on a single channel.
   */
  private async attemptDelivery(
    channel: DeliveryChannel,
    recipientId: string,
    attemptNumber: number,
  ): Promise<AlertDeliveryAttempt> {
    const attemptedAt = this.dateProvider();
    const provider = this.channelProviders[channel];

    try {
      const success = await provider.send(
        recipientId,
        'Critical Alert',
        'Critical test result requires immediate attention',
        'en' as any,
      );

      return {
        channel,
        attemptNumber,
        status: success ? 'delivered' : 'failed',
        attemptedAt,
        failureReason: success ? undefined : 'Channel delivery returned false',
      };
    } catch (error) {
      return {
        channel,
        attemptNumber,
        status: 'failed',
        attemptedAt,
        failureReason: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
}
