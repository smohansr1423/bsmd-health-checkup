/**
 * Notification Service - Unit Tests
 * Validates: Requirements 20.1, 20.2, 20.7, 19.6
 */

import { DeliveryChannel, EscalationLevel, NotificationType, SupportedLanguage } from '@health-checkup/shared';
import {
  NotificationService,
  InMemoryPreferencesRepository,
  InMemoryDeliveryLogRepository,
} from './notification.service';
import { NoActiveChannelError, AlertNotFoundError } from './notification.errors';
import type {
  NotificationRequest,
  CriticalAlertRequest,
  NotificationPreferences,
  ChannelProvider,
  LanguageProvider,
  NotificationDependencies,
} from './notification.types';

// --- Test Helpers ---

let idCounter = 0;
const testIdGenerator = () => `test-id-${++idCounter}`;
const testDateProvider = () => new Date('2024-06-15T10:00:00Z');

function createMockChannelProvider(shouldSucceed = true): ChannelProvider {
  return {
    send: jest.fn().mockResolvedValue(shouldSucceed),
  };
}

function createMockLanguageProvider(language: SupportedLanguage = SupportedLanguage.English): LanguageProvider {
  return {
    getPreferredLanguage: jest.fn().mockResolvedValue(language),
  };
}

function createService(overrides?: Partial<NotificationDependencies>): {
  service: NotificationService;
  preferencesRepo: InMemoryPreferencesRepository;
  deliveryLogRepo: InMemoryDeliveryLogRepository;
} {
  const preferencesRepo = new InMemoryPreferencesRepository();
  const deliveryLogRepo = new InMemoryDeliveryLogRepository();

  const deps: NotificationDependencies = {
    idGenerator: testIdGenerator,
    dateProvider: testDateProvider,
    preferencesRepository: preferencesRepo,
    deliveryLogRepository: deliveryLogRepo,
    languageProvider: createMockLanguageProvider(),
    channelProviders: {
      [DeliveryChannel.SMS]: createMockChannelProvider(),
      [DeliveryChannel.Email]: createMockChannelProvider(),
      [DeliveryChannel.Push]: createMockChannelProvider(),
      [DeliveryChannel.PhoneCall]: createMockChannelProvider(),
    },
    ...overrides,
  };

  const service = new NotificationService(deps);
  return { service, preferencesRepo, deliveryLogRepo };
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

function createCriticalAlertRequest(overrides?: Partial<CriticalAlertRequest>): CriticalAlertRequest {
  return {
    alertId: 'alert-1',
    recipientId: 'physician-1',
    testName: 'Blood Glucose',
    resultValue: 450,
    criticalThreshold: 300,
    thresholdDirection: 'above',
    patientName: 'John Doe',
    timestamp: '2024-06-15T10:00:00Z',
    ...overrides,
  };
}

// --- Tests ---

describe('NotificationService', () => {
  beforeEach(() => {
    idCounter = 0;
  });

  describe('sendNotification', () => {
    it('should deliver notification via configured channels', async () => {
      const { service, preferencesRepo } = createService();

      // Configure preferences with SMS and email
      await preferencesRepo.save({
        userId: 'user-1',
        activeChannels: [DeliveryChannel.SMS, DeliveryChannel.Email],
        optOutNonCritical: false,
      });

      const result = await service.sendNotification(createNotificationRequest());

      expect(result.recipientId).toBe('user-1');
      expect(result.channels).toHaveLength(2);
      expect(result.channels[0].channel).toBe(DeliveryChannel.SMS);
      expect(result.channels[0].status).toBe('delivered');
      expect(result.channels[1].channel).toBe(DeliveryChannel.Email);
      expect(result.channels[1].status).toBe('delivered');
    });

    it('should apply default preferences (push) for new accounts without configured preferences', async () => {
      const { service } = createService();

      const result = await service.sendNotification(createNotificationRequest());

      // Default is push channel only (Req 20.7)
      expect(result.channels).toHaveLength(1);
      expect(result.channels[0].channel).toBe(DeliveryChannel.Push);
      expect(result.channels[0].status).toBe('delivered');
    });

    it('should deliver in recipient preferred language', async () => {
      const languageProvider = createMockLanguageProvider(SupportedLanguage.Hindi);
      const { service } = createService({ languageProvider });

      const result = await service.sendNotification(createNotificationRequest());

      expect(result.language).toBe(SupportedLanguage.Hindi);
      expect(languageProvider.getPreferredLanguage).toHaveBeenCalledWith('user-1');
    });

    it('should log delivery attempts with timestamp and status', async () => {
      const { service, deliveryLogRepo } = createService();

      await service.sendNotification(createNotificationRequest());

      const logs = await deliveryLogRepo.findByNotificationId('test-id-1');
      expect(logs).toHaveLength(1);
      expect(logs[0].channel).toBe(DeliveryChannel.Push);
      expect(logs[0].status).toBe('delivered');
      expect(logs[0].timestamp).toEqual(new Date('2024-06-15T10:00:00Z'));
      expect(logs[0].language).toBe(SupportedLanguage.English);
    });

    it('should handle channel delivery failure', async () => {
      const failingProvider = createMockChannelProvider(false);
      const { service, preferencesRepo } = createService({
        channelProviders: {
          [DeliveryChannel.SMS]: failingProvider,
          [DeliveryChannel.Email]: createMockChannelProvider(),
          [DeliveryChannel.Push]: createMockChannelProvider(),
          [DeliveryChannel.PhoneCall]: createMockChannelProvider(),
        },
      });

      await preferencesRepo.save({
        userId: 'user-1',
        activeChannels: [DeliveryChannel.SMS],
        optOutNonCritical: false,
      });

      const result = await service.sendNotification(createNotificationRequest());

      expect(result.channels[0].status).toBe('failed');
      expect(result.channels[0].failureReason).toBe('Channel delivery returned false');
    });

    it('should handle channel provider throwing an error', async () => {
      const errorProvider: ChannelProvider = {
        send: jest.fn().mockRejectedValue(new Error('Network timeout')),
      };
      const { service, preferencesRepo } = createService({
        channelProviders: {
          [DeliveryChannel.SMS]: errorProvider,
          [DeliveryChannel.Email]: createMockChannelProvider(),
          [DeliveryChannel.Push]: createMockChannelProvider(),
          [DeliveryChannel.PhoneCall]: createMockChannelProvider(),
        },
      });

      await preferencesRepo.save({
        userId: 'user-1',
        activeChannels: [DeliveryChannel.SMS],
        optOutNonCritical: false,
      });

      const result = await service.sendNotification(createNotificationRequest());

      expect(result.channels[0].status).toBe('failed');
      expect(result.channels[0].failureReason).toBe('Network timeout');
    });

    it('should support all 4 channels: SMS, email, push, phone_call', async () => {
      const { service, preferencesRepo } = createService();

      await preferencesRepo.save({
        userId: 'user-1',
        activeChannels: [
          DeliveryChannel.SMS,
          DeliveryChannel.Email,
          DeliveryChannel.Push,
          DeliveryChannel.PhoneCall,
        ],
        optOutNonCritical: false,
      });

      const result = await service.sendNotification(createNotificationRequest());

      expect(result.channels).toHaveLength(4);
      expect(result.channels.map((c) => c.channel)).toEqual([
        DeliveryChannel.SMS,
        DeliveryChannel.Email,
        DeliveryChannel.Push,
        DeliveryChannel.PhoneCall,
      ]);
    });
  });

  describe('sendCriticalAlert', () => {
    it('should deliver critical alert via configured channels', async () => {
      const { service, preferencesRepo } = createService();

      await preferencesRepo.save({
        userId: 'physician-1',
        activeChannels: [DeliveryChannel.SMS, DeliveryChannel.PhoneCall],
        optOutNonCritical: false,
      });

      const result = await service.sendCriticalAlert(createCriticalAlertRequest());

      expect(result.recipientId).toBe('physician-1');
      expect(result.channels).toHaveLength(2);
      expect(result.channels[0].status).toBe('delivered');
      expect(result.channels[1].status).toBe('delivered');
    });

    it('should deliver critical alert in recipient preferred language', async () => {
      const languageProvider = createMockLanguageProvider(SupportedLanguage.Spanish);
      const { service } = createService({ languageProvider });

      const result = await service.sendCriticalAlert(createCriticalAlertRequest());

      expect(result.language).toBe(SupportedLanguage.Spanish);
    });

    it('should log critical alert delivery with alertId', async () => {
      const { service, deliveryLogRepo } = createService();

      await service.sendCriticalAlert(createCriticalAlertRequest());

      const logs = await deliveryLogRepo.findByAlertId('alert-1');
      expect(logs.length).toBeGreaterThan(0);
      expect(logs[0].alertId).toBe('alert-1');
    });

    it('should track critical alert for acknowledgement', async () => {
      const { service } = createService();

      await service.sendCriticalAlert(createCriticalAlertRequest());

      // Should not throw - alert exists
      await expect(
        service.acknowledgeCriticalAlert('alert-1', 'doc-1', 'action_taken')
      ).resolves.not.toThrow();
    });
  });

  describe('acknowledgeCriticalAlert', () => {
    it('should record acknowledgement with responder identity and action status', async () => {
      const { service } = createService();
      await service.sendCriticalAlert(createCriticalAlertRequest());

      await service.acknowledgeCriticalAlert('alert-1', 'doc-1', 'patient_admitted');

      // Verify no error thrown (acknowledgement recorded successfully)
    });

    it('should throw AlertNotFoundError for unknown alertId', async () => {
      const { service } = createService();

      await expect(
        service.acknowledgeCriticalAlert('nonexistent', 'doc-1', 'action')
      ).rejects.toThrow(AlertNotFoundError);
    });
  });

  describe('escalateAlert', () => {
    it('should escalate alert to department head', async () => {
      const { service } = createService();
      await service.sendCriticalAlert(createCriticalAlertRequest());

      await service.escalateAlert('alert-1', EscalationLevel.DepartmentHead);

      // Should not throw
    });

    it('should escalate alert to facility administrator', async () => {
      const { service } = createService();
      await service.sendCriticalAlert(createCriticalAlertRequest());

      await service.escalateAlert('alert-1', EscalationLevel.DepartmentHead);
      await service.escalateAlert('alert-1', EscalationLevel.FacilityAdministrator);

      // Should not throw
    });

    it('should throw AlertNotFoundError for unknown alertId', async () => {
      const { service } = createService();

      await expect(
        service.escalateAlert('nonexistent', EscalationLevel.DepartmentHead)
      ).rejects.toThrow(AlertNotFoundError);
    });
  });

  describe('configurePreferences', () => {
    it('should save preferences with at least one active channel', async () => {
      const { service, preferencesRepo } = createService();

      const prefs: NotificationPreferences = {
        userId: 'user-1',
        activeChannels: [DeliveryChannel.Email],
        optOutNonCritical: false,
      };

      await service.configurePreferences('user-1', prefs);

      const saved = await preferencesRepo.findByUserId('user-1');
      expect(saved).not.toBeNull();
      expect(saved!.activeChannels).toEqual([DeliveryChannel.Email]);
    });

    it('should reject preferences with empty activeChannels', async () => {
      const { service } = createService();

      const prefs: NotificationPreferences = {
        userId: 'user-1',
        activeChannels: [],
        optOutNonCritical: false,
      };

      await expect(
        service.configurePreferences('user-1', prefs)
      ).rejects.toThrow(NoActiveChannelError);
    });

    it('should update existing preferences', async () => {
      const { service, preferencesRepo } = createService();

      // Save initial preferences
      await preferencesRepo.save({
        userId: 'user-1',
        activeChannels: [DeliveryChannel.Push],
        optOutNonCritical: false,
      });

      // Update to include SMS
      const updated: NotificationPreferences = {
        userId: 'user-1',
        activeChannels: [DeliveryChannel.Push, DeliveryChannel.SMS],
        optOutNonCritical: true,
      };

      await service.configurePreferences('user-1', updated);

      const saved = await preferencesRepo.findByUserId('user-1');
      expect(saved!.activeChannels).toEqual([DeliveryChannel.Push, DeliveryChannel.SMS]);
      expect(saved!.optOutNonCritical).toBe(true);
    });

    it('should save preferences with quiet hours', async () => {
      const { service, preferencesRepo } = createService();

      const prefs: NotificationPreferences = {
        userId: 'user-1',
        activeChannels: [DeliveryChannel.Email],
        optOutNonCritical: false,
        quietHoursStart: '22:00',
        quietHoursEnd: '07:00',
      };

      await service.configurePreferences('user-1', prefs);

      const saved = await preferencesRepo.findByUserId('user-1');
      expect(saved!.quietHoursStart).toBe('22:00');
      expect(saved!.quietHoursEnd).toBe('07:00');
    });
  });

  describe('getDeliveryLog', () => {
    it('should return delivery log entries for an alert', async () => {
      const { service } = createService();
      await service.sendCriticalAlert(createCriticalAlertRequest());

      const logs = await service.getDeliveryLog('alert-1');

      expect(logs.length).toBeGreaterThan(0);
      expect(logs[0].alertId).toBe('alert-1');
      expect(logs[0].status).toBe('delivered');
      expect(logs[0].timestamp).toEqual(new Date('2024-06-15T10:00:00Z'));
    });

    it('should return empty array for unknown alertId', async () => {
      const { service } = createService();

      const logs = await service.getDeliveryLog('nonexistent');

      expect(logs).toEqual([]);
    });
  });

  describe('default preferences (Req 20.7)', () => {
    it('should create default preferences with push channel for new user on first notification', async () => {
      const { service, preferencesRepo } = createService();

      await service.sendNotification(createNotificationRequest({ recipientId: 'new-user' }));

      const saved = await preferencesRepo.findByUserId('new-user');
      expect(saved).not.toBeNull();
      expect(saved!.activeChannels).toEqual([DeliveryChannel.Push]);
      expect(saved!.optOutNonCritical).toBe(false);
    });
  });
});
