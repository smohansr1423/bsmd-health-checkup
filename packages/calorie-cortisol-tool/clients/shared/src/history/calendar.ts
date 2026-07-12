/**
 * Calendar-day arithmetic for meal history (Task 14.12).
 *
 * A {@link CalendarDay} is a local calendar date in `YYYY-MM-DD` form. All
 * date reasoning in the history module (daily/weekly ranges, streak counting,
 * the 30-day insights window) is done over these string days rather than raw
 * timestamps so the logic stays timezone-stable, pure, and deterministic —
 * "today" / "now" are always injected by the caller, never read from the clock.
 *
 * Days are compared and stepped by interpreting the date at UTC midnight, which
 * is purely an internal, DST-free representation for counting whole days; it is
 * never surfaced to callers.
 *
 * Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7
 */

/** A local calendar date, `YYYY-MM-DD` (ISO 8601 calendar-date form). */
export type CalendarDay = string;

/** Milliseconds in one calendar day. */
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Matches a strictly-formatted `YYYY-MM-DD` day (does not by itself validate ranges). */
const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Return true iff `day` is a well-formed, real `YYYY-MM-DD` calendar date
 * (rejects e.g. `2024-13-01`, `2024-02-30`, or non-date strings).
 */
export function isCalendarDay(day: string): day is CalendarDay {
  const m = DAY_PATTERN.exec(day);
  if (m === null) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const dayOfMonth = Number(m[3]);
  if (month < 1 || month > 12) return false;
  if (dayOfMonth < 1 || dayOfMonth > 31) return false;
  // Round-trip through a UTC Date to reject impossible dates (e.g. Feb 30).
  const d = new Date(Date.UTC(year, month - 1, dayOfMonth));
  return (
    d.getUTCFullYear() === year &&
    d.getUTCMonth() === month - 1 &&
    d.getUTCDate() === dayOfMonth
  );
}

/** Assert `day` is a valid calendar day, throwing a descriptive error otherwise. */
export function assertCalendarDay(day: string, label = 'day'): CalendarDay {
  if (!isCalendarDay(day)) {
    throw new RangeError(`${label} must be a valid YYYY-MM-DD calendar day, got: ${String(day)}`);
  }
  return day;
}

/** Derive the local {@link CalendarDay} from an ISO timestamp (local + offset). */
export function calendarDayOf(loggedAt: string): CalendarDay {
  // A local-with-offset ISO timestamp already carries the local wall date in
  // its leading `YYYY-MM-DD`, so the local calendar day is the first 10 chars.
  const day = loggedAt.slice(0, 10);
  return assertCalendarDay(day, 'loggedAt');
}

/** Internal: convert a calendar day to whole days since the Unix epoch (UTC). */
function toEpochDay(day: CalendarDay): number {
  const [y, m, d] = day.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / MS_PER_DAY);
}

/** Internal: convert whole days since the Unix epoch (UTC) back to a calendar day. */
function fromEpochDay(epochDay: number): CalendarDay {
  const date = new Date(epochDay * MS_PER_DAY);
  const y = String(date.getUTCFullYear()).padStart(4, '0');
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Return `day` shifted by `delta` whole days (negative shifts into the past). */
export function addDays(day: CalendarDay, delta: number): CalendarDay {
  assertCalendarDay(day);
  return fromEpochDay(toEpochDay(day) + Math.trunc(delta));
}

/** Whole-day difference `a - b` (positive when `a` is later than `b`). */
export function dayDifference(a: CalendarDay, b: CalendarDay): number {
  assertCalendarDay(a, 'a');
  assertCalendarDay(b, 'b');
  return toEpochDay(a) - toEpochDay(b);
}

/** Three-way calendar-day comparison (`-1 | 0 | 1`), suitable for sorting. */
export function compareDays(a: CalendarDay, b: CalendarDay): number {
  const diff = dayDifference(a, b);
  return diff < 0 ? -1 : diff > 0 ? 1 : 0;
}

/** True iff `start <= day <= end` (inclusive) as calendar days. */
export function isWithinRange(day: CalendarDay, start: CalendarDay, end: CalendarDay): boolean {
  return dayDifference(day, start) >= 0 && dayDifference(day, end) <= 0;
}

/**
 * Inclusive list of every calendar day from `start` to `end` in ascending
 * order. Returns an empty array when `end` precedes `start`.
 */
export function enumerateDays(start: CalendarDay, end: CalendarDay): CalendarDay[] {
  const span = dayDifference(end, start);
  if (span < 0) return [];
  const days: CalendarDay[] = [];
  for (let i = 0; i <= span; i++) {
    days.push(addDays(start, i));
  }
  return days;
}
