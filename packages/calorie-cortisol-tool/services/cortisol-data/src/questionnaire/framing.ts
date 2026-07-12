/**
 * Non-clinical wellness framing that must precede any tier value (Req 10.4).
 *
 * The presentation is an ordered list of segments where the framing text is
 * always the first segment and the tier value follows. This makes the ordering
 * constraint ("framing text appears adjacent to and before the tier value")
 * structural and directly checkable.
 */

import type { BurdenTier, TierPresentation, TierPresentationSegment } from './types';

/**
 * The non-clinical framing text shown before the tier value (Req 10.4). It
 * states that the result is a wellness estimate and not a medical diagnosis.
 */
export const NON_CLINICAL_FRAMING_TEXT =
  'This result is a general-wellness estimate and is not a medical diagnosis. ' +
  'It does not replace evaluation by a licensed healthcare professional.';

/**
 * Build the ordered presentation of a burden tier with the non-clinical framing
 * text first, followed by the tier value (Req 10.4).
 */
export function presentTier(tier: BurdenTier): TierPresentation {
  const segments: TierPresentationSegment[] = [
    { kind: 'framing', text: NON_CLINICAL_FRAMING_TEXT },
    { kind: 'tier', value: tier },
  ];
  return { segments, framingText: NON_CLINICAL_FRAMING_TEXT, tier };
}

/**
 * Whether the framing segment precedes the tier segment in a presentation
 * (Req 10.4). Useful as an invariant check.
 */
export function framingPrecedesTier(presentation: TierPresentation): boolean {
  const framingIndex = presentation.segments.findIndex((s) => s.kind === 'framing');
  const tierIndex = presentation.segments.findIndex((s) => s.kind === 'tier');
  return framingIndex >= 0 && tierIndex >= 0 && framingIndex < tierIndex;
}
