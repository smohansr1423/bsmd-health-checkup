import fc from 'fast-check';
import type { LifeEvent } from '@calorie-cortisol/shared';

import type { TimeWindow } from './ports';
import { selectInRangeAnnotations, type TrendAnnotation } from './trend';

/**
 * Property 32: Life-event annotation matches range membership
 * Validates: Requirements 12.3, 12.4
 * Feature: calorie-cortisol-tool, Property 32
 *
 * For any recorded life event, its annotation appears on the chart if and only
 * if the event date falls within the selected range; out-of-range events are
 * omitted without error (Req 12.3, 12.4).
 *
 * The test pins {@link selectInRangeAnnotations} against an INDEPENDENT oracle
 * that decides range membership directly from the event's parsed epoch time,
 * written without reusing the implementation's `isWithinWindow` predicate so
 * the two can disagree if the implementation drifts. It exercises events
 * placed deliberately before, on, and after both window edges, plus events with
 * unparseable dates (which must be treated as out-of-range without error).
 */

const MS_PER_DAY = 86_400_000;

/** A fixed anchor so windows are deterministic. */
const ANCHOR_MS = Date.parse('2024-04-01T12:00:00.000Z');

/**
 * Independent restatement of Req 12.3/12.4 membership: an event belongs on the
 * chart iff its date parses to an epoch instant within the inclusive window.
 * Deliberately does not import the implementation's window predicate.
 */
function isInRangeOracle(event: LifeEvent, window: TimeWindow): boolean {
  const ms = Date.parse(event.date);
  if (Number.isNaN(ms)) {
    return false;
  }
  return ms >= window.startMs && ms <= window.endMs;
}

/** A window of `spanDays` ending at the fixed anchor. */
const arbWindow: fc.Arbitrary<TimeWindow> = fc
  .constantFrom(7, 30, 90)
  .map((spanDays) => ({
    startMs: ANCHOR_MS - spanDays * MS_PER_DAY,
    endMs: ANCHOR_MS,
  }));

/**
 * An ISO date offset from the anchor by an amount that lands well inside,
 * exactly on, or well outside a 7/30/90-day window edge, so both sides of each
 * boundary are exercised.
 */
const arbOffsetMs = fc.integer({
  min: -120 * MS_PER_DAY,
  max: 30 * MS_PER_DAY,
});

const arbInRangeDate: fc.Arbitrary<string> = arbOffsetMs.map((offset) =>
  new Date(ANCHOR_MS + offset).toISOString(),
);

/** A blank/garbage date string that must parse-fail and be omitted. */
const arbUnparseableDate: fc.Arbitrary<string> = fc.constantFrom(
  '',
  '   ',
  'not-a-date',
  'yesterday',
  '2024-13-45T99:99:99Z',
);

const arbEventDate: fc.Arbitrary<string> = fc.oneof(
  { weight: 5, arbitrary: arbInRangeDate },
  { weight: 1, arbitrary: arbUnparseableDate },
);

const arbLifeEvent: fc.Arbitrary<LifeEvent> = fc.record({
  userId: fc.constant('user-1'),
  date: arbEventDate,
  label: fc.string({ minLength: 1, maxLength: 24 }),
});

const arbEvents: fc.Arbitrary<LifeEvent[]> = fc.array(arbLifeEvent, {
  maxLength: 40,
});

describe('Property 32: life-event annotation matches range membership (Req 12.3, 12.4) [Feature: calorie-cortisol-tool, Property 32]', () => {
  it('annotates an event iff its date falls within the selected range, without error', () => {
    fc.assert(
      fc.property(arbEvents, arbWindow, (events, window) => {
        const annotations = selectInRangeAnnotations(events, window);
        const annotatedDates = new Set(annotations.map((a) => a.date));

        // For every input event, presence-on-chart matches the oracle exactly.
        for (const event of events) {
          const expected = isInRangeOracle(event, window);
          // An in-range event's date must appear; an out-of-range one must not
          // (unless a distinct in-range event shares the same date string).
          const shareInRange = events.some(
            (e) => e.date === event.date && isInRangeOracle(e, window),
          );
          expect(annotatedDates.has(event.date)).toBe(expected || shareInRange);
        }

        // Every emitted annotation corresponds to a genuinely in-range event.
        for (const ann of annotations) {
          const source = events.find(
            (e) => e.date === ann.date && e.label === ann.label,
          );
          expect(source).toBeDefined();
          expect(isInRangeOracle(source as LifeEvent, window)).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('emits exactly the in-range events (count and set equality with the oracle)', () => {
    fc.assert(
      fc.property(arbEvents, arbWindow, (events, window) => {
        const expected = events.filter((e) => isInRangeOracle(e, window));
        const annotations = selectInRangeAnnotations(events, window);

        expect(annotations).toHaveLength(expected.length);

        const toKey = (x: { date: string; label: string }) =>
          `${x.date}\u0000${x.label}`;
        const expectedKeys = expected.map(toKey).sort();
        const actualKeys = annotations.map(toKey).sort();
        expect(actualKeys).toEqual(expectedKeys);
      }),
      { numRuns: 100 },
    );
  });

  it('returns annotations in ascending date order and never throws on any input', () => {
    fc.assert(
      fc.property(arbEvents, arbWindow, (events, window) => {
        let annotations: TrendAnnotation[] = [];
        expect(() => {
          annotations = selectInRangeAnnotations(events, window);
        }).not.toThrow();

        const times = annotations.map((a) => Date.parse(a.date));
        for (let i = 1; i < times.length; i += 1) {
          expect(times[i - 1]).toBeLessThanOrEqual(times[i]);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('omits every out-of-range event without error even when all events are out of range', () => {
    // Events pinned strictly before the window start → none should appear.
    const window: TimeWindow = {
      startMs: ANCHOR_MS - 7 * MS_PER_DAY,
      endMs: ANCHOR_MS,
    };
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            userId: fc.constant('user-1'),
            date: fc
              .integer({ min: 1, max: 365 })
              .map((d) =>
                new Date(window.startMs - d * MS_PER_DAY).toISOString(),
              ),
            label: fc.string({ minLength: 1, maxLength: 16 }),
          }),
          { maxLength: 20 },
        ),
        (events) => {
          const annotations = selectInRangeAnnotations(events, window);
          expect(annotations).toHaveLength(0);
        },
      ),
      { numRuns: 100 },
    );
  });
});
