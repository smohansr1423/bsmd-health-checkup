import fc from 'fast-check';

import { isOk } from '@calorie-cortisol/shared/result';

import {
  auditAccessibility,
  collectViolations,
  contrastRatio,
  hasRequiredSemantics,
  isLargeText,
  isLogicalFocusOrder,
  meetsContrast,
  meetsTargetSize,
} from './accessibility';
import {
  startVoiceGuidedSession,
  submitSpokenResponse,
} from './voice-logging';
import {
  MAX_FIELD_ATTEMPTS,
  MIN_CONTRAST_LARGE,
  MIN_CONTRAST_NORMAL,
  MIN_TARGET_CSS_PX,
  type AccessibilityNode,
  type AccessibilityScreen,
  type Color,
  type FocusableElement,
  type InteractiveTarget,
  type TextContrastSample,
  type TextStyle,
  type VoiceGuidedField,
} from './types';

/**
 * Property 61: Accessibility semantics completeness
 * Validates: Requirements 26.1, 26.2, 26.5
 * Feature: calorie-cortisol-tool, Property 61
 *
 * For any rendered screen, every interactive element and informational image
 * exposes an accessible name, role, and current state (Req 26.2); text/background
 * color pairs meet the WCAG AA contrast minimums (4.5:1 normal, 3:1 large) and
 * interactive targets are at least 44×44 CSS px (Req 26.1); and voice-guided
 * fields re-prompt at most 3 times before offering an alternative input method
 * (Req 26.5).
 *
 * Each claim is checked against an INDEPENDENT restatement of the requirement
 * rather than by reusing the module's own aggregation:
 *  - the screen audit is conformant iff the conjunction of every element-level
 *    rule holds (the audit misses no rule family);
 *  - the contrast decision matches a from-scratch WCAG relative-luminance oracle;
 *  - the target-size decision requires both dimensions ≥ 44;
 *  - the semantics requirement fires exactly for interactive elements and
 *    informational images;
 *  - the voice-guided reducer is driven step by step and compared to a
 *    hand-rolled attempt counter that offers an alternative after 3 failures.
 */

// --- Colour / style arbitraries --------------------------------------------

const arbChannel = fc.integer({ min: 0, max: 255 });
const arbColor: fc.Arbitrary<Color> = fc.record({
  r: arbChannel,
  g: arbChannel,
  b: arbChannel,
});

const arbTextStyle: fc.Arbitrary<TextStyle> = fc.record({
  pointSizePt: fc.integer({ min: 6, max: 48 }),
  bold: fc.boolean(),
});

// --- Independent WCAG luminance / contrast oracle (Req 26.1) ----------------

/** From-scratch relative luminance, independent of the module implementation. */
function oracleLuminance(color: Color): number {
  const lin = (v: number): number => {
    const c = Math.min(255, Math.max(0, v)) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(color.r) + 0.7152 * lin(color.g) + 0.0722 * lin(color.b);
}

function oracleContrast(a: Color, b: Color): number {
  const la = oracleLuminance(a);
  const lb = oracleLuminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

/** Independent "large text" classification: ≥18pt, or ≥14pt when bold. */
function oracleIsLarge(style: TextStyle): boolean {
  return style.pointSizePt >= 18 || (style.bold && style.pointSizePt >= 14);
}

/** Independent required minimum for a style. */
function oracleRequired(style: TextStyle): number {
  return oracleIsLarge(style) ? MIN_CONTRAST_LARGE : MIN_CONTRAST_NORMAL;
}

// --- Node / target / focusable arbitraries ---------------------------------

const arbName = fc.oneof(
  fc.constant(''),
  fc.constant('   '),
  fc.string({ minLength: 1, maxLength: 12 }),
);
const arbState = fc.oneof(
  fc.constant(undefined),
  fc.constant(''),
  fc.constant('  '),
  fc.constantFrom('enabled', 'checked', 'expanded', 'disabled'),
);
const arbRole = fc.constantFrom(
  'button',
  'link',
  'image',
  'text',
  'checkbox',
  'heading',
  'other',
) as fc.Arbitrary<AccessibilityNode['role']>;

let nodeCounter = 0;
const arbNode: fc.Arbitrary<AccessibilityNode> = fc
  .record({
    role: arbRole,
    accessibleName: arbName,
    state: arbState,
    interactive: fc.boolean(),
    informativeImage: fc.boolean(),
  })
  .map((r) => {
    nodeCounter += 1;
    return { id: `n${nodeCounter}`, ...r };
  });

let targetCounter = 0;
const arbTarget: fc.Arbitrary<InteractiveTarget> = fc
  .record({
    widthCssPx: fc.integer({ min: 10, max: 80 }),
    heightCssPx: fc.integer({ min: 10, max: 80 }),
  })
  .map((r) => {
    targetCounter += 1;
    return { id: `t${targetCounter}`, ...r };
  });

let sampleCounter = 0;
const arbTextSample: fc.Arbitrary<TextContrastSample> = fc
  .record({ foreground: arbColor, background: arbColor, style: arbTextStyle })
  .map((r) => {
    sampleCounter += 1;
    return { id: `s${sampleCounter}`, ...r };
  });

/**
 * A set of focusable elements whose reading indices form 0..n-1 and whose focus
 * indices are a (possibly different) permutation, so both logical and illogical
 * orders — plus missing indicators — are exercised.
 */
const arbFocusables: fc.Arbitrary<readonly FocusableElement[]> = fc
  .integer({ min: 0, max: 6 })
  .chain((n) => {
    if (n === 0) return fc.constant([] as FocusableElement[]);
    const ids = Array.from({ length: n }, (_, i) => i);
    return fc.record({
      focusOrder: fc.shuffledSubarray(ids, { minLength: n, maxLength: n }),
      indicators: fc.array(fc.boolean(), { minLength: n, maxLength: n }),
    }).map(({ focusOrder, indicators }) =>
      ids.map((readingIndex, i) => ({
        id: `f${readingIndex}`,
        readingIndex,
        focusIndex: focusOrder[i],
        hasVisibleFocusIndicator: indicators[i],
      })),
    );
  });

const arbScreen: fc.Arbitrary<AccessibilityScreen> = fc.record({
  nodes: fc.array(arbNode, { maxLength: 6 }),
  textSamples: fc.array(arbTextSample, { maxLength: 6 }),
  targets: fc.array(arbTarget, { maxLength: 6 }),
  focusables: arbFocusables,
});

// --- Independent screen-conformance oracle ---------------------------------

/**
 * Independent restatement of "the screen is fully conformant": every node has
 * required semantics, every text sample meets its contrast minimum, every
 * target meets the size minimum, every focusable has an indicator, and (when
 * any focusables exist) the focus order is logical.
 */
function oracleConformant(screen: AccessibilityScreen): boolean {
  const semanticsOk = screen.nodes.every((node) => {
    const named = node.accessibleName.trim().length > 0;
    if (node.interactive) {
      return named && node.state !== undefined && node.state.trim().length > 0;
    }
    if (node.informativeImage) return named;
    return true;
  });
  const contrastOk = screen.textSamples.every(
    (s) => oracleContrast(s.foreground, s.background) >= oracleRequired(s.style),
  );
  const sizeOk = screen.targets.every(
    (t) =>
      t.widthCssPx >= MIN_TARGET_CSS_PX && t.heightCssPx >= MIN_TARGET_CSS_PX,
  );
  const indicatorsOk = screen.focusables.every((f) => f.hasVisibleFocusIndicator);
  const focusOrderOk =
    screen.focusables.length === 0 || isLogicalFocusOrder(screen.focusables);
  return semanticsOk && contrastOk && sizeOk && indicatorsOk && focusOrderOk;
}

describe('Property 61: Accessibility semantics completeness (Req 26.1, 26.2, 26.5) [Feature: calorie-cortisol-tool, Property 61]', () => {
  it('audits a screen as conformant iff every element-level rule independently holds', () => {
    fc.assert(
      fc.property(arbScreen, (screen) => {
        const conformant = isOk(auditAccessibility(screen));
        const noViolations = collectViolations(screen).length === 0;
        // The audit's own two views agree...
        expect(conformant).toBe(noViolations);
        // ...and both equal the independent conjunction of all rule families.
        expect(conformant).toBe(oracleConformant(screen));
      }),
      { numRuns: 100 },
    );
  });

  it('accepts text contrast exactly when it meets the WCAG AA minimum for its style (Req 26.1)', () => {
    fc.assert(
      fc.property(arbColor, arbColor, arbTextStyle, (fg, bg, style) => {
        const required = oracleRequired(style);
        const expected = oracleContrast(fg, bg) >= required;
        expect(meetsContrast(fg, bg, style)).toBe(expected);
        // Contrast ratio itself is symmetric and within the WCAG [1, 21] band.
        const ratio = contrastRatio(fg, bg);
        expect(ratio).toBeCloseTo(contrastRatio(bg, fg), 10);
        expect(ratio).toBeGreaterThanOrEqual(1 - 1e-9);
        expect(ratio).toBeLessThanOrEqual(21 + 1e-9);
        expect(isLargeText(style)).toBe(oracleIsLarge(style));
      }),
      { numRuns: 100 },
    );
  });

  it('accepts an interactive target exactly when both dimensions are ≥ 44 CSS px (Req 26.1)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 10, max: 80 }),
        fc.integer({ min: 10, max: 80 }),
        (w, h) => {
          const expected = w >= MIN_TARGET_CSS_PX && h >= MIN_TARGET_CSS_PX;
          expect(meetsTargetSize({ id: 't', widthCssPx: w, heightCssPx: h })).toBe(
            expected,
          );
        },
      ),
      { numRuns: 100 },
    );
  });

  it('requires accessible name/role/state exactly for interactive elements and informational images (Req 26.2)', () => {
    fc.assert(
      fc.property(arbNode, (node) => {
        const named = node.accessibleName.trim().length > 0;
        let expected: boolean;
        if (node.interactive) {
          expected =
            named && node.state !== undefined && node.state.trim().length > 0;
        } else if (node.informativeImage) {
          expected = named;
        } else {
          expected = true;
        }
        expect(hasRequiredSemantics(node)).toBe(expected);
      }),
      { numRuns: 100 },
    );
  });

  // --- Voice-guided re-prompt limit (Req 26.5) -----------------------------

  /** A field that accepts only tokens in `valid`; anything else is invalid. */
  function fieldAccepting(valid: readonly string[]): VoiceGuidedField {
    return {
      id: 'foodName',
      prompt: 'What did you eat?',
      expectedInput: 'Say the name of the food.',
      validate: (spoken) => (valid.includes(spoken.trim()) ? spoken.trim() : null),
    };
  }

  it('re-prompts at most 3 times, then offers an alternative input method, for a persistently invalid field (Req 26.5)', () => {
    // A field that rejects every response, and 4..10 invalid responses.
    fc.assert(
      fc.property(
        fc.array(fc.string(), { minLength: MAX_FIELD_ATTEMPTS + 1, maxLength: 10 }),
        (responses) => {
          const field = fieldAccepting([]); // nothing is ever valid
          let state = startVoiceGuidedSession([field]);
          const statuses: string[] = [];
          const attempts: number[] = [];
          for (const spoken of responses) {
            state = submitSpokenResponse(state, [field], spoken);
            statuses.push(state.status);
            attempts.push(state.attempts);
          }
          // Attempts 1 and 2 keep re-prompting the same field...
          expect(statuses[0]).toBe('prompting');
          expect(attempts[0]).toBe(1);
          expect(statuses[1]).toBe('prompting');
          expect(attempts[1]).toBe(2);
          // ...the 3rd failure offers an alternative input method.
          expect(statuses[2]).toBe('alternativeInput');
          expect(attempts[2]).toBe(MAX_FIELD_ATTEMPTS);
          // Every subsequent response is ignored: still alternativeInput, and
          // the attempt count never exceeds the 3-attempt maximum.
          for (let i = 2; i < statuses.length; i += 1) {
            expect(statuses[i]).toBe('alternativeInput');
          }
          expect(Math.max(...attempts)).toBeLessThanOrEqual(MAX_FIELD_ATTEMPTS);
          // The field is never recorded as collected when it was never valid.
          expect(state.collected).toEqual({});
        },
      ),
      { numRuns: 100 },
    );
  });

  it('matches a hand-rolled attempt-counter model over arbitrary valid/invalid response streams (Req 26.5)', () => {
    const VALID = ['apple', 'toast'];
    fc.assert(
      fc.property(
        fc.array(fc.oneof(fc.constantFrom(...VALID), fc.string()), {
          maxLength: 12,
        }),
        (responses) => {
          const field = fieldAccepting(VALID);
          let state = startVoiceGuidedSession([field]);

          // Independent single-field model.
          let mStatus: 'prompting' | 'completed' | 'alternativeInput' =
            'prompting';
          let mAttempts = 0;
          let mDone = false;

          for (const spoken of responses) {
            state = submitSpokenResponse(state, [field], spoken);

            if (!mDone && mStatus === 'prompting') {
              if (VALID.includes(spoken.trim())) {
                mStatus = 'completed';
                mDone = true;
              } else {
                mAttempts += 1;
                mStatus =
                  mAttempts >= MAX_FIELD_ATTEMPTS ? 'alternativeInput' : 'prompting';
                if (mStatus === 'alternativeInput') mDone = true;
              }
            }

            expect(state.status).toBe(mStatus);
            if (state.status === 'prompting') {
              expect(state.attempts).toBe(mAttempts);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
