import { isErr, isOk } from '@calorie-cortisol/shared/result';

import {
  announceStateChange,
  auditAccessibility,
  collectViolations,
  contrastRatio,
  focusSequence,
  hasRequiredSemantics,
  isLargeText,
  isLogicalFocusOrder,
  meetsContrast,
  meetsTargetSize,
  relativeLuminance,
  requiredContrast,
  withinAnnouncementBudget,
} from './accessibility';
import {
  AccessibilityErrorCode,
  type AccessibilityNode,
  type AccessibilityScreen,
  type AnnouncementClock,
  type Color,
  type FocusableElement,
  type ScreenReader,
} from './types';

const BLACK: Color = { r: 0, g: 0, b: 0 };
const WHITE: Color = { r: 255, g: 255, b: 255 };
const MID_GRAY: Color = { r: 119, g: 119, b: 119 };

describe('contrast (Req 26.1)', () => {
  it('computes maximum contrast (21:1) for black on white', () => {
    expect(contrastRatio(BLACK, WHITE)).toBeCloseTo(21, 5);
  });

  it('is symmetric in its arguments', () => {
    expect(contrastRatio(BLACK, WHITE)).toBeCloseTo(contrastRatio(WHITE, BLACK), 10);
  });

  it('computes minimum contrast (1:1) for identical colors', () => {
    expect(contrastRatio(MID_GRAY, MID_GRAY)).toBeCloseTo(1, 5);
  });

  it('luminance of white is 1 and black is 0', () => {
    expect(relativeLuminance(WHITE)).toBeCloseTo(1, 5);
    expect(relativeLuminance(BLACK)).toBeCloseTo(0, 5);
  });

  it('classifies large text: ≥18pt, or ≥14pt bold (Req 26.1)', () => {
    expect(isLargeText({ pointSizePt: 18, bold: false })).toBe(true);
    expect(isLargeText({ pointSizePt: 14, bold: true })).toBe(true);
    expect(isLargeText({ pointSizePt: 14, bold: false })).toBe(false);
    expect(isLargeText({ pointSizePt: 17, bold: false })).toBe(false);
  });

  it('requires 4.5:1 for normal text and 3:1 for large text (Req 26.1)', () => {
    expect(requiredContrast({ pointSizePt: 12, bold: false })).toBe(4.5);
    expect(requiredContrast({ pointSizePt: 20, bold: false })).toBe(3);
  });

  it('meetsContrast enforces the style-appropriate minimum', () => {
    // gray-on-white ≈ 4.48:1 — fails normal (4.5) but passes large (3).
    expect(meetsContrast(MID_GRAY, WHITE, { pointSizePt: 12, bold: false })).toBe(false);
    expect(meetsContrast(MID_GRAY, WHITE, { pointSizePt: 20, bold: false })).toBe(true);
  });
});

describe('target size (Req 26.1)', () => {
  it('accepts targets ≥44×44 CSS px', () => {
    expect(meetsTargetSize({ id: 't', widthCssPx: 44, heightCssPx: 44 })).toBe(true);
    expect(meetsTargetSize({ id: 't', widthCssPx: 48, heightCssPx: 60 })).toBe(true);
  });

  it('rejects targets smaller than 44 in either dimension', () => {
    expect(meetsTargetSize({ id: 't', widthCssPx: 43, heightCssPx: 44 })).toBe(false);
    expect(meetsTargetSize({ id: 't', widthCssPx: 44, heightCssPx: 40 })).toBe(false);
  });
});

describe('accessible semantics (Req 26.2)', () => {
  const interactive = (over: Partial<AccessibilityNode>): AccessibilityNode => ({
    id: 'btn',
    role: 'button',
    accessibleName: 'Save',
    state: 'enabled',
    interactive: true,
    informativeImage: false,
    ...over,
  });

  it('requires name, role, and state for interactive elements', () => {
    expect(hasRequiredSemantics(interactive({}))).toBe(true);
    expect(hasRequiredSemantics(interactive({ accessibleName: '' }))).toBe(false);
    expect(hasRequiredSemantics(interactive({ state: undefined }))).toBe(false);
    expect(hasRequiredSemantics(interactive({ state: '  ' }))).toBe(false);
  });

  it('requires an accessible name for informational images', () => {
    const img: AccessibilityNode = {
      id: 'chart',
      role: 'image',
      accessibleName: 'Cortisol trend rising',
      interactive: false,
      informativeImage: true,
    };
    expect(hasRequiredSemantics(img)).toBe(true);
    expect(hasRequiredSemantics({ ...img, accessibleName: '' })).toBe(false);
  });

  it('imposes no requirement on decorative, non-interactive nodes', () => {
    const decorative: AccessibilityNode = {
      id: 'spacer',
      role: 'other',
      accessibleName: '',
      interactive: false,
      informativeImage: false,
    };
    expect(hasRequiredSemantics(decorative)).toBe(true);
  });
});

describe('announcements (Req 26.3)', () => {
  it('classifies within/over the 1s budget', () => {
    expect(withinAnnouncementBudget(0)).toBe(true);
    expect(withinAnnouncementBudget(1000)).toBe(true);
    expect(withinAnnouncementBudget(1001)).toBe(false);
  });

  function clockFrom(times: number[]): AnnouncementClock {
    let i = 0;
    return { now: () => times[Math.min(i++, times.length - 1)] };
  }

  it('announces a state change and reports timing within budget', () => {
    const spoken: string[] = [];
    const sr: ScreenReader = {
      isActive: () => true,
      announce: (m) => spoken.push(m),
    };
    const outcome = announceStateChange('Meal saved', sr, clockFrom([0, 300]));
    expect(outcome.announced).toBe(true);
    expect(outcome.elapsedMs).toBe(300);
    expect(outcome.withinBudget).toBe(true);
    expect(spoken).toEqual(['Meal saved']);
  });

  it('flags an announcement that overruns the 1s budget', () => {
    const sr: ScreenReader = { isActive: () => true, announce: () => undefined };
    const outcome = announceStateChange('slow', sr, clockFrom([0, 1500]));
    expect(outcome.withinBudget).toBe(false);
  });

  it('skips announcing when no screen reader is active', () => {
    const sr: ScreenReader = { isActive: () => false, announce: () => undefined };
    const outcome = announceStateChange('x', sr, clockFrom([0, 0]));
    expect(outcome.announced).toBe(false);
  });
});

describe('focus order (Req 26.6)', () => {
  const el = (
    id: string,
    readingIndex: number,
    focusIndex: number,
    hasVisibleFocusIndicator = true,
  ): FocusableElement => ({ id, readingIndex, focusIndex, hasVisibleFocusIndicator });

  it('computes the focus visitation sequence by ascending focusIndex', () => {
    const els = [el('c', 2, 2), el('a', 0, 0), el('b', 1, 1)];
    expect(focusSequence(els)).toEqual(['a', 'b', 'c']);
  });

  it('accepts a logical order matching the reading order', () => {
    expect(isLogicalFocusOrder([el('a', 0, 0), el('b', 1, 1), el('c', 2, 2)])).toBe(true);
  });

  it('rejects an order that diverges from the reading order', () => {
    // b (reading 1) is focused first, a (reading 0) second.
    expect(isLogicalFocusOrder([el('a', 0, 1), el('b', 1, 0)])).toBe(false);
  });

  it('rejects when a focusable lacks a visible indicator', () => {
    expect(isLogicalFocusOrder([el('a', 0, 0, false), el('b', 1, 1)])).toBe(false);
  });
});

describe('auditAccessibility screen-level audit (Req 26.1, 26.2, 26.6)', () => {
  const conformantScreen: AccessibilityScreen = {
    nodes: [
      {
        id: 'save',
        role: 'button',
        accessibleName: 'Save meal',
        state: 'enabled',
        interactive: true,
        informativeImage: false,
      },
    ],
    textSamples: [
      {
        id: 'title',
        foreground: BLACK,
        background: WHITE,
        style: { pointSizePt: 16, bold: false },
      },
    ],
    targets: [{ id: 'save', widthCssPx: 48, heightCssPx: 48 }],
    focusables: [
      { id: 'save', readingIndex: 0, focusIndex: 0, hasVisibleFocusIndicator: true },
    ],
  };

  it('passes a fully conformant screen', () => {
    const result = auditAccessibility(conformantScreen);
    expect(isOk(result)).toBe(true);
    expect(collectViolations(conformantScreen)).toHaveLength(0);
  });

  it('collects every violation across the four rule families', () => {
    const bad: AccessibilityScreen = {
      nodes: [
        {
          id: 'save',
          role: 'button',
          accessibleName: '',
          interactive: true,
          informativeImage: false,
        },
      ],
      textSamples: [
        {
          id: 'title',
          foreground: MID_GRAY,
          background: WHITE,
          style: { pointSizePt: 12, bold: false },
        },
      ],
      targets: [{ id: 'save', widthCssPx: 30, heightCssPx: 30 }],
      focusables: [
        { id: 'a', readingIndex: 0, focusIndex: 1, hasVisibleFocusIndicator: true },
        { id: 'b', readingIndex: 1, focusIndex: 0, hasVisibleFocusIndicator: true },
      ],
    };
    const violations = collectViolations(bad);
    const codes = violations.map((v) => v.code);
    expect(codes).toContain(AccessibilityErrorCode.MissingSemantics);
    expect(codes).toContain(AccessibilityErrorCode.InsufficientContrast);
    expect(codes).toContain(AccessibilityErrorCode.TargetTooSmall);
    expect(codes).toContain(AccessibilityErrorCode.IllogicalFocusOrder);

    const result = auditAccessibility(bad);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.retainedState).toBe(true);
    }
  });
});
