import fc from 'fast-check';
import type { TimeOfDayBucket } from '@calorie-cortisol/shared';

import {
  DIURNAL_WINDOWS,
  MORNING_WITHIN_MINUTES_OF_WAKE,
  isDiurnalSampleAccepted,
  type DiurnalSampleInput,
} from './diurnal-windows';

/**
 * Property 20: Diurnal sample window acceptance
 * Validates: Requirements 8.3
 * Feature: calorie-cortisol-tool, Property 20
 *
 * For any diurnal sample, it is accepted only if it falls within its defined
 * window (morning CAR within 30 min of waking; noon 11:00–13:00; afternoon
 * 15:00–17:00; evening 22:00–00:00 local).
 *
 * The test pins the acceptance decision of {@link isDiurnalSampleAccepted}
 * against an INDEPENDENT oracle that encodes the requirement's windows
 * directly, over the full input space (all minutes-of-day 0..1439 and
 * minutes-since-wake spanning below/at/above the 30-minute bound). This
 * establishes the biconditional: accepted ⇔ within window.
 */

const MINUTES_PER_DAY = 24 * 60;

/**
 * Independent restatement of Req 8.3 windows — deliberately written without
 * reusing the implementation's predicates, so the two can disagree if the
 * implementation drifts from the requirement.
 */
function withinWindowOracle(input: DiurnalSampleInput): boolean {
  switch (input.bucket) {
    case 'morning': {
      const m = input.minutesSinceWake;
      // Within 30 minutes of waking (non-negative, up to and including 30).
      return m !== undefined && Number.isFinite(m) && m >= 0 && m <= 30;
    }
    case 'noon': {
      const t = input.localMinutesOfDay;
      // 11:00–13:00 inclusive → [660, 780].
      return t !== undefined && t >= 660 && t <= 780;
    }
    case 'afternoon': {
      const t = input.localMinutesOfDay;
      // 15:00–17:00 inclusive → [900, 1020].
      return t !== undefined && t >= 900 && t <= 1020;
    }
    case 'evening': {
      const t = input.localMinutesOfDay;
      // 22:00–00:00 → [1320, 1439] plus exactly 00:00 (minute 0).
      return t !== undefined && (t >= 1320 || t === 0);
    }
    default:
      return false;
  }
}

const arbBucket: fc.Arbitrary<TimeOfDayBucket> = fc.constantFrom(
  'morning',
  'noon',
  'afternoon',
  'evening',
);

/** Any valid wall-clock minute-of-day. */
const arbMinuteOfDay = fc.integer({ min: 0, max: MINUTES_PER_DAY - 1 });

/**
 * Minutes since wake, spanning negatives (invalid), the accepted band, and
 * well past the 30-minute cutoff, so both sides of the boundary are exercised.
 */
const arbMinutesSinceWake = fc.integer({ min: -120, max: 720 });

describe('Property 20: Diurnal sample window acceptance (Req 8.3)', () => {
  it('accepts a sample iff it falls within its defined window (clock-based buckets)', () => {
    fc.assert(
      fc.property(
        fc.constantFrom<TimeOfDayBucket>('noon', 'afternoon', 'evening'),
        arbMinuteOfDay,
        (bucket, localMinutesOfDay) => {
          const input: DiurnalSampleInput = { bucket, localMinutesOfDay };
          expect(isDiurnalSampleAccepted(input)).toBe(withinWindowOracle(input));
        },
      ),
      { numRuns: 100 },
    );
  });

  it('accepts the morning CAR sample iff taken within 30 minutes of waking', () => {
    fc.assert(
      fc.property(arbMinutesSinceWake, (minutesSinceWake) => {
        const input: DiurnalSampleInput = { bucket: 'morning', minutesSinceWake };
        expect(isDiurnalSampleAccepted(input)).toBe(withinWindowOracle(input));
      }),
      { numRuns: 100 },
    );
  });

  it('agrees with the oracle across all buckets and both input dimensions', () => {
    fc.assert(
      fc.property(
        arbBucket,
        fc.option(arbMinuteOfDay, { nil: undefined }),
        fc.option(arbMinutesSinceWake, { nil: undefined }),
        (bucket, localMinutesOfDay, minutesSinceWake) => {
          const input: DiurnalSampleInput = {
            bucket,
            localMinutesOfDay,
            minutesSinceWake,
          };
          expect(isDiurnalSampleAccepted(input)).toBe(withinWindowOracle(input));
        },
      ),
      { numRuns: 100 },
    );
  });

  it('never accepts a sample that lies outside every window (accepted ⇒ within window)', () => {
    fc.assert(
      fc.property(
        arbBucket,
        fc.option(arbMinuteOfDay, { nil: undefined }),
        fc.option(arbMinutesSinceWake, { nil: undefined }),
        (bucket, localMinutesOfDay, minutesSinceWake) => {
          const input: DiurnalSampleInput = {
            bucket,
            localMinutesOfDay,
            minutesSinceWake,
          };
          if (isDiurnalSampleAccepted(input)) {
            // Acceptance is only ever permitted when the oracle agrees it is in-window.
            expect(withinWindowOracle(input)).toBe(true);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('window constants match the Req 8.3 boundaries', () => {
    expect(MORNING_WITHIN_MINUTES_OF_WAKE).toBe(30);
    expect(DIURNAL_WINDOWS.noon).toEqual({ startMin: 660, endMin: 780 });
    expect(DIURNAL_WINDOWS.afternoon).toEqual({ startMin: 900, endMin: 1020 });
    expect(DIURNAL_WINDOWS.evening).toEqual({ startMin: 1320, endMin: MINUTES_PER_DAY });
  });
});
