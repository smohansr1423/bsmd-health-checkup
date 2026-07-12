/**
 * Voice food logging (Task 14.21).
 *
 * Two flows, both pure and deterministic:
 *
 *  - Free-form voice logging ({@link logMealByVoice}): a spoken input of up to
 *    60 s is transcribed within a 10 s budget into a `voice`-sourced meal entry
 *    populated with the transcribed text (Req 7.3). A too-long input, a failed
 *    transcription, an empty/whitespace transcription, or a transcription that
 *    overruns the budget creates no meal entry and retains prior state so the
 *    caller can retry or pick an alternative input method (Req 7.4).
 *
 *  - Voice-guided field-by-field logging ({@link startVoiceGuidedSession} /
 *    {@link submitSpokenResponse}): each required field emits an audible prompt
 *    and accepts a spoken response; an invalid response emits an audible error
 *    describing the expected input and re-prompts, allowing at most 3 attempts
 *    per field before offering an alternative input method (Req 26.4, 26.5).
 *
 * Device effects (the ASR engine, the audible prompter) are injected as ports
 * so the logic runs identically across clients and in tests with no hardware.
 *
 * Requirements: 7.3, 7.4, 26.4, 26.5
 */

import {
  atomicFailure,
  err,
  ok,
  timeoutOutcome,
  validationRejection,
  type Result,
} from '@calorie-cortisol/shared/result';
import type {
  Meal,
  NutrientValue,
  NutritionTotals,
} from '@calorie-cortisol/shared';

import {
  MAX_FIELD_ATTEMPTS,
  MAX_VOICE_INPUT_SECONDS,
  VOICE_TRANSCRIPTION_BUDGET_SECONDS,
  VoiceErrorCode,
  type AudioPrompter,
  type SpeechRecognizer,
  type VoiceAudioInput,
  type VoiceGuidedField,
  type VoiceGuidedState,
  type VoiceMealContext,
  type VoiceMealEntry,
} from './types';

// ---------------------------------------------------------------------------
// Free-form voice logging (Req 7.3, 7.4)
// ---------------------------------------------------------------------------

/** A zero-valued nutrient in the given unit (a freshly logged voice entry has no items yet). */
function zeroNutrient(unit: NutrientValue['unit']): NutrientValue {
  return { value: 0, unit, lower: 0, upper: 0, available: false };
}

/**
 * Zeroed totals for a meal entry that has no items yet. Nutrition is resolved
 * downstream (Nutrition Lookup) from the transcribed text; the voice flow only
 * creates the entry populated with that text (Req 7.3).
 */
function zeroTotals(): NutritionTotals {
  return {
    calories: zeroNutrient('kcal'),
    protein: zeroNutrient('g'),
    carbs: zeroNutrient('g'),
    fat: zeroNutrient('g'),
    secondary: {},
  };
}

/** Whether transcribed text contains recognizable (non-whitespace) content (Req 7.4). */
export function hasRecognizableText(text: string): boolean {
  return text.trim().length > 0;
}

/**
 * Build a `voice`-sourced meal entry populated with the transcribed text
 * (Req 7.3). The meal starts with no items and zeroed totals; item resolution
 * and nutrition are computed downstream from {@link VoiceMealEntry.transcribedText}.
 */
export function buildVoiceMeal(
  transcribedText: string,
  context: VoiceMealContext,
): VoiceMealEntry {
  const meal: Meal = {
    id: context.mealId,
    userId: context.userId,
    loggedAt: context.loggedAt,
    items: [],
    totals: zeroTotals(),
    source: 'voice',
    syncStatus: 'local',
  };
  return { meal, transcribedText: transcribedText.trim() };
}

/**
 * Free-form voice logging (Req 7.3, 7.4). Transcribes a spoken input into a
 * `voice`-sourced meal entry, or returns a structured degraded outcome that
 * retains prior state (no partial entry) so the caller can retry or offer an
 * alternative input method.
 *
 * Rules:
 *  - input longer than 60 s → validation rejection, no entry (Req 7.3).
 *  - transcription that overruns the 10 s budget → timeout, no entry, retained
 *    input for retry (Req 7.3, 21.6).
 *  - transcription failure or empty/whitespace text → atomic failure, no entry,
 *    retained state, retryable so the UI offers retry / alternative (Req 7.4).
 *  - otherwise → a meal entry populated with the transcribed text (Req 7.3).
 */
export function logMealByVoice(
  audio: VoiceAudioInput,
  recognizer: SpeechRecognizer,
  context: VoiceMealContext,
): Result<VoiceMealEntry> {
  if (audio.durationSeconds > MAX_VOICE_INPUT_SECONDS) {
    return err(
      validationRejection(
        VoiceErrorCode.InputTooLong,
        `Spoken input exceeds the ${MAX_VOICE_INPUT_SECONDS}s maximum for voice logging.`,
      ),
    );
  }

  const outcome = recognizer.transcribe(audio);

  if (outcome.kind === 'failed') {
    // No recognizable transcription: create no entry, retain state, offer retry
    // or an alternative input method (Req 7.4).
    return err(
      atomicFailure(
        VoiceErrorCode.TranscriptionFailed,
        outcome.reason ??
          'Voice transcription was unsuccessful. Retry or choose another input method.',
      ),
    );
  }

  // A transcription that overran the budget is a timeout: no entry, retained
  // input for retry (Req 7.3, 21.6).
  if (outcome.elapsedSeconds > VOICE_TRANSCRIPTION_BUDGET_SECONDS) {
    return err(
      timeoutOutcome(
        VoiceErrorCode.TranscriptionTimedOut,
        `Transcription did not complete within ${VOICE_TRANSCRIPTION_BUDGET_SECONDS}s. The input was retained for retry.`,
      ),
    );
  }

  // Empty / whitespace-only text is "no recognizable text" (Req 7.4).
  if (!hasRecognizableText(outcome.text)) {
    return err(
      atomicFailure(
        VoiceErrorCode.TranscriptionFailed,
        'Voice transcription produced no recognizable text. Retry or choose another input method.',
      ),
    );
  }

  return ok(buildVoiceMeal(outcome.text, context));
}

// ---------------------------------------------------------------------------
// Voice-guided field-by-field logging (Req 26.4, 26.5)
// ---------------------------------------------------------------------------

/**
 * The initial state of a voice-guided session: prompting the first field
 * (Req 26.4). An empty field list yields an immediately-completed session.
 */
export function startVoiceGuidedSession(
  fields: readonly VoiceGuidedField[],
): VoiceGuidedState {
  if (fields.length === 0) {
    return {
      status: 'completed',
      fieldIndex: 0,
      attempts: 0,
      collected: {},
      currentFieldId: null,
      activePrompt: null,
      errorIndication: null,
    };
  }
  const first = fields[0];
  return {
    status: 'prompting',
    fieldIndex: 0,
    attempts: 0,
    collected: {},
    currentFieldId: first.id,
    activePrompt: first.prompt,
    errorIndication: null,
  };
}

/**
 * Reduce a spoken response for the currently prompted field into the next state
 * (Req 26.4, 26.5). Pure: identical (state, fields, spoken) always yields the
 * same next state.
 *
 *  - A valid response records the accepted value and advances to the next field
 *    (or completes the session when it was the last field).
 *  - An invalid/unrecognized response increments the attempt count and either
 *    re-prompts the same field with an audible error describing the expected
 *    input (Req 26.5), or — once {@link MAX_FIELD_ATTEMPTS} attempts have failed
 *    — offers an alternative input method (Req 26.5).
 *  - A response submitted when the session is not prompting is ignored.
 */
export function submitSpokenResponse(
  state: VoiceGuidedState,
  fields: readonly VoiceGuidedField[],
  spoken: string,
): VoiceGuidedState {
  if (state.status !== 'prompting') {
    return state;
  }
  const field = fields[state.fieldIndex];
  if (field === undefined) {
    return state;
  }

  const accepted = field.validate(spoken);

  if (accepted !== null) {
    // Valid response: record and advance (Req 26.4).
    const collected = { ...state.collected, [field.id]: accepted };
    const nextIndex = state.fieldIndex + 1;
    if (nextIndex >= fields.length) {
      return {
        status: 'completed',
        fieldIndex: nextIndex,
        attempts: 0,
        collected,
        currentFieldId: null,
        activePrompt: null,
        errorIndication: null,
      };
    }
    const nextField = fields[nextIndex];
    return {
      status: 'prompting',
      fieldIndex: nextIndex,
      attempts: 0,
      collected,
      currentFieldId: nextField.id,
      activePrompt: nextField.prompt,
      errorIndication: null,
    };
  }

  // Invalid response (Req 26.5).
  const attempts = state.attempts + 1;
  const errorIndication = `I didn't catch that. ${field.expectedInput}`;

  if (attempts >= MAX_FIELD_ATTEMPTS) {
    // Attempts exhausted: offer an alternative input method (Req 26.5).
    return {
      status: 'alternativeInput',
      fieldIndex: state.fieldIndex,
      attempts,
      collected: state.collected,
      currentFieldId: field.id,
      activePrompt: null,
      errorIndication,
    };
  }

  // Re-prompt the same field with the audible error (Req 26.5).
  return {
    status: 'prompting',
    fieldIndex: state.fieldIndex,
    attempts,
    collected: state.collected,
    currentFieldId: field.id,
    activePrompt: field.prompt,
    errorIndication,
  };
}

/**
 * Stateful façade that drives the pure voice-guided reducers using the injected
 * {@link SpeechRecognizer} and {@link AudioPrompter} ports. It emits the audible
 * field prompt (Req 26.4) and the audible error indication (Req 26.5) as the
 * session progresses, so the platform layer only supplies the recorded audio.
 */
export class VoiceGuidedLoggingSession {
  private state: VoiceGuidedState;

  private readonly fields: readonly VoiceGuidedField[];

  private readonly recognizer: SpeechRecognizer;

  private readonly prompter: AudioPrompter;

  constructor(
    fields: readonly VoiceGuidedField[],
    ports: { recognizer: SpeechRecognizer; prompter: AudioPrompter },
  ) {
    this.fields = fields;
    this.recognizer = ports.recognizer;
    this.prompter = ports.prompter;
    this.state = startVoiceGuidedSession(fields);
  }

  /** The current session state (status, active prompt, collected values). */
  get current(): VoiceGuidedState {
    return this.state;
  }

  /**
   * Begin the session by emitting the first field's audible prompt (Req 26.4).
   * Returns the current state.
   */
  start(): VoiceGuidedState {
    if (this.state.status === 'prompting' && this.state.activePrompt !== null) {
      this.prompter.prompt(this.state.activePrompt);
    }
    return this.state;
  }

  /**
   * Transcribe a spoken response for the active field and advance the session,
   * emitting the next audible prompt or the audible error indication (Req 26.4,
   * 26.5). Returns the new state.
   */
  provideResponse(audio: VoiceAudioInput): VoiceGuidedState {
    if (this.state.status !== 'prompting') {
      return this.state;
    }
    const outcome = this.recognizer.transcribe(audio);
    const spoken = outcome.kind === 'transcribed' ? outcome.text : '';
    this.state = submitSpokenResponse(this.state, this.fields, spoken);

    if (this.state.errorIndication !== null) {
      this.prompter.error(this.state.errorIndication);
    }
    if (this.state.status === 'prompting' && this.state.activePrompt !== null) {
      this.prompter.prompt(this.state.activePrompt);
    }
    return this.state;
  }
}
