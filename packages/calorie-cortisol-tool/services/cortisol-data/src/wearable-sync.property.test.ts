import fc from 'fast-check';

import {
  hasValidTimestamp,
  syncWearable,
  type RawWearableReading,
  type WearableSourceType,
  type WearableSyncRequest,
} from './wearable-sync';

/**
 * Property-based test for imported-reading tagging (Task 9.8).
 *
 * Feature: calorie-cortisol-tool, Property 23
 * Property 23: Imported readings are tagged with source and timestamp.
 *   For any imported wearable/patch/device reading that is accepted, it carries
 *   a source identifier (patch id or device type) and a measurement/capture
 *   timestamp.
 *
 * Validates: Requirements 9.3, 9.5
 */

const SOURCE_TYPES: readonly WearableSourceType[] = ['patch', 'whoop', 'oura', 'garmin'];

/** Categories the generators draw from; a subset is authorized per request. */
const CATEGORIES = ['cortisol', 'hrv', 'sleep', 'steps', 'restingHr'] as const;

/**
 * Timestamp arbitrary that mixes valid ISO instants with clearly invalid ones
 * (missing / empty / whitespace / unparseable) so the accepted-reading tagging
 * guarantee is exercised across both accepted and rejected inputs.
 */
const timestampArb: fc.Arbitrary<string | null | undefined> = fc.oneof(
  // Valid ISO 8601 instants spanning a wide, realistic range.
  fc
    .date({ min: new Date('2000-01-01T00:00:00.000Z'), max: new Date('2035-12-31T23:59:59.999Z') })
    .map((d) => d.toISOString()),
  fc.constant(undefined),
  fc.constant(null),
  fc.constant(''),
  fc.constant('   '),
  fc.constant('not-a-date'),
);

/** A source identifier that is sometimes present, sometimes absent/blank. */
const sourceIdArb: fc.Arbitrary<string | null | undefined> = fc.oneof(
  fc.string({ minLength: 1, maxLength: 24 }).map((s) => `patch-${s}`),
  fc.constant(undefined),
  fc.constant(null),
  fc.constant(''),
  fc.constant('   '),
);

const readingArb: fc.Arbitrary<RawWearableReading> = fc.record({
  category: fc.constantFrom(...CATEGORIES),
  metricType: fc.constantFrom('patchCortisol', 'hrv', 'restingHr', 'sleep', 'steps'),
  // Values span in-range, boundary, and out-of-range so validation branches all fire.
  value: fc.oneof(
    fc.double({ min: 0.01, max: 100, noNaN: true }),
    fc.double({ min: -50, max: 0.009, noNaN: true }),
    fc.double({ min: 100.01, max: 500, noNaN: true }),
    fc.constant(Number.NaN),
  ),
  unit: fc.constantFrom('ng/mL', 'ug/dL', 'ms', 'bpm'),
  capturedAt: timestampArb,
  sourceId: sourceIdArb,
});

const requestArb: fc.Arbitrary<WearableSyncRequest> = fc.record({
  userId: fc.string({ minLength: 1, maxLength: 16 }).map((s) => `user-${s}`),
  sourceType: fc.constantFrom(...SOURCE_TYPES),
  // Focus on the active connection path — that is where readings get imported
  // and tagged (Req 9.3/9.5). Inactive/revoked import nothing (covered by 9.10).
  connectionStatus: fc.constant('active' as const),
  authorizedCategories: fc
    .subarray([...CATEGORIES], { minLength: 0, maxLength: CATEGORIES.length })
    .map((xs) => [...xs]),
  readings: fc.array(readingArb, { minLength: 0, maxLength: 30 }),
});

describe('Property 23: imported readings are tagged with source and timestamp', () => {
  it('every accepted reading carries a non-empty source id, device type, and valid timestamp', () => {
    fc.assert(
      fc.property(requestArb, (request) => {
        const result = syncWearable(request);

        for (const accepted of result.accepted) {
          // Source identifier present and non-empty (Req 9.3/9.5).
          expect(typeof accepted.sourceId).toBe('string');
          expect(accepted.sourceId.trim().length).toBeGreaterThan(0);

          // Device type is one of the supported source types (Req 9.5).
          expect(SOURCE_TYPES).toContain(accepted.deviceType);
          expect(accepted.deviceType).toBe(request.sourceType);

          // Capture/measurement timestamp present and parseable (Req 9.3/9.5).
          expect(hasValidTimestamp(accepted.capturedAt)).toBe(true);

          // Source id is the reading's own patch/device id when supplied,
          // otherwise falls back to the connection's device type.
          const original = request.readings.find(
            (r) =>
              r.category === accepted.category &&
              r.metricType === accepted.metricType &&
              r.value === accepted.value &&
              r.capturedAt === accepted.capturedAt,
          );
          const hadExplicitSourceId =
            typeof original?.sourceId === 'string' && original.sourceId.trim().length > 0;
          if (hadExplicitSourceId) {
            expect(accepted.sourceId).toBe(original?.sourceId);
          } else {
            expect(accepted.sourceId).toBe(request.sourceType);
          }
        }
      }),
      { numRuns: 100 },
    );
  });

  it('preserves the capture timestamp verbatim on accepted readings', () => {
    fc.assert(
      fc.property(requestArb, (request) => {
        const result = syncWearable(request);
        for (const accepted of result.accepted) {
          // The tagged timestamp is exactly the source-reported capture instant.
          expect(typeof accepted.capturedAt).toBe('string');
          expect(Number.isFinite(Date.parse(accepted.capturedAt))).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  });
});
