/**
 * Voice Assistance Service
 * Provides voice command processing, audio feedback generation,
 * and playback control for senior citizens with limited vision.
 *
 * Validates: Requirements 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.7
 */

import { SupportedLanguage } from '@health-checkup/shared';

// --- Types ---

/**
 * Supported voice commands for navigation.
 * Requirement 14.4: Senior citizens can navigate using voice commands.
 */
export type VoiceCommandName = 'next' | 'back' | 'home' | 'appointments' | 'reports';

/**
 * Actions that can result from a voice command.
 */
export type VoiceAction = 'navigate' | 'read' | 'activate' | 'error_announcement';

/**
 * Result of processing a voice command.
 * Requirement 14.1, 14.4, 14.6: Command recognition with response timing.
 */
export interface VoiceCommandResult {
  recognized: boolean;
  command?: VoiceCommandName;
  action?: VoiceAction;
  target?: string;
  feedbackMessage: string;
  responseTimeMs: number;
}

/**
 * Descriptor for a supported voice command.
 */
export interface VoiceCommand {
  name: VoiceCommandName;
  description: string;
  action: VoiceAction;
  target: string;
}

/**
 * Audio feedback output.
 * Requirement 14.2, 14.3: Audio confirmation and error announcements.
 */
export interface AudioFeedback {
  message: string;
  language: SupportedLanguage;
  durationMs: number;
  type: 'confirmation' | 'error' | 'navigation' | 'announcement';
}

/**
 * Playback state for managing pause/resume.
 * Requirement 14.5: Pause within 500ms, resume after 2s silence.
 */
export interface PlaybackState {
  isPlaying: boolean;
  isPaused: boolean;
  pausedAtMs: number;
  totalDurationMs: number;
}

/**
 * Page context describing current content for reading aloud.
 * Requirement 14.1: Read headings, form labels, navigation options.
 */
export interface PageContext {
  heading: string;
  formLabels: string[];
  navigationOptions: string[];
}

/**
 * Error context for audio error announcements.
 * Requirement 14.3: Announce error with field name.
 */
export interface ErrorContext {
  fieldName: string;
  errorDescription: string;
}

// --- Constants ---

/**
 * Maximum response time for page reading, action confirmations, and error announcements.
 * Requirement 14.1, 14.2, 14.3: Within 2 seconds.
 */
export const MAX_RESPONSE_TIME_MS = 2000;

/**
 * Maximum time to pause playback when user speaks.
 * Requirement 14.5: Within 500 milliseconds.
 */
export const MAX_PAUSE_LATENCY_MS = 500;

/**
 * Silence duration before resuming playback.
 * Requirement 14.5: 2 seconds of silence.
 */
export const SILENCE_THRESHOLD_MS = 2000;

/**
 * Maximum time to provide unrecognized command prompt.
 * Requirement 14.6: Within 5 seconds.
 */
export const UNRECOGNIZED_COMMAND_TIMEOUT_MS = 5000;

/**
 * All supported voice commands with their metadata.
 * Requirement 14.4: Commands "next", "back", "home", "appointments", "reports".
 */
export const SUPPORTED_VOICE_COMMANDS: VoiceCommand[] = [
  { name: 'next', description: 'Navigate to the next section', action: 'navigate', target: '/next' },
  { name: 'back', description: 'Navigate to the previous section', action: 'navigate', target: '/back' },
  { name: 'home', description: 'Navigate to the home page', action: 'navigate', target: '/' },
  { name: 'appointments', description: 'Navigate to appointments', action: 'navigate', target: '/appointments' },
  { name: 'reports', description: 'Navigate to health reports', action: 'navigate', target: '/reports' },
];

// --- Service ---

/**
 * VoiceAssistanceService manages voice command processing, audio feedback,
 * and playback control for senior citizens with limited vision.
 *
 * Business rules:
 * - Supported commands: "next", "back", "home", "appointments", "reports" (Req 14.4)
 * - Response time: within 2 seconds for page reading, actions, errors (Req 14.1, 14.2, 14.3)
 * - Pause: within 500ms when user speaks; resume after 2s silence (Req 14.5)
 * - Unrecognized command: audio prompt within 5 seconds (Req 14.6)
 * - Activation: announce with summary of available commands (Req 14.7)
 */
export class VoiceAssistanceService {
  private playbackState: PlaybackState = {
    isPlaying: false,
    isPaused: false,
    pausedAtMs: 0,
    totalDurationMs: 0,
  };

  /**
   * Process a voice command transcript and return the result.
   *
   * Requirement 14.4: Navigate between sections using voice commands.
   * Requirement 14.6: Unrecognized commands receive a prompt within 5 seconds.
   */
  processCommand(transcript: string): VoiceCommandResult {
    const startTime = Date.now();
    const normalizedInput = transcript.trim().toLowerCase();

    const matchedCommand = SUPPORTED_VOICE_COMMANDS.find(
      (cmd) => normalizedInput === cmd.name || normalizedInput.includes(cmd.name),
    );

    const responseTimeMs = Date.now() - startTime;

    if (matchedCommand) {
      return {
        recognized: true,
        command: matchedCommand.name,
        action: matchedCommand.action,
        target: matchedCommand.target,
        feedbackMessage: `Navigating to ${matchedCommand.description.toLowerCase()}.`,
        responseTimeMs,
      };
    }

    return {
      recognized: false,
      feedbackMessage: this.getUnrecognizedCommandMessage(),
      responseTimeMs,
    };
  }

  /**
   * Process a voice command from raw audio input (Buffer-based).
   * Delegates to processCommand after transcription simulation.
   *
   * Requirement 14.1: Read page content within 2 seconds of request.
   * Requirement 14.4: Voice command navigation.
   */
  async processVoiceCommand(audioInput: Buffer, userId: string): Promise<VoiceCommandResult> {
    const transcript = this.transcribeAudio(audioInput);
    return this.processCommand(transcript);
  }

  /**
   * Generate audio feedback for a given message.
   *
   * Requirement 14.2: Audio confirmation for completed actions within 2 seconds.
   * Requirement 14.3: Error announcements through audio within 2 seconds.
   */
  generateFeedback(message: string, language: SupportedLanguage): AudioFeedback {
    const estimatedDuration = this.estimateAudioDuration(message);

    return {
      message,
      language,
      durationMs: estimatedDuration,
      type: this.inferFeedbackType(message),
    };
  }

  /**
   * Generate audio feedback as a Buffer (TTS output simulation).
   *
   * Requirement 14.2: Audio confirmation for completed actions within 2 seconds.
   */
  async generateAudioFeedback(message: string, language: SupportedLanguage): Promise<Buffer> {
    const feedback = this.generateFeedback(message, language);
    // Simulate TTS output as a buffer containing the message text
    return Buffer.from(JSON.stringify(feedback), 'utf-8');
  }

  /**
   * Read aloud the current page content.
   *
   * Requirement 14.1: Read current page heading, form labels, and
   * navigation options within 2 seconds of request.
   */
  readPageContent(context: PageContext, language: SupportedLanguage): AudioFeedback {
    const parts: string[] = [];

    if (context.heading) {
      parts.push(`Page: ${context.heading}.`);
    }

    if (context.formLabels.length > 0) {
      parts.push(`Form fields: ${context.formLabels.join(', ')}.`);
    }

    if (context.navigationOptions.length > 0) {
      parts.push(`Navigation options: ${context.navigationOptions.join(', ')}.`);
    }

    const message = parts.join(' ');
    return this.generateFeedback(message, language);
  }

  /**
   * Generate audio error announcement.
   *
   * Requirement 14.3: Announce error description and field name
   * through audio within 2 seconds.
   */
  announceError(error: ErrorContext, language: SupportedLanguage): AudioFeedback {
    const message = `Error in field "${error.fieldName}": ${error.errorDescription}`;
    return {
      message,
      language,
      durationMs: this.estimateAudioDuration(message),
      type: 'error',
    };
  }

  /**
   * Generate audio confirmation for a completed action.
   *
   * Requirement 14.2: Audio confirmation for completed actions
   * (appointment booking, payment submission, report download) within 2 seconds.
   */
  announceActionComplete(actionType: string, language: SupportedLanguage): AudioFeedback {
    const message = `${actionType} completed successfully.`;
    return {
      message,
      language,
      durationMs: this.estimateAudioDuration(message),
      type: 'confirmation',
    };
  }

  /**
   * Get the activation announcement message.
   *
   * Requirement 14.7: Announce that voice assistance is active
   * and provide a summary of available voice commands.
   */
  getActivationAnnouncement(language: SupportedLanguage): string {
    const commandList = SUPPORTED_VOICE_COMMANDS.map((cmd) => `"${cmd.name}"`).join(', ');
    return `Voice assistance is now active. Available commands: ${commandList}. Say a command to navigate.`;
  }

  /**
   * Get the list of all supported voice commands.
   *
   * Requirement 14.4: Supported commands listing.
   */
  getSupportedCommands(): VoiceCommand[] {
    return [...SUPPORTED_VOICE_COMMANDS];
  }

  /**
   * Pause audio playback when the user begins speaking.
   *
   * Requirement 14.5: Pause within 500 milliseconds when user speaks.
   */
  pausePlayback(): PlaybackState {
    if (this.playbackState.isPlaying) {
      this.playbackState = {
        ...this.playbackState,
        isPlaying: false,
        isPaused: true,
        pausedAtMs: Date.now(),
      };
    }
    return { ...this.playbackState };
  }

  /**
   * Resume audio playback from the paused position.
   *
   * Requirement 14.5: Resume after 2 seconds of silence.
   */
  resumePlayback(): PlaybackState {
    if (this.playbackState.isPaused) {
      this.playbackState = {
        ...this.playbackState,
        isPlaying: true,
        isPaused: false,
      };
    }
    return { ...this.playbackState };
  }

  /**
   * Start playback of audio content.
   */
  startPlayback(durationMs: number): PlaybackState {
    this.playbackState = {
      isPlaying: true,
      isPaused: false,
      pausedAtMs: 0,
      totalDurationMs: durationMs,
    };
    return { ...this.playbackState };
  }

  /**
   * Get the current playback state.
   */
  getPlaybackState(): PlaybackState {
    return { ...this.playbackState };
  }

  /**
   * Check if silence duration has exceeded threshold for resuming playback.
   *
   * Requirement 14.5: Resume after 2 seconds of silence.
   */
  shouldResumeAfterSilence(silenceDurationMs: number): boolean {
    return silenceDurationMs >= SILENCE_THRESHOLD_MS;
  }

  // --- Private Methods ---

  /**
   * Simulate audio transcription from buffer input.
   * In production, this would call a speech-to-text service.
   */
  private transcribeAudio(audioInput: Buffer): string {
    return audioInput.toString('utf-8').trim();
  }

  /**
   * Get the unrecognized command feedback message.
   * Requirement 14.6: List available voice commands when not recognized.
   */
  private getUnrecognizedCommandMessage(): string {
    const commandList = SUPPORTED_VOICE_COMMANDS.map((cmd) => `"${cmd.name}"`).join(', ');
    return `Command not recognized. Available commands: ${commandList}.`;
  }

  /**
   * Estimate audio duration based on message length.
   * Average speaking rate ~150 words per minute = ~2.5 words/sec.
   */
  private estimateAudioDuration(message: string): number {
    const wordCount = message.split(/\s+/).length;
    const wordsPerSecond = 2.5;
    return Math.ceil((wordCount / wordsPerSecond) * 1000);
  }

  /**
   * Infer the feedback type from the message content.
   */
  private inferFeedbackType(message: string): AudioFeedback['type'] {
    const lowerMessage = message.toLowerCase();
    if (lowerMessage.includes('error') || lowerMessage.includes('failed')) {
      return 'error';
    }
    if (lowerMessage.includes('completed') || lowerMessage.includes('success')) {
      return 'confirmation';
    }
    if (lowerMessage.includes('navigat') || lowerMessage.includes('page:')) {
      return 'navigation';
    }
    return 'announcement';
  }
}
