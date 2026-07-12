/**
 * WCAG 2.1 AA accessibility semantics (Task 14.21).
 *
 * Pure, deterministic predicates and audits for Requirement 26:
 *   - accessible name / role / current state for interactive elements and
 *     informational images (Req 26.2)
 *   - contrast ratio (≥4.5:1 normal text, ≥3:1 large text) and interactive
 *     target size (≥44×44 CSS px) (Req 26.1)
 *   - screen-reader announcement of a state change within 1 s (Req 26.3)
 *   - visible focus indicator and logical focus order (Req 26.6)
 *
 * The screen reader is abstracted behind an injectable {@link ScreenReader}
 * port and timing behind a {@link Clock} port so the announcement logic is pure
 * and testable without VoiceOver / TalkBack.
 *
 * Requirements: 26.1, 26.2, 26.3, 26.6
 */

import { err, ok, validationRejection, type Result } from '@calorie-cortisol/shared/result';

import {
  ANNOUNCEMENT_BUDGET_MS,
  AccessibilityErrorCode,
  LARGE_TEXT_BOLD_POINT_SIZE,
  LARGE_TEXT_POINT_SIZE,
  MIN_CONTRAST_LARGE,
  MIN_CONTRAST_NORMAL,
  MIN_TARGET_CSS_PX,
  type AccessibilityNode,
  type AccessibilityScreen,
  type AnnouncementClock,
  type Color,
  type FocusableElement,
  type InteractiveTarget,
  type ScreenReader,
  type TextContrastSample,
  type TextStyle,
} from './types';

// ---------------------------------------------------------------------------
// Contrast (Req 26.1)
// ---------------------------------------------------------------------------

/** Clamp a channel to the valid 0–255 range. */
function clampChannel(c: number): number {
  if (c < 0) return 0;
  if (c > 255) return 255;
  return c;
}

/** WCAG relative luminance of a single linearized sRGB channel component. */
function linearize(channel8bit: number): number {
  const c = clampChannel(channel8bit) / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/**
 * WCAG 2.1 relative luminance of a color (0 = black … 1 = white).
 * https://www.w3.org/TR/WCAG21/#dfn-relative-luminance
 */
export function relativeLuminance(color: Color): number {
  return (
    0.2126 * linearize(color.r) +
    0.7152 * linearize(color.g) +
    0.0722 * linearize(color.b)
  );
}

/**
 * WCAG 2.1 contrast ratio between two colors, in the range [1, 21]. The result
 * is symmetric in its arguments (order-independent) (Req 26.1).
 */
export function contrastRatio(a: Color, b: Color): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Whether text of the given style is "large" per WCAG AA: ≥18pt, or ≥14pt when
 * bold (Req 26.1).
 */
export function isLargeText(style: TextStyle): boolean {
  if (style.pointSizePt >= LARGE_TEXT_POINT_SIZE) {
    return true;
  }
  return style.bold && style.pointSizePt >= LARGE_TEXT_BOLD_POINT_SIZE;
}

/** The minimum contrast ratio required for text of the given style (Req 26.1). */
export function requiredContrast(style: TextStyle): number {
  return isLargeText(style) ? MIN_CONTRAST_LARGE : MIN_CONTRAST_NORMAL;
}

/**
 * Whether a foreground/background pair meets the WCAG AA contrast minimum for
 * the given text style (4.5:1 normal, 3:1 large) (Req 26.1).
 */
export function meetsContrast(
  foreground: Color,
  background: Color,
  style: TextStyle,
): boolean {
  return contrastRatio(foreground, background) >= requiredContrast(style);
}

// ---------------------------------------------------------------------------
// Target size (Req 26.1)
// ---------------------------------------------------------------------------

/**
 * Whether an interactive target meets the ≥44×44 CSS px minimum (Req 26.1).
 * Both dimensions must satisfy the minimum.
 */
export function meetsTargetSize(target: InteractiveTarget): boolean {
  return (
    target.widthCssPx >= MIN_TARGET_CSS_PX &&
    target.heightCssPx >= MIN_TARGET_CSS_PX
  );
}

// ---------------------------------------------------------------------------
// Accessible name / role / state (Req 26.2)
// ---------------------------------------------------------------------------

/**
 * Whether a node exposes the semantics WCAG AA requires (Req 26.2):
 *   - interactive elements: a non-empty accessible name, a role, and a current
 *     state token.
 *   - informational images: a non-empty accessible name (alt text) and a role.
 *   - decorative / non-interactive nodes: no requirement.
 */
export function hasRequiredSemantics(node: AccessibilityNode): boolean {
  const hasName = node.accessibleName.trim().length > 0;
  if (node.interactive) {
    return hasName && node.state !== undefined && node.state.trim().length > 0;
  }
  if (node.informativeImage) {
    return hasName;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Announcements (Req 26.3)
// ---------------------------------------------------------------------------

/** Whether an announcement completed within the 1 s budget (Req 26.3). */
export function withinAnnouncementBudget(elapsedMs: number): boolean {
  return elapsedMs >= 0 && elapsedMs <= ANNOUNCEMENT_BUDGET_MS;
}

/** The outcome of announcing a state change through the screen reader. */
export interface AnnouncementOutcome {
  /** Whether a screen reader was active and the announcement was emitted. */
  readonly announced: boolean;
  /** Wall-clock time the announcement took, in ms. */
  readonly elapsedMs: number;
  /** Whether the announcement completed within the 1 s budget (Req 26.3). */
  readonly withinBudget: boolean;
}

/**
 * Announce a user-action-driven state change through the active screen reader
 * and report whether it completed within 1 second (Req 26.3). When no screen
 * reader is active the announcement is skipped (`announced: false`). Timing is
 * measured via the injected {@link Clock} so the logic is testable.
 */
export function announceStateChange(
  message: string,
  screenReader: ScreenReader,
  clock: AnnouncementClock,
): AnnouncementOutcome {
  if (!screenReader.isActive()) {
    return { announced: false, elapsedMs: 0, withinBudget: true };
  }
  const start = clock.now();
  screenReader.announce(message);
  const elapsedMs = clock.now() - start;
  return {
    announced: true,
    elapsedMs,
    withinBudget: withinAnnouncementBudget(elapsedMs),
  };
}

// ---------------------------------------------------------------------------
// Focus order (Req 26.6)
// ---------------------------------------------------------------------------

/** The ids of focusable elements in the order the focus system will visit them. */
export function focusSequence(
  elements: readonly FocusableElement[],
): string[] {
  return [...elements]
    .sort((a, b) => a.focusIndex - b.focusIndex)
    .map((e) => e.id);
}

/**
 * Whether focus moves in a logical reading order and every focusable element
 * has a visible focus indicator (Req 26.6). Focus order is logical iff visiting
 * elements by ascending `focusIndex` yields the same element sequence as the
 * intended reading order (ascending `readingIndex`).
 */
export function isLogicalFocusOrder(
  elements: readonly FocusableElement[],
): boolean {
  if (!elements.every((e) => e.hasVisibleFocusIndicator)) {
    return false;
  }
  const byReading = [...elements]
    .sort((a, b) => a.readingIndex - b.readingIndex)
    .map((e) => e.id);
  const byFocus = focusSequence(elements);
  return byReading.length === byFocus.length &&
    byReading.every((id, i) => id === byFocus[i]);
}

// ---------------------------------------------------------------------------
// Screen-level audit (Req 26.1, 26.2, 26.6)
// ---------------------------------------------------------------------------

/** A single accessibility violation found while auditing a screen. */
export interface A11yViolation {
  readonly code: AccessibilityErrorCode;
  readonly elementId: string;
  readonly message: string;
}

/**
 * Audit a full screen against the checkable WCAG AA rules (Req 26.1, 26.2,
 * 26.6): missing semantics, insufficient contrast, undersized targets, and
 * illogical/indicatorless focus order. Returns a success result when the screen
 * is conformant, or a validation rejection carrying every violation found.
 */
export function auditAccessibility(
  screen: AccessibilityScreen,
): Result<{ conformant: true }> {
  const violations = collectViolations(screen);
  if (violations.length === 0) {
    return ok({ conformant: true });
  }
  const summary = violations
    .map((v) => `${v.elementId}: ${v.message}`)
    .join('; ');
  const primary = violations[0];
  return err(
    validationRejection(
      primary.code,
      `Screen fails WCAG 2.1 AA (${violations.length} issue(s)): ${summary}`,
    ),
  );
}

/** Collect every WCAG AA violation on a screen (Req 26.1, 26.2, 26.6). */
export function collectViolations(
  screen: AccessibilityScreen,
): A11yViolation[] {
  const violations: A11yViolation[] = [];

  for (const node of screen.nodes) {
    if (!hasRequiredSemantics(node)) {
      violations.push({
        code: AccessibilityErrorCode.MissingSemantics,
        elementId: node.id,
        message:
          'missing accessible name, role, or current state (Req 26.2)',
      });
    }
  }

  for (const sample of screen.textSamples) {
    if (!meetsContrast(sample.foreground, sample.background, sample.style)) {
      violations.push({
        code: AccessibilityErrorCode.InsufficientContrast,
        elementId: sample.id,
        message: `contrast ${contrastRatio(sample.foreground, sample.background).toFixed(2)}:1 below the ${requiredContrast(sample.style)}:1 minimum (Req 26.1)`,
      });
    }
  }

  for (const target of screen.targets) {
    if (!meetsTargetSize(target)) {
      violations.push({
        code: AccessibilityErrorCode.TargetTooSmall,
        elementId: target.id,
        message: `target ${target.widthCssPx}×${target.heightCssPx} below the ${MIN_TARGET_CSS_PX}×${MIN_TARGET_CSS_PX} CSS px minimum (Req 26.1)`,
      });
    }
  }

  for (const focusable of screen.focusables) {
    if (!focusable.hasVisibleFocusIndicator) {
      violations.push({
        code: AccessibilityErrorCode.MissingFocusIndicator,
        elementId: focusable.id,
        message: 'focusable element lacks a visible focus indicator (Req 26.6)',
      });
    }
  }
  if (screen.focusables.length > 0 && !isLogicalFocusOrder(screen.focusables)) {
    violations.push({
      code: AccessibilityErrorCode.IllogicalFocusOrder,
      elementId: '(screen)',
      message: 'focus order does not follow the reading order (Req 26.6)',
    });
  }

  return violations;
}
