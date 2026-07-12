/**
 * Structural parsing + validation of lab-result payloads (Req 8.4/8.8).
 *
 * Two encodings are accepted (design: "`POST /webhooks/lab-results` — HL7/JSON
 * ingestion"):
 *   - JSON : structured `readings[]` on the {@link LabResultsWebhookRequest}.
 *   - HL7  : a raw v2 message in `rawMessage`; OBX segments carry the results.
 *
 * Both are normalized to {@link NormalizedLabReading} (value converted to
 * nmol/L). A reading that is missing required fields or carries an unrecognized
 * unit is collected as a structural error rather than silently dropped, so the
 * caller can decide the overall ingest outcome (Req 8.8).
 */

import type {
  LabResultReading,
  LabResultsWebhookRequest,
  TimeOfDayBucket,
} from '@calorie-cortisol/shared';
import { toNmolPerL } from './units';

/** A single validated, unit-normalized reading ready for contextualization. */
export interface NormalizedLabReading {
  sampleId: string;
  /** ISO timestamp of collection. */
  collectedAt: string;
  /** Value normalized to nmol/L. */
  valueNmolL: number;
  /** Reported bucket, when the payload provides one. */
  timeOfDayBucket?: TimeOfDayBucket;
}

/** Outcome of parsing a payload: valid normalized readings + rejection reasons. */
export interface ParseResult {
  readings: NormalizedLabReading[];
  /** One human-readable reason per structurally-invalid reading. */
  errors: string[];
}

const VALID_BUCKETS: ReadonlySet<string> = new Set<TimeOfDayBucket>([
  'morning',
  'noon',
  'afternoon',
  'evening',
]);

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

function isValidIso(ts: unknown): ts is string {
  return typeof ts === 'string' && !Number.isNaN(Date.parse(ts));
}

function coerceBucket(v: unknown): TimeOfDayBucket | undefined {
  return typeof v === 'string' && VALID_BUCKETS.has(v)
    ? (v as TimeOfDayBucket)
    : undefined;
}

/** Validate + normalize a single structured JSON reading. */
function normalizeJsonReading(
  reading: LabResultReading,
  index: number,
): { reading?: NormalizedLabReading; error?: string } {
  if (!isNonEmptyString(reading?.sampleId)) {
    return { error: `reading[${index}]: missing sampleId` };
  }
  if (!isValidIso(reading.collectedAt)) {
    return { error: `reading[${index}]: invalid collectedAt` };
  }
  if (typeof reading.value !== 'number' || !Number.isFinite(reading.value) || reading.value <= 0) {
    return { error: `reading[${index}]: non-positive or non-numeric value` };
  }
  if (!isNonEmptyString(reading.unit)) {
    return { error: `reading[${index}]: missing unit` };
  }
  const valueNmolL = toNmolPerL(reading.value, reading.unit);
  if (valueNmolL === null) {
    return { error: `reading[${index}]: unrecognized unit "${reading.unit}"` };
  }
  return {
    reading: {
      sampleId: reading.sampleId,
      collectedAt: new Date(reading.collectedAt).toISOString(),
      valueNmolL,
      timeOfDayBucket: coerceBucket(reading.timeOfDayBucket),
    },
  };
}

/** Parse the structured JSON `readings[]` of a webhook request. */
export function parseJsonReadings(readings: unknown): ParseResult {
  const out: ParseResult = { readings: [], errors: [] };
  if (!Array.isArray(readings) || readings.length === 0) {
    out.errors.push('no readings present in JSON payload');
    return out;
  }
  readings.forEach((raw, i) => {
    const { reading, error } = normalizeJsonReading(raw as LabResultReading, i);
    if (reading) out.readings.push(reading);
    if (error) out.errors.push(error);
  });
  return out;
}

/**
 * Convert an HL7 v2 datetime (`YYYYMMDD[HHMM[SS]]`, optional trailing tz) to an
 * ISO string, or `null` if it cannot be parsed.
 */
export function hl7DateToIso(raw: string): string | null {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?(\d{2})?/.exec(raw.trim());
  if (!m) return null;
  const [, y, mo, d, h = '00', mi = '00', s = '00'] = m;
  const iso = `${y}-${mo}-${d}T${h}:${mi}:${s}Z`;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

/**
 * Minimal HL7 v2 parser: split into segments and extract OBX result segments.
 * For each OBX we read OBX-5 (value), OBX-6 (units), and OBX-14 (observation
 * datetime). The enclosing OBR-3 (filler order / accession) supplies the
 * sampleId; when absent we fall back to the OBX observation identifier (OBX-3).
 */
export function parseHl7Readings(rawMessage: string): ParseResult {
  const out: ParseResult = { readings: [], errors: [] };
  if (!isNonEmptyString(rawMessage)) {
    out.errors.push('empty HL7 message');
    return out;
  }

  const segments = rawMessage
    .split(/[\r\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  let currentSampleId: string | undefined;
  let obxIndex = 0;
  let sawObx = false;

  for (const segment of segments) {
    const fields = segment.split('|');
    const type = fields[0];

    if (type === 'OBR') {
      // OBR-3 is the filler order number (accession) — our sampleId anchor.
      currentSampleId = fields[3]?.split('^')[0]?.trim() || currentSampleId;
      continue;
    }

    if (type !== 'OBX') continue;
    sawObx = true;
    const i = obxIndex++;

    const observationId = fields[3]?.split('^')[0]?.trim();
    const rawValue = fields[5]?.trim();
    const unit = fields[6]?.split('^')[0]?.trim();
    const rawWhen = fields[14]?.trim();

    const sampleId = currentSampleId || observationId;
    if (!isNonEmptyString(sampleId)) {
      out.errors.push(`OBX[${i}]: no sample/observation identifier`);
      continue;
    }
    const value = Number(rawValue);
    if (!rawValue || !Number.isFinite(value) || value <= 0) {
      out.errors.push(`OBX[${i}]: non-positive or non-numeric value`);
      continue;
    }
    if (!isNonEmptyString(unit)) {
      out.errors.push(`OBX[${i}]: missing units`);
      continue;
    }
    const valueNmolL = toNmolPerL(value, unit);
    if (valueNmolL === null) {
      out.errors.push(`OBX[${i}]: unrecognized unit "${unit}"`);
      continue;
    }
    const collectedAt = rawWhen ? hl7DateToIso(rawWhen) : null;
    if (!collectedAt) {
      out.errors.push(`OBX[${i}]: missing or invalid observation datetime`);
      continue;
    }
    out.readings.push({ sampleId, collectedAt, valueNmolL });
  }

  if (!sawObx) out.errors.push('HL7 message contained no OBX result segments');
  return out;
}

/**
 * Structurally validate the webhook envelope and dispatch to the format-specific
 * parser. Envelope-level problems (missing ids, wrong/absent body for the
 * declared format) are surfaced as errors with no readings.
 */
export function parseLabResultsPayload(request: LabResultsWebhookRequest): ParseResult {
  const out: ParseResult = { readings: [], errors: [] };

  if (!isNonEmptyString(request?.orderId)) out.errors.push('missing orderId');
  if (!isNonEmptyString(request?.labPartnerId)) out.errors.push('missing labPartnerId');

  if (request?.format === 'JSON') {
    const parsed = parseJsonReadings(request.readings);
    out.readings.push(...parsed.readings);
    out.errors.push(...parsed.errors);
  } else if (request?.format === 'HL7') {
    const parsed = parseHl7Readings(request.rawMessage ?? '');
    out.readings.push(...parsed.readings);
    out.errors.push(...parsed.errors);
  } else {
    out.errors.push(`unsupported or missing payload format`);
  }

  return out;
}
