import {
  hasValidTimestamp,
  isCategoryAuthorized,
  isValidReadingValue,
  READING_VALUE_MAX,
  READING_VALUE_MIN,
  syncWearable,
  validateReading,
  type RawWearableReading,
  type WearableSyncRequest,
} from './wearable-sync';

/**
 * Focused unit tests for the wearable/patch sync pipeline (Task 9.7).
 * Requirements: 9.2, 9.3, 9.4, 9.5, 9.8
 */

const reading = (over: Partial<RawWearableReading> = {}): RawWearableReading => ({
  category: 'cortisol',
  metricType: 'patchCortisol',
  value: 12.5,
  unit: 'ng/mL',
  capturedAt: '2024-01-01T08:00:00.000Z',
  sourceId: 'patch-abc',
  ...over,
});

const request = (over: Partial<WearableSyncRequest> = {}): WearableSyncRequest => ({
  userId: 'user-1',
  sourceType: 'patch',
  connectionStatus: 'active',
  authorizedCategories: ['cortisol'],
  readings: [reading()],
  ...over,
});

describe('isValidReadingValue (Req 9.4)', () => {
  it('accepts values within the inclusive [0.01, 100] range', () => {
    expect(isValidReadingValue(READING_VALUE_MIN)).toBe(true);
    expect(isValidReadingValue(READING_VALUE_MAX)).toBe(true);
    expect(isValidReadingValue(50)).toBe(true);
  });

  it('rejects values outside the range and non-finite values', () => {
    expect(isValidReadingValue(0)).toBe(false);
    expect(isValidReadingValue(0.009)).toBe(false);
    expect(isValidReadingValue(100.01)).toBe(false);
    expect(isValidReadingValue(-5)).toBe(false);
    expect(isValidReadingValue(Number.NaN)).toBe(false);
    expect(isValidReadingValue(Number.POSITIVE_INFINITY)).toBe(false);
  });
});

describe('hasValidTimestamp (Req 9.4)', () => {
  it('accepts a parseable ISO timestamp', () => {
    expect(hasValidTimestamp('2024-01-01T08:00:00.000Z')).toBe(true);
  });

  it('rejects missing, empty, and unparseable timestamps', () => {
    expect(hasValidTimestamp(undefined)).toBe(false);
    expect(hasValidTimestamp(null)).toBe(false);
    expect(hasValidTimestamp('')).toBe(false);
    expect(hasValidTimestamp('   ')).toBe(false);
    expect(hasValidTimestamp('not-a-date')).toBe(false);
  });
});

describe('validateReading (Req 9.4)', () => {
  it('accepts an in-range, timestamped reading', () => {
    expect(validateReading(reading())).toEqual({ valid: true });
  });

  it('rejects an out-of-range value', () => {
    expect(validateReading(reading({ value: 200 }))).toEqual({
      valid: false,
      reason: 'value_out_of_range',
    });
  });

  it('rejects a reading without a timestamp', () => {
    expect(validateReading(reading({ capturedAt: null }))).toEqual({
      valid: false,
      reason: 'missing_timestamp',
    });
  });

  it('reports missing_timestamp first when a reading is both invalid', () => {
    expect(validateReading(reading({ value: 200, capturedAt: undefined }))).toEqual({
      valid: false,
      reason: 'missing_timestamp',
    });
  });
});

describe('isCategoryAuthorized (Req 9.2)', () => {
  it('is true only for explicitly authorized categories', () => {
    expect(isCategoryAuthorized('cortisol', ['cortisol', 'hrv'])).toBe(true);
    expect(isCategoryAuthorized('sleep', ['cortisol', 'hrv'])).toBe(false);
    expect(isCategoryAuthorized('cortisol', [])).toBe(false);
  });
});

describe('syncWearable — reauthorization / inactive handling (Req 9.8)', () => {
  it('stops sync and prompts reauthorization for a revoked connection', () => {
    const result = syncWearable(request({ connectionStatus: 'revoked' }));
    expect(result.status).toBe('inactive');
    expect(result.connectionActive).toBe(false);
    expect(result.accepted).toHaveLength(0);
    expect(result.invalid).toHaveLength(0);
    expect(result.retainedPriorData).toBe(true);
    expect(result.notifications).toEqual([
      expect.objectContaining({ kind: 'reauthorization_required' }),
    ]);
  });

  it('does not import from an inactive connection but retains prior data', () => {
    const result = syncWearable(request({ connectionStatus: 'inactive' }));
    expect(result.status).toBe('inactive');
    expect(result.connectionActive).toBe(false);
    expect(result.accepted).toHaveLength(0);
    expect(result.retainedPriorData).toBe(true);
    expect(result.notifications[0].kind).toBe('reauthorization_required');
  });
});

describe('syncWearable — authorization scoping (Req 9.2)', () => {
  it('excludes unauthorized categories and notifies which are unavailable', () => {
    const result = syncWearable(
      request({
        authorizedCategories: ['cortisol'],
        readings: [
          reading({ category: 'cortisol' }),
          reading({ category: 'sleep', metricType: 'sleep' }),
          reading({ category: 'steps', metricType: 'steps' }),
        ],
      }),
    );

    expect(result.accepted).toHaveLength(1);
    expect(result.accepted[0].category).toBe('cortisol');
    expect(result.excludedReadingCount).toBe(2);
    expect([...result.excludedCategories].sort()).toEqual(['sleep', 'steps']);

    const notice = result.notifications.find((n) => n.kind === 'categories_unavailable');
    expect(notice).toBeDefined();
    expect([...(notice?.categories ?? [])].sort()).toEqual(['sleep', 'steps']);
  });

  it('produces no categories-unavailable notification when all are authorized', () => {
    const result = syncWearable(
      request({
        authorizedCategories: ['cortisol', 'hrv'],
        readings: [reading({ category: 'cortisol' }), reading({ category: 'hrv' })],
      }),
    );
    expect(result.excludedReadingCount).toBe(0);
    expect(result.notifications).toHaveLength(0);
  });
});

describe('syncWearable — per-reading validation isolates invalid readings (Req 9.4)', () => {
  it('accepts valid readings while recording invalid ones from the same batch', () => {
    const good = reading({ value: 10, capturedAt: '2024-01-01T08:00:00.000Z' });
    const outOfRange = reading({ value: 250 });
    const noTimestamp = reading({ value: 5, capturedAt: null });

    const result = syncWearable(
      request({ readings: [good, outOfRange, noTimestamp] }),
    );

    expect(result.accepted).toHaveLength(1);
    expect(result.accepted[0].value).toBe(10);
    expect(result.invalid).toHaveLength(2);
    expect(result.invalid.map((i) => i.reason).sort()).toEqual([
      'missing_timestamp',
      'value_out_of_range',
    ]);
    // Valid readings are never discarded because the batch had invalid ones.
    expect(result.retainedPriorData).toBe(true);
  });
});

describe('syncWearable — source and timestamp tagging (Req 9.3, 9.5)', () => {
  it('tags a patch reading with its patch id and capture timestamp', () => {
    const result = syncWearable(
      request({
        sourceType: 'patch',
        readings: [reading({ sourceId: 'patch-xyz', capturedAt: '2024-02-02T09:30:00.000Z' })],
      }),
    );
    expect(result.accepted[0].sourceId).toBe('patch-xyz');
    expect(result.accepted[0].deviceType).toBe('patch');
    expect(result.accepted[0].capturedAt).toBe('2024-02-02T09:30:00.000Z');
  });

  it('tags a device reading with the device type when no explicit source id is given', () => {
    const result = syncWearable(
      request({
        sourceType: 'oura',
        authorizedCategories: ['hrv'],
        readings: [reading({ category: 'hrv', metricType: 'hrv', sourceId: null })],
      }),
    );
    expect(result.accepted[0].sourceId).toBe('oura');
    expect(result.accepted[0].deviceType).toBe('oura');
  });
});
