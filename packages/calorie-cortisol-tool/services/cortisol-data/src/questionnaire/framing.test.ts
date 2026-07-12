import {
  NON_CLINICAL_FRAMING_TEXT,
  framingPrecedesTier,
  presentTier,
} from './framing';
import type { BurdenTier } from './types';

const TIERS: BurdenTier[] = ['Low', 'Moderate', 'Elevated', 'High'];

describe('presentTier non-clinical framing (Req 10.4)', () => {
  it('places the framing text before the tier value for every tier', () => {
    for (const tier of TIERS) {
      const presentation = presentTier(tier);
      expect(presentation.segments[0]).toEqual({
        kind: 'framing',
        text: NON_CLINICAL_FRAMING_TEXT,
      });
      expect(presentation.segments[1]).toEqual({ kind: 'tier', value: tier });
      expect(framingPrecedesTier(presentation)).toBe(true);
    }
  });

  it('exposes the framing text and tier via convenience accessors', () => {
    const presentation = presentTier('Elevated');
    expect(presentation.framingText).toBe(NON_CLINICAL_FRAMING_TEXT);
    expect(presentation.tier).toBe('Elevated');
  });

  it('uses non-clinical, non-diagnostic wording', () => {
    expect(NON_CLINICAL_FRAMING_TEXT.toLowerCase()).toContain('wellness estimate');
    expect(NON_CLINICAL_FRAMING_TEXT.toLowerCase()).toContain('not a medical diagnosis');
  });
});
