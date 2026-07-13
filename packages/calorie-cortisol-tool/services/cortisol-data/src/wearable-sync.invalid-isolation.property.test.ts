import fc from 'fast-check';

import {
  hasValidTimestamp,
  isValidReadingValue,
  syncWearable,
  validateReading,
  READING_VALUE_MIN,
  READING_VALUE_MAX,
  type RawWearableReading,
  type WearableSourceType,
  type WearableSyncRequest,
} from './wearable-sync';

/**
 * Property-based test for invalid-measurement isolation (Task 9.9).
 *
 * Feature: calorie-cortisol-tool, Property 24
 * Property 24: Reading validation isolates invalid measurements.
 *   For any import batch, a measurement is rejected and recorded as invalid
 *   (and excluded from proxy calculations) if and only if its value falls
 *   outside 0.01–100.00 in the reported unit or it lacks a timestamp; valid
 *   measurements in the same batch are retained.
 *
 * Validates: Requirements 9.4
 */

const SOURCE_TYPES: readonly WearableSourceType[] = ['patch', 'whoop', 'oura', 'garmin'];

/** Categories the generators draw from. */
const CATEGORIES = ['cortisol', 'hrv', 'sleep', 'steps', 'restingHr'] as const;

/**
 * Timestamp arbitrary mixing valid ISO instants with a broad spread of
 * clearly-invalid ones (missing / null / empty / whitespace / unparseable) so
 * both the missing-timestamp rejection branch and the accepted branch fire.
 */
const timestampArb: fc.Arbitrary<string | null | undefined> = fc.oneof(
  fc
    .date({
      min: new Date('2000-01-01T00:00:00.000Z'),
      max: new Date('2035-12-31T23:59:59.999Z'),
    })
    .map((d) => d.toISOString()),
  fc.constant(undefined),
  fc.constant(null),
  fc.constant(''),
  fc.constant('   '),
  fc.constant('not-a-date'),
);

/**
 * Value arbitrary that deliberately straddles the [0.01, 100] boundaries so the
 * in-range, below-range, above-range, boundary, and NaN cases all appear.
 */
const valueArb: fc.Arbitrary<number> = fc.oneof(
  fc.double({ min: READING_VALUE_MIN, max: READING_VALUE_MAX, noNaN: true }),
  fc.double({ min: -100, max: READING_VALUE_MIN - 0.0001, noNaN: true }),
  fc.double({ min: READING_VALUE_MAX + 0.0001, max: 1000, noNaN: true }),
  // Exact boundaries — must be treated as valid (inclusive range).
  fc.constantFrom(READING_VALUE_MIN, READING_VALUE_MAX),
  fc.constant(Number.NaN),
);

const readingArb: fc.Arbitrary<RawWearableReading> = fc.record({
  category: fc.constantFrom(...CATEGORIES),
  metricType: fc.constantFrom('patchCortisol', 'hrv', 'restingHr', 'sleep', 'steps'),
  value: valueArb,
  unit: fc.constantFrom('ng/mL', 'ug/dL', 'ms', 'bpm'),
  capturedAt: timestampArb,
  sourceId: fc.oneof(
    fc.string({ minLength: 1, maxLength: 16 }).map((s) => `patch-${s}`),
    fc.constant(undefined),
  ),
});

/**
 * Active connection with every category authorized, so authorization scoping
 * (Req 9.2) never removes readings and the outcome is governed purely by the
 * per-reading validation rule under test (Req 9.4).
 */
const requestArb: fc.Arbitrary<WearableSyncRequest> = fc.record({
  userId: fc.string({ minLength: 1, maxLength: 16 }).map((s) => `user-${s}`),
  sourceType: fc.constantFrom(...SOURCE_TYPES),
  connectionStatus: fc.constant('active' as const),
  authorizedCategories: fc.constant([...CATEGORIES]),
  readings: fc.array(readingArb, { minLength: 0, maxLength: 40 }),
});

/** Ground-truth predicate for acceptance derived straight from Req 9.4. */
const shouldAccept = (r: RawWearableReading): boolean =>
  isValidReadingValue(r.value) && hasValidTimestamp(r.capturedAt);

describe('Property 24: reading validation isolates invalid measurements', () => {
  it('accepts a reading iff its value is in [0.01, 100] and it has a valid timestamp', () => {
    fc.assert(
      fc.property(requestArb, (request) => {
        const result = syncWearable(request);

        // With every category authorized, each reading is classified exactly
        // once — either accepted or recorded invalid. The two sets partition
        // the batch with no loss and no duplication.
        expect(result.excludedReadingCount).toBe(0);
        expect(result.accepted.length + result.invalid.length).toBe(
          request.readings.length,
        );

        // Counts match the ground-truth iff predicate over the batch.
        const expectedAccepted = request.readings.filter(shouldAccept).length;
        expect(result.accepted.length).toBe(expectedAccepted);
        expect(result.invalid.length).toBe(request.readings.length - expectedAccepted);

        // Every accepted reading genuinely satisfies both conditions.
        for (const accepted of result.accepted) {
          expect(isValidReadingValue(accepted.value)).toBe(true);
          expect(hasValidTimestamp(accepted.capturedAt)).toBe(true);
        }

        // Every invalid reading genuinely violates at least one condition and
        // is excluded from the accepted (proxy-calculation) set.
        for (const { reading, reason } of result.invalid) {
          expect(shouldAccept(reading)).toBe(false);
          if (reason === 'missing_timestamp') {
            expect(hasValidTimestamp(reading.capturedAt)).toBe(false);
          } else {
            // value_out_of_range implies the timestamp was valid but the value was not.
            expect(hasValidTimestamp(reading.capturedAt)).toBe(true);
            expect(isValidReadingValue(reading.value)).toBe(false);
          }
        }
      }),
      { numRuns: 100 },
    );
  });

  it('retains every valid measurement even when invalid ones share the batch', () => {
    // Guarantee a mix: at least one guaranteed-valid reading and at least one
    // guaranteed-invalid reading in the same batch, plus arbitrary others.
    const validReadingArb: fc.Arbitrary<RawWearableReading> = fc.record({
      category: fc.constantFrom(...CATEGORIES),
      metricType: fc.constant('patchCortisol'),
      value: fc.double({ min: READING_VALUE_MIN, max: READING_VALUE_MAX, noNaN: true }),
      unit: fc.constant('ng/mL'),
      capturedAt: fc
        .date({
          min: new Date('2000-01-01T00:00:00.000Z'),
          max: new Date('2035-12-31T23:59:59.999Z'),
        })
        .map((d) => d.toISOString()),
      sourceId: fc.constant('patch-fixed'),
    });

    const invalidReadingArb: fc.Arbitrary<RawWearableReading> = fc.record({
      category: fc.constantFrom(...CATEGORIES),
      metricType: fc.constant('patchCortisol'),
      value: fc.oneof(
        fc.double({ min: READING_VALUE_MAX + 0.01, max: 1000, noNaN: true }),
        fc.constant(Number.NaN),
      ),
      unit: fc.constant('ng/mL'),
      capturedAt: fc.constantFrom(undefined, null, '', 'not-a-date'),
      sourceId: fc.constant(undefined),
    });

    fc.assert(
      fc.property(
        fc.record({
          userId: fc.constant('user-mix'),
          sourceType: fc.constantFrom(...SOURCE_TYPES),
          connectionStatus: fc.constant('active' as const),
          authorizedCategories: fc.constant([...CATEGORIES]),
          valids: fc.array(validReadingArb, { minLength: 1, maxLength: 10 }),
          invalids: fc.array(invalidReadingArb, { minLength: 1, maxLength: 10 }),
        }),
        ({ userId, sourceType, connectionStatus, authorizedCategories, valids, invalids }) => {
          // Interleave valid and invalid readings so retention is not an artifact of ordering.
          const readings: RawWearableReading[] = [];
          const max = Math.max(valids.length, invalids.length);
          for (let i = 0; i < max; i += 1) {
            if (i < valids.length) readings.push(valids[i]);
            if (i < invalids.length) readings.push(invalids[i]);
          }

          const result = syncWearable({
            userId,
            sourceType,
            connectionStatus,
            authorizedCategories,
            readings,
          });

          // Every guaranteed-valid reading is retained (present in accepted).
          expect(result.accepted.length).toBe(valids.length);
          // Every guaranteed-invalid reading is recorded (present in invalid).
          expect(result.invalid.length).toBe(invalids.length);
          // Validation is a per-reading verdict consistent with the direct helper.
          for (const r of readings) {
            const verdict = validateReading(r);
            expect(verdict.valid).toBe(shouldAccept(r));
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
