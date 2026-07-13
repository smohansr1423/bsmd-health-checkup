/**
 * Offline mode — on-device inference, "inference pending" status, and the
 * consent-aware sync engine: types and injectable ports (Task 14.16).
 *
 * This module owns the *client* side of the design's "Graceful degradation"
 * pillar (design principle 3): core capture/inference works with no
 * connectivity, records are stored local-first in the {@link DataVault}, and on
 * reconnect exactly the consent-permitted records are pushed to the cloud with
 * bounded retries and deterministic conflict handling.
 *
 * It reimplements none of the storage or crypto logic — it composes the Data
 * Vault (task 2.4) — and it consults consent state (task 4.4) purely as data
 * (`ConsentState`). Everything that crosses a boundary (on-device inference, the
 * 10 s guard timer, the cloud transport, the wall clock) is an injectable port,
 * so the same logic runs identically on iOS, Android, and the PWA and can be
 * exercised end to end with in-memory fakes.
 *
 * Requirements: 27.1, 27.2, 27.3, 27.4, 27.5, 27.6, 17.2
 */

import type { ConsentState, FoodItem } from '@calorie-cortisol/shared';
import type { Result } from '@calorie-cortisol/shared/result';

import type { VaultRecord, VaultRecordKind } from '../data-vault';
// Reuse the generic 10s-guard timer port already defined for the food-calorie
// flow rather than duplicating it, so both guards behave identically.
import type { TimeoutScheduler } from '../food-flow';

// Re-export so consumers can refer to the consent snapshot the sync engine
// takes without a second import.
export type { ConsentState };
// Re-export the shared timer port so offline callers have a single import site.
export type { TimeoutScheduler };

// ---------------------------------------------------------------------------
// Budgets / bounds (Req 27.1, 27.2, 27.4, 27.5)
// ---------------------------------------------------------------------------

/**
 * On-device inference budget, in milliseconds. Inference must produce a result
 * within this window; otherwise the capture is stored with an
 * "inference pending" status (Req 27.1, 27.2).
 */
export const INFERENCE_TIMEOUT_MS = 10_000;

/**
 * Deadline, in milliseconds, for synchronizing all locally stored unsynced
 * records after connectivity is restored (Req 27.4). The reconnect pass reports
 * whether it completed within this budget.
 */
export const RECONNECT_SYNC_DEADLINE_MS = 60_000;

/**
 * Maximum number of retry attempts for a single record during a reconnect sync
 * before it is retained unsynced (Req 27.5 / 17.5). Aligned with the shared
 * `CONSENT_SYNC_SCHEDULE` (3 retries).
 */
export const MAX_SYNC_RETRIES = 3;

/** Default record kind / consent category for an offline photo capture. */
export const DEFAULT_CAPTURE_KIND: VaultRecordKind = 'photo';

// ---------------------------------------------------------------------------
// On-device inference (Req 27.1, 27.2)
// ---------------------------------------------------------------------------

/**
 * A reference to a captured photo. The vault stores the (encrypted) reference;
 * the concrete media bytes live in the platform's media store. `byteLength` is
 * optional metadata; the 50 MB free-space gate is enforced by the Data Vault
 * against reported free storage, not this field.
 */
export interface CapturedImage {
  /** Opaque, platform-specific handle / URI for the captured media. */
  ref: string;
  /** Optional captured-media size in bytes (metadata only). */
  byteLength?: number;
}

/** The on-device inference output for a captured photo. */
export interface DetectionResult {
  /** Recognized food items (may be empty if nothing was detected). */
  items: FoodItem[];
}

/**
 * Whether on-device inference has produced a result for a stored capture.
 * `pending` records are re-analyzed later (Req 27.2).
 */
export type InferenceStatus = 'complete' | 'pending';

/**
 * The payload stored in the Data Vault for an offline capture. Carries the
 * image reference, the inference status, and — once inference completes — the
 * detection result.
 */
export interface OfflineCaptureRecord {
  image: CapturedImage;
  /** `complete` when inference produced a result in time; else `pending`. */
  inferenceStatus: InferenceStatus;
  /** Present only when {@link inferenceStatus} is `complete`. */
  detection?: DetectionResult;
}

/**
 * On-device inference port. Runs entirely offline. Returns a structured result
 * so a hard inference failure is a first-class degraded outcome rather than a
 * throw. Failing to resolve within {@link INFERENCE_TIMEOUT_MS} (or resolving
 * with a failure) both drive the "inference pending" branch (Req 27.2).
 */
export interface OnDeviceInference {
  infer(image: CapturedImage): Promise<Result<DetectionResult>>;
}

/**
 * The 10 s inference guard uses the shared {@link TimeoutScheduler} port
 * (re-exported above from the food-calorie flow). Production uses the food
 * flow's `RealTimeoutScheduler` (setTimeout); tests inject a fake so the guard
 * fires deterministically without real time passing.
 */

/** Input to a single offline capture → inference run (Req 27.1). */
export interface InferLocalRequest {
  /** Stable id to store the resulting capture record under. */
  recordId: string;
  userId: string;
  /** The captured photo to analyze and store. */
  image: CapturedImage;
  /** Record category / consent category; defaults to {@link DEFAULT_CAPTURE_KIND}. */
  kind?: VaultRecordKind;
  /** ISO timestamp the photo was captured (defaults to the injected clock). */
  capturedAt?: string;
}

/**
 * The successful outcomes of {@link OfflineCapture.inferLocal}.
 *
 *  - `inferred` — inference produced a result within the 10 s budget; the
 *    record is stored `complete` with its detection (Req 27.1).
 *  - `pending`  — inference did not produce a result in time (timeout or a hard
 *    failure); the photo is stored `inference pending` for later analysis
 *    (Req 27.2).
 *
 * A rejected capture (insufficient local storage, Req 27.3) is *not* one of
 * these — it is returned as an `err` with the input retained and previously
 * stored records left unchanged.
 */
export type InferLocalOutcome =
  | {
      kind: 'inferred';
      record: VaultRecord<OfflineCaptureRecord>;
      detection: DetectionResult;
    }
  | { kind: 'pending'; record: VaultRecord<OfflineCaptureRecord> };

// ---------------------------------------------------------------------------
// Consent-aware sync engine (Req 27.4, 27.5, 27.6, 17.2)
// ---------------------------------------------------------------------------

/**
 * Deterministic conflict-resolution strategy defined in the user's sync
 * settings (Req 27.6). Whichever strategy is configured, *both* versions are
 * always retained; the strategy only decides which version is treated as
 * current.
 *
 *  - `local-wins`  — the locally stored version is current.
 *  - `remote-wins` — the server version is current.
 *  - `latest-wins` — the version with the later `updatedAt` is current; ties
 *    resolve to the local version (deterministic).
 */
export type ConflictResolution = 'local-wins' | 'remote-wins' | 'latest-wins';

/** The user's sync settings consulted by the engine. */
export interface SyncSettings {
  /** Deterministic conflict resolution to apply on a conflict (Req 27.6). */
  conflictResolution: ConflictResolution;
  /**
   * Map a record kind to the consent category that gates its sync. Defaults to
   * the identity (the record kind *is* the consent category), matching the food
   * flow's `DEFAULT_MEAL_CONSENT_CATEGORY` convention.
   */
  categoryForKind?: (kind: VaultRecordKind) => string;
}

/**
 * The result of a single transport push attempt.
 *
 *  - `synced`   — the server accepted the record.
 *  - `conflict` — the server holds a divergent version of the same item; both
 *    are retained and the settings-defined resolution is applied (Req 27.6).
 *  - `failed`   — the push failed; `retryable` indicates whether another attempt
 *    may succeed (drives the bounded retry, Req 27.5).
 */
export type SyncTransportOutcome<T = unknown> =
  | { kind: 'synced' }
  | { kind: 'conflict'; serverRecord: VaultRecord<T> }
  | { kind: 'failed'; retryable: boolean };

/** Cloud transport port (client → gateway). Consent is enforced before this. */
export interface SyncTransport {
  push<T>(record: VaultRecord<T>): Promise<SyncTransportOutcome<T>>;
}

/** Details of a resolved sync conflict (Req 27.6). Both versions are retained. */
export interface ConflictOutcome {
  /** The item whose local/server versions conflicted. */
  recordId: string;
  /** The resolution strategy that was applied. */
  resolution: ConflictResolution;
  /** Which retained version is treated as current. */
  winner: 'local' | 'remote';
  /** Vault id of the retained local version (marked `conflict`). */
  localRecordId: string;
  /** Vault id of the retained server version. */
  remoteRecordId: string;
}

/**
 * A summary of one reconnect sync pass (Req 27.4–27.6, 17.2).
 *
 * `synced`/`blocked`/`unsynced`/`conflicts` partition the input records by
 * outcome; a client surfaces the appropriate indication for each group (synced,
 * "consent required", "not yet synced", "conflict occurred").
 */
export interface SyncPushReport {
  /** Ids successfully synchronized (Req 27.4). */
  synced: string[];
  /** Ids not transmitted because consent was not granted (Req 17.2 / 27.6). */
  blocked: string[];
  /** Ids retained unsynced after retries were exhausted (Req 27.5). */
  unsynced: string[];
  /** Conflicts detected and deterministically resolved (Req 27.6). */
  conflicts: ConflictOutcome[];
  /** Wall-clock duration of the pass, in milliseconds. */
  elapsedMs: number;
  /** Whether the pass completed within the 60 s reconnect deadline (Req 27.4). */
  withinDeadline: boolean;
}
