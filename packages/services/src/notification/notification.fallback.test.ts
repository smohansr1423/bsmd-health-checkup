// @ts-nocheck
/**
 * Notification Fallback, Opt-Out Routing, and Caregiver Preferences - Unit Tests
 *
 * Validates: Requirements 20.3, 20.4, 20.5, 20.6
 */

import { DeliveryChannel, NotificationType, SupportedLanguage } from '@health-checkup/shared';
import {
  NotificationFallbackService,
  InMemoryUndeliveredRepository,
  InMemoryCaregiverPreferencesRepository,
  MAX_FALLBACK_ATTEMPTS,
  ALWAYS_DELIVER_TYPES,
  SUPPRESSIBLE_TYPES,
} from './notification.fallback';
import type {
  FallbackDependencies,
  CaregiverPreferences,
  UndeliveredNotification,
} from './notification.fallback';
import type {
  NotificationRequest,
  NotificationPreferences,
  ChannelProvider,
} from './notification.types';

// --- Test Helpers ---

let idCounter = 0;
const testIdGenerator = () => `fallback-id-${++idCounter}`;
const testDateProvider = () => new Date('2024-06-15T10:00:00Z');
const noOpDelay = async (_ms: number): Promise<void> => {};

function createMockChannelProvider(shouldSucceed = true): ChannelProvider & { send: jest.Mock } {
  return {
    send: jest.fn().mockResolvedValue(shouldSucceed),
  };
}

function createFailingChannelProvider(errorMessage?: string): ChannelProvider & { send: jest.Mock } {
  return {
    send: jest.fn().mockRejectedValue(new Error(errorMessage ?? 'Channel unavailable')),
  };
}

function createService(overrides?: Partial<FallbackDependencies>): {
  service: NotificationFallbackService;
  undeliveredRepo: InMemoryUndeliveredRepository;
  caregiverRepo: InMemoryCaregiverPreferencesRepository;
  channelProviders: Record<DeliveryChannel, ChannelProvider & { send: jest.Mock }>;
} {
  const undeliveredRepo = new InMemoryUndeliveredRepository();
  const caregiverRepo = new InMemoryCaregiverPreferencesRepository();

  const channelProviders = {
    [DeliveryChannel.SMS]: createMockChannelProvider(),
    [DeliveryChannel.Email]: createMockChannelProvider(),
    [DeliveryChannel.Push]: createMockChannelProvider(),
    [DeliveryChannel.PhoneCall]: createMockChannelProvider(),
  };

  const deps: FallbackDependencies = {
    idGenerator: testIdGenerator,
    dateProvider: testDateProvider,
    channelProviders,
    undeliveredRepository: undeliveredRepo,
    caregiverPreferencesRepository: caregiverRepo,
    delayFn: noOpDelay,
    ...overrides,
  };

  const service = new NotificationFallbackService(deps);
  return { service, undeliveredRepo, caregiverRepo, channelProviders };
}

function createNotificationRequest(overrides?: Partial<NotificationRequest>): NotificationRequest {
  return {
    recipientId: 'user-1',
    type: NotificationType.AppointmentConfirmation,
    subject: 'Appointment Confirmed',
    body: 'Your appointment is confirmed for tomorrow at 10:00 AM.',
    ...overrides,
  };
}

function createPreferences(overrides?: Partial<NotificationPreferences>): NotificationPreferences {
  return {
    userId: 'user-1',
    activeChannels: [DeliveryChannel.SMS, DeliveryChannel.Email, DeliveryChannel.Push],
    optOutNonCritical: false,
    ...overrides,
  };
}

// --- Tests ---

describe('NotificationFallbackService', () => {
  beforeEach(() => {
    idCounter = 0;
  });

  describe('Opt-out routing (Requirement 20.6)', () => {
    it('should deliver all notification types when optOutNonCritical is false', () => {
      const { service } = createService();
      const preferences = createPreferences({ optOutNonCritical: false });

      for (const type of Object.values(NotificationType)) {
        const request = createNotificationRequest({ type });
        expect(service.shouldDeliver(request, preferences)).toBe(true);
      }
    });

    it('should always deliver critical alerts when opted out', () => {
      const { service } = createService();
      const preferences = createPreferences({ optOutNonCritical: true });
      const request = createNotificationRequest({ type: NotificationType.CriticalAlert });

      expect(service.shouldDeliver(request, preferences)).toBe(true);
    });

    it('should always deliver appointment reminders when opted out', () => {
      const { service } = createService();
      const preferences = createPreferences({ optOutNonCritical: true });
      const request = createNotificationRequest({ type: NotificationType.AppointmentReminder });

      expect(service.shouldDeliver(request, preferences)).toBe(true);
    });

    it('should always deliver appointment confirmations when opted out', () => {
      const { service } = createService();
      const preferences = createPreferences({ optOutNonCritical: true });
      const request = createNotificationRequest({ type: NotificationType.AppointmentConfirmation });

      expect(service.shouldDeliver(request, preferences)).toBe(true);
    });

    it('should always deliver escalation notifications when opted out', () => {
      const { service } = createService();
      const preferences = createPreferences({ optOutNonCritical: true });
      const request = createNotificationRequest({ type: NotificationType.Escalation });

      expect(service.shouldDeliver(request, preferences)).toBe(true);
    });

    it('should suppress ReportAvailable when opted out', () => {
      const { service } = createService();
      const preferences = createPreferences({ optOutNonCritical: true });
      const request = createNotificationRequest({ type: NotificationType.ReportAvailable });

      expect(service.shouldDeliver(request, preferences)).toBe(false);
    });

    it('should suppress FollowUpReminder when opted out', () => {
      const { service } = createService();
      const preferences = createPreferences({ optOutNonCritical: true });
      const request = createNotificationRequest({ type: NotificationType.FollowUpReminder });

      expect(service.shouldDeliver(request, preferences)).toBe(false);
    });

    it('should suppress PaymentConfirmation when opted out', () => {
      const { service } = createService();
      const preferences = createPreferences({ optOutNonCritical: true });
      const request = createNotificationRequest({ type: NotificationType.PaymentConfirmation });

      expect(service.shouldDeliver(request, preferences)).toBe(false);
    });
  });

  describe('Fallback delivery (Requirement 20.4)', () => {
    it('should deliver on primary channel when it succeeds', async () => {
      const { service } = createService();
      const request = createNotificationRequest();
      const preferences = createPreferences({
        activeChannels: [DeliveryChannel.SMS, DeliveryChannel.Email],
      });

      const result = await service.deliverWithFallback(request, preferences, 'en');

      expect(result.delivered).toBe(true);
      expect(result.finalChannel).toBe(DeliveryChannel.SMS);
      expect(result.fallbackCount).toBe(0);
      expect(result.channelAttempts).toHaveLength(1);
    });

    it('should fallback to second channel when primary fails', async () => {
      const smsProvider = createFailingChannelProvider('SMS unavailable');
      const emailProvider = createMockChannelProvider(true);

      const { service } = createService({
        channelProviders: {
          [DeliveryChannel.SMS]: smsProvider,
          [DeliveryChannel.Email]: emailProvider,
          [DeliveryChannel.Push]: createMockChannelProvider(),
          [DeliveryChannel.PhoneCall]: createMockChannelProvider(),
        },
      });

      const request = createNotificationRequest();
      const preferences = createPreferences({
        activeChannels: [DeliveryChannel.SMS, DeliveryChannel.Email, DeliveryChannel.Push],
      });

      const result = await service.deliverWithFallback(request, preferences, 'en');

      expect(result.delivered).toBe(true);
      expect(result.finalChannel).toBe(DeliveryChannel.Email);
      expect(result.channelAttempts).toHaveLength(2);
      expect(result.channelAttempts[0].status).toBe('failed');
      expect(result.channelAttempts[1].status).toBe('delivered');
    });

    it('should fallback to third channel when first two fail', async () => {
      const { service } = createService({
        channelProviders: {
          [DeliveryChannel.SMS]: createFailingChannelProvider('SMS down'),
          [DeliveryChannel.Email]: createMockChannelProvider(false), // returns false
          [DeliveryChannel.Push]: createMockChannelProvider(true),
          [DeliveryChannel.PhoneCall]: createMockChannelProvider(),
        },
      });

      const request = createNotificationRequest();
      const preferences = createPreferences({
        activeChannels: [DeliveryChannel.SMS, DeliveryChannel.Email, DeliveryChannel.Push],
      });

      const result = await service.deliverWithFallback(request, preferences, 'en');

      expect(result.delivered).toBe(true);
      expect(result.finalChannel).toBe(DeliveryChannel.Push);
      expect(result.channelAttempts).toHaveLength(3);
      expect(result.fallbackCount).toBe(1);
    });

    it('should not exceed MAX_FALLBACK_ATTEMPTS (3) fallback attempts', async () => {
      const { service } = createService({
        channelProviders: {
          [DeliveryChannel.SMS]: createFailingChannelProvider(),
          [DeliveryChannel.Email]: createFailingChannelProvider(),
          [DeliveryChannel.Push]: createFailingChannelProvider(),
          [DeliveryChannel.PhoneCall]: createFailingChannelProvider(),
        },
      });

      const request = createNotificationRequest();
      const preferences = createPreferences({
        activeChannels: [
          DeliveryChannel.SMS,
          DeliveryChannel.Email,
          DeliveryChannel.Push,
          DeliveryChannel.PhoneCall,
        ],
      });

      const result = await service.deliverWithFallback(request, preferences, 'en');

      expect(result.delivered).toBe(false);
      // Primary + up to 3 fallbacks = 4 attempts max
      expect(result.channelAttempts.length).toBeLessThanOrEqual(MAX_FALLBACK_ATTEMPTS + 1);
    });

    it('should invoke delay between fallback attempts', async () => {
      const delayFn = jest.fn().mockResolvedValue(undefined);
      const { service } = createService({
        channelProviders: {
          [DeliveryChannel.SMS]: createFailingChannelProvider(),
          [DeliveryChannel.Email]: createFailingChannelProvider(),
          [DeliveryChannel.Push]: createMockChannelProvider(true),
          [DeliveryChannel.PhoneCall]: createMockChannelProvider(),
        },
        delayFn,
      });

      const request = createNotificationRequest();
      const preferences = createPreferences({
        activeChannels: [DeliveryChannel.SMS, DeliveryChannel.Email, DeliveryChannel.Push],
      });

      await service.deliverWithFallback(request, preferences, 'en');

      // Delay should be called between attempts (after first failure, before second; after second, before third)
      expect(delayFn).toHaveBeenCalledWith(5 * 60 * 1000);
    });
  });

  describe('Undelivered notification indicator (Requirement 20.5)', () => {
    it('should create undelivered indicator when all channels fail', async () => {
      const { service, undeliveredRepo } = createService({
        channelProviders: {
          [DeliveryChannel.SMS]: createFailingChannelProvider(),
          [DeliveryChannel.Email]: createFailingChannelProvider(),
          [DeliveryChannel.Push]: createFailingChannelProvider(),
          [DeliveryChannel.PhoneCall]: createFailingChannelProvider(),
        },
      });

      const request = createNotificationRequest({ recipientId: 'user-42' });
      const preferences = createPreferences({
        userId: 'user-42',
        activeChannels: [DeliveryChannel.SMS, DeliveryChannel.Email],
      });

      const result = await service.deliverWithFallback(request, preferences, 'en');

      expect(result.delivered).toBe(false);
      expect(result.undelivered).toBeDefined();
      expect(result.undelivered!.recipientId).toBe('user-42');
      expect(result.undelivered!.displayedOnLogin).toBe(false);
      expect(result.undelivered!.failedChannels).toContain(DeliveryChannel.SMS);
      expect(result.undelivered!.failedChannels).toContain(DeliveryChannel.Email);
    });

    it('should return undelivered indicators on next login', async () => {
      const { service, undeliveredRepo } = createService({
        channelProviders: {
          [DeliveryChannel.SMS]: createFailingChannelProvider(),
          [DeliveryChannel.Email]: createFailingChannelProvider(),
          [DeliveryChannel.Push]: createFailingChannelProvider(),
          [DeliveryChannel.PhoneCall]: createFailingChannelProvider(),
        },
      });

      const request = createNotificationRequest({ recipientId: 'user-login' });
      const preferences = createPreferences({
        userId: 'user-login',
        activeChannels: [DeliveryChannel.Push],
      });

      await service.deliverWithFallback(request, preferences, 'en');

      const indicators = await service.getUndeliveredIndicators('user-login');
      expect(indicators).toHaveLength(1);
      expect(indicators[0].recipientId).toBe('user-login');
      expect(indicators[0].displayedOnLogin).toBe(false);
    });

    it('should mark indicator as displayed after login acknowledgment', async () => {
      const { service } = createService({
        channelProviders: {
          [DeliveryChannel.SMS]: createFailingChannelProvider(),
          [DeliveryChannel.Email]: createFailingChannelProvider(),
          [DeliveryChannel.Push]: createFailingChannelProvider(),
          [DeliveryChannel.PhoneCall]: createFailingChannelProvider(),
        },
      });

      const request = createNotificationRequest({ recipientId: 'user-mark' });
      const preferences = createPreferences({
        userId: 'user-mark',
        activeChannels: [DeliveryChannel.SMS],
      });

      const result = await service.deliverWithFallback(request, preferences, 'en');
      const indicatorId = result.undelivered!.id;

      await service.markIndicatorDisplayed(indicatorId);

      const indicators = await service.getUndeliveredIndicators('user-mark');
      expect(indicators).toHaveLength(0);
    });

    it('should not create undelivered indicator when delivery succeeds', async () => {
      const { service } = createService();

      const request = createNotificationRequest({ recipientId: 'user-ok' });
      const preferences = createPreferences({
        userId: 'user-ok',
        activeChannels: [DeliveryChannel.Push],
      });

      const result = await service.deliverWithFallback(request, preferences, 'en');

      expect(result.delivered).toBe(true);
      expect(result.undelivered).toBeUndefined();
    });
  });

  describe('Caregiver preferences (Requirement 20.3)', () => {
    it('should allow caregiver to configure separate preferences for a senior', async () => {
      const { service } = createService();

      const result = await service.configureCaregiverPreferences(
        'caregiver-1',
        'senior-1',
        [DeliveryChannel.Email, DeliveryChannel.SMS],
        false,
      );

      expect(result.caregiverId).toBe('caregiver-1');
      expect(result.seniorId).toBe('senior-1');
      expect(result.activeChannels).toEqual([DeliveryChannel.Email, DeliveryChannel.SMS]);
      expect(result.optOutNonCritical).toBe(false);
    });

    it('should update existing caregiver preferences', async () => {
      const { service } = createService();

      await service.configureCaregiverPreferences(
        'caregiver-1',
        'senior-1',
        [DeliveryChannel.Email],
        false,
      );

      const updated = await service.configureCaregiverPreferences(
        'caregiver-1',
        'senior-1',
        [DeliveryChannel.Push, DeliveryChannel.PhoneCall],
        true,
      );

      expect(updated.activeChannels).toEqual([DeliveryChannel.Push, DeliveryChannel.PhoneCall]);
      expect(updated.optOutNonCritical).toBe(true);
    });

    it('should reject caregiver preferences with no active channels', async () => {
      const { service } = createService();

      await expect(
        service.configureCaregiverPreferences('caregiver-1', 'senior-1', [], false),
      ).rejects.toThrow('At least one active delivery channel is required');
    });

    it('should retrieve caregiver preferences by caregiver and senior', async () => {
      const { service } = createService();

      await service.configureCaregiverPreferences(
        'caregiver-2',
        'senior-2',
        [DeliveryChannel.SMS],
        true,
        '22:00',
        '07:00',
      );

      const prefs = await service.getCaregiverPreferences('caregiver-2', 'senior-2');

      expect(prefs).not.toBeNull();
      expect(prefs!.caregiverId).toBe('caregiver-2');
      expect(prefs!.seniorId).toBe('senior-2');
      expect(prefs!.quietHoursStart).toBe('22:00');
      expect(prefs!.quietHoursEnd).toBe('07:00');
    });

    it('should get all caregiver preferences linked to a senior', async () => {
      const { service } = createService();

      await service.configureCaregiverPreferences('caregiver-A', 'senior-X', [DeliveryChannel.SMS], false);
      await service.configureCaregiverPreferences('caregiver-B', 'senior-X', [DeliveryChannel.Email], true);

      const allPrefs = await service.getCaregiverPreferencesForSenior('senior-X');
      expect(allPrefs).toHaveLength(2);
    });

    it('should allow separate preferences from the senior citizen preferences', async () => {
      const { service } = createService();

      // Caregiver configures their own preferences for a senior
      await service.configureCaregiverPreferences(
        'caregiver-1',
        'senior-1',
        [DeliveryChannel.PhoneCall],
        true,
      );

      // Verify caregiver prefs are independent
      const caregiverPrefs = await service.getCaregiverPreferences('caregiver-1', 'senior-1');
      expect(caregiverPrefs!.activeChannels).toEqual([DeliveryChannel.PhoneCall]);
      expect(caregiverPrefs!.optOutNonCritical).toBe(true);
    });
  });
});
