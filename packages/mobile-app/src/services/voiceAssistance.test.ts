/**
 * Tests for Voice Assistance Service
 * Requirements: 10.6
 */
import {
  voiceAssistanceService,
  formatReadingAnnouncement,
  formatAlertAnnouncement,
} from './voiceAssistance';
import { updateAccessibilityConfig, getAccessibilityConfig } from '../hooks/useAccessibility';
import type { PushNotification } from './notificationHandler';
import type { VitalReading } from '../stores/healthReadingsStore';

// Mock React Native modules
jest.mock('react-native', () => ({
  AccessibilityInfo: {
    announceForAccessibility: jest.fn(),
    isScreenReaderEnabled: jest.fn().mockResolvedValue(false),
    addEventListener: jest.fn(() => ({ remove: jest.fn() })),
  },
  PixelRatio: {
    getFontScale: jest.fn(() => 1.0),
  },
  Platform: {
    OS: 'ios',
  },
}));

const { AccessibilityInfo } = jest.requireMock('react-native');

describe('voiceAssistanceService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset voice assistance to disabled
    updateAccessibilityConfig({ voiceAssistanceEnabled: false });
  });

  describe('isEnabled', () => {
    it('returns false when voice assistance is disabled', () => {
      updateAccessibilityConfig({ voiceAssistanceEnabled: false });
      expect(voiceAssistanceService.isEnabled()).toBe(false);
    });

    it('returns true when voice assistance is enabled', () => {
      updateAccessibilityConfig({ voiceAssistanceEnabled: true });
      expect(voiceAssistanceService.isEnabled()).toBe(true);
    });
  });

  describe('announceCriticalAlert', () => {
    const criticalNotification: PushNotification = {
      alertId: 'alert-001',
      severity: 'critical',
      readingType: 'heart_rate',
      measuredValue: 150,
      threshold: 120,
      message: 'Heart rate is dangerously elevated.',
    };

    it('does not announce when voice assistance is disabled', () => {
      updateAccessibilityConfig({ voiceAssistanceEnabled: false });
      voiceAssistanceService.announceCriticalAlert(criticalNotification);
      expect(AccessibilityInfo.announceForAccessibility).not.toHaveBeenCalled();
    });

    it('announces critical alert with assertive priority when enabled', () => {
      updateAccessibilityConfig({ voiceAssistanceEnabled: true });
      voiceAssistanceService.announceCriticalAlert(criticalNotification);
      expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledTimes(1);
      const message = AccessibilityInfo.announceForAccessibility.mock.calls[0][0];
      expect(message).toContain('Critical alert');
      expect(message).toContain('heart_rate');
      expect(message).toContain('150');
      expect(message).toContain('120');
    });

    it('includes warning severity in announcement', () => {
      updateAccessibilityConfig({ voiceAssistanceEnabled: true });
      const warningNotification: PushNotification = {
        alertId: 'alert-002',
        severity: 'warning',
        readingType: 'blood_glucose',
        measuredValue: 180,
        threshold: 160,
        message: 'Blood glucose is elevated.',
      };
      voiceAssistanceService.announceCriticalAlert(warningNotification);
      const message = AccessibilityInfo.announceForAccessibility.mock.calls[0][0];
      expect(message).toContain('Warning alert');
    });
  });

  describe('announceReadingChange', () => {
    const heartRateReading: VitalReading = {
      type: 'heart_rate',
      value: 72,
      unit: 'bpm',
      timestamp: '2024-01-15T10:00:00Z',
      trend: 'stable',
      status: 'normal',
    };

    it('does not announce when voice assistance is disabled', () => {
      updateAccessibilityConfig({ voiceAssistanceEnabled: false });
      voiceAssistanceService.announceReadingChange(heartRateReading);
      expect(AccessibilityInfo.announceForAccessibility).not.toHaveBeenCalled();
    });

    it('announces reading change with polite priority when enabled', () => {
      updateAccessibilityConfig({ voiceAssistanceEnabled: true });
      voiceAssistanceService.announceReadingChange(heartRateReading);
      expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledTimes(1);
      const message = AccessibilityInfo.announceForAccessibility.mock.calls[0][0];
      expect(message).toContain('Heart Rate');
      expect(message).toContain('72');
      expect(message).toContain('bpm');
      expect(message).toContain('normal');
      expect(message).toContain('stable');
    });

    it('formats blood pressure with systolic over diastolic', () => {
      updateAccessibilityConfig({ voiceAssistanceEnabled: true });
      const bpReading: VitalReading = {
        type: 'blood_pressure',
        value: 130,
        secondaryValue: 85,
        unit: 'mmHg',
        timestamp: '2024-01-15T10:00:00Z',
        trend: 'improving',
        status: 'borderline',
      };
      voiceAssistanceService.announceReadingChange(bpReading);
      const message = AccessibilityInfo.announceForAccessibility.mock.calls[0][0];
      expect(message).toContain('Blood Pressure');
      expect(message).toContain('130 over 85');
      expect(message).toContain('mmHg');
    });
  });

  describe('announceReadingsRefresh', () => {
    const readings: VitalReading[] = [
      {
        type: 'heart_rate',
        value: 72,
        unit: 'bpm',
        timestamp: '2024-01-15T10:00:00Z',
        trend: 'stable',
        status: 'normal',
      },
      {
        type: 'spo2',
        value: 98,
        unit: '%',
        timestamp: '2024-01-15T10:00:00Z',
        trend: 'stable',
        status: 'normal',
      },
    ];

    it('does not announce when voice assistance is disabled', () => {
      updateAccessibilityConfig({ voiceAssistanceEnabled: false });
      voiceAssistanceService.announceReadingsRefresh(readings);
      expect(AccessibilityInfo.announceForAccessibility).not.toHaveBeenCalled();
    });

    it('does not announce when readings array is empty', () => {
      updateAccessibilityConfig({ voiceAssistanceEnabled: true });
      voiceAssistanceService.announceReadingsRefresh([]);
      expect(AccessibilityInfo.announceForAccessibility).not.toHaveBeenCalled();
    });

    it('announces summary of all readings on refresh', () => {
      updateAccessibilityConfig({ voiceAssistanceEnabled: true });
      voiceAssistanceService.announceReadingsRefresh(readings);
      expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledTimes(1);
      const message = AccessibilityInfo.announceForAccessibility.mock.calls[0][0];
      expect(message).toContain('Health readings updated');
      expect(message).toContain('Heart Rate');
      expect(message).toContain('Blood Oxygen');
    });
  });
});

describe('formatReadingAnnouncement', () => {
  it('formats a standard reading', () => {
    const reading: VitalReading = {
      type: 'temperature',
      value: 37.2,
      unit: '°C',
      timestamp: '2024-01-15T10:00:00Z',
      trend: 'stable',
      status: 'normal',
    };
    const result = formatReadingAnnouncement(reading);
    expect(result).toBe('Temperature: 37.2 °C, status normal, trend stable');
  });

  it('formats blood pressure with both values', () => {
    const reading: VitalReading = {
      type: 'blood_pressure',
      value: 120,
      secondaryValue: 80,
      unit: 'mmHg',
      timestamp: '2024-01-15T10:00:00Z',
      trend: 'improving',
      status: 'normal',
    };
    const result = formatReadingAnnouncement(reading);
    expect(result).toBe(
      'Blood Pressure: 120 over 80 mmHg, status normal, trend improving'
    );
  });
});

describe('formatAlertAnnouncement', () => {
  it('formats a critical alert', () => {
    const notification: PushNotification = {
      alertId: 'alert-1',
      severity: 'critical',
      readingType: 'heart_rate',
      measuredValue: 150,
      threshold: 120,
      message: 'Immediate attention required.',
    };
    const result = formatAlertAnnouncement(notification);
    expect(result).toBe(
      'Critical alert. heart_rate: 150 exceeds threshold of 120. Immediate attention required.'
    );
  });

  it('formats a warning alert', () => {
    const notification: PushNotification = {
      alertId: 'alert-2',
      severity: 'warning',
      readingType: 'blood_glucose',
      measuredValue: 180,
      threshold: 160,
      message: 'Monitor closely.',
    };
    const result = formatAlertAnnouncement(notification);
    expect(result).toBe(
      'Warning alert. blood_glucose: 180 exceeds threshold of 160. Monitor closely.'
    );
  });
});
