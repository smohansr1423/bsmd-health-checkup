import type { CortisolReading, LifeEvent } from '@calorie-cortisol/shared';
import { isErr, isOk } from '@calorie-cortisol/shared/result';
import type { DbEndpoint, TimescaleConfig } from '../db/config';
import { ReplicaRouter } from '../db/replica-router';
import { TrendErrorCode } from './errors';
import type { OverlayPoint, TimeWindow, TrendReadPort } from './ports';
import {
  computeWindow,
  deriveReferenceBands,
  filterReadingsInRange,
  isOverlayRequested,
  isWithinWindow,
  parseOverlayMetric,
  parseTrendRange,
  queryTrend,
  selectInRangeAnnotations,
  selectOverlay,
  TREND_RANGES,
} from './trend';

/**
 * Focused unit tests for the cortisol trend query (Req 12.1, 12.2, 12.3, 12.4,
 * 12.5, 12.6). The optional property tests (Properties 31/32) are tasks
 * 9.19/9.20.
 */

const NOW = '2024-04-01T12:00:00.000Z';
const NOW_MS = Date.parse(NOW);
const MS_PER_DAY = 86_400_000;

/** ISO timestamp `days` before the fixed `NOW` anchor. */
function daysAgo(days: number): string {
  return new Date(NOW_MS - days * MS_PER_DAY).toISOString();
}

function reading(
  overrides: Partial<CortisolReading> & { measuredAt: string },
): CortisolReading {
  return {
    id: overrides.id ?? `r-${overrides.measuredAt}`,
    userId: overrides.userId ?? 'u1',
    valueNmolL: overrides.valueNmolL ?? 10,
    source: overrides.source ?? 'lab',
    timeOfDayBucket: overrides.timeOfDayBucket ?? 'morning',
    valid: overrides.valid ?? true,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

describe('parseTrendRange (Req 12.1)', () => {
  it('accepts exactly 7/30/90 as numbers or strings', () => {
    expect(parseTrendRange(7)).toBe(7);
    expect(parseTrendRange('30')).toBe(30);
    expect(parseTrendRange('90d')).toBe(90);
    expect(parseTrendRange('7 days')).toBe(7);
  });

  it('rejects unsupported ranges', () => {
    expect(parseTrendRange(14)).toBeNull();
    expect(parseTrendRange('60')).toBeNull();
    expect(parseTrendRange('abc')).toBeNull();
    expect(parseTrendRange(undefined)).toBeNull();
  });

  it('covers all documented ranges', () => {
    for (const r of TREND_RANGES) {
      expect(parseTrendRange(r)).toBe(r);
    }
  });
});

describe('parseOverlayMetric / isOverlayRequested (Req 12.5)', () => {
  it('accepts exactly calories/sleep/hrv (case-insensitive)', () => {
    expect(parseOverlayMetric('calories')).toBe('calories');
    expect(parseOverlayMetric('SLEEP')).toBe('sleep');
    expect(parseOverlayMetric(' hrv ')).toBe('hrv');
  });

  it('rejects unsupported metrics and blanks', () => {
    expect(parseOverlayMetric('steps')).toBeNull();
    expect(parseOverlayMetric('')).toBeNull();
    expect(parseOverlayMetric(undefined)).toBeNull();
  });

  it('distinguishes "not requested" from "invalid"', () => {
    expect(isOverlayRequested(undefined)).toBe(false);
    expect(isOverlayRequested('  ')).toBe(false);
    expect(isOverlayRequested('steps')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Window + range filtering (Req 12.1)
// ---------------------------------------------------------------------------

describe('computeWindow / isWithinWindow (Req 12.1)', () => {
  it('spans the requested number of days back from the anchor', () => {
    const window = computeWindow(30, NOW);
    expect(window).not.toBeNull();
    expect(window?.endMs).toBe(NOW_MS);
    expect(window?.startMs).toBe(NOW_MS - 30 * MS_PER_DAY);
  });

  it('returns null for an unparseable anchor', () => {
    expect(computeWindow(7, 'not-a-date')).toBeNull();
  });

  it('is inclusive on both bounds and rejects unparseable timestamps', () => {
    const window = computeWindow(7, NOW) as TimeWindow;
    expect(isWithinWindow(NOW, window)).toBe(true);
    expect(isWithinWindow(daysAgo(7), window)).toBe(true);
    expect(isWithinWindow(daysAgo(7.5), window)).toBe(false);
    expect(isWithinWindow('nope', window)).toBe(false);
  });
});

describe('filterReadingsInRange (Req 12.1 / Property 31)', () => {
  const window = computeWindow(7, NOW) as TimeWindow;

  it('keeps exactly the in-range readings, ascending by time', () => {
    const inA = reading({ id: 'a', measuredAt: daysAgo(1) });
    const inB = reading({ id: 'b', measuredAt: daysAgo(5) });
    const out = reading({ id: 'c', measuredAt: daysAgo(20) });

    const result = filterReadingsInRange([inA, out, inB], window);
    expect(result.map((r) => r.id)).toEqual(['b', 'a']);
  });

  it('filters purely by timestamp, regardless of validity flag', () => {
    const invalidInRange = reading({
      id: 'x',
      measuredAt: daysAgo(2),
      valid: false,
    });
    const result = filterReadingsInRange([invalidInRange], window);
    expect(result.map((r) => r.id)).toEqual(['x']);
  });

  it('returns an empty array when nothing is in range', () => {
    expect(
      filterReadingsInRange([reading({ measuredAt: daysAgo(90) })], window),
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Reference bands (Req 12.1)
// ---------------------------------------------------------------------------

describe('deriveReferenceBands (Req 12.1)', () => {
  it('derives one band per contextualized time-of-day bucket, in diurnal order', () => {
    const readings = [
      reading({
        measuredAt: daysAgo(1),
        timeOfDayBucket: 'evening',
        contextualized: {
          ageBand: '18-64',
          sex: 'F',
          refLower: 0.5,
          refUpper: 4,
          classification: 'normal',
        },
      }),
      reading({
        measuredAt: daysAgo(2),
        timeOfDayBucket: 'morning',
        contextualized: {
          ageBand: '18-64',
          sex: 'F',
          refLower: 5,
          refUpper: 23,
          classification: 'normal',
        },
      }),
    ];
    const bands = deriveReferenceBands(readings);
    expect(bands.map((b) => b.bucket)).toEqual(['morning', 'evening']);
    expect(bands[0]).toMatchObject({ refLower: 5, refUpper: 23 });
  });

  it('omits bands for readings that were never contextualized', () => {
    expect(deriveReferenceBands([reading({ measuredAt: daysAgo(1) })])).toEqual(
      [],
    );
  });
});

// ---------------------------------------------------------------------------
// Life-event annotations (Req 12.3, 12.4)
// ---------------------------------------------------------------------------

describe('selectInRangeAnnotations (Req 12.3, 12.4)', () => {
  const window = computeWindow(30, NOW) as TimeWindow;

  const events: LifeEvent[] = [
    { userId: 'u1', date: daysAgo(2), label: 'in-range recent' },
    { userId: 'u1', date: daysAgo(29), label: 'in-range edge' },
    { userId: 'u1', date: daysAgo(45), label: 'out-of-range' },
    { userId: 'u1', date: 'garbage', label: 'unparseable' },
  ];

  it('annotates only in-range events and omits out-of-range ones without error', () => {
    const annotations = selectInRangeAnnotations(events, window);
    expect(annotations.map((a) => a.label)).toEqual([
      'in-range edge',
      'in-range recent',
    ]);
  });

  it('returns no annotations when the list is empty', () => {
    expect(selectInRangeAnnotations([], window)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Overlay selection (Req 12.5, 12.6)
// ---------------------------------------------------------------------------

describe('selectOverlay (Req 12.5, 12.6)', () => {
  const window = computeWindow(7, NOW) as TimeWindow;

  it('keeps in-range overlay points on the shared axis, ascending', () => {
    const points: OverlayPoint[] = [
      { at: daysAgo(1), value: 2000 },
      { at: daysAgo(6), value: 1800 },
      { at: daysAgo(30), value: 1500 },
    ];
    const series = selectOverlay('calories', points, window);
    expect(series.available).toBe(true);
    expect(series.points.map((p) => p.value)).toEqual([1800, 2000]);
  });

  it('reports no-overlay-data when nothing is in range (Req 12.6)', () => {
    const series = selectOverlay('hrv', [{ at: daysAgo(40), value: 55 }], window);
    expect(series.available).toBe(false);
    expect(series.points).toEqual([]);
    expect(series.message).toMatch(/no hrv data/i);
  });
});

// ---------------------------------------------------------------------------
// Orchestration — queryTrend (Req 12.1–12.6)
// ---------------------------------------------------------------------------

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

/** In-memory read port that records which endpoint each read was routed to. */
class FakeReads implements TrendReadPort {
  readonly routedHosts: string[] = [];

  constructor(
    private readonly readings: readonly CortisolReading[],
    private readonly events: readonly LifeEvent[],
    private readonly overlay: readonly OverlayPoint[] = [],
  ) {}

  async fetchCortisolReadings(
    ep: DbEndpoint,
    _userId: string,
    _window: TimeWindow,
  ): Promise<readonly CortisolReading[]> {
    this.routedHosts.push(ep.host);
    return this.readings;
  }

  async fetchLifeEvents(
    ep: DbEndpoint,
    _userId: string,
  ): Promise<readonly LifeEvent[]> {
    this.routedHosts.push(ep.host);
    return this.events;
  }

  async fetchOverlaySeries(
    ep: DbEndpoint,
    _userId: string,
    _metric: 'calories' | 'sleep' | 'hrv',
    _window: TimeWindow,
  ): Promise<readonly OverlayPoint[]> {
    this.routedHosts.push(ep.host);
    return this.overlay;
  }
}

describe('queryTrend validation (Req 12.1, 12.2, 12.5)', () => {
  const reads = new FakeReads([], []);
  const deps = { router: new ReplicaRouter(CONFIG), reads };

  it('rejects a blank userId', async () => {
    const result = await queryTrend({ userId: '', range: 7, asOf: NOW }, deps);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.code).toBe(TrendErrorCode.INVALID_REQUEST);
      expect(result.error.retainedState).toBe(true);
    }
  });

  it('rejects an unsupported range and retains prior state (Req 12.2)', async () => {
    const result = await queryTrend(
      { userId: 'u1', range: 14, asOf: NOW },
      deps,
    );
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.code).toBe(TrendErrorCode.INVALID_RANGE);
      expect(result.error.retainedState).toBe(true);
    }
  });

  it('rejects an unsupported overlay metric (Req 12.5)', async () => {
    const result = await queryTrend(
      { userId: 'u1', range: 7, asOf: NOW, overlay: 'steps' },
      deps,
    );
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.code).toBe(TrendErrorCode.INVALID_OVERLAY_METRIC);
    }
  });

  it('rejects an unparseable anchor', async () => {
    const result = await queryTrend(
      { userId: 'u1', range: 7, asOf: 'nope' },
      deps,
    );
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.code).toBe(TrendErrorCode.INVALID_AS_OF);
    }
  });
});

describe('queryTrend assembly (Req 12.1–12.6)', () => {
  it('routes reads to a read replica and returns in-range readings + bands', async () => {
    const reads = new FakeReads(
      [
        reading({
          id: 'in',
          measuredAt: daysAgo(2),
          timeOfDayBucket: 'morning',
          contextualized: {
            ageBand: '18-64',
            sex: 'F',
            refLower: 5,
            refUpper: 23,
            classification: 'normal',
          },
        }),
        reading({ id: 'out', measuredAt: daysAgo(40) }),
      ],
      [],
    );
    const deps = { router: new ReplicaRouter(CONFIG), reads };

    const result = await queryTrend(
      { userId: 'u1', range: 7, asOf: NOW },
      deps,
    );
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.readings.map((r) => r.id)).toEqual(['in']);
      expect(result.value.referenceBands).toHaveLength(1);
      expect(result.value.empty).toBe(false);
      expect(result.value.retainedRange).toBe(7);
    }
    // Req 12.1: every read was routed to the configured replica.
    expect(reads.routedHosts.every((h) => h === 'replica-1')).toBe(true);
  });

  it('returns an empty-state that retains the selected range (Req 12.2)', async () => {
    const reads = new FakeReads([reading({ measuredAt: daysAgo(40) })], []);
    const deps = { router: new ReplicaRouter(CONFIG), reads };

    const result = await queryTrend(
      { userId: 'u1', range: 30, asOf: NOW },
      deps,
    );
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.empty).toBe(true);
      expect(result.value.emptyMessage).toMatch(/no cortisol data/i);
      expect(result.value.retainedRange).toBe(30);
      expect(result.value.readings).toEqual([]);
    }
  });

  it('annotates only in-range life events (Req 12.3, 12.4)', async () => {
    const reads = new FakeReads(
      [reading({ measuredAt: daysAgo(1) })],
      [
        { userId: 'u1', date: daysAgo(3), label: 'in' },
        { userId: 'u1', date: daysAgo(60), label: 'out' },
      ],
    );
    const deps = { router: new ReplicaRouter(CONFIG), reads };

    const result = await queryTrend(
      { userId: 'u1', range: 30, asOf: NOW },
      deps,
    );
    if (isOk(result)) {
      expect(result.value.annotations.map((a) => a.label)).toEqual(['in']);
    } else {
      throw new Error('expected ok');
    }
  });

  it('attaches an overlay when data exists in range (Req 12.5)', async () => {
    const reads = new FakeReads(
      [reading({ measuredAt: daysAgo(1) })],
      [],
      [{ at: daysAgo(2), value: 55 }],
    );
    const deps = { router: new ReplicaRouter(CONFIG), reads };

    const result = await queryTrend(
      { userId: 'u1', range: 7, asOf: NOW, overlay: 'hrv' },
      deps,
    );
    if (isOk(result)) {
      expect(result.value.overlay?.metric).toBe('hrv');
      expect(result.value.overlay?.available).toBe(true);
      expect(result.value.overlay?.points).toHaveLength(1);
    } else {
      throw new Error('expected ok');
    }
  });

  it('indicates no-overlay-data and renders cortisol alone (Req 12.6)', async () => {
    const reads = new FakeReads(
      [reading({ measuredAt: daysAgo(1) })],
      [],
      [{ at: daysAgo(40), value: 55 }], // out of the 7-day range
    );
    const deps = { router: new ReplicaRouter(CONFIG), reads };

    const result = await queryTrend(
      { userId: 'u1', range: 7, asOf: NOW, overlay: 'sleep' },
      deps,
    );
    if (isOk(result)) {
      expect(result.value.readings).toHaveLength(1);
      expect(result.value.overlay?.available).toBe(false);
      expect(result.value.overlay?.message).toMatch(/no sleep data/i);
    } else {
      throw new Error('expected ok');
    }
  });

  it('omits overlay reads entirely when no overlay is requested (Req 12.5)', async () => {
    const reads = new FakeReads([reading({ measuredAt: daysAgo(1) })], []);
    const deps = { router: new ReplicaRouter(CONFIG), reads };

    const result = await queryTrend(
      { userId: 'u1', range: 7, asOf: NOW },
      deps,
    );
    if (isOk(result)) {
      expect(result.value.overlay).toBeNull();
    } else {
      throw new Error('expected ok');
    }
  });
});
