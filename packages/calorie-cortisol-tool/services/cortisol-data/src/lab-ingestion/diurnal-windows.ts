/**
 * Diurnal 4-sample protocol window acceptance (Req 8.3, design Property 20).
 *
 * The at-home diurnal protocol collects four timed samples, each of which is
 * accepted only when it falls inside its defined local-time window:
 *   - morning CAR : within 30 minutes of waking
 *   - noon        : 11:00–13:00 (local)
 *   - afternoon   : 15:00–17:00 (local)
 *   - evening     : 22:00–00:00 (local)
 *
 * All logic here is pure: it operates on wall-clock "minutes of day" (0..1439)
 * and, for the morning sample, "minutes since wake". Timezone/offset handling
 * lives at the edge (see {@link localMinutesOfDay}), keeping the window rules
 * deterministic and directly testable.
 */

import type { TimeOfDayBucket } from '@calorie-cortisol/shared';

/** Minutes in a day. */
const MINUTES_PER_DAY = 24 * 60;

/** The morning CAR sample must be taken within this many minutes of waking. */
export const MORNING_WITHIN_MINUTES_OF_WAKE = 30;

/**
 * Fixed local-time windows (inclusive minute-of-day bounds) for the non-morning
 * diurnal samples. Evening is expressed as a start with a midnight wrap so that
 * exactly 00:00 is accepted (Req 8.3 "22:00 and 00:00").
 */
export const DIURNAL_WINDOWS = {
  noon: { startMin: 11 * 60, endMin: 13 * 60 }, // 660..780
  afternoon: { startMin: 15 * 60, endMin: 17 * 60 }, // 900..1020
  evening: { startMin: 22 * 60, endMin: MINUTES_PER_DAY }, // 1320..1440 (00:00)
} as const;

/**
 * Convert an ISO timestamp to its local minute-of-day (0..1439) given a UTC
 * offset in minutes (e.g. -300 for US Eastern standard time). Returns `null`
 * for an unparseable timestamp.
 */
export function localMinutesOfDay(
  isoTimestamp: string,
  utcOffsetMinutes = 0,
): number | null {
  const ms = Date.parse(isoTimestamp);
  if (Number.isNaN(ms)) return null;
  const localMs = ms + utcOffsetMinutes * 60_000;
  const dayMs = ((localMs % 86_400_000) + 86_400_000) % 86_400_000;
  return Math.floor(dayMs / 60_000);
}

/** True when a minute-of-day falls in the inclusive noon window (11:00–13:00). */
export function isNoonSample(localMin: number): boolean {
  return localMin >= DIURNAL_WINDOWS.noon.startMin && localMin <= DIURNAL_WINDOWS.noon.endMin;
}

/** True when a minute-of-day falls in the inclusive afternoon window (15:00–17:00). */
export function isAfternoonSample(localMin: number): boolean {
  return (
    localMin >= DIURNAL_WINDOWS.afternoon.startMin &&
    localMin <= DIURNAL_WINDOWS.afternoon.endMin
  );
}

/**
 * True when a minute-of-day falls in the evening window (22:00–00:00). Accepts
 * 22:00 through 23:59 and exactly midnight (00:00 → minute 0).
 */
export function isEveningSample(localMin: number): boolean {
  return localMin >= DIURNAL_WINDOWS.evening.startMin || localMin === 0;
}

/** True when the morning CAR sample was taken within 30 minutes of waking. */
export function isMorningSample(minutesSinceWake: number): boolean {
  return (
    Number.isFinite(minutesSinceWake) &&
    minutesSinceWake >= 0 &&
    minutesSinceWake <= MORNING_WITHIN_MINUTES_OF_WAKE
  );
}

/** Input to {@link isDiurnalSampleAccepted}. */
export interface DiurnalSampleInput {
  /** The bucket the sample is intended to satisfy. */
  bucket: TimeOfDayBucket;
  /** Local wall-clock minute-of-day of collection (0..1439). Not used for morning. */
  localMinutesOfDay?: number;
  /** Minutes elapsed since the user's recorded wake time. Required for morning. */
  minutesSinceWake?: number;
}

/**
 * Whether a diurnal sample is accepted for its intended bucket (Req 8.3).
 * A sample outside its window is rejected (not accepted); callers retain
 * previously accepted samples rather than discarding them.
 */
export function isDiurnalSampleAccepted(input: DiurnalSampleInput): boolean {
  switch (input.bucket) {
    case 'morning':
      return input.minutesSinceWake !== undefined && isMorningSample(input.minutesSinceWake);
    case 'noon':
      return input.localMinutesOfDay !== undefined && isNoonSample(input.localMinutesOfDay);
    case 'afternoon':
      return (
        input.localMinutesOfDay !== undefined && isAfternoonSample(input.localMinutesOfDay)
      );
    case 'evening':
      return input.localMinutesOfDay !== undefined && isEveningSample(input.localMinutesOfDay);
    default:
      return false;
  }
}

/**
 * Total classification of any local minute-of-day into one of the four
 * time-of-day buckets, used for reference-range selection (Req 8.5) when a lab
 * does not report a bucket. This partitions the whole day (unlike the strict
 * acceptance windows above):
 *   morning   05:00–10:59
 *   noon      11:00–14:59
 *   afternoon 15:00–21:59
 *   evening   22:00–04:59
 */
export function deriveTimeOfDayBucket(localMin: number): TimeOfDayBucket {
  if (localMin >= 5 * 60 && localMin < 11 * 60) return 'morning';
  if (localMin >= 11 * 60 && localMin < 15 * 60) return 'noon';
  if (localMin >= 15 * 60 && localMin < 22 * 60) return 'afternoon';
  return 'evening';
}
