/**
 * Lab-result ingestion orchestration for `POST /webhooks/lab-results`
 * (Req 8.4, 8.5, 8.8; design "Cortisol Data Service").
 *
 * Pipeline (framework-agnostic so it is directly unit-testable):
 *   1. Verify the HMAC signature over the raw request body.
 *   2. Parse the JSON envelope.
 *   3. Structurally validate + parse readings (HL7 or JSON), normalizing units.
 *   4. Enforce the 72-hour results window (Req 8.8) when an expected
 *      publication time is known.
 *   5. Contextualize each valid reading against age/sex/time-of-day reference
 *      ranges (Req 8.5) and emit persistable {@link CortisolReading}s.
 *
 * Outcomes map to the shared `LabResultsIngestStatus`:
 *   - `accepted`         → ≥1 structurally-valid reading ingested.
 *   - `results-pending`  → no usable results / structural failure / 72h timeout;
 *                          the order is retained and flagged (Req 8.8).
 *   - `rejected`         → signature or JSON-parse failure (nothing trusted).
 */

import { randomUUID } from 'node:crypto';
import type {
  CortisolReading,
  LabResultsWebhookRequest,
  LabResultsWebhookResponse,
  Sex,
  TimeOfDayBucket,
} from '@calorie-cortisol/shared';
import { verifyHmacSignature } from './hmac';
import { parseLabResultsPayload, type NormalizedLabReading } from './parse';
import {
  contextualizeReading,
  type UserDemographics,
} from './reference-ranges';
import { deriveTimeOfDayBucket, localMinutesOfDay } from './diurnal-windows';
import { LabIngestErrorCode } from './errors';

/** The results-pending timeout window in hours (Req 8.8). */
export const RESULTS_TIMEOUT_HOURS = 72;

/**
 * Whether the expected results have timed out — i.e. `now` is more than 72
 * hours after the expected publication time (Req 8.8).
 */
export function isResultsTimedOut(expectedPublicationAt: Date, now: Date): boolean {
  const deadline = expectedPublicationAt.getTime() + RESULTS_TIMEOUT_HOURS * 3_600_000;
  return now.getTime() > deadline;
}

/** Injected dependencies for the ingestion handler. */
export interface LabIngestionDeps {
  /** Shared secret used to verify the partner's HMAC signature. */
  readonly webhookSecret: string;
  /** Resolve the ordering user's demographics for contextualization (Req 8.5). */
  readonly resolveUser: (orderId: string) => { userId: string } & UserDemographics;
  /** Current time (injectable for tests). Defaults to `new Date()`. */
  readonly now?: () => Date;
  /** UTC offset (minutes) used to derive local time-of-day. Defaults to 0. */
  readonly utcOffsetMinutes?: number;
  /**
   * Expected publication time for an order, when known. Enables the 72-hour
   * results-pending timeout (Req 8.8).
   */
  readonly expectedPublicationAt?: (orderId: string) => Date | undefined;
  /** Optional sink for the contextualized readings (e.g. TimescaleDB writer). */
  readonly persistReadings?: (readings: CortisolReading[]) => void;
}

/** The result returned by {@link handleLabResultsWebhook}. */
export interface LabWebhookOutcome {
  /** Suggested HTTP status: 200 accepted, 202 results-pending, 400/401 rejected. */
  statusCode: number;
  body: LabResultsWebhookResponse;
  /** Contextualized readings produced on an `accepted` outcome. */
  readings: CortisolReading[];
}

function rejected(orderId: string, reason: string, statusCode: number): LabWebhookOutcome {
  return {
    statusCode,
    body: { status: 'rejected', orderId, acceptedCount: 0, rejectedCount: 0, reason },
    readings: [],
  };
}

function resultsPending(
  orderId: string,
  reason: string,
  rejectedCount: number,
): LabWebhookOutcome {
  return {
    statusCode: 202,
    body: {
      status: 'results-pending',
      orderId,
      acceptedCount: 0,
      rejectedCount,
      reason,
    },
    readings: [],
  };
}

/** Resolve the bucket for a reading: reported bucket, else derived from local time. */
function resolveBucket(
  reading: NormalizedLabReading,
  utcOffsetMinutes: number,
): TimeOfDayBucket {
  if (reading.timeOfDayBucket) return reading.timeOfDayBucket;
  const localMin = localMinutesOfDay(reading.collectedAt, utcOffsetMinutes);
  return localMin === null ? 'morning' : deriveTimeOfDayBucket(localMin);
}

/**
 * Handle a raw lab-results webhook request. `rawBody` is the exact bytes the
 * signature was computed over; `signature` is the partner-supplied HMAC header.
 */
export function handleLabResultsWebhook(
  rawBody: string,
  signature: string | undefined,
  deps: LabIngestionDeps,
): LabWebhookOutcome {
  const now = (deps.now ?? (() => new Date()))();
  const utcOffsetMinutes = deps.utcOffsetMinutes ?? 0;

  // 1. HMAC verification — nothing in the body is trusted until this passes.
  if (!verifyHmacSignature(rawBody, signature, deps.webhookSecret)) {
    return rejected('unknown', LabIngestErrorCode.SIGNATURE_INVALID, 401);
  }

  // 2. Parse the JSON envelope.
  let request: LabResultsWebhookRequest;
  try {
    request = JSON.parse(rawBody) as LabResultsWebhookRequest;
  } catch {
    return rejected('unknown', LabIngestErrorCode.PAYLOAD_UNPARSEABLE, 400);
  }
  const orderId = typeof request?.orderId === 'string' ? request.orderId : 'unknown';

  // 3. Structural validation + reading parse.
  const parsed = parseLabResultsPayload(request);

  // 4. 72-hour results window (Req 8.8): even a well-formed-but-empty delivery
  //    that arrives past the deadline is retained as results-pending.
  const expectedAt = deps.expectedPublicationAt?.(orderId);
  if (parsed.readings.length === 0) {
    if (expectedAt && isResultsTimedOut(expectedAt, now)) {
      return resultsPending(orderId, LabIngestErrorCode.RESULTS_TIMEOUT, parsed.errors.length);
    }
    return resultsPending(orderId, LabIngestErrorCode.PAYLOAD_INVALID, parsed.errors.length);
  }

  // 5. Contextualize each valid reading (Req 8.5).
  const user = deps.resolveUser(orderId);
  const demographics: UserDemographics = { age: user.age, sex: user.sex as Sex | undefined };

  const readings: CortisolReading[] = parsed.readings.map((r) => {
    const bucket = resolveBucket(r, utcOffsetMinutes);
    const contextualized = contextualizeReading(r.valueNmolL, bucket, demographics);
    return {
      id: randomUUID(),
      userId: user.userId,
      measuredAt: r.collectedAt,
      valueNmolL: r.valueNmolL,
      source: 'lab',
      timeOfDayBucket: bucket,
      valid: true,
      ...(contextualized ? { contextualized } : {}),
    };
  });

  deps.persistReadings?.(readings);

  return {
    statusCode: 200,
    body: {
      status: 'accepted',
      orderId,
      acceptedCount: readings.length,
      rejectedCount: parsed.errors.length,
    },
    readings,
  };
}
