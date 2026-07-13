import type {
  CortisolReading,
  LifeEvent,
  Sex,
  TimeOfDayBucket,
} from '@calorie-cortisol/shared';
import { isOk } from '@calorie-cortisol/shared/result';
import fc from 'fast-check';
import type { DbEndpoint, TimescaleConfig } from '../db/config';
import { ReplicaRouter } from '../db/replica-router';
import type { OverlayPoint, TimeWindow, TrendReadPort } from './ports';
import {
  computeWindow,
  deriveReferenceBands,
  filterReadingsInRange,
  isWithinWindow,
  queryTrend,
  type TrendRange,
} from './trend';

/**
 * Property-based test for trend range filtering (Task 9.19).
 *
 * Feature: calorie-cortisol-tool, Property 31
 * Property 31: Trend range filtering.
 *   For any selected 7/30/90-day range, the rendered trend contains exactly the
 *   cortisol readings whose timestamps fall within the range, plus reference
 *   bands.
 *
 * Validates: Requirements 12.1
 */

const NOW = '2024-04-01T12:00:00.000Z';
const NOW_MS = Date.parse(NOW);
const MS_PER_DAY = 86_400_000;

const TIME_BUCKETS: readonly TimeOfDayBucket[] = [
  'morning',
  'noon',
  'afternoon',
  'evening',
];
const SEXES: readonly Sex[] = ['M', 'F', 'other'];
const TREND_RANGES: readonly TrendRange[] = [7, 30, 90];

/** Endpoint/config doubles so trend reads route through the replica router. */
function endpoint(host: string): DbEndpoint {
  return {
    host,
    port: 5432,
    database: 'cortisol',
    user: 'svc',
    password: 'pw',
    ssl: true,
    maxConnections: 10,
  };
}

const CONFIG: TimescaleConfig = {
  primary: endpoint('primary'),
  replicas: [endpoint('replica-1')],
};

/** In-memory read port returning fixed rows (the DB is out of scope here). */
class FakeReads implements TrendReadPort {
  constructor(private readonly readings: readonly CortisolReading[]) {}

  async fetchCortisolReadings(): Promise<readonly CortisolReading[]> {
    return this.readings;
  }

  async fetchLifeEvents(): Promise<readonly LifeEvent[]> {
    return [];
  }

  async fetchOverlaySeries(): Promise<readonly OverlayPoint[]> {
    return [];
  }
}

/**
 * A reading whose `measuredAt` is a deterministic offset (in days, possibly
 * fractional and negative) from the fixed `NOW` anchor. Offsets span well
 * beyond the widest 90-day window so in-range and out-of-range readings are
 * both generated. About half the readings are contextualized so reference-band
 * derivation is exercised. Timestamps are occasionally unparseable to confirm
 * they are treated as out-of-range.
 */
const readingArb: fc.Arbitrary<Omit<CortisolReading, 'id'>> = fc.record({
  // -200..+50 days: covers before/inside/after every supported window plus a
  // small band of "future" readings that must never appear in a backward range.
  offsetDays: fc.double({ min: -200, max: 50, noNaN: true }),
  garbageTimestamp: fc.boolean(),
  valueNmolL: fc.double({ min: 0.01, max: 100, noNaN: true }),
  timeOfDayBucket: fc.constantFrom(...TIME_BUCKETS),
  valid: fc.boolean(),
  contextualize: fc.boolean(),
  sex: fc.constantFrom(...SEXES),
  refLower: fc.double({ min: 0, max: 20, noNaN: true }),
  refSpan: fc.double({ min: 0.1, max: 20, noNaN: true }),
}).map((r) => {
  const measuredAt = r.garbageTimestamp
    ? 'not-a-timestamp'
    : new Date(NOW_MS + r.offsetDays * MS_PER_DAY).toISOString();
  const base: Omit<CortisolReading, 'id'> = {
    userId: 'u1',
    measuredAt,
    valueNmolL: r.valueNmolL,
    source: 'lab',
    timeOfDayBucket: r.timeOfDayBucket,
    valid: r.valid,
  };
  if (r.contextualize) {
    return {
      ...base,
      contextualized: {
        ageBand: '18-64',
        sex: r.sex,
        refLower: r.refLower,
        refUpper: r.refLower + r.refSpan,
        classification: 'normal' as const,
      },
    };
  }
  return base;
});

/** A batch of readings with unique ids so set membership is unambiguous. */
const readingsArb: fc.Arbitrary<CortisolReading[]> = fc
  .array(readingArb, { minLength: 0, maxLength: 40 })
  .map((rows) => rows.map((row, i) => ({ ...row, id: `r-${i}` })));

const rangeArb: fc.Arbitrary<TrendRange> = fc.constantFrom(...TREND_RANGES);

describe('Property 31: trend range filtering', () => {
  it('renders exactly the in-range readings plus their reference bands', async () => {
    await fc.assert(
      fc.asyncProperty(readingsArb, rangeArb, async (readings, range) => {
        const deps = { router: new ReplicaRouter(CONFIG), reads: new FakeReads(readings) };
        const result = await queryTrend(
          { userId: 'u1', range, asOf: NOW },
          deps,
        );

        expect(isOk(result)).toBe(true);
        if (!isOk(result)) {
          return;
        }
        const view = result.value;
        const window = computeWindow(range, NOW) as TimeWindow;

        // The set of rendered readings is EXACTLY the set of input readings
        // whose timestamps fall within the window (Property 31 / Req 12.1).
        const expectedIds = new Set(
          readings.filter((r) => isWithinWindow(r.measuredAt, window)).map((r) => r.id),
        );
        const renderedIds = new Set(view.readings.map((r) => r.id));
        expect(renderedIds).toEqual(expectedIds);

        // No rendered reading is out of range; each one lies inside the window.
        for (const r of view.readings) {
          expect(isWithinWindow(r.measuredAt, window)).toBe(true);
        }

        // ...and no in-range input reading is dropped (exact, not subset).
        expect(view.readings).toHaveLength(expectedIds.size);

        // Reference bands accompany the rendered readings and are derived
        // solely from those in-range readings (Property 31: "plus reference
        // bands").
        expect(view.referenceBands).toEqual(deriveReferenceBands(view.readings));

        // Every band corresponds to a bucket that an in-range contextualized
        // reading actually reports — no bands invented from out-of-range data.
        const inRangeBuckets = new Set(
          view.readings.filter((r) => r.contextualized).map((r) => r.timeOfDayBucket),
        );
        for (const band of view.referenceBands) {
          expect(inRangeBuckets.has(band.bucket)).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('a smaller range never renders a reading excluded by a larger range', async () => {
    await fc.assert(
      fc.asyncProperty(readingsArb, async (readings) => {
        const deps = { router: new ReplicaRouter(CONFIG), reads: new FakeReads(readings) };
        const idsFor = async (range: TrendRange): Promise<Set<string>> => {
          const result = await queryTrend({ userId: 'u1', range, asOf: NOW }, deps);
          expect(isOk(result)).toBe(true);
          return isOk(result)
            ? new Set(result.value.readings.map((r) => r.id))
            : new Set();
        };

        const ids7 = await idsFor(7);
        const ids30 = await idsFor(30);
        const ids90 = await idsFor(90);

        // Range windows are nested (7 ⊆ 30 ⊆ 90), so the rendered reading sets
        // must be nested too — pure consequence of range-membership filtering.
        for (const id of ids7) {
          expect(ids30.has(id)).toBe(true);
        }
        for (const id of ids30) {
          expect(ids90.has(id)).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('filterReadingsInRange agrees with pointwise window membership', () => {
    fc.assert(
      fc.property(readingsArb, rangeArb, (readings, range) => {
        const window = computeWindow(range, NOW) as TimeWindow;
        const filtered = filterReadingsInRange(readings, window);

        // Membership is exactly the pointwise predicate.
        expect(new Set(filtered.map((r) => r.id))).toEqual(
          new Set(
            readings.filter((r) => isWithinWindow(r.measuredAt, window)).map((r) => r.id),
          ),
        );

        // Result is sorted ascending by measured instant for left-to-right rendering.
        const times = filtered.map((r) => Date.parse(r.measuredAt));
        for (let i = 1; i < times.length; i += 1) {
          expect(times[i - 1]).toBeLessThanOrEqual(times[i]);
        }
      }),
      { numRuns: 100 },
    );
  });
});
