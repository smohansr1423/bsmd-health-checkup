/**
 * Food-photo → calorie-estimate end-to-end orchestrator (Task 18.1).
 *
 * Wires the design's "Flow 1" across the already-implemented pieces:
 *
 *   Camera_Capture (SubmittableImage)          ← produced upstream, Req 1
 *        │
 *        ▼  (gateway-routed ports)
 *   Food Vision recognize  ──▶ confidence branch (Req 2.3/2.6/2.7)
 *        │
 *        ▼
 *   Food Vision portion    ──▶ volume + error band + scaled flag (Req 3)
 *        │
 *        ▼
 *   Nutrition Lookup       ──▶ macros + confidence ranges + totals (Req 4)
 *        │
 *        ▼
 *   Data Vault (local-first store, Req 27.1)
 *        │
 *        ├──▶ consent-aware sync push (Req 17.2 / 27.4)
 *        └──▶ async insights enqueue (Req 15)
 *
 * The recognition → portion → nutrition analysis is wrapped in a 10s timeout
 * guard: if it exceeds the budget the analysis is abandoned, the captured input
 * is retained, and a retryable timeout outcome is returned — with *no* partial
 * meal stored (Req 21.6).
 *
 * This orchestrator reimplements none of the recognition/portion/nutrition
 * logic; it composes those services through injectable ports (see `./types`).
 *
 * Requirements: 1.1, 2.6, 3.1, 4.1, 21.6, 27.1
 */

import type { ErrorContract, Result } from '@calorie-cortisol/shared/result';
import {
  err,
  ok,
  timeoutOutcome,
  validationRejection,
} from '@calorie-cortisol/shared/result';
import type { FoodItem, Meal } from '@calorie-cortisol/shared';

import type { DataVault } from '../data-vault';
import type { VaultRecord } from '../data-vault';

import {
  ANALYSIS_TIMEOUT_MS,
  DEFAULT_MEAL_CONSENT_CATEGORY,
  FoodFlowErrorCode,
  type ConsentAwareSync,
  type ConsentCategory,
  type ConsentGate,
  type FoodFlowOutcome,
  type FoodFlowRequest,
  type InsightsQueue,
  type NutritionResponse,
  type NutritionService,
  type PortionService,
  type RecognitionService,
  type TimeoutScheduler,
} from './types';

/** Collaborators the {@link FoodCalorieFlow} composes. */
export interface FoodCalorieFlowDeps {
  /** Gateway-routed Food Vision recognition (Req 2). */
  recognition: RecognitionService;
  /** Gateway-routed Food Vision portion estimation (Req 3). */
  portion: PortionService;
  /** Gateway-routed Nutrition Lookup (Req 4). */
  nutrition: NutritionService;
  /** Local-first encrypted record store (Req 27.1). */
  vault: DataVault;
  /** Master consent gate consulted before any egress (Req 17.2). */
  consent: ConsentGate;
  /** Consent-aware cloud sync engine (task 14.16 seam). */
  sync: ConsentAwareSync;
  /** Async correlation/insights enqueue (Req 15). */
  insights: InsightsQueue;
  /** Timer backing the 10s analysis guard (Req 21.6). */
  scheduler: TimeoutScheduler;
  /** Override the analysis timeout budget (defaults to 10s). */
  timeoutMs?: number;
  /** Consent category gating meal sync (defaults to `meal`). */
  consentCategory?: ConsentCategory;
}

/** Internal discriminated outcome of the timed analysis stage. */
type AnalysisResult =
  | { kind: 'nutrition'; items: FoodItem[]; response: NutritionResponse }
  | { kind: 'needsConfirmation'; candidates: FoodItem[][] }
  | { kind: 'noFood' }
  | { kind: 'error'; error: ErrorContract };

/** Sentinel resolved by the timeout guard when the budget is exceeded. */
const TIMED_OUT = Symbol('food-flow/timed-out');

/**
 * The default, production timeout scheduler backed by `setTimeout`. The pending
 * timer is unref'd where supported so a scheduled guard never keeps a process
 * alive on its own.
 */
export class RealTimeoutScheduler implements TimeoutScheduler {
  schedule(ms: number, onTimeout: () => void): () => void {
    const handle = setTimeout(onTimeout, ms);
    // `unref` exists in Node; guard for DOM/other environments.
    (handle as unknown as { unref?: () => void }).unref?.();
    return () => clearTimeout(handle);
  }
}

/**
 * Orchestrates the food-photo → calorie-estimate flow end to end.
 */
export class FoodCalorieFlow {
  private readonly timeoutMs: number;

  private readonly consentCategory: ConsentCategory;

  constructor(private readonly deps: FoodCalorieFlowDeps) {
    this.timeoutMs = deps.timeoutMs ?? ANALYSIS_TIMEOUT_MS;
    this.consentCategory = deps.consentCategory ?? DEFAULT_MEAL_CONSENT_CATEGORY;
  }

  /**
   * Run the full flow for a captured image set.
   *
   * On the happy path this returns an `estimated` outcome carrying the stored
   * {@link Meal}, its Data Vault record, and whether it was synced / enqueued.
   * Recognition branches (`needsConfirmation`, `noFoodRecognized`) return
   * successfully with the captured input retained and no meal stored. Failures
   * (empty input, downstream error, timeout, storage failure) return an `err`
   * whose {@link ErrorContract.retainedState} is true so the client keeps the
   * input available for retry.
   */
  async run(request: FoodFlowRequest): Promise<Result<FoodFlowOutcome>> {
    if (request.images.length === 0) {
      return err(
        validationRejection(
          FoodFlowErrorCode.NoImages,
          'No captured image was provided to analyze.',
        ),
      );
    }

    // --- Timed analysis stage (recognize → portion → nutrition) -----------
    const analysisPromise = this.analyze(request);
    // Avoid an unhandled rejection if a port rejects rather than resolving; the
    // analyze() pipeline itself always resolves, this is purely defensive.
    analysisPromise.catch(() => undefined);

    let cancelTimer: () => void = () => undefined;
    const timeoutPromise = new Promise<typeof TIMED_OUT>((resolve) => {
      cancelTimer = this.deps.scheduler.schedule(this.timeoutMs, () =>
        resolve(TIMED_OUT),
      );
    });

    const raced = await Promise.race([analysisPromise, timeoutPromise]);
    cancelTimer();

    if (raced === TIMED_OUT) {
      // Cancel/abandon the in-flight analysis, retain the input, offer retry.
      // No partial meal is stored (Req 21.6).
      return err(
        timeoutOutcome(
          FoodFlowErrorCode.AnalysisTimedOut,
          `Food analysis exceeded the ${this.timeoutMs}ms guard; the captured input was retained for retry.`,
        ),
      );
    }

    const analysis = raced as AnalysisResult;

    switch (analysis.kind) {
      case 'error':
        // Propagate the downstream service's structured error unchanged.
        return err(analysis.error);
      case 'noFood':
        return ok({
          kind: 'noFoodRecognized',
          retainedInput: request.images,
        });
      case 'needsConfirmation':
        return ok({
          kind: 'needsConfirmation',
          candidates: analysis.candidates,
          retainedInput: request.images,
        });
      case 'nutrition':
        return this.persistAndDistribute(request, analysis.response);
      default: {
        // Exhaustiveness guard.
        const _never: never = analysis;
        return _never;
      }
    }
  }

  /**
   * The network-bound analysis pipeline guarded by the 10s timeout: recognition
   * → (confidence branch) → portion → nutrition. Always resolves to an
   * {@link AnalysisResult}; downstream failures are captured as `error`.
   */
  private async analyze(request: FoodFlowRequest): Promise<AnalysisResult> {
    const recognition = await this.deps.recognition.recognize({
      userId: request.userId,
      images: request.images,
    });
    if (!recognition.ok) {
      return { kind: 'error', error: recognition.error };
    }
    if (recognition.value.status === 'noFood') {
      return { kind: 'noFood' };
    }
    if (recognition.value.status === 'needsConfirmation') {
      return {
        kind: 'needsConfirmation',
        candidates: recognition.value.candidates,
      };
    }

    const items = recognition.value.items;

    const portion = await this.deps.portion.portion({
      userId: request.userId,
      images: request.images,
      items,
    });
    if (!portion.ok) {
      return { kind: 'error', error: portion.error };
    }

    const nutrition = await this.deps.nutrition.nutrition({
      userId: request.userId,
      items: items.map((foodItem, i) => ({
        foodItem,
        portion: portion.value[i],
      })),
    });
    if (!nutrition.ok) {
      return { kind: 'error', error: nutrition.error };
    }

    return { kind: 'nutrition', items, response: nutrition.value };
  }

  /**
   * Assemble the estimated {@link Meal}, store it in the local Data Vault, then
   * (consent permitting) push it to cloud sync and enqueue the async insights
   * job.
   */
  private async persistAndDistribute(
    request: FoodFlowRequest,
    response: NutritionResponse,
  ): Promise<Result<FoodFlowOutcome>> {
    const meal: Meal = {
      id: request.mealId,
      userId: request.userId,
      loggedAt: request.loggedAt,
      items: response.items,
      totals: response.totals,
      source: request.source ?? 'photo',
      syncStatus: 'local',
    };

    // Local-first: store before any egress (Req 27.1).
    const stored = this.deps.vault.put<Meal>({
      id: meal.id,
      userId: meal.userId,
      kind: 'meal',
      payload: meal,
      syncStatus: 'local',
    });
    if (!stored.ok) {
      // Data Vault errors already match the ErrorContract shape.
      return err({
        code: stored.error.code,
        message: stored.error.message,
        retryable: stored.error.retryable,
        retainedState: stored.error.retainedState,
      });
    }

    let record: VaultRecord<Meal> = stored.value;

    // Consent-aware sync (Req 17.2 / 27.4): only egress consent-permitted
    // records; otherwise the meal stays local-only.
    let synced = false;
    if (this.deps.consent.isGranted(request.userId, this.consentCategory)) {
      const pending = this.deps.vault.setSyncStatus<Meal>(meal.id, 'pending');
      if (pending.ok) {
        record = pending.value;
      }
      const pushed = await this.deps.sync.push(record);
      if (pushed.ok) {
        const done = this.deps.vault.setSyncStatus<Meal>(meal.id, 'synced');
        if (done.ok) {
          record = done.value;
        }
        synced = true;
      }
      // On push failure the record stays `pending` and is left for the sync
      // engine's bounded retry (task 14.16); the flow still succeeds locally.
    }

    // Async insights enqueue (Req 15) — best-effort; never fails the flow.
    let insightsEnqueued = false;
    const enqueued = await this.deps.insights.enqueue({
      userId: request.userId,
      mealId: meal.id,
      loggedAt: meal.loggedAt,
    });
    insightsEnqueued = enqueued.ok;

    return ok({
      kind: 'estimated',
      meal: record.payload,
      record,
      synced,
      insightsEnqueued,
    });
  }
}
