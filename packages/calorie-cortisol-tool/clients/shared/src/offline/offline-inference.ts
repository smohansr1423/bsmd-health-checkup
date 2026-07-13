/**
 * Offline on-device inference with a 10 s pending fallback and local-first
 * storage (Task 14.16, design "Graceful degradation").
 *
 * `inferLocal` is the offline counterpart of the online recognition flow: it
 * runs the on-device model against a captured photo and stores the result in
 * the local Data Vault, entirely without connectivity.
 *
 *   - If inference produces a result within {@link INFERENCE_TIMEOUT_MS}, the
 *     capture is stored `complete` with its detection (Req 27.1).
 *   - If inference does not produce a result within the budget — a timeout or a
 *     hard inference failure — the photo is stored with an "inference pending"
 *     status for later re-analysis, and the caller surfaces that analysis will
 *     complete later (Req 27.2).
 *   - If storing the record fails because free local storage is below the 50 MB
 *     minimum, the capture is rejected, previously stored records are left
 *     unchanged, and an insufficient-storage error is returned (Req 27.3). The
 *     Data Vault enforces this precheck; this module simply propagates it.
 *
 * The 10 s guard is implemented by racing the inference promise against an
 * injectable {@link TimeoutScheduler}, mirroring the food-calorie flow's
 * analysis guard so the two behave identically.
 *
 * Requirements: 27.1, 27.2, 27.3
 */

import type { Result } from '@calorie-cortisol/shared/result';
import { err, ok } from '@calorie-cortisol/shared/result';

import type { DataVault, VaultRecord } from '../data-vault';
// The production 10s-guard timer is shared with the food-calorie flow.
import { RealTimeoutScheduler } from '../food-flow';

import {
  DEFAULT_CAPTURE_KIND,
  INFERENCE_TIMEOUT_MS,
  type DetectionResult,
  type InferLocalOutcome,
  type InferLocalRequest,
  type OfflineCaptureRecord,
  type OnDeviceInference,
  type TimeoutScheduler,
} from './types';

// Re-export so offline callers can construct the production scheduler without
// reaching into the food-flow module directly.
export { RealTimeoutScheduler };

/** Sentinel resolved by the guard timer when the inference budget is exceeded. */
const TIMED_OUT = Symbol('offline/inference-timed-out');

/** Collaborators the {@link OfflineCapture} engine composes. */
export interface OfflineCaptureDeps {
  /** On-device inference model (runs offline, Req 27.1). */
  inference: OnDeviceInference;
  /** Local-first encrypted record store (Req 27.1, and the 50 MB gate Req 27.3). */
  vault: DataVault;
  /** Timer backing the 10 s inference guard (Req 27.1/27.2). */
  scheduler: TimeoutScheduler;
  /** Override the inference budget (defaults to 10 s). */
  timeoutMs?: number;
  /** Clock for `createdAt`/`updatedAt`; defaults to `Date.now`. Injectable for tests. */
  now?: () => Date;
}

/**
 * Runs offline capture → on-device inference → local storage with the 10 s
 * pending fallback and 50 MB storage gate.
 */
export class OfflineCapture {
  private readonly timeoutMs: number;

  private readonly now: () => Date;

  constructor(private readonly deps: OfflineCaptureDeps) {
    this.timeoutMs = deps.timeoutMs ?? INFERENCE_TIMEOUT_MS;
    this.now = deps.now ?? (() => new Date());
  }

  /**
   * Capture-time offline inference. Always attempts to store a record locally
   * (either the completed detection or an "inference pending" placeholder),
   * except when the 50 MB storage gate rejects the capture.
   */
  async inferLocal(
    request: InferLocalRequest,
  ): Promise<Result<InferLocalOutcome>> {
    const detection = await this.runGuardedInference(request.image);

    const payload: OfflineCaptureRecord =
      detection === null
        ? { image: request.image, inferenceStatus: 'pending' }
        : { image: request.image, inferenceStatus: 'complete', detection };

    // Local-first store. The Data Vault enforces the 50 MB free-space precheck
    // for a new record: on rejection previously stored records are left
    // unchanged and this capture is not persisted (Req 27.3).
    const stored = this.deps.vault.put<OfflineCaptureRecord>({
      id: request.recordId,
      userId: request.userId,
      kind: request.kind ?? DEFAULT_CAPTURE_KIND,
      payload,
      syncStatus: 'local',
      createdAt: request.capturedAt ?? this.now().toISOString(),
    });

    if (!stored.ok) {
      // The Data Vault error already conforms to the ErrorContract shape
      // (code/message/retryable/retainedState); propagate it unchanged so the
      // client can surface "insufficient local storage" and retain the input.
      return err({
        code: stored.error.code,
        message: stored.error.message,
        retryable: stored.error.retryable,
        retainedState: stored.error.retainedState,
      });
    }

    const record: VaultRecord<OfflineCaptureRecord> = stored.value;

    return ok(
      detection === null
        ? { kind: 'pending', record }
        : { kind: 'inferred', record, detection },
    );
  }

  /**
   * Race on-device inference against the 10 s guard. Resolves to the detection
   * on a timely success, or `null` when the budget is exceeded or inference
   * fails to produce a result (both drive the pending branch, Req 27.2).
   */
  private async runGuardedInference(
    image: InferLocalRequest['image'],
  ): Promise<DetectionResult | null> {
    const inferencePromise = this.deps.inference.infer(image);
    // Defensive: avoid an unhandled rejection if the port rejects rather than
    // resolving with a structured failure.
    inferencePromise.catch(() => undefined);

    let cancelTimer: () => void = () => undefined;
    const timeoutPromise = new Promise<typeof TIMED_OUT>((resolve) => {
      cancelTimer = this.deps.scheduler.schedule(this.timeoutMs, () =>
        resolve(TIMED_OUT),
      );
    });

    let raced: Result<DetectionResult> | typeof TIMED_OUT;
    try {
      raced = await Promise.race([inferencePromise, timeoutPromise]);
    } catch {
      // A rejected inference port is treated the same as a failure to produce.
      cancelTimer();
      return null;
    }
    cancelTimer();

    if (raced === TIMED_OUT || !raced.ok) {
      return null;
    }
    return raced.value;
  }
}
