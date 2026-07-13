/**
 * Integration tests for the supplementary food-input pipelines (Task 18.3).
 *
 * The design "Testing Strategy" covers the barcode / voice / menu-OCR food
 * input pipelines (Req 7) with 1–3 representative integration cases each. These
 * pipelines are client-side: they compose the shared meal-correction logic and
 * the voice-logging flow with their injectable resolver / recognizer ports
 * (the gateway-routed Nutrition Lookup and the platform ASR engine in
 * production), so they run identically across iOS, Android, and the PWA and are
 * exercised here with in-memory doubles.
 *
 *   - **Barcode** scan → logged entry (Req 7.1): a scanned product barcode that
 *     matches a nutritional record adds the item to the meal and recomputes its
 *     totals; a barcode that matches nothing leaves the meal and its totals
 *     unchanged and surfaces a no-match outcome (Req 7.2).
 *   - **Voice** logging (Req 7.3): a spoken input is transcribed into a
 *     `voice`-sourced meal entry populated with the transcribed text; a failed
 *     transcription creates no entry and retains prior state (Req 7.4).
 *
 * NOTE: The menu-OCR pipeline (Req 7.5) is not yet implemented as a shared
 * module (no OCR extraction seam exists to compose), so it has no integration
 * surface to exercise here; it is covered by unit tests once that module lands.
 *
 * Requirements: 7.1, 7.3
 */

import { isErr, isOk, ok, type Result } from '@calorie-cortisol/shared/result';
import type {
  Meal,
  MealItem,
  NutrientUnit,
  NutrientValue,
} from '@calorie-cortisol/shared';

import {
  CorrectionErrorCode,
  InMemoryMealStore,
  MealCorrector,
  recomputeTotals,
  type FoodItemResolver,
  type ResolvedFoodItem,
} from '../correction';
import {
  logMealByVoice,
  VoiceErrorCode,
  type SpeechRecognizer,
  type TranscriptionOutcome,
  type VoiceAudioInput,
  type VoiceMealContext,
} from '../voice-accessibility';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function nv(value: number, unit: NutrientUnit = 'g', available = true): NutrientValue {
  return { value, unit, lower: value * 0.9, upper: value * 1.1, available };
}

function makeItem(id: string): MealItem {
  return {
    foodItem: { id, label: id, confidence: 90 },
    portionMultiplier: 1,
    nutrition: {
      calories: nv(200, 'kcal'),
      protein: nv(10, 'g'),
      carbs: nv(20, 'g'),
      fat: nv(5, 'g'),
    },
  };
}

function makeMeal(items: MealItem[]): Meal {
  return {
    id: 'meal-1',
    userId: 'user-1',
    loggedAt: '2024-01-01T12:00:00.000Z',
    items,
    totals: recomputeTotals(items),
    source: 'photo',
    syncStatus: 'local',
  };
}

const barcodeResolved: ResolvedFoodItem = {
  foodItem: { id: 'granola-bar', label: 'granola bar', confidence: 95 },
  nutrition: {
    calories: nv(190, 'kcal'),
    protein: nv(4, 'g'),
    carbs: nv(29, 'g'),
    fat: nv(6, 'g'),
  },
};

/** Resolver whose barcode lookup returns a fixed match. */
class BarcodeMatchResolver implements FoodItemResolver {
  constructor(private readonly resolved: ResolvedFoodItem) {}
  resolveByText(): Promise<Result<ResolvedFoodItem | null>> {
    return Promise.resolve(ok(null));
  }
  resolveByBarcode(): Promise<Result<ResolvedFoodItem | null>> {
    return Promise.resolve(ok(this.resolved));
  }
}

/** Resolver whose barcode lookup finds nothing (clean no-match, Req 7.2). */
class BarcodeNoMatchResolver implements FoodItemResolver {
  resolveByText(): Promise<Result<ResolvedFoodItem | null>> {
    return Promise.resolve(ok(null));
  }
  resolveByBarcode(): Promise<Result<ResolvedFoodItem | null>> {
    return Promise.resolve(ok(null));
  }
}

function fixedRecognizer(outcome: TranscriptionOutcome): SpeechRecognizer {
  return { transcribe: () => outcome };
}

const audio = (durationSeconds: number): VoiceAudioInput => ({
  id: 'audio-1',
  durationSeconds,
});

const voiceContext: VoiceMealContext = {
  mealId: 'meal-voice-1',
  userId: 'user-1',
  loggedAt: '2024-01-01T12:30:00.000Z',
};

// ===========================================================================
// Barcode scan → logged meal entry (Req 7.1, 7.2)
// ===========================================================================

describe('Food input — barcode pipeline (Req 7.1)', () => {
  it('adds the matched product to the meal and recomputes totals', async () => {
    const store = new InMemoryMealStore([makeMeal([makeItem('apple')])]);
    const corrector = new MealCorrector({
      store,
      resolver: new BarcodeMatchResolver(barcodeResolved),
    });

    const result = await corrector.applyCorrection('meal-1', {
      kind: 'addByBarcode',
      barcode: '0123456789012',
    });

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      // The scanned product is appended as a new logged item.
      expect(result.value.meal.items).toHaveLength(2);
      expect(result.value.meal.items[1].foodItem.id).toBe('granola-bar');
      // Totals are the exact sum: apple (200) + granola bar (190) kcal.
      expect(result.value.totals.calories.value).toBeCloseTo(390, 5);
    }
    // Persisted through the store.
    expect(store.getMeal('meal-1')?.items).toHaveLength(2);
  });

  it('leaves the meal and totals unchanged when the barcode matches nothing (Req 7.2)', async () => {
    const store = new InMemoryMealStore([makeMeal([makeItem('apple')])]);
    const corrector = new MealCorrector({
      store,
      resolver: new BarcodeNoMatchResolver(),
    });

    const result = await corrector.applyCorrection('meal-1', {
      kind: 'addByBarcode',
      barcode: '9999999999999',
    });

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.code).toBe(CorrectionErrorCode.NoMatch);
    }
    // Stored meal is untouched (still just the apple).
    expect(store.getMeal('meal-1')?.items).toHaveLength(1);
    expect(store.getMeal('meal-1')?.totals.calories.value).toBeCloseTo(200, 5);
  });
});

// ===========================================================================
// Voice logging → meal entry (Req 7.3, 7.4)
// ===========================================================================

describe('Food input — voice pipeline (Req 7.3)', () => {
  it('transcribes a spoken input into a voice-sourced meal entry', () => {
    const recognizer = fixedRecognizer({
      kind: 'transcribed',
      text: 'grilled chicken salad',
      elapsedSeconds: 3,
    });

    const result = logMealByVoice(audio(20), recognizer, voiceContext);

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.meal.source).toBe('voice');
      expect(result.value.meal.id).toBe('meal-voice-1');
      expect(result.value.transcribedText).toBe('grilled chicken salad');
    }
  });

  it('creates no entry and retains prior state when transcription fails (Req 7.4)', () => {
    const recognizer = fixedRecognizer({ kind: 'failed', reason: 'no speech detected' });

    const result = logMealByVoice(audio(15), recognizer, voiceContext);

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.code).toBe(VoiceErrorCode.TranscriptionFailed);
    }
  });
});
