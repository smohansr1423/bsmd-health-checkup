import { isRecognizedUnit, toNmolPerL } from './units';

describe('cortisol unit normalization → nmol/L', () => {
  it('passes nmol/L through unchanged', () => {
    expect(toNmolPerL(12.5, 'nmol/L')).toBeCloseTo(12.5, 5);
    expect(toNmolPerL(12.5, 'nmol/l')).toBeCloseTo(12.5, 5);
  });

  it('converts µg/dL using 27.59', () => {
    expect(toNmolPerL(1, 'ug/dL')).toBeCloseTo(27.59, 2);
    expect(toNmolPerL(1, 'µg/dL')).toBeCloseTo(27.59, 2);
  });

  it('converts ng/mL using 2.759', () => {
    expect(toNmolPerL(10, 'ng/mL')).toBeCloseTo(27.59, 2);
  });

  it('is case/space insensitive', () => {
    expect(isRecognizedUnit('  NMOL/L ')).toBe(true);
    expect(isRecognizedUnit('NG/ML')).toBe(true);
  });

  it('returns null for unrecognized units or non-finite values', () => {
    expect(toNmolPerL(1, 'furlongs')).toBeNull();
    expect(isRecognizedUnit('furlongs')).toBe(false);
    expect(toNmolPerL(Number.NaN, 'nmol/L')).toBeNull();
    expect(toNmolPerL(Infinity, 'nmol/L')).toBeNull();
  });
});
