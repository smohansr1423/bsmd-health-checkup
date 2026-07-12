/**
 * Food-photo → calorie-estimate end-to-end flow — types and injectable ports
 * (Task 18.1, design "Flow 1: Food Photo → Calorie Estimate").
 *
 * This module defines the seams that the {@link FoodCalorieFlow} orchestrator
 * composes. It deliberately owns *no* recognition, portion, or nutrition logic
 * of its own — those live in the Food Vision and Nutrition Lookup services and
 * are reached across the API gateway. Here they are expressed as injectable
 * ports so the flow can be exercised end to end with in-memory fakes and run
 * identically on iOS, Android, and the PWA over a real gateway client.
 *
 * The concrete client capture ({@link SubmittableImage} producer) and the
 * local-first {@link DataVault} are the two *real* collaborators the flow uses;
 * everything that crosses the network boundary (gateway-routed service calls,
 * consent-aware cloud sync, async insights enqueue) is a port.
 *
 * Requirements: 1.1, 2.6, 3.1, 4.1, 21.6, 27.1
 */

import type {
  FoodItem,
  Meal,
  MealItem,
  MealSource,
  NutritionTotals,
  PortionEstimate,
} from '@calorie-cortisol/shared';
import type { Result } from '@calorie-cortisol/shared/result';

import type { SubmittableImage } from '../capture';
import type { VaultRecord } from '../data-vault';

/**
 * Analysis timeout guard, in milliseconds (Req 21.6). If recognition → portion
 * → nutrition does not complete within this budget the in-flight analysis is
 * cancelled, the captured input is retained, and the caller is offered a retry.
 */
export const ANALYSIS_TIMEOUT_MS = 10_000;

/** Consent category gating cloud sync of a logged meal (Req 17.2, 27.4). */
export const DEFAULT_MEAL_CONSENT_CATEGORY = 'meal';

/** Stable, machine-readable error codes surfaced by the food-calorie flow. */
export const FoodFlowErrorCode = {
  /** No submittable image was provided to analyze (Req 1.1). */
  NoImages: 'food-flow/no-images',
  /** Analysis exceeded the 10s guard; input retained for retry (Req 21.6). */
  AnalysisTimedOut: 'food-flow/analysis-timed-out',
  /** The local Data Vault could not store the estimated meal (Req 27.1/27.3). */
  StorageFailed: 'food-flow/storage-failed',
} as const;

export type FoodFlowErrorCode =
  (typeof FoodFlowErrorCode)[keyof typeof FoodFlowErrorCode];

// ---------------------------------------------------------------------------
// Recognition port (client → gateway → Food Vision `POST /recognize`)
// ---------------------------------------------------------------------------

/** Request to recognize the food in one or more captured images (Req 2). */
export interface RecognizeRequest {
  userId: string;
  images: readonly SubmittableImage[];
}

/**
 * The three terminal recognition branches the Food Vision service returns,
 * already resolved by that service's confidence gating (Req 2.3, 2.6, 2.7):
 *
 *   - `recognized`        — every detection is at/above the auto threshold;
 *                           the flow proceeds to portion estimation.
 *   - `needsConfirmation` — at least one detection is below threshold; the
 *                           service offers top-3 candidates per ambiguous item
 *                           and the flow surfaces them for user confirmation
 *                           without producing a meal (Req 2.3).
 *   - `noFood`            — no detection reached the threshold; "no food
 *                           recognized" with the image retained (Req 2.6).
 */
export type RecognitionResponse =
  | { status: 'recognized'; items: FoodItem[] }
  | { status: 'needsConfirmation'; candidates: FoodItem[][] }
  | { status: 'noFood' };

/** Gateway-routed Food Vision recognition seam (Req 2). */
export interface RecognitionService {
  recognize(request: RecognizeRequest): Promise<Result<RecognitionResponse>>;
}

// ---------------------------------------------------------------------------
// Portion port (client → gateway → Food Vision `POST /portion`)
// ---------------------------------------------------------------------------

/** Request to estimate portion/volume for recognized items (Req 3). */
export interface PortionRequest {
  userId: string;
  images: readonly SubmittableImage[];
  items: readonly FoodItem[];
}

/**
 * Gateway-routed Food Vision portion-estimation seam. Returns one
 * {@link PortionEstimate} per requested item, index-aligned with
 * {@link PortionRequest.items} (Req 3.1).
 */
export interface PortionService {
  portion(request: PortionRequest): Promise<Result<PortionEstimate[]>>;
}

// ---------------------------------------------------------------------------
// Nutrition port (client → gateway → Nutrition Lookup `POST /nutrition`)
// ---------------------------------------------------------------------------

/** A recognized item paired with its portion estimate (Req 4). */
export interface NutritionRequestItem {
  foodItem: FoodItem;
  portion: PortionEstimate;
}

/** Request to compute nutrition for the portioned items (Req 4). */
export interface NutritionRequest {
  userId: string;
  items: readonly NutritionRequestItem[];
}

/**
 * Nutrition Lookup response: per-item nutrition (as {@link MealItem}s) plus the
 * aggregated {@link NutritionTotals} for the meal (Req 4.1–4.6). The flow does
 * not recompute totals; it assembles the returned pieces into a {@link Meal}.
 */
export interface NutritionResponse {
  items: MealItem[];
  totals: NutritionTotals;
}

/** Gateway-routed Nutrition Lookup seam (Req 4). */
export interface NutritionService {
  nutrition(request: NutritionRequest): Promise<Result<NutritionResponse>>;
}

// ---------------------------------------------------------------------------
// Consent-aware sync + async insights ports
// ---------------------------------------------------------------------------

/** A consent category the user may opt in/out of (Req 17). */
export type ConsentCategory = string;

/**
 * Master consent gate consulted before any cloud egress (Req 17.2). Returns
 * whether the given user has opted the category in. When false the meal is
 * stored locally only and never leaves the device.
 */
export interface ConsentGate {
  isGranted(userId: string, category: ConsentCategory): boolean;
}

/**
 * Consent-aware sync seam (the sync engine of task 14.16). The flow only calls
 * this after the master consent gate has permitted the category; the engine is
 * responsible for the actual reconnect/retry/conflict handling.
 */
export interface ConsentAwareSync {
  push(record: VaultRecord<Meal>): Promise<Result<void>>;
}

/** An async correlation/insights job enqueued after a meal is logged. */
export interface InsightsEvent {
  userId: string;
  mealId: string;
  loggedAt: string;
}

/**
 * Async insights enqueue seam (Req 15, design "async enqueue for
 * correlation/insights"). Enqueue failures never fail the flow — the meal is
 * already durably stored — so this is best-effort with a reported flag.
 */
export interface InsightsQueue {
  enqueue(event: InsightsEvent): Promise<Result<void>>;
}

// ---------------------------------------------------------------------------
// Timeout scheduler port (deterministic 10s guard)
// ---------------------------------------------------------------------------

/**
 * Injectable timer used to implement the 10s analysis guard (Req 21.6).
 * Production uses {@link RealTimeoutScheduler} (setTimeout); tests inject a fake
 * so the guard fires deterministically without real time passing.
 */
export interface TimeoutScheduler {
  /** Run `onTimeout` after `ms`. Returns a function that cancels the pending timer. */
  schedule(ms: number, onTimeout: () => void): () => void;
}

// ---------------------------------------------------------------------------
// Flow request / outcome
// ---------------------------------------------------------------------------

/** Input to a single food-photo → calorie-estimate run (Req 1.1). */
export interface FoodFlowRequest {
  userId: string;
  /** Stable id to store the resulting meal under in the Data Vault. */
  mealId: string;
  /** ISO timestamp (local + offset) the meal was logged at. */
  loggedAt: string;
  /** Normalized image(s) produced by Camera_Capture (single or multi-angle). */
  images: readonly SubmittableImage[];
  /** Origin of the meal; defaults to `photo`. */
  source?: MealSource;
}

/**
 * The successful outcomes of a flow run. `estimated` is the happy path; the
 * other two are recognition branches that intentionally produce no meal and
 * retain the captured input for a follow-up (confirm candidates / retry).
 */
export type FoodFlowOutcome =
  | {
      kind: 'estimated';
      meal: Meal;
      record: VaultRecord<Meal>;
      /** Whether the meal was pushed to cloud sync (consent-permitted). */
      synced: boolean;
      /** Whether the async insights job was enqueued successfully. */
      insightsEnqueued: boolean;
    }
  | {
      kind: 'needsConfirmation';
      candidates: FoodItem[][];
      retainedInput: readonly SubmittableImage[];
    }
  | { kind: 'noFoodRecognized'; retainedInput: readonly SubmittableImage[] };
