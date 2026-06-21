/**
 * Voice Assistance Service - Unit Tests
 * Validates: Requirements 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.7
 */

import { SupportedLanguage } from '@health-checkup/shared';
import {
  VoiceAssistanceService,
  SUPPORTED_VOICE_COMMANDS,
  MAX_RESPONSE_TIME_MS,
  MAX_PAUSE_LATENCY_MS,
  SILENCE_THRESHOLD_MS,
  UNRECOGNIZED_COMMAND_TIMEOUT_MS,
} from './voice-assistance';
import type {
  VoiceCommandResult,
  AudioFeedback,
  PageContext,
  ErrorContext,
  PlaybackState,
} from './voice-assistance';

// --- Test Helpers ---

function createService(): VoiceAssistanceService {
  return new VoiceAssistanceService();
}

function createPageContext(overrides?: Partial<PageContext>): PageContext {
  return {
    heading: 'Appointments',
    formLabels: ['Date', 'Time', 'Doctor'],
    navigationOptions: ['Home', 'Reports', 'Profile'],
    ...overrides,
  };
}

function createErrorContext(overrides?: Partial<ErrorContext>): ErrorContext {
  return {
    fieldName: 'Phone Number',
    errorDescription: 'Phone number must be 10 digits',
    ...overrides,
  };
}

// --- Tests ---

describe('VoiceAssistanceService', () => {
  describe('processCommand', () => {
    it('should recognize "next" command (Req 14.4)', () => {
      const service = createService();

      const result = service.processCommand('next');

      expect(result.recognized).toBe(true);
      expect(result.command).toBe('next');
      expect(result.action).toBe('navigate');
      expect(result.target).toBe('/next');
    });

    it('should recognize "back" command (Req 14.4)', () => {
      const service = createService();

      const result = service.processCommand('back');

      expect(result.recognized).toBe(true);
      expect(result.command).toBe('back');
      expect(result.action).toBe('navigate');
      expect(result.target).toBe('/back');
    });

    it('should recognize "home" command (Req 14.4)', () => {
      const service = createService();

      const result = service.processCommand('home');

      expect(result.recognized).toBe(true);
      expect(result.command).toBe('home');
      expect(result.action).toBe('navigate');
      expect(result.target).toBe('/');
    });

    it('should recognize "appointments" command (Req 14.4)', () => {
      const service = createService();

      const result = service.processCommand('appointments');

      expect(result.recognized).toBe(true);
      expect(result.command).toBe('appointments');
      expect(result.action).toBe('navigate');
      expect(result.target).toBe('/appointments');
    });

    it('should recognize "reports" command (Req 14.4)', () => {
      const service = createService();

      const result = service.processCommand('reports');

      expect(result.recognized).toBe(true);
      expect(result.command).toBe('reports');
      expect(result.action).toBe('navigate');
      expect(result.target).toBe('/reports');
    });

    it('should be case-insensitive when matching commands (Req 14.4)', () => {
      const service = createService();

      const result = service.processCommand('HOME');

      expect(result.recognized).toBe(true);
      expect(result.command).toBe('home');
    });

    it('should trim whitespace from transcript before matching (Req 14.4)', () => {
      const service = createService();

      const result = service.processCommand('  appointments  ');

      expect(result.recognized).toBe(true);
      expect(result.command).toBe('appointments');
    });

    it('should match commands within longer phrases (Req 14.4)', () => {
      const service = createService();

      const result = service.processCommand('go to appointments');

      expect(result.recognized).toBe(true);
      expect(result.command).toBe('appointments');
    });

    it('should return recognized=false for unrecognized commands (Req 14.6)', () => {
      const service = createService();

      const result = service.processCommand('play music');

      expect(result.recognized).toBe(false);
      expect(result.command).toBeUndefined();
      expect(result.action).toBeUndefined();
    });

    it('should provide available commands list when command not recognized (Req 14.6)', () => {
      const service = createService();

      const result = service.processCommand('unknown command');

      expect(result.feedbackMessage).toContain('not recognized');
      expect(result.feedbackMessage).toContain('next');
      expect(result.feedbackMessage).toContain('back');
      expect(result.feedbackMessage).toContain('home');
      expect(result.feedbackMessage).toContain('appointments');
      expect(result.feedbackMessage).toContain('reports');
    });

    it('should include responseTimeMs in the result (Req 14.1)', () => {
      const service = createService();

      const result = service.processCommand('next');

      expect(result.responseTimeMs).toBeDefined();
      expect(result.responseTimeMs).toBeLessThan(MAX_RESPONSE_TIME_MS);
    });

    it('should provide feedback message for recognized commands (Req 14.4)', () => {
      const service = createService();

      const result = service.processCommand('reports');

      expect(result.feedbackMessage).toBeDefined();
      expect(result.feedbackMessage.length).toBeGreaterThan(0);
    });
  });

  describe('processVoiceCommand', () => {
    it('should process audio buffer and return command result (Req 14.4)', async () => {
      const service = createService();
      const audioBuffer = Buffer.from('appointments', 'utf-8');

      const result = await service.processVoiceCommand(audioBuffer, 'user-1');

      expect(result.recognized).toBe(true);
      expect(result.command).toBe('appointments');
    });

    it('should handle unrecognized audio input (Req 14.6)', async () => {
      const service = createService();
      const audioBuffer = Buffer.from('gibberish', 'utf-8');

      const result = await service.processVoiceCommand(audioBuffer, 'user-1');

      expect(result.recognized).toBe(false);
      expect(result.feedbackMessage).toContain('not recognized');
    });
  });

  describe('generateFeedback', () => {
    it('should generate audio feedback with correct language (Req 14.2)', () => {
      const service = createService();

      const feedback = service.generateFeedback('Action completed', SupportedLanguage.English);

      expect(feedback.message).toBe('Action completed');
      expect(feedback.language).toBe(SupportedLanguage.English);
    });

    it('should estimate duration based on message length (Req 14.2)', () => {
      const service = createService();

      const shortFeedback = service.generateFeedback('Done', SupportedLanguage.English);
      const longFeedback = service.generateFeedback(
        'Your appointment has been successfully booked for next Monday',
        SupportedLanguage.English,
      );

      expect(longFeedback.durationMs).toBeGreaterThan(shortFeedback.durationMs);
    });

    it('should classify confirmation messages correctly (Req 14.2)', () => {
      const service = createService();

      const feedback = service.generateFeedback('Payment completed successfully', SupportedLanguage.English);

      expect(feedback.type).toBe('confirmation');
    });

    it('should classify error messages correctly (Req 14.3)', () => {
      const service = createService();

      const feedback = service.generateFeedback('Error in phone number field', SupportedLanguage.English);

      expect(feedback.type).toBe('error');
    });

    it('should classify navigation messages correctly (Req 14.4)', () => {
      const service = createService();

      const feedback = service.generateFeedback('Navigating to appointments', SupportedLanguage.English);

      expect(feedback.type).toBe('navigation');
    });

    it('should classify generic messages as announcement (Req 14.7)', () => {
      const service = createService();

      const feedback = service.generateFeedback('Welcome to the system', SupportedLanguage.English);

      expect(feedback.type).toBe('announcement');
    });
  });

  describe('generateAudioFeedback', () => {
    it('should return a Buffer with feedback data (Req 14.2)', async () => {
      const service = createService();

      const buffer = await service.generateAudioFeedback('Action completed', SupportedLanguage.English);

      expect(Buffer.isBuffer(buffer)).toBe(true);
      const parsed = JSON.parse(buffer.toString('utf-8'));
      expect(parsed.message).toBe('Action completed');
      expect(parsed.language).toBe(SupportedLanguage.English);
    });
  });

  describe('readPageContent', () => {
    it('should include page heading in output (Req 14.1)', () => {
      const service = createService();
      const context = createPageContext({ heading: 'Dashboard' });

      const feedback = service.readPageContent(context, SupportedLanguage.English);

      expect(feedback.message).toContain('Page: Dashboard');
    });

    it('should include form labels in output (Req 14.1)', () => {
      const service = createService();
      const context = createPageContext({ formLabels: ['Name', 'Email'] });

      const feedback = service.readPageContent(context, SupportedLanguage.English);

      expect(feedback.message).toContain('Form fields: Name, Email');
    });

    it('should include navigation options in output (Req 14.1)', () => {
      const service = createService();
      const context = createPageContext({ navigationOptions: ['Home', 'Settings'] });

      const feedback = service.readPageContent(context, SupportedLanguage.English);

      expect(feedback.message).toContain('Navigation options: Home, Settings');
    });

    it('should handle empty form labels gracefully (Req 14.1)', () => {
      const service = createService();
      const context = createPageContext({ formLabels: [] });

      const feedback = service.readPageContent(context, SupportedLanguage.English);

      expect(feedback.message).not.toContain('Form fields');
    });

    it('should handle empty navigation options gracefully (Req 14.1)', () => {
      const service = createService();
      const context = createPageContext({ navigationOptions: [] });

      const feedback = service.readPageContent(context, SupportedLanguage.English);

      expect(feedback.message).not.toContain('Navigation options');
    });

    it('should return feedback of type navigation (Req 14.1)', () => {
      const service = createService();
      const context = createPageContext();

      const feedback = service.readPageContent(context, SupportedLanguage.English);

      expect(feedback.type).toBe('navigation');
    });
  });

  describe('announceError', () => {
    it('should include field name in error announcement (Req 14.3)', () => {
      const service = createService();
      const error = createErrorContext({ fieldName: 'Email' });

      const feedback = service.announceError(error, SupportedLanguage.English);

      expect(feedback.message).toContain('Email');
    });

    it('should include error description in announcement (Req 14.3)', () => {
      const service = createService();
      const error = createErrorContext({ errorDescription: 'Required field' });

      const feedback = service.announceError(error, SupportedLanguage.English);

      expect(feedback.message).toContain('Required field');
    });

    it('should return feedback of type error (Req 14.3)', () => {
      const service = createService();
      const error = createErrorContext();

      const feedback = service.announceError(error, SupportedLanguage.English);

      expect(feedback.type).toBe('error');
    });

    it('should set correct language in feedback (Req 14.3)', () => {
      const service = createService();
      const error = createErrorContext();

      const feedback = service.announceError(error, SupportedLanguage.Hindi);

      expect(feedback.language).toBe(SupportedLanguage.Hindi);
    });
  });

  describe('announceActionComplete', () => {
    it('should include action type in confirmation message (Req 14.2)', () => {
      const service = createService();

      const feedback = service.announceActionComplete('Appointment booking', SupportedLanguage.English);

      expect(feedback.message).toContain('Appointment booking');
      expect(feedback.message).toContain('completed successfully');
    });

    it('should return feedback of type confirmation (Req 14.2)', () => {
      const service = createService();

      const feedback = service.announceActionComplete('Payment submission', SupportedLanguage.English);

      expect(feedback.type).toBe('confirmation');
    });
  });

  describe('getActivationAnnouncement', () => {
    it('should announce voice assistance is active (Req 14.7)', () => {
      const service = createService();

      const announcement = service.getActivationAnnouncement(SupportedLanguage.English);

      expect(announcement).toContain('Voice assistance is now active');
    });

    it('should list all available commands (Req 14.7)', () => {
      const service = createService();

      const announcement = service.getActivationAnnouncement(SupportedLanguage.English);

      expect(announcement).toContain('next');
      expect(announcement).toContain('back');
      expect(announcement).toContain('home');
      expect(announcement).toContain('appointments');
      expect(announcement).toContain('reports');
    });
  });

  describe('getSupportedCommands', () => {
    it('should return all 5 supported commands (Req 14.4)', () => {
      const service = createService();

      const commands = service.getSupportedCommands();

      expect(commands).toHaveLength(5);
      const names = commands.map((cmd) => cmd.name);
      expect(names).toContain('next');
      expect(names).toContain('back');
      expect(names).toContain('home');
      expect(names).toContain('appointments');
      expect(names).toContain('reports');
    });

    it('should return a copy of the commands array (immutability)', () => {
      const service = createService();

      const commands1 = service.getSupportedCommands();
      const commands2 = service.getSupportedCommands();

      expect(commands1).not.toBe(commands2);
      expect(commands1).toEqual(commands2);
    });
  });

  describe('playback control', () => {
    it('should pause playback when playing (Req 14.5)', () => {
      const service = createService();
      service.startPlayback(5000);

      const state = service.pausePlayback();

      expect(state.isPlaying).toBe(false);
      expect(state.isPaused).toBe(true);
    });

    it('should not change state if not playing when pause is called (Req 14.5)', () => {
      const service = createService();

      const state = service.pausePlayback();

      expect(state.isPlaying).toBe(false);
      expect(state.isPaused).toBe(false);
    });

    it('should resume playback from paused state (Req 14.5)', () => {
      const service = createService();
      service.startPlayback(5000);
      service.pausePlayback();

      const state = service.resumePlayback();

      expect(state.isPlaying).toBe(true);
      expect(state.isPaused).toBe(false);
    });

    it('should not change state if not paused when resume is called (Req 14.5)', () => {
      const service = createService();

      const state = service.resumePlayback();

      expect(state.isPlaying).toBe(false);
      expect(state.isPaused).toBe(false);
    });

    it('should start playback with correct duration', () => {
      const service = createService();

      const state = service.startPlayback(3000);

      expect(state.isPlaying).toBe(true);
      expect(state.isPaused).toBe(false);
      expect(state.totalDurationMs).toBe(3000);
    });

    it('should return current playback state', () => {
      const service = createService();
      service.startPlayback(4000);

      const state = service.getPlaybackState();

      expect(state.isPlaying).toBe(true);
      expect(state.totalDurationMs).toBe(4000);
    });
  });

  describe('shouldResumeAfterSilence', () => {
    it('should return true when silence >= 2000ms (Req 14.5)', () => {
      const service = createService();

      expect(service.shouldResumeAfterSilence(2000)).toBe(true);
      expect(service.shouldResumeAfterSilence(3000)).toBe(true);
    });

    it('should return false when silence < 2000ms (Req 14.5)', () => {
      const service = createService();

      expect(service.shouldResumeAfterSilence(1999)).toBe(false);
      expect(service.shouldResumeAfterSilence(0)).toBe(false);
    });
  });

  describe('timing constants', () => {
    it('should have max response time of 2000ms (Req 14.1, 14.2, 14.3)', () => {
      expect(MAX_RESPONSE_TIME_MS).toBe(2000);
    });

    it('should have max pause latency of 500ms (Req 14.5)', () => {
      expect(MAX_PAUSE_LATENCY_MS).toBe(500);
    });

    it('should have silence threshold of 2000ms (Req 14.5)', () => {
      expect(SILENCE_THRESHOLD_MS).toBe(2000);
    });

    it('should have unrecognized command timeout of 5000ms (Req 14.6)', () => {
      expect(UNRECOGNIZED_COMMAND_TIMEOUT_MS).toBe(5000);
    });
  });
});
