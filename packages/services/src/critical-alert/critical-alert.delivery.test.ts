/**
 * Critical Alert Delivery Retry Service - Unit Tests
 * Validates: Requirements 19.7, 19.8
 */

import { DeliveryChannel } from '@health-checkup/shared';
import {
  AlertDeliveryService,
  MAX_PRIMARY_RETRIES,
  PRIMARY_RETRY_INTERVAL_MS,
  SECONDARY_FALLBACK_DEADLINE_MS,
} from './critical-alert.delivery';
import type { AlertDeliveryDependencies } from './critical-alert.delivery';
import type { ChannelProvider } from '../notification/notification.types';

// --- Test Helpers ---

function createMockChannelProvider(sendFn?: () => Promise<boolean>): ChannelProvider {
  return {
    send: sendFn ?? jest.fn().mockResolvedValue(true),
  };
}

function createFailingProvider(failureReason?: string): ChannelProvider {
  return {
    send: jest.fn().mockRejectedValue(new Error(failureReason ?? 'Channel unavailable')),
  };
}

function createFalseProvider(): ChannelProvider {
  return {
    send: jest.fn().mockResolvedValue(false),
  };
}

function createTestDeps(overrides?: Partial<AlertDeliveryDependencies>): AlertDeliveryDependencies {
  return {
    dateProvider: () => new Date('2024-03-01T10:00:00.000Z'),
    channelProviders: {
      [DeliveryChannel.SMS]: createMockChannelProvider(),
      [DeliveryChannel.Email]: createMockChannelProvider(),
      [DeliveryChannel.Push]: createMockChannelProvider(),
      [DeliveryChannel.PhoneCall]: createMockChannelProvider(),
    },
    delayFn: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

// --- Tests ---

describe('AlertDeliveryService', () => {
  describe('deliverWithRetry - successful primary delivery', () => {
    it('should deliver on first attempt when primary channel succeeds', async () => {
      const deps = createTestDeps();
      const service = new AlertDeliveryService(deps);

      const result = await service.deliverWithRetry(
        'alert-1',
        'recipient-1',
        [DeliveryChannel.SMS, DeliveryChannel.Email],
      );

      expect(result.delivered).toBe(true);
      expect(result.alertId).toBe('alert-1');
      expect(result.recipientId).toBe('recipient-1');
      expect(result.primaryChannel).toBe(DeliveryChannel.SMS);
      expect(result.fallbackUsed).toBe(false);
      expect(result.finalChannel).toBe(DeliveryChannel.SMS);
      expect(result.attempts).toHaveLength(1);
      expect(result.attempts[0].status).toBe('delivered');
      expect(result.attempts[0].attemptNumber).toBe(1);
    });

    it('should not wait before first delivery attempt', async () => {
      const delayFn = jest.fn().mockResolvedValue(undefined);
      const deps = createTestDeps({ delayFn });
      const service = new AlertDeliveryService(deps);

      await service.deliverWithRetry(
        'alert-1',
        'recipient-1',
        [DeliveryChannel.SMS, DeliveryChannel.Email],
      );

      expect(delayFn).not.toHaveBeenCalled();
    });
  });

  describe('deliverWithRetry - primary retry logic (Req 19.7)', () => {
    it('should retry 3 times at 2-minute intervals on primary failure', async () => {
      const smsProvider = createFalseProvider();
      const emailProvider = createMockChannelProvider();
      const delayFn = jest.fn().mockResolvedValue(undefined);

      const deps = createTestDeps({
        channelProviders: {
          [DeliveryChannel.SMS]: smsProvider,
          [DeliveryChannel.Email]: emailProvider,
          [DeliveryChannel.Push]: createMockChannelProvider(),
          [DeliveryChannel.PhoneCall]: createMockChannelProvider(),
        },
        delayFn,
      });
      const service = new AlertDeliveryService(deps);

      const result = await service.deliverWithRetry(
        'alert-1',
        'recipient-1',
        [DeliveryChannel.SMS, DeliveryChannel.Email],
      );

      // 4 total primary attempts (1 initial + 3 retries), all failed
      const primaryAttempts = result.attempts.filter((a) => a.channel === DeliveryChannel.SMS);
      expect(primaryAttempts).toHaveLength(4);
      expect(primaryAttempts.every((a) => a.status === 'failed')).toBe(true);

      // Should have waited 3 times at 2-minute intervals for retries + 1 time for fallback
      const retryDelays = delayFn.mock.calls.filter(
        (call) => call[0] === PRIMARY_RETRY_INTERVAL_MS,
      );
      expect(retryDelays).toHaveLength(3);
    });

    it('should succeed on retry attempt without fallback', async () => {
      let callCount = 0;
      const smsProvider: ChannelProvider = {
        send: jest.fn().mockImplementation(() => {
          callCount++;
          // Succeed on 3rd attempt
          return Promise.resolve(callCount === 3);
        }),
      };

      const deps = createTestDeps({
        channelProviders: {
          [DeliveryChannel.SMS]: smsProvider,
          [DeliveryChannel.Email]: createMockChannelProvider(),
          [DeliveryChannel.Push]: createMockChannelProvider(),
          [DeliveryChannel.PhoneCall]: createMockChannelProvider(),
        },
      });
      const service = new AlertDeliveryService(deps);

      const result = await service.deliverWithRetry(
        'alert-1',
        'recipient-1',
        [DeliveryChannel.SMS, DeliveryChannel.Email],
      );

      expect(result.delivered).toBe(true);
      expect(result.fallbackUsed).toBe(false);
      expect(result.finalChannel).toBe(DeliveryChannel.SMS);
      expect(result.attempts).toHaveLength(3);
      expect(result.attempts[0].status).toBe('failed');
      expect(result.attempts[1].status).toBe('failed');
      expect(result.attempts[2].status).toBe('delivered');
    });

    it('should record correct attempt numbers', async () => {
      const smsProvider = createFalseProvider();
      const emailProvider = createMockChannelProvider();

      const deps = createTestDeps({
        channelProviders: {
          [DeliveryChannel.SMS]: smsProvider,
          [DeliveryChannel.Email]: emailProvider,
          [DeliveryChannel.Push]: createMockChannelProvider(),
          [DeliveryChannel.PhoneCall]: createMockChannelProvider(),
        },
      });
      const service = new AlertDeliveryService(deps);

      const result = await service.deliverWithRetry(
        'alert-1',
        'recipient-1',
        [DeliveryChannel.SMS, DeliveryChannel.Email],
      );

      const primaryAttempts = result.attempts.filter((a) => a.channel === DeliveryChannel.SMS);
      expect(primaryAttempts[0].attemptNumber).toBe(1);
      expect(primaryAttempts[1].attemptNumber).toBe(2);
      expect(primaryAttempts[2].attemptNumber).toBe(3);
      expect(primaryAttempts[3].attemptNumber).toBe(4);
    });
  });

  describe('deliverWithRetry - fallback to secondary (Req 19.7)', () => {
    it('should fallback to secondary channel within 1 minute after all primary retries fail', async () => {
      const smsProvider = createFalseProvider();
      const emailProvider = createMockChannelProvider();
      const delayFn = jest.fn().mockResolvedValue(undefined);

      const deps = createTestDeps({
        channelProviders: {
          [DeliveryChannel.SMS]: smsProvider,
          [DeliveryChannel.Email]: emailProvider,
          [DeliveryChannel.Push]: createMockChannelProvider(),
          [DeliveryChannel.PhoneCall]: createMockChannelProvider(),
        },
        delayFn,
      });
      const service = new AlertDeliveryService(deps);

      const result = await service.deliverWithRetry(
        'alert-1',
        'recipient-1',
        [DeliveryChannel.SMS, DeliveryChannel.Email],
      );

      expect(result.delivered).toBe(true);
      expect(result.fallbackUsed).toBe(true);
      expect(result.finalChannel).toBe(DeliveryChannel.Email);
      expect(result.primaryChannel).toBe(DeliveryChannel.SMS);

      // Verify fallback delay was 1 minute (secondary fallback deadline)
      const fallbackDelay = delayFn.mock.calls.find(
        (call) => call[0] === SECONDARY_FALLBACK_DEADLINE_MS,
      );
      expect(fallbackDelay).toBeDefined();
    });

    it('should report all attempts including fallback', async () => {
      const smsProvider = createFalseProvider();
      const emailProvider = createMockChannelProvider();

      const deps = createTestDeps({
        channelProviders: {
          [DeliveryChannel.SMS]: smsProvider,
          [DeliveryChannel.Email]: emailProvider,
          [DeliveryChannel.Push]: createMockChannelProvider(),
          [DeliveryChannel.PhoneCall]: createMockChannelProvider(),
        },
      });
      const service = new AlertDeliveryService(deps);

      const result = await service.deliverWithRetry(
        'alert-1',
        'recipient-1',
        [DeliveryChannel.SMS, DeliveryChannel.Email],
      );

      // 4 primary (all failed) + 1 secondary (delivered)
      expect(result.attempts).toHaveLength(5);
      expect(result.attempts[4].channel).toBe(DeliveryChannel.Email);
      expect(result.attempts[4].status).toBe('delivered');
      expect(result.attempts[4].attemptNumber).toBe(1);
    });

    it('should return undelivered when both primary and secondary fail', async () => {
      const smsProvider = createFalseProvider();
      const emailProvider = createFalseProvider();

      const deps = createTestDeps({
        channelProviders: {
          [DeliveryChannel.SMS]: smsProvider,
          [DeliveryChannel.Email]: emailProvider,
          [DeliveryChannel.Push]: createMockChannelProvider(),
          [DeliveryChannel.PhoneCall]: createMockChannelProvider(),
        },
      });
      const service = new AlertDeliveryService(deps);

      const result = await service.deliverWithRetry(
        'alert-1',
        'recipient-1',
        [DeliveryChannel.SMS, DeliveryChannel.Email],
      );

      expect(result.delivered).toBe(false);
      expect(result.fallbackUsed).toBe(true);
      expect(result.finalChannel).toBeUndefined();
      // 4 primary + 1 secondary = 5 total
      expect(result.attempts).toHaveLength(5);
    });

    it('should not attempt fallback when no secondary channel is configured', async () => {
      const smsProvider = createFalseProvider();

      const deps = createTestDeps({
        channelProviders: {
          [DeliveryChannel.SMS]: smsProvider,
          [DeliveryChannel.Email]: createMockChannelProvider(),
          [DeliveryChannel.Push]: createMockChannelProvider(),
          [DeliveryChannel.PhoneCall]: createMockChannelProvider(),
        },
      });
      const service = new AlertDeliveryService(deps);

      const result = await service.deliverWithRetry(
        'alert-1',
        'recipient-1',
        [DeliveryChannel.SMS], // only one channel
      );

      expect(result.delivered).toBe(false);
      expect(result.fallbackUsed).toBe(false);
      // Only 4 primary attempts, no fallback
      expect(result.attempts).toHaveLength(4);
    });
  });

  describe('deliverWithRetry - error handling', () => {
    it('should handle channel provider throwing errors gracefully', async () => {
      const smsProvider = createFailingProvider('Network timeout');
      const emailProvider = createMockChannelProvider();

      const deps = createTestDeps({
        channelProviders: {
          [DeliveryChannel.SMS]: smsProvider,
          [DeliveryChannel.Email]: emailProvider,
          [DeliveryChannel.Push]: createMockChannelProvider(),
          [DeliveryChannel.PhoneCall]: createMockChannelProvider(),
        },
      });
      const service = new AlertDeliveryService(deps);

      const result = await service.deliverWithRetry(
        'alert-1',
        'recipient-1',
        [DeliveryChannel.SMS, DeliveryChannel.Email],
      );

      expect(result.delivered).toBe(true);
      expect(result.fallbackUsed).toBe(true);

      const failedAttempts = result.attempts.filter((a) => a.status === 'failed');
      expect(failedAttempts[0].failureReason).toBe('Network timeout');
    });

    it('should handle empty channels list', async () => {
      const deps = createTestDeps();
      const service = new AlertDeliveryService(deps);

      const result = await service.deliverWithRetry('alert-1', 'recipient-1', []);

      expect(result.delivered).toBe(false);
      expect(result.attempts).toHaveLength(0);
      expect(result.fallbackUsed).toBe(false);
    });

    it('should record timestamps for each attempt', async () => {
      let timeCounter = 0;
      const dateProvider = () => {
        timeCounter++;
        return new Date(`2024-03-01T10:0${timeCounter}:00.000Z`);
      };

      const smsProvider = createFalseProvider();
      const emailProvider = createMockChannelProvider();

      const deps = createTestDeps({
        dateProvider,
        channelProviders: {
          [DeliveryChannel.SMS]: smsProvider,
          [DeliveryChannel.Email]: emailProvider,
          [DeliveryChannel.Push]: createMockChannelProvider(),
          [DeliveryChannel.PhoneCall]: createMockChannelProvider(),
        },
      });
      const service = new AlertDeliveryService(deps);

      const result = await service.deliverWithRetry(
        'alert-1',
        'recipient-1',
        [DeliveryChannel.SMS, DeliveryChannel.Email],
      );

      // Each attempt should have a distinct timestamp
      const timestamps = result.attempts.map((a) => a.attemptedAt.toISOString());
      const uniqueTimestamps = new Set(timestamps);
      expect(uniqueTimestamps.size).toBe(timestamps.length);
    });
  });

  describe('deliverWithRetry - timing constants', () => {
    it('MAX_PRIMARY_RETRIES should be 3', () => {
      expect(MAX_PRIMARY_RETRIES).toBe(3);
    });

    it('PRIMARY_RETRY_INTERVAL_MS should be 2 minutes', () => {
      expect(PRIMARY_RETRY_INTERVAL_MS).toBe(2 * 60 * 1000);
    });

    it('SECONDARY_FALLBACK_DEADLINE_MS should be 1 minute', () => {
      expect(SECONDARY_FALLBACK_DEADLINE_MS).toBe(1 * 60 * 1000);
    });
  });
});
