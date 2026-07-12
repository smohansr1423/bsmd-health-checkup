import { isErr, isOk } from '@calorie-cortisol/shared/result';

import {
  logMealByVoice,
  buildVoiceMeal,
  hasRecognizableText,
  startVoiceGuidedSession,
  submitSpokenResponse,
  VoiceGuidedLoggingSession,
} from './voice-logging';
import {
  MAX_FIELD_ATTEMPTS,
  VoiceErrorCode,
  type AudioPrompter,
  type SpeechRecognizer,
  type TranscriptionOutcome,
  type VoiceAudioInput,
  type VoiceGuidedField,
  type VoiceMealContext,
} from './types';

const CONTEXT: VoiceMealContext = {
  mealId: 'meal-1',
  userId: 'user-1',
  loggedAt: '2024-01-01T12:00:00-05:00',
};

/** A recognizer that always returns a fixed outcome. */
function fixedRecognizer(outcome: TranscriptionOutcome): SpeechRecognizer {
  return { transcribe: () => outcome };
}

const audio = (durationSeconds: number): VoiceAudioInput => ({
  id: 'audio-1',
  durationSeconds,
});

describe('logMealByVoice (Req 7.3, 7.4)', () => {
  it('creates a voice-sourced meal entry populated with transcribed text', () => {
    const recognizer = fixedRecognizer({
      kind: 'transcribed',
      text: 'grilled chicken salad',
      elapsedSeconds: 3,
    });
    const result = logMealByVoice(audio(20), recognizer, CONTEXT);

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.transcribedText).toBe('grilled chicken salad');
      expect(result.value.meal.source).toBe('voice');
      expect(result.value.meal.id).toBe('meal-1');
      expect(result.value.meal.items).toHaveLength(0);
      expect(result.value.meal.syncStatus).toBe('local');
    }
  });

  it('trims surrounding whitespace from the transcribed text', () => {
    const recognizer = fixedRecognizer({
      kind: 'transcribed',
      text: '  oatmeal with berries  ',
      elapsedSeconds: 2,
    });
    const result = logMealByVoice(audio(10), recognizer, CONTEXT);
    expect(isOk(result) && result.value.transcribedText).toBe(
      'oatmeal with berries',
    );
  });

  it('rejects input longer than 60 seconds without creating an entry (Req 7.3)', () => {
    const recognizer = fixedRecognizer({
      kind: 'transcribed',
      text: 'should not be used',
      elapsedSeconds: 1,
    });
    const result = logMealByVoice(audio(61), recognizer, CONTEXT);

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.code).toBe(VoiceErrorCode.InputTooLong);
      expect(result.error.retainedState).toBe(true);
    }
  });

  it('accepts input at exactly 60 seconds', () => {
    const recognizer = fixedRecognizer({
      kind: 'transcribed',
      text: 'apple',
      elapsedSeconds: 1,
    });
    expect(isOk(logMealByVoice(audio(60), recognizer, CONTEXT))).toBe(true);
  });

  it('creates no entry and retains state when transcription fails (Req 7.4)', () => {
    const result = logMealByVoice(
      audio(15),
      fixedRecognizer({ kind: 'failed', reason: 'no speech detected' }),
      CONTEXT,
    );

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.code).toBe(VoiceErrorCode.TranscriptionFailed);
      expect(result.error.retainedState).toBe(true);
      // Retryable so the UI can offer retry / alternative input (Req 7.4).
      expect(result.error.retryable).toBe(true);
    }
  });

  it('treats whitespace-only transcription as no recognizable text (Req 7.4)', () => {
    const result = logMealByVoice(
      audio(15),
      fixedRecognizer({ kind: 'transcribed', text: '   ', elapsedSeconds: 2 }),
      CONTEXT,
    );

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.code).toBe(VoiceErrorCode.TranscriptionFailed);
    }
  });

  it('times out (no entry, retained input) when transcription overruns the 10s budget (Req 7.3)', () => {
    const result = logMealByVoice(
      audio(15),
      fixedRecognizer({
        kind: 'transcribed',
        text: 'late result',
        elapsedSeconds: 11,
      }),
      CONTEXT,
    );

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.code).toBe(VoiceErrorCode.TranscriptionTimedOut);
      expect(result.error.retainedState).toBe(true);
      expect(result.error.retryable).toBe(true);
    }
  });

  it('accepts a transcription completing at exactly the 10s budget', () => {
    const result = logMealByVoice(
      audio(15),
      fixedRecognizer({ kind: 'transcribed', text: 'toast', elapsedSeconds: 10 }),
      CONTEXT,
    );
    expect(isOk(result)).toBe(true);
  });
});

describe('hasRecognizableText / buildVoiceMeal', () => {
  it('classifies recognizable vs. empty text', () => {
    expect(hasRecognizableText('food')).toBe(true);
    expect(hasRecognizableText('   ')).toBe(false);
    expect(hasRecognizableText('')).toBe(false);
  });

  it('builds a zeroed voice meal skeleton', () => {
    const entry = buildVoiceMeal('banana', CONTEXT);
    expect(entry.meal.source).toBe('voice');
    expect(entry.meal.totals.calories.value).toBe(0);
    expect(entry.meal.totals.calories.available).toBe(false);
    expect(entry.transcribedText).toBe('banana');
  });
});

// ---------------------------------------------------------------------------
// Voice-guided field-by-field logging (Req 26.4, 26.5)
// ---------------------------------------------------------------------------

const FIELDS: VoiceGuidedField[] = [
  {
    id: 'foodName',
    prompt: 'What did you eat?',
    expectedInput: 'Say the name of the food.',
    validate: (spoken) => (spoken.trim().length > 0 ? spoken.trim() : null),
  },
  {
    id: 'portion',
    prompt: 'How many servings?',
    expectedInput: 'Say a number of servings.',
    validate: (spoken) => (/^\d+$/.test(spoken.trim()) ? spoken.trim() : null),
  },
];

describe('voice-guided logging reducer (Req 26.4, 26.5)', () => {
  it('starts by prompting the first field (Req 26.4)', () => {
    const state = startVoiceGuidedSession(FIELDS);
    expect(state.status).toBe('prompting');
    expect(state.currentFieldId).toBe('foodName');
    expect(state.activePrompt).toBe('What did you eat?');
    expect(state.errorIndication).toBeNull();
  });

  it('completes immediately with no fields', () => {
    const state = startVoiceGuidedSession([]);
    expect(state.status).toBe('completed');
    expect(state.activePrompt).toBeNull();
  });

  it('advances to the next field on a valid response (Req 26.4)', () => {
    let state = startVoiceGuidedSession(FIELDS);
    state = submitSpokenResponse(state, FIELDS, 'pizza');
    expect(state.status).toBe('prompting');
    expect(state.currentFieldId).toBe('portion');
    expect(state.collected.foodName).toBe('pizza');
    expect(state.attempts).toBe(0);
  });

  it('completes after the last field is answered', () => {
    let state = startVoiceGuidedSession(FIELDS);
    state = submitSpokenResponse(state, FIELDS, 'pizza');
    state = submitSpokenResponse(state, FIELDS, '2');
    expect(state.status).toBe('completed');
    expect(state.collected).toEqual({ foodName: 'pizza', portion: '2' });
    expect(state.activePrompt).toBeNull();
  });

  it('re-prompts the same field with an audible error on invalid input (Req 26.5)', () => {
    let state = startVoiceGuidedSession(FIELDS);
    state = submitSpokenResponse(state, FIELDS, 'pizza'); // -> portion
    state = submitSpokenResponse(state, FIELDS, 'not a number');
    expect(state.status).toBe('prompting');
    expect(state.currentFieldId).toBe('portion');
    expect(state.attempts).toBe(1);
    expect(state.errorIndication).toContain('Say a number of servings.');
  });

  it('offers an alternative input method after 3 failed attempts (Req 26.5)', () => {
    let state = startVoiceGuidedSession(FIELDS);
    state = submitSpokenResponse(state, FIELDS, 'pizza'); // -> portion
    for (let i = 0; i < MAX_FIELD_ATTEMPTS; i += 1) {
      state = submitSpokenResponse(state, FIELDS, 'bad');
    }
    expect(state.status).toBe('alternativeInput');
    expect(state.attempts).toBe(MAX_FIELD_ATTEMPTS);
    expect(state.activePrompt).toBeNull();
    expect(state.errorIndication).not.toBeNull();
  });

  it('allows recovery within the attempt budget (2 fails then success)', () => {
    let state = startVoiceGuidedSession(FIELDS);
    state = submitSpokenResponse(state, FIELDS, 'pizza'); // -> portion
    state = submitSpokenResponse(state, FIELDS, 'bad');
    state = submitSpokenResponse(state, FIELDS, 'bad');
    expect(state.status).toBe('prompting');
    state = submitSpokenResponse(state, FIELDS, '3');
    expect(state.status).toBe('completed');
    expect(state.collected.portion).toBe('3');
  });

  it('ignores responses once the session is not prompting', () => {
    const done = startVoiceGuidedSession([]);
    expect(submitSpokenResponse(done, FIELDS, 'x')).toBe(done);
  });
});

describe('VoiceGuidedLoggingSession façade (Req 26.4, 26.5)', () => {
  function recordingPrompter(): AudioPrompter & {
    prompts: string[];
    errors: string[];
  } {
    const prompts: string[] = [];
    const errors: string[] = [];
    return {
      prompts,
      errors,
      prompt: (t) => prompts.push(t),
      error: (t) => errors.push(t),
    };
  }

  it('emits the first prompt on start (Req 26.4)', () => {
    const prompter = recordingPrompter();
    const session = new VoiceGuidedLoggingSession(FIELDS, {
      recognizer: fixedRecognizer({ kind: 'failed' }),
      prompter,
    });
    session.start();
    expect(prompter.prompts).toEqual(['What did you eat?']);
  });

  it('emits the audible error and re-prompts on an unrecognized response (Req 26.5)', () => {
    const prompter = recordingPrompter();
    // First response transcribes to empty (invalid for foodName).
    const session = new VoiceGuidedLoggingSession(FIELDS, {
      recognizer: fixedRecognizer({ kind: 'failed' }),
      prompter,
    });
    session.start();
    const state = session.provideResponse(audio(3));
    expect(state.attempts).toBe(1);
    expect(prompter.errors).toHaveLength(1);
    // re-prompted the same field
    expect(prompter.prompts).toEqual(['What did you eat?', 'What did you eat?']);
  });

  it('advances through fields on valid transcribed responses (Req 26.4)', () => {
    const prompter = recordingPrompter();
    let outcome: TranscriptionOutcome = {
      kind: 'transcribed',
      text: 'salad',
      elapsedSeconds: 1,
    };
    const recognizer: SpeechRecognizer = { transcribe: () => outcome };
    const session = new VoiceGuidedLoggingSession(FIELDS, {
      recognizer,
      prompter,
    });
    session.start();
    session.provideResponse(audio(2)); // "salad" -> portion
    outcome = { kind: 'transcribed', text: '2', elapsedSeconds: 1 };
    const state = session.provideResponse(audio(2)); // "2" -> completed
    expect(state.status).toBe('completed');
    expect(state.collected).toEqual({ foodName: 'salad', portion: '2' });
  });
});
