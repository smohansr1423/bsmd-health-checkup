/**
 * Biometric access gate — types, constants, and injectable ports (Task 14.19).
 *
 * The biometric access gate is the shared-client component that decides, purely
 * and deterministically, whether on-device health data may be displayed. It
 * enforces Requirement 18 (Biometric Authentication) on every app open and on
 * every resume after the app has been backgrounded for 60 seconds or longer:
 *
 *   - health data stays hidden until an authentication succeeds (Req 18.1)
 *   - a single failed biometric attempt keeps data hidden, surfaces a
 *     "not recognized" indication, and allows a retry (Req 18.3)
 *   - 3 consecutive failed biometric attempts deny biometrics and present the
 *     fallback (passcode / password) method (Req 18.4)
 *   - no enrolled biometric hardware, or biometrics unavailable at the OS level,
 *     presents the fallback with an "unavailable" indication (Req 18.5)
 *   - cancelling the biometric prompt keeps data hidden and presents the
 *     fallback (Req 18.6)
 *
 * All device / OS effects are modeled behind injectable ports
 * ({@link BiometricAuthenticator}, {@link Clock}) so the gate logic itself is
 * pure and testable — no real Face ID, Touch ID, Android Biometric, or system
 * clock dependency is required to exercise it. The gate therefore runs
 * identically on iOS (LocalAuthentication), Android (Biometric), and the PWA.
 *
 * Requirements: 18.1, 18.3, 18.4, 18.5, 18.6
 */

// ---------------------------------------------------------------------------
// Constants (single source of truth for the Requirement 18 thresholds)
// ---------------------------------------------------------------------------

/**
 * Time in seconds the app must have been backgrounded before a resume forces
 * re-authentication. A resume at or beyond this threshold re-locks the gate
 * (Req 18.1).
 */
export const BACKGROUND_REPROMPT_THRESHOLD_SECONDS = 60;

/**
 * Number of consecutive failed biometric attempts after which biometrics are
 * denied and the fallback method is presented (Req 18.4).
 */
export const MAX_CONSECUTIVE_BIOMETRIC_FAILURES = 3;

/**
 * Stable, machine-readable indications the gate surfaces to the UI describing
 * why the current prompt is shown. The UI maps these to localized copy.
 */
export const GateIndication = {
  /** No indication to display (initial, or after a successful unlock). */
  None: 'biometric/none',
  /** A single biometric attempt was not recognized; retry allowed (Req 18.3). */
  BiometricNotRecognized: 'biometric/not-recognized',
  /** 3 consecutive biometric failures; biometrics denied, fallback shown (Req 18.4). */
  BiometricDenied: 'biometric/denied-max-attempts',
  /** No enrolled hardware or OS-level biometrics unavailable; fallback shown (Req 18.5). */
  BiometricUnavailable: 'biometric/unavailable',
  /** The user cancelled the biometric prompt; fallback shown (Req 18.6). */
  BiometricCancelled: 'biometric/cancelled',
  /** A fallback (passcode/password) attempt was not recognized; retry allowed. */
  FallbackNotRecognized: 'biometric/fallback-not-recognized',
} as const;

export type GateIndication =
  (typeof GateIndication)[keyof typeof GateIndication];

// ---------------------------------------------------------------------------
// Gate model
// ---------------------------------------------------------------------------

/** Whether protected health data may currently be displayed (Req 18.1). */
export type HealthDataVisibility = 'hidden' | 'visible';

/**
 * Which unlock method (if any) is currently presented to the user:
 *   - `biometric` — the biometric prompt is active and may be attempted.
 *   - `fallback`  — the passcode / password method is presented (Req 18.4–18.6).
 *   - `none`      — no prompt is active (health data is visible / unlocked).
 */
export type ActivePrompt = 'biometric' | 'fallback' | 'none';

/**
 * The complete, serializable state of the access gate. This is the single
 * value the UI renders from: it decides visibility of health data, which prompt
 * to show, and which indication to surface.
 */
export interface BiometricGateState {
  /** Whether health data may be displayed. Hidden until an unlock succeeds. */
  readonly visibility: HealthDataVisibility;
  /** Which unlock prompt is currently presented. */
  readonly activePrompt: ActivePrompt;
  /** Count of consecutive failed biometric attempts (0–{@link MAX_CONSECUTIVE_BIOMETRIC_FAILURES}). */
  readonly consecutiveFailures: number;
  /**
   * Whether the biometric path is closed for this lock cycle — either because
   * 3 consecutive attempts failed (Req 18.4) or biometrics are unavailable
   * (Req 18.5). While true the fallback is the only available method.
   */
  readonly biometricDenied: boolean;
  /** Machine-readable reason for the current prompt, for the UI to localize. */
  readonly indication: GateIndication;
  /**
   * Clock time (ms since epoch) at which the app was last backgrounded, or
   * `null` if the app is foregrounded. Used to decide whether a resume crosses
   * the {@link BACKGROUND_REPROMPT_THRESHOLD_SECONDS} threshold (Req 18.1).
   */
  readonly backgroundedAtMs: number | null;
}

/** The outcome of a single biometric prompt as reported by the OS. */
export type BiometricAttemptResult =
  /** The biometric match succeeded (Req 18.1 grants access). */
  | { readonly kind: 'success' }
  /** The biometric match was not recognized (Req 18.3 / 18.4). */
  | { readonly kind: 'failure'; readonly reason?: string }
  /** The user dismissed the prompt without attempting a match (Req 18.6). */
  | { readonly kind: 'cancelled' }
  /** Biometrics became unavailable at the OS level during the prompt (Req 18.5). */
  | { readonly kind: 'unavailable' };

// ---------------------------------------------------------------------------
// Injectable ports (device / OS effects)
// ---------------------------------------------------------------------------

/** A monotonic-enough wall clock, in milliseconds since the Unix epoch. */
export interface Clock {
  /** Current time in milliseconds since the Unix epoch. */
  now(): number;
}

/**
 * The platform biometric authenticator (Face ID / Touch ID / Android
 * Biometric). Both methods are effectful and modeled as ports so the gate is
 * pure and testable.
 */
export interface BiometricAuthenticator {
  /**
   * Whether biometric hardware is enrolled AND biometrics are available at the
   * OS level right now. When false, the gate presents the fallback with the
   * {@link GateIndication.BiometricUnavailable} indication (Req 18.5).
   */
  isAvailable(): boolean;
  /** Present the biometric prompt and report its terminal outcome. */
  authenticate(): BiometricAttemptResult;
}

/** The effect ports the {@link BiometricAccessGate} depends on. */
export interface BiometricGatePorts {
  readonly clock: Clock;
  readonly authenticator: BiometricAuthenticator;
}

/** Options controlling gate behavior. */
export interface BiometricGateOptions {
  /**
   * Whether biometric authentication is enabled for this user (Req 18.1 is
   * conditioned on "WHERE biometric authentication is enabled"). When false,
   * the gate locks straight to the fallback method with no biometric prompt.
   * Defaults to `true`.
   */
  readonly biometricEnabled?: boolean;
}
