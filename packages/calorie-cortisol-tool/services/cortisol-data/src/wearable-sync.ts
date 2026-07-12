/**
 * Wearable / patch sync with per-reading validation (Task 9.7).
 *
 * Implements the `POST /wearable/sync` import pipeline for the
 * Wearable_Integration component (Req 9.2, 9.3, 9.4, 9.5, 9.8):
 *
 *   1. Authorization scoping — only data categories the user has explicitly
 *      authorized are imported; unauthorized categories are excluded and the
 *      caller is notified which ones are unavailable, while previously imported
 *      data is retained (Req 9.2).
 *   2. Per-reading validation — each reading is accepted only if its value is
 *      within [0.01, 100.00] in the reported unit AND it carries a valid
 *      capture/measurement timestamp. An out-of-range or timestamp-less reading
 *      is rejected and recorded as invalid (excluded from proxy calculations)
 *      without discarding the valid readings from the same batch (Req 9.4).
 *   3. Source tagging — every accepted reading is tagged with a source
 *      identifier (patch id for a sweat/interstitial patch, or the device type
 *      for WHOOP/Oura/Garmin) and its capture timestamp (Req 9.3, 9.5).
 *   4. Reauthorization / inactive handling — if the connection has been revoked
 *      or is inactive, synchronization is stopped for that source, the
 *      connection is reported inactive, previously imported data is retained,
 *      and a reauthorization-required notification is surfaced (Req 9.8).
 *
 * The logic is pure and dependency-free (no DB / network) so it is directly
 * unit- and property-testable; persistence into the `wearable_proxy_series`
 * hypertable is performed by the route layer using this module's output.
 *
 * NOTE: The `[0.01, 100]` value bounds and the `{ code, message, retryable,
 * retainedState }` error shape mirror the shared `@calorie-cortisol/shared`
 * contract (READING_VALUE_MIN/MAX, ErrorContract). They are re-declared locally
 * because the shared package is not linked into this service's test module
 * graph; the values are the single source of truth for Req 9.4 either way.
 *
 * Requirements: 9.2, 9.3, 9.4, 9.5, 9.8
 */

// ---------------------------------------------------------------------------
// Contract constants (mirror @calorie-cortisol/shared READING_VALUE_MIN/MAX)
// ---------------------------------------------------------------------------

/** Wearable/patch reading value bounds in the reported unit, inclusive (Req 9.4). */
export const READING_VALUE_MIN = 0.01;
export const READING_VALUE_MAX = 100.0;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Supported wearable/patch source types (Req 9.3, 9.5). */
export type WearableSourceType = 'patch' | 'whoop' | 'oura' | 'garmin';

/**
 * Authorization/liveness state of a connected source.
 * - `active`   — connected and authorized; import proceeds.
 * - `inactive` — previously marked inactive; import is skipped (Req 9.8).
 * - `revoked`  — platform/device revoked authorization; sync stops and the
 *                connection is marked inactive (Req 9.8).
 */
export type ConnectionStatus = 'active' | 'inactive' | 'revoked';

/** A raw reading as received from a wearable platform or patch, pre-validation. */
export interface RawWearableReading {
  /** Data category the reading belongs to (e.g. 'cortisol', 'hrv', 'sleep'). */
  readonly category: string;
  /** Proxy metric name (e.g. 'patchCortisol', 'hrv', 'restingHr'). */
  readonly metricType: string;
  /** Raw value in the source-reported unit. */
  readonly value: number;
  /** Unit as reported by the source. */
  readonly unit: string;
  /**
   * Capture / measurement timestamp (ISO 8601). May be missing or malformed;
   * such readings are rejected as invalid (Req 9.4).
   */
  readonly capturedAt?: string | null;
  /** Source patch/device identifier (Req 9.3). */
  readonly sourceId?: string | null;
}

/** A sync request for a single connected source. */
export interface WearableSyncRequest {
  readonly userId: string;
  readonly sourceType: WearableSourceType;
  /** Current authorization/liveness state of the connection (Req 9.8). */
  readonly connectionStatus: ConnectionStatus;
  /** Data categories the user has explicitly authorized for import (Req 9.2). */
  readonly authorizedCategories: readonly string[];
  /** The batch of raw readings to import. */
  readonly readings: readonly RawWearableReading[];
}

/** An accepted reading, tagged with source + capture timestamp (Req 9.3, 9.5). */
export interface AcceptedReading {
  readonly userId: string;
  readonly category: string;
  readonly metricType: string;
  readonly value: number;
  readonly unit: string;
  /** Guaranteed present for accepted readings (Req 9.3/9.5). */
  readonly capturedAt: string;
  /** Source identifier: patch id when present, else the source/device type. */
  readonly sourceId: string;
  /** Device type tag (Req 9.5). */
  readonly deviceType: WearableSourceType;
  readonly valid: true;
}

/** Reason a reading was rejected during per-reading validation (Req 9.4). */
export type InvalidReadingReason = 'value_out_of_range' | 'missing_timestamp';

/** A rejected reading, recorded (not discarded) as invalid (Req 9.4). */
export interface InvalidReading {
  readonly reading: RawWearableReading;
  readonly reason: InvalidReadingReason;
  readonly valid: false;
}

/** Notification kinds surfaced by the sync pipeline. */
export type SyncNotificationKind =
  | 'reauthorization_required'
  | 'categories_unavailable';

/** A notification surfaced to the user as a first-class sync outcome. */
export interface SyncNotification {
  readonly kind: SyncNotificationKind;
  readonly message: string;
  /** Affected categories, for the categories-unavailable notification (Req 9.2). */
  readonly categories?: readonly string[];
}

/** Structured outcome of a wearable/patch sync (mirrors the shared result contract). */
export interface WearableSyncResult {
  /** `synced` when the connection was active; `inactive` when sync was stopped. */
  readonly status: 'synced' | 'inactive';
  /** Whether the connection remains active after this sync (Req 9.8). */
  readonly connectionActive: boolean;
  /** Readings accepted and tagged for persistence / proxy calculation. */
  readonly accepted: readonly AcceptedReading[];
  /** Readings rejected and recorded as invalid (Req 9.4). */
  readonly invalid: readonly InvalidReading[];
  /** Distinct unauthorized categories present in the batch (Req 9.2). */
  readonly excludedCategories: readonly string[];
  /** Count of readings excluded due to missing authorization (Req 9.2). */
  readonly excludedReadingCount: number;
  /** Notifications to surface (reauthorization, categories-unavailable). */
  readonly notifications: readonly SyncNotification[];
  /** Previously imported data is always retained across every branch. */
  readonly retainedPriorData: true;
}

// ---------------------------------------------------------------------------
// Pure validation helpers
// ---------------------------------------------------------------------------

const isFiniteNumber = (n: unknown): n is number =>
  typeof n === 'number' && Number.isFinite(n);

/** A reading value lies within the inclusive [0.01, 100] range (Req 9.4). */
export function isValidReadingValue(value: number): boolean {
  return (
    isFiniteNumber(value) &&
    value >= READING_VALUE_MIN &&
    value <= READING_VALUE_MAX
  );
}

/**
 * A reading carries a usable capture/measurement timestamp: a non-empty ISO
 * string that parses to a real calendar instant (Req 9.4).
 */
export function hasValidTimestamp(capturedAt: string | null | undefined): capturedAt is string {
  if (typeof capturedAt !== 'string' || capturedAt.trim().length === 0) {
    return false;
  }
  const parsed = Date.parse(capturedAt);
  return Number.isFinite(parsed);
}

/**
 * Validate a single reading against the per-reading rule (Req 9.4):
 * accepted iff value ∈ [0.01, 100] AND it has a valid timestamp. A
 * timestamp-less reading is reported `missing_timestamp` (checked first so a
 * reading that is both out-of-range and timestamp-less is still surfaced with a
 * deterministic reason), otherwise an out-of-range value is `value_out_of_range`.
 */
export function validateReading(
  reading: RawWearableReading,
): { valid: true } | { valid: false; reason: InvalidReadingReason } {
  if (!hasValidTimestamp(reading.capturedAt)) {
    return { valid: false, reason: 'missing_timestamp' };
  }
  if (!isValidReadingValue(reading.value)) {
    return { valid: false, reason: 'value_out_of_range' };
  }
  return { valid: true };
}

/** Whether a category was explicitly authorized by the user (Req 9.2). */
export function isCategoryAuthorized(
  category: string,
  authorizedCategories: readonly string[],
): boolean {
  return authorizedCategories.includes(category);
}

/**
 * Tag an accepted reading with its source identifier and device type (Req 9.3,
 * 9.5). The source identifier is the reading's own patch/device id when present
 * (Req 9.3), falling back to the connection's source type so an accepted
 * reading always carries a non-empty source tag.
 */
function tagAccepted(
  userId: string,
  sourceType: WearableSourceType,
  reading: RawWearableReading,
  capturedAt: string,
): AcceptedReading {
  const sourceId =
    typeof reading.sourceId === 'string' && reading.sourceId.trim().length > 0
      ? reading.sourceId
      : sourceType;
  return {
    userId,
    category: reading.category,
    metricType: reading.metricType,
    value: reading.value,
    unit: reading.unit,
    capturedAt,
    sourceId,
    deviceType: sourceType,
    valid: true,
  };
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

/**
 * Import a batch of wearable/patch readings for a single connected source.
 *
 * Behavior:
 * - Revoked or inactive connection → sync stops, connection reported inactive,
 *   nothing imported, prior data retained, reauthorization notification (Req 9.8).
 * - Active connection → readings in unauthorized categories are excluded (Req
 *   9.2); readings in authorized categories are validated per-reading, accepted
 *   ones tagged with source + timestamp (Req 9.3/9.5), rejected ones recorded
 *   as invalid without discarding the valid ones (Req 9.4).
 */
export function syncWearable(request: WearableSyncRequest): WearableSyncResult {
  const { userId, sourceType, connectionStatus, authorizedCategories, readings } =
    request;

  // Req 9.8: revoked/inactive connection → stop sync, mark inactive, retain
  // prior data, prompt reauthorization. No readings are imported.
  if (connectionStatus !== 'active') {
    return {
      status: 'inactive',
      connectionActive: false,
      accepted: [],
      invalid: [],
      excludedCategories: [],
      excludedReadingCount: 0,
      notifications: [
        {
          kind: 'reauthorization_required',
          message:
            connectionStatus === 'revoked'
              ? `Authorization for ${sourceType} was revoked. Reauthorization is required to resume syncing.`
              : `The ${sourceType} connection is inactive. Reauthorization is required to resume syncing.`,
        },
      ],
      retainedPriorData: true,
    };
  }

  const accepted: AcceptedReading[] = [];
  const invalid: InvalidReading[] = [];
  const excludedCategories = new Set<string>();
  let excludedReadingCount = 0;

  for (const reading of readings) {
    // Req 9.2: authorization scoping — skip unauthorized categories.
    if (!isCategoryAuthorized(reading.category, authorizedCategories)) {
      excludedCategories.add(reading.category);
      excludedReadingCount += 1;
      continue;
    }

    // Req 9.4: per-reading validation.
    const verdict = validateReading(reading);
    if (verdict.valid) {
      // hasValidTimestamp already narrowed capturedAt to a valid string.
      accepted.push(
        tagAccepted(userId, sourceType, reading, reading.capturedAt as string),
      );
    } else {
      invalid.push({ reading, reason: verdict.reason, valid: false });
    }
  }

  const notifications: SyncNotification[] = [];
  if (excludedCategories.size > 0) {
    const categories = [...excludedCategories];
    notifications.push({
      kind: 'categories_unavailable',
      message: `The following categories are unavailable due to missing authorization: ${categories.join(
        ', ',
      )}.`,
      categories,
    });
  }

  return {
    status: 'synced',
    connectionActive: true,
    accepted,
    invalid,
    excludedCategories: [...excludedCategories],
    excludedReadingCount,
    notifications,
    retainedPriorData: true,
  };
}
