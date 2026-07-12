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
