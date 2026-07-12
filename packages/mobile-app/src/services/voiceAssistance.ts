/**
 * Voice Assistance Service — Provides audio announcements for critical alerts
 * and health reading value changes when voice assistance mode is enabled.
 *
 * Integrates with the AccessibilityEngine's announce() method to deliver
 * screen reader announcements with appropriate priority levels:
 * - 'assertive' for critical alerts (interrupts current speech)
 * - 'polite' for informational reading updates (queued after current speech)
 *
 * Requirements: 10.6
 */

import {
  AccessibilityEngine,
  createAccessibilityEngine,
  getDefaultAccessibilityEngine,
} from '../utils/accessibility';
import { getAccessibilityConfig } from '../hooks/useAccessibility';
import type { PushNotification } from './notificationHandler';
import type { VitalReading, ReadingType } from '../stores/healthReadingsStore';

// ---------- Types ----------

export interface VoiceAssistanceService {
  /**
   * Announces a critical alert notification with 'assertive' priority.
   * Only announces if voice assistance is currently enabled.
   */
  announceCriticalAlert(notification: PushNotification): void;

  /**
   * Announces health reading value changes with 'polite' priority.
   * Only announces if voice assistance is currently enabled.
   */
  announceReadingChange(reading: VitalReading): void;

  /**
   * Announces a batch of reading changes (e.g., after a data refresh).
   * Summarizes all readings with 'polite' priority.
   * Only announces if voice assistance is currently enabled.
   */
  announceReadingsRefresh(readings: VitalReading[]): void;

  /**
   * Checks whether voice assistance is currently enabled.
   */
  isEnabled(): boolean;
}

// ---------- Reading Type Display Names ----------

const READING_TYPE_LABELS: Record<ReadingType, string> = {
  blood_pressure: 'Blood Pressure',
  heart_rate: 'Heart Rate',
  blood_glucose: 'Blood Glucose',
  spo2: 'Blood Oxygen',
  temperature: 'Temperature',
  weight: 'Weight',
};

// ---------- Helpers ----------

/**
 * Formats a vital reading into a human-readable announcement string.
 */
function formatReadingAnnouncement(reading: VitalReading): string {
  const label = READING_TYPE_LABELS[reading.type] || reading.type;

  if (reading.type === 'blood_pressure' && reading.secondaryValue != null) {
    return `${label}: ${reading.value} over ${reading.secondaryValue} ${reading.unit}, status ${reading.status}, trend ${reading.trend}`;
  }

  return `${label}: ${reading.value} ${reading.unit}, status ${reading.status}, trend ${reading.trend}`;
}

/**
 * Formats a critical alert notification into a human-readable announcement string.
 */
function formatAlertAnnouncement(notification: PushNotification): string {
  const severity =
    notification.severity === 'critical' ? 'Critical alert' : 'Warning alert';
  return `${severity}. ${notification.readingType}: ${notification.measuredValue} exceeds threshold of ${notification.threshold}. ${notification.message}`;
}

// ---------- Implementation ----------

function createVoiceAssistanceService(): VoiceAssistanceService {
  /**
   * Returns the current accessibility engine based on the latest config.
   * Rebuilds each time to reflect config changes (e.g., voice toggled on/off).
   */
  function getEngine(): AccessibilityEngine {
    const config = getAccessibilityConfig();
    return createAccessibilityEngine(config);
  }

  const service: VoiceAssistanceService = {
    isEnabled(): boolean {
      const config = getAccessibilityConfig();
      return config.voiceAssistanceEnabled;
    },

    announceCriticalAlert(notification: PushNotification): void {
      if (!service.isEnabled()) {
        return;
      }

      const engine = getEngine();
      const message = formatAlertAnnouncement(notification);
      engine.announce(message, 'assertive');
    },

    announceReadingChange(reading: VitalReading): void {
      if (!service.isEnabled()) {
        return;
      }

      const engine = getEngine();
      const message = formatReadingAnnouncement(reading);
      engine.announce(message, 'polite');
    },

    announceReadingsRefresh(readings: VitalReading[]): void {
      if (!service.isEnabled()) {
        return;
      }

      if (readings.length === 0) {
        return;
      }

      const engine = getEngine();

      // Build a summary announcement for the batch refresh
      const summary = readings
        .map((r) => formatReadingAnnouncement(r))
        .join('. ');

      const message = `Health readings updated. ${summary}`;
      engine.announce(message, 'polite');
    },
  };

  return service;
}

// ---------- Singleton Export ----------

export const voiceAssistanceService: VoiceAssistanceService =
  createVoiceAssistanceService();

// ---------- Exported Helpers for Testing ----------

export { formatReadingAnnouncement, formatAlertAnnouncement };
