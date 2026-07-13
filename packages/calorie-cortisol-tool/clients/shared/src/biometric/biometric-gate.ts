/**
 * Biometric access gate (Task 14.19).
 *
 * Pure, deterministic gate state machine for Requirement 18. Health data stays
 * hidden until an authentication succeeds; the machine tracks consecutive
 * biometric failures, denies biometrics after 3, and routes to the fallback on
 * denial, cancel, or unavailable hardware. Device/OS effects (the biometric
 * prompt, the wall clock) are injected as ports so this logic runs identically
 * on iOS, Android, and the PWA, and in tests with no hardware at all.
 *
 * Requirements: 18.1, 18.3, 18.4, 18.5, 18.6
 */

import {
  BACKGROUND_REPROMPT_THRESHOLD_SECONDS,
  GateIndication,
  MAX_CONSECUTIVE_BIOMETRIC_FAILURES,
  type BiometricAttemptResult,
  type BiometricAuthenticator,
  type BiometricGateOptions,
  type BiometricGatePorts,
  type BiometricGateState,
} from './types';

// ---------------------------------------------------------------------------
// Pure state builders / reducers
// ---------------------------------------------------------------------------

/**
 * The initial gate state before the app is opened: health data hidden, no
 * prompt yet presented, and the app foregrounded.
 */
export function initialGateState(): BiometricGateState {
  return {
    visibility: 'hidden',
    activePrompt: 'none',
    consecutiveFailures: 0,
    biometricDenied: false,
    indication: GateIndication.None,
    backgroundedAtMs: null,
  };
}

/**
 * A freshly locked state presenting the biometric prompt (Req 18.1). Consecutive
 * failures reset because this begins a new lock cycle.
 */
export function lockedForBiometric(): BiometricGateState {
  return {
    visibility: 'hidden',
    activePrompt: 'biometric',
    consecutiveFailures: 0,
    biometricDenied: false,
    indication: GateIndication.None,
    backgroundedAtMs: null,
  };
}

/**
 * A freshly locked state presenting the fallback method with the given
 * indication (used for unavailable hardware, Req 18.5, or when biometrics are
 * disabled). The biometric path is closed for this lock cycle.
 */
export function lockedForFallback(
  indication: BiometricGateState['indication'],
): BiometricGateState {
  return {
    visibility: 'hidden',
    activePrompt: 'fallback',
    consecutiveFailures: 0,
    biometricDenied: true,
    indication,
    backgroundedAtMs: null,
  };
}

/**
 * Whether a resume at `nowMs` must re-lock the gate: true iff the app was
 * backgrounded and the elapsed time is at least
 * {@link BACKGROUND_REPROMPT_THRESHOLD_SECONDS} (Req 18.1). A resume before the
 * threshold, or when the app was never backgrounded, does not re-lock.
 */
export function shouldRepromptOnResume(
  backgroundedAtMs: number | null,
  nowMs: number,
  thresholdSeconds: number = BACKGROUND_REPROMPT_THRESHOLD_SECONDS,
): boolean {
  if (backgroundedAtMs === null) {
    return false;
  }
  const elapsedSeconds = (nowMs - backgroundedAtMs) / 1000;
  return elapsedSeconds >= thresholdSeconds;
}

/**
 * Reduce a biometric prompt outcome into the next gate state (Req 18.3–18.6).
 * Pure: given the same prior state and result it always yields the same state.
 *
 * If the biometric prompt is not the active prompt the state is returned
 * unchanged (a stray result cannot unlock or alter a fallback-only gate).
 */
export function applyBiometricResult(
  state: BiometricGateState,
  result: BiometricAttemptResult,
): BiometricGateState {
  if (state.activePrompt !== 'biometric') {
    return state;
  }

  switch (result.kind) {
    case 'success':
      // Successful match grants access to health data (Req 18.1).
      return {
        visibility: 'visible',
        activePrompt: 'none',
        consecutiveFailures: 0,
        biometricDenied: false,
        indication: GateIndication.None,
        backgroundedAtMs: null,
      };

    case 'failure': {
      const consecutiveFailures = state.consecutiveFailures + 1;
      if (consecutiveFailures >= MAX_CONSECUTIVE_BIOMETRIC_FAILURES) {
        // 3 consecutive failures: deny biometrics, present fallback (Req 18.4).
        return {
          visibility: 'hidden',
          activePrompt: 'fallback',
          consecutiveFailures,
          biometricDenied: true,
          indication: GateIndication.BiometricDenied,
          backgroundedAtMs: null,
        };
      }
      // Single (sub-threshold) failure: stay hidden, indicate, allow retry (Req 18.3).
      return {
        visibility: 'hidden',
        activePrompt: 'biometric',
        consecutiveFailures,
        biometricDenied: false,
        indication: GateIndication.BiometricNotRecognized,
        backgroundedAtMs: null,
      };
    }

    case 'cancelled':
      // Cancel keeps data hidden and presents the fallback (Req 18.6). A cancel
      // is not a failed match, so the failure count is preserved unchanged. It
      // is also not a foreground/resume/lock event, so the backgrounded marker
      // is preserved: a later resume after ≥60 s must still re-lock (Req 18.1).
      return {
        visibility: 'hidden',
        activePrompt: 'fallback',
        consecutiveFailures: state.consecutiveFailures,
        biometricDenied: state.biometricDenied,
        indication: GateIndication.BiometricCancelled,
        backgroundedAtMs: state.backgroundedAtMs,
      };

    case 'unavailable':
    default:
      // Biometrics unavailable at the OS level: present fallback (Req 18.5).
      // Like cancel, this does not clear the backgrounded marker, so a later
      // resume after ≥60 s still re-locks (Req 18.1).
      return {
        visibility: 'hidden',
        activePrompt: 'fallback',
        consecutiveFailures: state.consecutiveFailures,
        biometricDenied: true,
        indication: GateIndication.BiometricUnavailable,
        backgroundedAtMs: state.backgroundedAtMs,
      };
  }
}

/**
 * Reduce a fallback (passcode / password) attempt into the next gate state. A
 * successful fallback unlocks health data; a failed fallback keeps data hidden
 * and re-presents the fallback for another attempt.
 */
export function applyFallbackResult(
  state: BiometricGateState,
  success: boolean,
): BiometricGateState {
  if (state.activePrompt !== 'fallback') {
    return state;
  }
  if (success) {
    return {
      visibility: 'visible',
      activePrompt: 'none',
      consecutiveFailures: 0,
      biometricDenied: false,
      indication: GateIndication.None,
      backgroundedAtMs: null,
    };
  }
  // A failed fallback attempt is not a foreground/resume/lock event, so the
  // backgrounded marker is preserved (a later resume after ≥60 s re-locks;
  // Req 18.1). Only visibility, prompt, and indication change.
  return {
    ...state,
    visibility: 'hidden',
    activePrompt: 'fallback',
    indication: GateIndication.FallbackNotRecognized,
  };
}

/** Whether protected health data may be displayed for the given state. */
export function isHealthDataVisible(state: BiometricGateState): boolean {
  return state.visibility === 'visible';
}

// ---------------------------------------------------------------------------
// Stateful gate façade (wires the pure reducers to the injected ports)
// ---------------------------------------------------------------------------

/**
 * The biometric access gate: a thin stateful wrapper that drives the pure
 * reducers above using the injected {@link BiometricAuthenticator} and
 * {@link Clock} ports. It exposes the app lifecycle events (open, background,
 * resume) and the unlock attempts (biometric, fallback) the UI calls.
 */
export class BiometricAccessGate {
  private state: BiometricGateState;

  private readonly clock: BiometricGatePorts['clock'];

  private readonly authenticator: BiometricAuthenticator;

  private readonly biometricEnabled: boolean;

  constructor(ports: BiometricGatePorts, options: BiometricGateOptions = {}) {
    this.clock = ports.clock;
    this.authenticator = ports.authenticator;
    this.biometricEnabled = options.biometricEnabled ?? true;
    this.state = initialGateState();
  }

  /** The current gate state (health data visibility, active prompt, indication). */
  get current(): BiometricGateState {
    return this.state;
  }

  /** Whether protected health data may currently be displayed. */
  get healthDataVisible(): boolean {
    return isHealthDataVisible(this.state);
  }

  /**
   * Handle app open: lock the gate and present the appropriate prompt before
   * any health data is displayed (Req 18.1). Biometrics are presented when
   * enabled and available; otherwise the fallback is presented (Req 18.5).
   */
  open(): BiometricGateState {
    this.state = this.lock();
    return this.state;
  }

  /**
   * Record that the app has been backgrounded, capturing the clock time so a
   * later {@link resume} can measure the elapsed interval (Req 18.1).
   */
  background(): BiometricGateState {
    this.state = { ...this.state, backgroundedAtMs: this.clock.now() };
    return this.state;
  }

  /**
   * Handle app resume: re-lock and re-prompt when the app was backgrounded for
   * at least {@link BACKGROUND_REPROMPT_THRESHOLD_SECONDS} (Req 18.1). A shorter
   * background interval leaves the current state (and any granted visibility)
   * intact and simply clears the backgrounded marker.
   */
  resume(): BiometricGateState {
    const reprompt = shouldRepromptOnResume(
      this.state.backgroundedAtMs,
      this.clock.now(),
    );
    this.state = reprompt
      ? this.lock()
      : { ...this.state, backgroundedAtMs: null };
    return this.state;
  }

  /**
   * Attempt a biometric match against the current prompt. No-op unless the
   * biometric prompt is active. On success health data becomes visible; on
   * failure/cancel/unavailable the gate follows Req 18.3–18.6.
   */
  attemptBiometric(): BiometricGateState {
    if (this.state.activePrompt !== 'biometric') {
      return this.state;
    }
    const result = this.authenticator.authenticate();
    this.state = applyBiometricResult(this.state, result);
    return this.state;
  }

  /**
   * Submit a fallback (passcode / password) result. On success health data
   * becomes visible; on failure the fallback is re-presented.
   */
  submitFallback(success: boolean): BiometricGateState {
    this.state = applyFallbackResult(this.state, success);
    return this.state;
  }

  /**
   * Compute a fresh locked state, choosing biometric vs. fallback based on
   * whether biometrics are enabled (option) and available (port) (Req 18.1, 18.5).
   */
  private lock(): BiometricGateState {
    if (!this.biometricEnabled) {
      return lockedForFallback(GateIndication.None);
    }
    if (!this.authenticator.isAvailable()) {
      return lockedForFallback(GateIndication.BiometricUnavailable);
    }
    return lockedForBiometric();
  }
}
