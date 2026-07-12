/**
 * Voice food logging & accessibility semantics — types, constants, and
 * injectable ports (Task 14.21).
 *
 * This module hosts two closely related shared-client concerns:
 *
 *  1. Voice food logging (Req 7.3, 7.4, 26.4, 26.5):
 *     - free-form voice logging: a single spoken input of up to 60 seconds is
 *       transcribed (within a 10 s budget) into a `voice`-sourced meal entry
 *       populated with the transcribed text; a failed or empty transcription
 *       creates no entry, retains prior state, and offers retry / alternative
 *       input (Req 7.3, 7.4).
 *     - voice-guided field-by-field logging: each required data field emits an
 *       audible prompt and accepts a spoken response; an unrecognized/invalid
 *       response emits an audible error describing the expected input and
 *       re-prompts, allowing at most 3 attempts per field before offering an
 *       alternative input method (Req 26.4, 26.5).
 *
 *  2. WCAG 2.1 AA semantics (Req 26.1, 26.2, 26.3, 26.6):
 *     - accessible name / role / current state for interactive elements and
 *       informational images (Req 26.2)
 *     - minimum contrast (4.5:1 normal text, 3:1 large text) and minimum
 *       44×44 CSS px interactive target size (Req 26.1)
 *     - screen-reader announcement of state changes within 1 second (Req 26.3)
 *     - visible focus indicator and logical focus order under keyboard/switch
 *       navigation (Req 26.6)
 *
 * All device / OS effects (the speech recognizer, the audible prompter, the
 * screen reader, the wall clock) are modeled behind injectable ports so the
 * decision logic itself is pure and testable — no real ASR engine, VoiceOver,
 * or TalkBack dependency is required to exercise it. The logic therefore runs
 * identically on iOS, Android, and the PWA.
 *
 * Requirements: 7.3, 7.4, 26.1, 26.2, 26.3, 26.4, 26.5, 26.6
 */

// ===========================================================================
// Voice logging — constants
// ===========================================================================

/** Maximum accepted spoken-input duration for voice logging, 60 s (Req 7.3). */
export const MAX_VOICE_INPUT_SECONDS = 60;

/**
 * Time budget within which a spoken input must be transcribed into a meal entry
 * (Req 7.3). A transcription that takes longer is treated as a timeout: no meal
 * entry is created and the input is retained for retry.
 */
export const VOICE_TRANSCRIPTION_BUDGET_SECONDS = 10;

/**
 * Maximum number of attempts per field in voice-guided logging before an
 * alternative input method is offered (Req 26.5).
 */
export const MAX_FIELD_ATTEMPTS = 3;

/** Stable, machine-readable error codes surfaced by voice logging. */
export const VoiceErrorCode = {
  /** Spoken input exceeds the 60 s maximum (Req 7.3). */
  InputTooLong: 'voice/input-too-long',
  /** Transcription failed or produced no recognizable text (Req 7.4). */
  TranscriptionFailed: 'voice/transcription-failed',
  /** Transcription did not complete within the 10 s budget (Req 7.3, 21.6). */
  TranscriptionTimedOut: 'voice/transcription-timed-out',
} as const;

export type VoiceErrorCode =
  (typeof VoiceErrorCode)[keyof typeof VoiceErrorCode];

// ===========================================================================
// Voice logging — models
// ===========================================================================

/** A recorded spoken input to be transcribed (Req 7.3). */
export interface VoiceAudioInput {
  /** Stable identifier for the underlying audio asset. */
  id: string;
  /** Duration of the recording in seconds. */
  durationSeconds: number;
  /** Opaque audio handle the recognizer understands. */
  data?: unknown;
}

/** The terminal outcome of a transcription attempt as reported by the ASR port. */
export type TranscriptionOutcome =
  /** Speech was transcribed; `text` may still be empty/whitespace (Req 7.4). */
  | { readonly kind: 'transcribed'; readonly text: string; readonly elapsedSeconds: number }
  /** The recognizer failed to transcribe the input (Req 7.4). */
  | { readonly kind: 'failed'; readonly reason?: string; readonly elapsedSeconds?: number };

/**
 * The result of free-form voice logging (Req 7.3): a `voice`-sourced meal entry
 * whose transcribed text is carried alongside the meal skeleton so downstream
 * nutrition lookup can resolve items from it.
 */
export interface VoiceMealEntry {
  readonly meal: import('@calorie-cortisol/shared').Meal;
  /** The transcribed spoken text that populated the entry (Req 7.3). */
  readonly transcribedText: string;
}

/** Context needed to construct a meal entry from a transcription. */
export interface VoiceMealContext {
  readonly mealId: string;
  readonly userId: string;
  /** ISO timestamp (local + offset) at which the meal was logged. */
  readonly loggedAt: string;
}

// ===========================================================================
// Voice-guided (field-by-field) logging — models (Req 26.4, 26.5)
// ===========================================================================

/**
 * A single required data field in the voice-guided flow. `validate` normalizes
 * a spoken response and returns the accepted value, or `null` when the response
 * is not recognized / invalid (Req 26.5).
 */
export interface VoiceGuidedField {
  /** Stable field identifier (e.g. `foodName`, `portion`). */
  readonly id: string;
  /** Audible prompt spoken for this field (Req 26.4). */
  readonly prompt: string;
  /** Description of the expected input, spoken on error (Req 26.5). */
  readonly expectedInput: string;
  /** Return the accepted, normalized value, or `null` if invalid (Req 26.5). */
  validate(spoken: string): string | null;
}

/** Lifecycle status of a voice-guided logging session. */
export type VoiceGuidedStatus =
  /** A field prompt is active and awaiting a spoken response. */
  | 'prompting'
  /** All required fields have been collected. */
  | 'completed'
  /** A field exhausted its attempts; an alternative input method is offered (Req 26.5). */
  | 'alternativeInput';

/**
 * The complete, serializable state of a voice-guided logging session. The UI
 * renders the active prompt / error indication from this value and drives the
 * audible output through the {@link AudioPrompter} port.
 */
export interface VoiceGuidedState {
  readonly status: VoiceGuidedStatus;
  /** Index of the field currently being prompted (0-based). */
  readonly fieldIndex: number;
  /** Failed attempts made so far on the current field (0–{@link MAX_FIELD_ATTEMPTS}). */
  readonly attempts: number;
  /** Accepted values collected so far, keyed by field id. */
  readonly collected: Readonly<Record<string, string>>;
  /** Id of the field currently being prompted, or `null` when not prompting. */
  readonly currentFieldId: string | null;
  /** Audible prompt to emit now, or `null` when completed / offering alternative. */
  readonly activePrompt: string | null;
  /** Audible error indication to emit now, or `null` when there is none (Req 26.5). */
  readonly errorIndication: string | null;
}

// ===========================================================================
// Accessibility — constants (Req 26.1)
// ===========================================================================

/** Minimum WCAG AA contrast ratio for normal text (Req 26.1). */
export const MIN_CONTRAST_NORMAL = 4.5;

/** Minimum WCAG AA contrast ratio for large text (Req 26.1). */
export const MIN_CONTRAST_LARGE = 3;

/** Minimum interactive touch-target dimension, in CSS pixels (Req 26.1). */
export const MIN_TARGET_CSS_PX = 44;

/** Point size at/above which text is "large" (Req 26.1). */
export const LARGE_TEXT_POINT_SIZE = 18;

/** Point size at/above which *bold* text is "large" (Req 26.1). */
export const LARGE_TEXT_BOLD_POINT_SIZE = 14;

/** Maximum time, in ms, allowed for a screen-reader announcement (Req 26.3). */
export const ANNOUNCEMENT_BUDGET_MS = 1000;

/** Stable, machine-readable accessibility audit codes. */
export const AccessibilityErrorCode = {
  /** An interactive element or informational image is missing name/role/state (Req 26.2). */
  MissingSemantics: 'a11y/missing-semantics',
  /** A text/background pair fails the WCAG AA contrast minimum (Req 26.1). */
  InsufficientContrast: 'a11y/insufficient-contrast',
  /** An interactive target is smaller than 44×44 CSS px (Req 26.1). */
  TargetTooSmall: 'a11y/target-too-small',
  /** Focus order does not follow the intended reading order (Req 26.6). */
  IllogicalFocusOrder: 'a11y/illogical-focus-order',
  /** A focusable element lacks a visible focus indicator (Req 26.6). */
  MissingFocusIndicator: 'a11y/missing-focus-indicator',
} as const;

export type AccessibilityErrorCode =
  (typeof AccessibilityErrorCode)[keyof typeof AccessibilityErrorCode];

// ===========================================================================
// Accessibility — models (Req 26.1, 26.2, 26.6)
// ===========================================================================

/** An sRGB color with 8-bit channels (0–255). */
export interface Color {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

/** Font attributes needed to classify text as normal vs. large (Req 26.1). */
export interface TextStyle {
  /** Point size of the text. */
  readonly pointSizePt: number;
  /** Whether the text is bold. */
  readonly bold: boolean;
}

/** ARIA-like role classification of a rendered element. */
export type A11yRole =
  | 'button'
  | 'link'
  | 'image'
  | 'text'
  | 'checkbox'
  | 'switch'
  | 'slider'
  | 'textbox'
  | 'menuitem'
  | 'tab'
  | 'heading'
  | 'other';

/**
 * A rendered UI node inspected for accessible semantics (Req 26.2). Interactive
 * elements and informational images must expose a non-empty accessible name, a
 * role, and (for interactive elements) a current state.
 */
export interface AccessibilityNode {
  /** Stable identifier for diagnostics. */
  readonly id: string;
  /** The element's role. */
  readonly role: A11yRole;
  /** Accessible name (label) exposed to assistive technology. */
  readonly accessibleName: string;
  /** Current state token (e.g. `checked`, `expanded`, `disabled`); required for interactive elements. */
  readonly state?: string;
  /** Whether the element is interactive (button, link, control…). */
  readonly interactive: boolean;
  /** Whether the element is an informational (non-decorative) image. */
  readonly informativeImage: boolean;
}

/** A rendered text run with its color pair and style, for contrast auditing. */
export interface TextContrastSample {
  readonly id: string;
  readonly foreground: Color;
  readonly background: Color;
  readonly style: TextStyle;
}

/** An interactive target with its rendered size in CSS pixels (Req 26.1). */
export interface InteractiveTarget {
  readonly id: string;
  readonly widthCssPx: number;
  readonly heightCssPx: number;
}

/** A focusable element with its intended and assigned focus positions (Req 26.6). */
export interface FocusableElement {
  readonly id: string;
  /** Position in the intended reading order (0-based). */
  readonly readingIndex: number;
  /** Position the focus system visits this element (e.g. tabindex-derived, 0-based). */
  readonly focusIndex: number;
  /** Whether a visible focus indicator is shown when focused (Req 26.6). */
  readonly hasVisibleFocusIndicator: boolean;
}

/** A full screen snapshot to audit against WCAG AA (Req 26.1, 26.2, 26.6). */
export interface AccessibilityScreen {
  readonly nodes: readonly AccessibilityNode[];
  readonly textSamples: readonly TextContrastSample[];
  readonly targets: readonly InteractiveTarget[];
  readonly focusables: readonly FocusableElement[];
}

// ===========================================================================
// Injectable ports (device / OS effects)
// ===========================================================================

/**
 * A monotonic-enough wall clock, in milliseconds since the Unix epoch, used to
 * measure screen-reader announcement latency (Req 26.3). Named distinctly from
 * other module clocks so the shared-client barrel stays unambiguous.
 */
export interface AnnouncementClock {
  now(): number;
}

/** The platform speech recognizer (ASR). Effectful, so modeled as a port. */
export interface SpeechRecognizer {
  /** Transcribe the audio and report the terminal outcome. */
  transcribe(audio: VoiceAudioInput): TranscriptionOutcome;
}

/** Emits audible field prompts and error indications for voice-guided logging (Req 26.4, 26.5). */
export interface AudioPrompter {
  /** Speak the audible prompt for a required field (Req 26.4). */
  prompt(text: string): void;
  /** Speak the audible error indication describing the expected input (Req 26.5). */
  error(text: string): void;
}

/** The active screen reader (VoiceOver / TalkBack). Effectful, so modeled as a port (Req 26.3). */
export interface ScreenReader {
  /** Whether a screen reader is currently active. */
  isActive(): boolean;
  /** Announce a state change through the screen reader. */
  announce(message: string): void;
}
