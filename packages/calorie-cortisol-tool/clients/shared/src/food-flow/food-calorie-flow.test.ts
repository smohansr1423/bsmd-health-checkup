/**
 * End-to-end wiring test for the food-photo → calorie-estimate flow (Task 18.1).
 *
 * Exercises the design's "Flow 1" through the {@link FoodCalorieFlow}
 * orchestrator using in-memory fakes for every gateway/service boundary and a
 * real {@link DataVault}:
 *
 *   - happy path: capture → recognize → portion → nutrition → local store →
 *     consent-aware sync → async insights enqueue (Req 1.1, 2.6, 3.1, 4.1, 27.1)
 *   - 10s timeout guard: a hung analysis is abandoned, the input is retained,
 *     and no partial meal is stored (Req 21.6)
 *
 * Requirements: 1.1, 2.6, 3.1, 4.1, 21.6, 27.1
 */

import { ok, err, timeoutOutcome, type Result } from '@calorie-cortisol/shared/result';
import type {
  FoodItem,
  Meal,
  MealItem,
  NutrientValue,
  NutritionTotals,
  PortionEstimate,
} from '@calorie-cortisol/shared';

import { DataVault } from '../data-vault';
import { InMemoryStorageBackend } from '../data-vault';
import type { SubmittableImage } from '../capture';

import {
  FoodCalorieFlow,
  RealTimeoutScheduler,
} from './food-calorie-flow';
import {
  FoodFlowErrorCode,
  type ConsentAwareSync,
  type ConsentGate,
  type InsightsEvent,
  type InsightsQueue,
  type NutritionResponse,
  type NutritionService,
  type PortionService,
  type RecognitionResponse,
  type RecognitionService,
  type TimeoutScheduler,
} from './types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const image: SubmittableImage = {
  sourceId: 'photo-1',
  mode: 'single',
  format: 'jpeg',
  byteSize: 1024,
  enhanced: false,
};

function nutrient(value: number, unit: NutrientValue['unit']): NutrientValue {
  return { value, unit, lower: value * 0.9, upper: value * 1.1, available: true };
}

const apple: FoodItem = { id: 'f1', label: 'apple', confidence: 92 };

const applePortion: PortionEstimate = {
  volumeMl: 180,
  errorPct: 12,
  scaled: true,
  referenceObject: 'plate',
};

const appleMealItem: MealItem = {
  foodItem: apple,
  portionMultiplier: 1,
  nutrition: { calories: nutrient(95, 'kcal') },
};

const totals: NutritionTotals = {
  calories: nutrient(95, 'kcal'),
  protein: nutrient(0.5, 'g'),
  carbs: nutrient(25, 'g'),
  fat: nutrient(0.3, 'g'),
  secondary: { fiber: nutrient(4.4, 'g') },
};

// ---------------------------------------------------------------------------
// Fakes (in-memory service/gateway boundaries)
// ---------------------------------------------------------------------------

class FakeRecognition implements RecognitionService {
  constructor(private readonly response: Result<RecognitionResponse>) {}

  recognize = jest.fn(async (): Promise<Result<RecognitionResponse>> => this.response);
}

class FakePortion implements PortionService {
  constructor(private readonly response: Result<PortionEstimate[]>) {}

  portion = jest.fn(async (): Promise<Result<PortionEstimate[]>> => this.response);
}

class FakeNutrition implements NutritionService {
  constructor(private readonly response: Result<NutritionResponse>) {}

  nutrition = jest.fn(async (): Promise<Result<NutritionResponse>> => this.response);
}

class RecordingSync implements ConsentAwareSync {
  readonly pushed: Meal[] = [];

  constructor(private readonly result: Result<void> = ok(undefined)) {}

  push = jest.fn(async (record: { payload: Meal }): Promise<Result<void>> => {
    this.pushed.push(record.payload);
    return this.result;
  });
}

class RecordingInsights implements InsightsQueue {
  readonly events: InsightsEvent[] = [];

  constructor(private readonly result: Result<void> = ok(undefined)) {}

  enqueue = jest.fn(async (event: InsightsEvent): Promise<Result<void>> => {
    this.events.push(event);
    return this.result;
  });
}

function consentGate(granted: boolean): ConsentGate {
  return { isGranted: () => granted };
}

/** A scheduler whose timer never fires — the analysis always wins the race. */
const neverScheduler: TimeoutScheduler = {
  schedule: () => () => undefined,
};

/** A scheduler that fires its timeout on the next microtask, deterministically. */
const immediateScheduler: TimeoutScheduler = {
  schedule: (_ms, onTimeout) => {
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (!cancelled) onTimeout();
    });
    return () => {
      cancelled = true;
    };
  },
};

const recognizedResponse: Result<RecognitionResponse> = ok({
  status: 'recognized',
  items: [apple],
});

function makeHappyFlow(
  overrides: {
    consent?: boolean;
    sync?: RecordingSync;
    insights?: RecordingInsights;
    scheduler?: TimeoutScheduler;
    backend?: InMemoryStorageBackend;
  } = {},
) {
  const backend = overrides.backend ?? new InMemoryStorageBackend();
  const vault = new DataVault(backend, undefined, {
    now: () => new Date('2024-01-01T12:00:00.000Z'),
  });
  const sync = overrides.sync ?? new RecordingSync();
  const insights = overrides.insights ?? new RecordingInsights();

  const flow = new FoodCalorieFlow({
    recognition: new FakeRecognition(recognizedResponse),
    portion: new FakePortion(ok([applePortion])),
    nutrition: new FakeNutrition(ok({ items: [appleMealItem], totals })),
    vault,
    consent: consentGate(overrides.consent ?? true),
    sync,
    insights,
    scheduler: overrides.scheduler ?? neverScheduler,
  });

  return { flow, vault, backend, sync, insights };
}

const request = {
  userId: 'u1',
  mealId: 'meal-1',
  loggedAt: '2024-01-01T12:00:00.000Z',
  images: [image],
} as const;

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe('FoodCalorieFlow — happy path (end to end)', () => {
  it('captures → recognizes → portions → nutrition → stores → syncs → enqueues', async () => {
    const { flow, vault, sync, insights } = makeHappyFlow();

    const result = await flow.run(request);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.kind).toBe('estimated');
    if (result.value.kind !== 'estimated') return;

    // Meal assembled from the service outputs (no recomputation in the flow).
    expect(result.value.meal.items).toEqual([appleMealItem]);
    expect(result.value.meal.totals).toEqual(totals);
    expect(result.value.meal.source).toBe('photo');

    // Local-first: the meal is durably stored in the Data Vault (Req 27.1).
    const stored = vault.get<Meal>('meal-1');
    expect(stored.ok).toBe(true);

    // Consent-permitted → pushed to cloud sync and marked synced (Req 17.2).
    expect(sync.push).toHaveBeenCalledTimes(1);
    expect(sync.pushed[0].id).toBe('meal-1');
    expect(result.value.synced).toBe(true);
    expect(result.value.record.syncStatus).toBe('synced');

    // Async insights job enqueued (Req 15).
    expect(insights.enqueue).toHaveBeenCalledTimes(1);
    expect(insights.events[0]).toEqual({
      userId: 'u1',
      mealId: 'meal-1',
      loggedAt: '2024-01-01T12:00:00.000Z',
    });
    expect(result.value.insightsEnqueued).toBe(true);
  });

  it('stores locally only and does not sync when consent is not granted (Req 17.2)', async () => {
    const sync = new RecordingSync();
    const { flow, vault, insights } = makeHappyFlow({ consent: false, sync });

    const result = await flow.run(request);

    expect(result.ok).toBe(true);
    if (!result.ok || result.value.kind !== 'estimated') throw new Error('expected estimated');

    // Meal is retained locally...
    expect(vault.get<Meal>('meal-1').ok).toBe(true);
    expect(result.value.record.syncStatus).toBe('local');
    // ...but nothing egressed.
    expect(sync.push).not.toHaveBeenCalled();
    expect(result.value.synced).toBe(false);
    // Insights still enqueued locally.
    expect(insights.enqueue).toHaveBeenCalledTimes(1);
  });

  it('still succeeds locally when the sync push fails (record left pending for retry)', async () => {
    const sync = new RecordingSync(
      err(timeoutOutcome('sync/unreachable', 'cloud unreachable')),
    );
    const { flow, vault } = makeHappyFlow({ sync });

    const result = await flow.run(request);

    expect(result.ok).toBe(true);
    if (!result.ok || result.value.kind !== 'estimated') throw new Error('expected estimated');
    expect(result.value.synced).toBe(false);
    // Meal remains stored, marked pending for the sync engine's bounded retry.
    expect(result.value.record.syncStatus).toBe('pending');
    expect(vault.get<Meal>('meal-1').ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 10s timeout guard
// ---------------------------------------------------------------------------

describe('FoodCalorieFlow — 10s timeout guard (Req 21.6)', () => {
  it('abandons a hung analysis, retains the input, and stores no partial meal', async () => {
    const backend = new InMemoryStorageBackend();
    const vault = new DataVault(backend);
    const sync = new RecordingSync();
    const insights = new RecordingInsights();

    // Recognition never resolves → the timeout guard must win the race.
    const hangingRecognition: RecognitionService = {
      recognize: () => new Promise<Result<RecognitionResponse>>(() => undefined),
    };

    const flow = new FoodCalorieFlow({
      recognition: hangingRecognition,
      portion: new FakePortion(ok([applePortion])),
      nutrition: new FakeNutrition(ok({ items: [appleMealItem], totals })),
      vault,
      consent: consentGate(true),
      sync,
      insights,
      scheduler: immediateScheduler,
      timeoutMs: 10_000,
    });

    const result = await flow.run(request);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe(FoodFlowErrorCode.AnalysisTimedOut);
    // Timeout is retryable and preserves the captured input (Req 21.6).
    expect(result.error.retryable).toBe(true);
    expect(result.error.retainedState).toBe(true);

    // No partial meal stored, nothing synced or enqueued.
    expect(backend.size).toBe(0);
    expect(vault.get<Meal>('meal-1').ok).toBe(false);
    expect(sync.push).not.toHaveBeenCalled();
    expect(insights.enqueue).not.toHaveBeenCalled();
  });

  it('completes normally when analysis finishes before the guard fires', async () => {
    // Real setTimeout-based scheduler with the full 10s budget; the fake
    // services resolve immediately, so analysis wins well within budget.
    const { flow } = makeHappyFlow({ scheduler: new RealTimeoutScheduler() });

    const result = await flow.run(request);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.kind).toBe('estimated');
  });
});

// ---------------------------------------------------------------------------
// Recognition branches & input validation
// ---------------------------------------------------------------------------

describe('FoodCalorieFlow — recognition branches', () => {
  it('surfaces top-3 candidates for confirmation without storing a meal (Req 2.3)', async () => {
    const backend = new InMemoryStorageBackend();
    const vault = new DataVault(backend);
    const flow = new FoodCalorieFlow({
      recognition: new FakeRecognition(
        ok({ status: 'needsConfirmation', candidates: [[apple]] }),
      ),
      portion: new FakePortion(ok([applePortion])),
      nutrition: new FakeNutrition(ok({ items: [appleMealItem], totals })),
      vault,
      consent: consentGate(true),
      sync: new RecordingSync(),
      insights: new RecordingInsights(),
      scheduler: neverScheduler,
    });

    const result = await flow.run(request);

    expect(result.ok).toBe(true);
    if (!result.ok || result.value.kind !== 'needsConfirmation') {
      throw new Error('expected needsConfirmation');
    }
    expect(result.value.candidates).toEqual([[apple]]);
    expect(result.value.retainedInput).toEqual([image]);
    expect(backend.size).toBe(0);
  });

  it('returns "no food recognized" with the input retained (Req 2.6)', async () => {
    const backend = new InMemoryStorageBackend();
    const vault = new DataVault(backend);
    const flow = new FoodCalorieFlow({
      recognition: new FakeRecognition(ok({ status: 'noFood' })),
      portion: new FakePortion(ok([applePortion])),
      nutrition: new FakeNutrition(ok({ items: [appleMealItem], totals })),
      vault,
      consent: consentGate(true),
      sync: new RecordingSync(),
      insights: new RecordingInsights(),
      scheduler: neverScheduler,
    });

    const result = await flow.run(request);

    expect(result.ok).toBe(true);
    if (!result.ok || result.value.kind !== 'noFoodRecognized') {
      throw new Error('expected noFoodRecognized');
    }
    expect(result.value.retainedInput).toEqual([image]);
    expect(backend.size).toBe(0);
  });

  it('rejects an empty image set before any service call', async () => {
    const { flow, sync } = makeHappyFlow();
    const result = await flow.run({ ...request, images: [] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe(FoodFlowErrorCode.NoImages);
    expect(sync.push).not.toHaveBeenCalled();
  });

  it('propagates a downstream recognition error unchanged', async () => {
    const backend = new InMemoryStorageBackend();
    const vault = new DataVault(backend);
    const flow = new FoodCalorieFlow({
      recognition: new FakeRecognition(
        err({ code: 'vision/unavailable', message: 'down', retryable: true, retainedState: true }),
      ),
      portion: new FakePortion(ok([applePortion])),
      nutrition: new FakeNutrition(ok({ items: [appleMealItem], totals })),
      vault,
      consent: consentGate(true),
      sync: new RecordingSync(),
      insights: new RecordingInsights(),
      scheduler: neverScheduler,
    });

    const result = await flow.run(request);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('vision/unavailable');
    expect(backend.size).toBe(0);
  });
});
