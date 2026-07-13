import fc from 'fast-check';
import type { Sex, TimeOfDayBucket } from '@calorie-cortisol/shared';
import {
  classifyAgainstRange,
  contextualizeReading,
  resolveAgeBand,
  resolveReferenceRange,
} from './reference-ranges';

describe('resolveAgeBand', () => {
  it('maps ages to bands at the boundaries', () => {
    expect(resolveAgeBand(0)).toBe('0-17');
    expect(resolveAgeBand(17)).toBe('0-17');
    expect(resolveAgeBand(18)).toBe('18-64');
    expect(resolveAgeBand(64)).toBe('18-64');
    expect(resolveAgeBand(65)).toBe('65+');
    expect(resolveAgeBand(90)).toBe('65+');
  });
});

describe('resolveReferenceRange', () => {
  it('always returns an ordered, positive interval', () => {
    for (const band of ['0-17', '18-64', '65+'] as const) {
      for (const sex of ['M', 'F', 'other'] as const) {
        for (const bucket of ['morning', 'noon', 'afternoon', 'evening'] as const) {
          const r = resolveReferenceRange(band, sex, bucket);
          expect(r.refLower).toBeGreaterThan(0);
          expect(r.refLower).toBeLessThanOrEqual(r.refUpper);
        }
      }
    }
  });

  it('follows the diurnal shape: morning upper bound is the highest', () => {
    const morning = resolveReferenceRange('18-64', 'F', 'morning');
    const evening = resolveReferenceRange('18-64', 'F', 'evening');
    expect(morning.refUpper).toBeGreaterThan(evening.refUpper);
  });
});

describe('classifyAgainstRange (below/normal/above, inclusive bounds)', () => {
  const range = { refLower: 5, refUpper: 10 };
  it('classifies below the lower bound', () => {
    expect(classifyAgainstRange(4.9, range)).toBe('below');
  });
  it('classifies within (bounds inclusive) as normal', () => {
    expect(classifyAgainstRange(5, range)).toBe('normal');
    expect(classifyAgainstRange(7, range)).toBe('normal');
    expect(classifyAgainstRange(10, range)).toBe('normal');
  });
  it('classifies above the upper bound', () => {
    expect(classifyAgainstRange(10.1, range)).toBe('above');
  });
});

describe('contextualizeReading (Req 8.5)', () => {
  it('returns null when age or sex is unavailable', () => {
    expect(contextualizeReading(10, 'morning', {})).toBeNull();
    expect(contextualizeReading(10, 'morning', { age: 40 })).toBeNull();
    expect(contextualizeReading(10, 'morning', { sex: 'F' })).toBeNull();
  });

  it('builds a full ReferenceContext with classification when both are present', () => {
    const ctx = contextualizeReading(2.0, 'evening', { age: 40, sex: 'F' });
    expect(ctx).not.toBeNull();
    expect(ctx?.ageBand).toBe('18-64');
    expect(ctx?.sex).toBe('F');
    expect(ctx?.refLower).toBeLessThanOrEqual(ctx!.refUpper);
    expect(['below', 'normal', 'above']).toContain(ctx?.classification);
  });

  it('classifies a very high morning value as above', () => {
    const ctx = contextualizeReading(500, 'morning', { age: 30, sex: 'M' });
    expect(ctx?.classification).toBe('above');
  });

  it('classifies a near-zero value as below', () => {
    const ctx = contextualizeReading(0.01, 'morning', { age: 30, sex: 'M' });
    expect(ctx?.classification).toBe('below');
  });
});

/**
 * Feature: calorie-cortisol-tool, Property 21
 *
 * Property 21: Reference-range contextualization.
 * For any ingested reading with the user's age and sex available, the reading
 * is classified below/normal/above using the reference range appropriate to the
 * user's age band, sex, and time-of-day bucket.
 *
 * **Validates: Requirements 8.5**
 */
describe('Property 21: reference-range contextualization (Req 8.5)', () => {
  const sexArb: fc.Arbitrary<Sex> = fc.constantFrom<Sex>('M', 'F', 'other');
  const bucketArb: fc.Arbitrary<TimeOfDayBucket> = fc.constantFrom<TimeOfDayBucket>(
    'morning',
    'noon',
    'afternoon',
    'evening',
  );
  // Age in whole years across the full supported human range.
  const ageArb = fc.integer({ min: 0, max: 120 });
  // Reading value in nmol/L across (and beyond) the plausible salivary range so
  // that below / normal / above are all reachable.
  const valueArb = fc.double({ min: 0, max: 1000, noNaN: true });

  it('classifies every reading with known age+sex using the appropriate age/sex/bucket range', () => {
    fc.assert(
      fc.property(valueArb, ageArb, sexArb, bucketArb, (value, age, sex, bucket) => {
        const ctx = contextualizeReading(value, bucket, { age, sex });

        // Age + sex are available, so a context is always produced (Req 8.5).
        expect(ctx).not.toBeNull();

        // The reference range used must be the one appropriate to the user's
        // age band, sex, and the reading's time-of-day bucket.
        const expectedBand = resolveAgeBand(age);
        const expectedRange = resolveReferenceRange(expectedBand, sex, bucket);

        expect(ctx!.ageBand).toBe(expectedBand);
        expect(ctx!.sex).toBe(sex);
        expect(ctx!.refLower).toBe(expectedRange.refLower);
        expect(ctx!.refUpper).toBe(expectedRange.refUpper);

        // Reference interval must always be ordered.
        expect(ctx!.refLower).toBeLessThanOrEqual(ctx!.refUpper);

        // Classification must be exactly the below/normal/above decision made
        // against that appropriate range.
        expect(ctx!.classification).toBe(classifyAgainstRange(value, expectedRange));

        // And it must agree with the value's position relative to the bounds
        // (inclusive bounds are normal).
        if (value < expectedRange.refLower) {
          expect(ctx!.classification).toBe('below');
        } else if (value > expectedRange.refUpper) {
          expect(ctx!.classification).toBe('above');
        } else {
          expect(ctx!.classification).toBe('normal');
        }
      }),
      { numRuns: 100 },
    );
  });
});
