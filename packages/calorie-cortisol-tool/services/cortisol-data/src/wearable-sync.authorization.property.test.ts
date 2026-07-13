import fc from 'fast-check';

import {
  syncWearable,
  type ConnectionStatus,
  type RawWearableReading,
  type WearableSourceType,
  type WearableSyncRequest,
} from './wearable-sync';

/**
 * Property-based test for authorization-scoped import (Task 9.10).
 *
 * Feature: calorie-cortisol-tool, Property 25
 * Property 25: Authorization scoping on import.
 *   For any platform import, only categories the user has explicitly authorized
 *   are imported; unauthorized/denied categories are excluded and previously
 *   imported data is retained. A revoked or inactive connection imports nothing
 *   and retains previously imported data.
 *
 * Validates: Requirements 9.2, 9.8
 */

const SOURCE_TYPES: readonly WearableSourceType[] = ['patch', 'whoop', 'oura', 'garmin'];

/** Category universe the generators draw from; a subset is authorized per request. */
const CATEGORIES = ['cortisol', 'hrv', 'sleep', 'steps', 'restingHr'] as const;

const CONNECTION_STATUSES: readonly ConnectionStatus[] = ['active', 'inactive', 'revoked'];

/**
 * Reading generator drawn from the full category universe (so both authorized
 * and unauthorized categories appear) with a valid, in-range value + timestamp
 * so that authorization scoping — not per-reading validation — is the only
 * thing that can exclude an authorized reading (isolates Property 25).
 */
const readingArb: fc.Arbitrary<RawWearableReading> = fc.record({
  category: fc.constantFrom(...CATEGORIES),
  metricType: fc.constantFrom('patchCortisol', 'hrv', 'restingHr', 'sleep', 'steps'),
  value: fc.double({ min: 0.01, max: 100, noNaN: true }),
  unit: fc.constantFrom('ng/mL', 'ug/dL', 'ms', 'bpm'),
  capturedAt: fc
    .date({ min: new Date('2000-01-01T00:00:00.000Z'), max: new Date('2035-12-31T23:59:59.999Z') })
    .map((d) => d.toISOString()),
  sourceId: fc.oneof(
    fc.string({ minLength: 1, maxLength: 24 }).map((s) => `patch-${s}`),
    fc.constant(null),
  ),
});

const requestArb: fc.Arbitrary<WearableSyncRequest> = fc.record({
  userId: fc.string({ minLength: 1, maxLength: 16 }).map((s) => `user-${s}`),
  sourceType: fc.constantFrom(...SOURCE_TYPES),
  connectionStatus: fc.constantFrom(...CONNECTION_STATUSES),
  authorizedCategories: fc
    .subarray([...CATEGORIES], { minLength: 0, maxLength: CATEGORIES.length })
    .map((xs) => [...xs]),
  readings: fc.array(readingArb, { minLength: 0, maxLength: 30 }),
});

describe('Property 25: authorization scoping on import [Feature: calorie-cortisol-tool, Property 25]', () => {
  it('imports only authorized categories, excludes the rest, and always retains prior data (Req 9.2, 9.8)', () => {
    fc.assert(
      fc.property(requestArb, (request) => {
        const result = syncWearable(request);

        // Previously imported data is retained across every branch (Req 9.2, 9.8).
        expect(result.retainedPriorData).toBe(true);

        if (request.connectionStatus !== 'active') {
          // Req 9.8: a revoked/inactive connection imports nothing, is marked
          // inactive, and surfaces a reauthorization-required notification.
          expect(result.status).toBe('inactive');
          expect(result.connectionActive).toBe(false);
          expect(result.accepted).toHaveLength(0);
          expect(result.invalid).toHaveLength(0);
          expect(result.excludedCategories).toHaveLength(0);
          expect(result.excludedReadingCount).toBe(0);
          expect(
            result.notifications.some((n) => n.kind === 'reauthorization_required'),
          ).toBe(true);
          return;
        }

        // Req 9.2: active connection — only authorized categories are imported.
        expect(result.status).toBe('synced');
        expect(result.connectionActive).toBe(true);

        // Every accepted reading belongs to an explicitly authorized category.
        for (const accepted of result.accepted) {
          expect(request.authorizedCategories).toContain(accepted.category);
        }

        // No accepted reading belongs to an unauthorized category.
        const acceptedUnauthorized = result.accepted.filter(
          (a) => !request.authorizedCategories.includes(a.category),
        );
        expect(acceptedUnauthorized).toHaveLength(0);

        // Every distinct unauthorized category present in the batch is reported
        // as excluded — and only genuinely unauthorized categories are.
        const unauthorizedInBatch = new Set(
          request.readings
            .map((r) => r.category)
            .filter((c) => !request.authorizedCategories.includes(c)),
        );
        expect([...result.excludedCategories].sort()).toEqual(
          [...unauthorizedInBatch].sort(),
        );
        for (const excluded of result.excludedCategories) {
          expect(request.authorizedCategories).not.toContain(excluded);
        }

        // The excluded-reading count equals the number of readings whose
        // category was not authorized.
        const unauthorizedReadingCount = request.readings.filter(
          (r) => !request.authorizedCategories.includes(r.category),
        ).length;
        expect(result.excludedReadingCount).toBe(unauthorizedReadingCount);

        // When something was excluded, the user is told which categories are
        // unavailable due to missing authorization (Req 9.2).
        if (unauthorizedInBatch.size > 0) {
          const notice = result.notifications.find(
            (n) => n.kind === 'categories_unavailable',
          );
          expect(notice).toBeDefined();
          expect([...(notice?.categories ?? [])].sort()).toEqual(
            [...unauthorizedInBatch].sort(),
          );
        }
      }),
      { numRuns: 100 },
    );
  });

  it('drops nothing from authorized categories when every category is authorized (Req 9.2)', () => {
    const fullyAuthorizedArb: fc.Arbitrary<WearableSyncRequest> = fc.record({
      userId: fc.string({ minLength: 1, maxLength: 16 }).map((s) => `user-${s}`),
      sourceType: fc.constantFrom(...SOURCE_TYPES),
      connectionStatus: fc.constant('active' as const),
      authorizedCategories: fc.constant([...CATEGORIES]),
      readings: fc.array(readingArb, { minLength: 0, maxLength: 30 }),
    });

    fc.assert(
      fc.property(fullyAuthorizedArb, (request) => {
        const result = syncWearable(request);

        // All categories authorized + all readings valid ⇒ nothing excluded and
        // every reading is imported (Req 9.2).
        expect(result.excludedCategories).toHaveLength(0);
        expect(result.excludedReadingCount).toBe(0);
        expect(result.accepted).toHaveLength(request.readings.length);
        expect(
          result.notifications.some((n) => n.kind === 'categories_unavailable'),
        ).toBe(false);
        expect(result.retainedPriorData).toBe(true);
      }),
      { numRuns: 100 },
    );
  });
});
